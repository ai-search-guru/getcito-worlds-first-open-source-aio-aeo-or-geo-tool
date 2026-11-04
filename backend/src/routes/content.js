import { STATUS_CODES } from 'node:http';
import { Router } from 'express';
import { generateObject } from 'ai';
import { z } from 'zod';
import {
  requireFeature,
  enforceBriefQuota,
  getBriefQuotaStatus,
  getContentUsage,
  getOpportunityRequestAllowance,
  getOrgIdForUser,
  PlanLimitError,
} from '../lib/planGuard.js';
import { createJob, getJob } from '../lib/jobManager.js';
import { runContentJob } from '../lib/jobRunner.js';
import { resolveModel } from '../lib/aiProvider.js';
import { getLanguageName } from '../lib/languages.js';
import supabaseAdmin from '../config/supabase.js';
import { selectInChunks } from '../lib/chunkedIn.js';
import { isRedirect, postJson } from '../lib/safePost.js';
import { webhookTestLimiter } from '../middleware/rateLimiter.js';
import {
  MANAGER_ROLES,
  assertBrandAccess,
  assertOpportunitiesAccess,
  assertOpportunityAccess,
  assertPromptAccess,
  assertRole,
} from '../lib/access.js';
import { loadClusters } from '../lib/promptClusters.js';
import { loadNeedAvailability } from '../lib/opportunityAvailability.js';
import { sendToActionCenter } from '../lib/action-center/fromOpportunity.js';
import { IDEA_MAX_LENGTH } from '../lib/opportunityGenerator.js';
import { cleanStoredOpportunity } from '../lib/opportunityText.js';
import { sourceDataForStatus, VALID_OPPORTUNITY_STATUSES } from '../lib/opportunityStatus.js';
import {
  openOpportunityForPrompt,
  promptClusterId,
  promptSuggestionRequest,
  runningSuggestionJob,
} from '../lib/promptContentSuggestion.js';

/** What a send says of a webhook that redirects, and the test too: nothing reaches where it points. */
const WEBHOOK_REDIRECT_ERROR = 'The webhook address redirects. Use the address it redirects to.';

const router = Router();

/** The job a repeated "+ New" or alternative request already started. */
async function startedJob(brandId, idempotencyKey) {
  const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString();
  const { data } = await supabaseAdmin
    .from('jobs')
    .select('id, data')
    .eq('type', 'content')
    .eq('brand_id', brandId)
    .eq('data->request->>idempotencyKey', idempotencyKey)
    .gte('created_at', since)
    .limit(1)
    .maybeSingle();
  return data;
}

/** What one request may ask for; self-hosted setups without an org have no quota. */
function requestAllowance(orgId) {
  return orgId
    ? getOpportunityRequestAllowance(orgId)
    : { perRequest: 5, remaining: -1, max: 5, periodEnd: null, planId: 'self_hosted' };
}

function quotaExhausted(res, allowance) {
  return res.status(429).json({
    success: false,
    error: 'quota_exhausted',
    message: 'Monthly opportunity limit reached.',
    periodEnd: allowance.periodEnd,
    plan: allowance.planId,
  });
}

/**
 * The brand's competitor names, which opportunity text is checked against
 * when it's read (CONTENT-005).
 */
async function competitorNames(brandId) {
  const { data } = await supabaseAdmin.from('competitors').select('name').eq('brand_id', brandId);
  return (data || []).map((c) => c.name);
}

/**
 * The API's opportunity. Text is shown cleaned of leaked internal indexes and
 * misspelled competitor names; the stored row is left as it is.
 */
function mapOpportunityRow(stored, competitors = []) {
  const row = cleanStoredOpportunity(stored, competitors);
  return {
    id: row.id,
    brandId: row.brand_id,
    promptId: row.prompt_id,
    clusterId: row.cluster_id ?? null,
    decision: row.decision ?? null,
    title: row.title,
    description: row.description,
    type: row.type,
    impact: row.impact,
    opportunityScore: parseFloat(row.opportunity_score),
    status: row.status,
    source: row.source ?? 'system',
    sourceData: row.source_data || {},
    brief: row.brief || null,
    webhookSentAt: row.webhook_sent_at,
    webhookResponse: row.webhook_response,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Generating opportunities and briefs costs AI: admins and managers start it (2026-10-29). */
const GENERATE_OPPORTUNITIES_REFUSAL = 'Only admins and managers can generate opportunities.';
const GENERATE_BRIEF_REFUSAL = 'Only admins and managers can generate briefs.';

/**
 * POST /api/content/generate
 * Enqueues a content opportunity generation job. Returns { jobId } immediately.
 */
router.post('/generate', requireFeature('content_optimization'), async (req, res) => {
  try {
    const { brandId, model } = req.body;

    if (!brandId) {
      return res.status(400).json({ error: 'brandId is required' });
    }

    await assertBrandAccess(brandId, req.user.id);
    await assertRole(req.user.id, MANAGER_ROLES, GENERATE_OPPORTUNITIES_REFUSAL);

    const job = await createJob({
      type: 'content',
      brandId,
      data: { brandId, model: model || null },
      maxAttempts: 2,
    });

    const io = req.app.get('io');
    runContentJob(job.id, io);

    return res.json({
      success: true,
      jobId: job.id,
      message: 'Content generation job enqueued',
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    req.log.error({ err: error }, 'content enqueue error');
    return res.status(500).json({ error: error.message });
  }
});

const onDemandSchema = z.object({
  brandId: z.guid(),
  count: z.number().int().min(1).max(20),
  topicId: z.guid().nullish(),
  promptId: z.guid().nullish(),
  idea: z.string().trim().max(IDEA_MAX_LENGTH).nullish(),
  // One page of the AI Traffic page's Pages section (AT-006 part B3), as a path.
  pagePath: z.string().min(1).max(2048).startsWith('/').nullish(),
  idempotencyKey: z.string().min(8).max(100),
});

/** How long a repeated idempotency key returns the job it first started. */
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

/**
 * POST /api/content/opportunities/generate
 * "+ New" (CONTENT-003): generate opportunities now instead of waiting for
 * the nightly run, optionally around a topic, a prompt or a free-text idea,
 * or for one page ("Suggest content" on AI Traffic's Pages, AT-006 part B3:
 * one opportunity, from the clusters about the page).
 * Body: { brandId, count, topicId?, promptId?, idea?, pagePath?, idempotencyKey }.
 *
 * The count is capped by the plan (Starter 3, Growth 5 per request) and by
 * what is left of the month; the generation claims its quota slots
 * atomically, so neither a double click nor two tabs can overshoot, and it
 * hands back whatever it doesn't create. A repeated idempotency key returns
 * the job it already started. Returns { jobId, count } (202), or 429 with
 * error 'quota_exhausted' and the reset date when nothing is left.
 */
router.post('/opportunities/generate', requireFeature('content_optimization'), async (req, res) => {
  const parsed = onDemandSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  }
  const { brandId, count, topicId, promptId, idea, pagePath, idempotencyKey } = parsed.data;

  try {
    const { orgId } = await assertBrandAccess(brandId, req.user.id);
    await assertRole(req.user.id, MANAGER_ROLES, GENERATE_OPPORTUNITIES_REFUSAL);

    const previous = await startedJob(brandId, idempotencyKey);
    if (previous) {
      return res.status(202).json({ jobId: previous.id, count: previous.data.request.count });
    }

    const allowance = await requestAllowance(orgId);
    if (allowance.max <= 0) return quotaExhausted(res, allowance);

    const request = {
      // A page gets one opportunity.
      count: pagePath ? 1 : Math.min(count, allowance.max),
      topicId: topicId ?? null,
      promptId: promptId ?? null,
      // A prompt picked by name is asked for on purpose, as its own Suggest
      // content (PROMPT-006): a dismissed or finished opportunity on its need
      // doesn't hold it back, an open one does.
      explicit: !!promptId,
      idea: idea || null,
      pagePath: pagePath ?? null,
      idempotencyKey,
    };
    const job = await createJob({
      type: 'content',
      brandId,
      data: { brandId, model: null, request },
      maxAttempts: 2,
    });
    runContentJob(job.id, req.app.get('io'));

    return res.status(202).json({ jobId: job.id, count: request.count });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'plan_limit',
        message: error.message,
      });
    }
    if (error.status) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    req.log.error({ err: error }, 'on-demand opportunity generation error');
    return res.status(500).json({ error: 'Failed to start generation' });
  }
});

const alternativeSchema = z.object({
  direction: z.string().trim().max(IDEA_MAX_LENGTH).nullish(),
  idempotencyKey: z.string().min(8).max(100),
});

/**
 * The cluster an alternative is written for: the opportunity's own, or, for
 * one from the per-prompt generator, the cluster its prompt is in today.
 */
async function alternativeCluster(opp) {
  if (opp.cluster_id) return opp.cluster_id;
  return opp.prompt_id ? promptClusterId(opp.prompt_id) : null;
}

/**
 * POST /api/content/:id/alternative
 * "Another angle" (CONTENT-006): one more opportunity for the same need with
 * a different angle, optionally steered by `direction`. It stands beside the
 * original (source_data.alternativeOf), uses one quota slot (handed back on
 * failure) and skips the duplicate check, since the user asked for it.
 * Body: { direction?, idempotencyKey }. Returns { jobId } (202); 409
 * 'no_cluster' when the prompt isn't in any cluster; 429 'quota_exhausted'.
 */
router.post('/:id/alternative', requireFeature('content_optimization'), async (req, res) => {
  const parsed = alternativeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  }
  const { direction, idempotencyKey } = parsed.data;

  try {
    const opp = await assertOpportunityAccess(req.params.id, req.user.id);
    await assertRole(req.user.id, MANAGER_ROLES, GENERATE_OPPORTUNITIES_REFUSAL);
    const previous = await startedJob(opp.brand_id, idempotencyKey);
    if (previous) return res.status(202).json({ jobId: previous.id });

    const clusterId = await alternativeCluster(opp);
    if (!clusterId) {
      return res.status(409).json({
        error: 'no_cluster',
        message:
          "This opportunity's prompt isn't grouped yet, so there's no need to write another angle for.",
      });
    }

    const allowance = await requestAllowance(await getOrgIdForUser(req.user.id));
    if (allowance.max <= 0) return quotaExhausted(res, allowance);

    // The model sees the original as users read it.
    const readable = cleanStoredOpportunity(opp, await competitorNames(opp.brand_id));
    const request = {
      count: 1,
      idea: direction || null,
      alternativeOf: {
        id: opp.id,
        title: readable.title,
        description: readable.description ?? null,
        decision: opp.decision ?? null,
        clusterId,
      },
      idempotencyKey,
    };
    const job = await createJob({
      type: 'content',
      brandId: opp.brand_id,
      data: { brandId: opp.brand_id, model: null, request },
      maxAttempts: 2,
    });
    runContentJob(job.id, req.app.get('io'));

    return res.status(202).json({ jobId: job.id });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'plan_limit',
        message: error.message,
      });
    }
    if (error.status) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    req.log.error({ err: error }, 'alternative opportunity error');
    return res.status(500).json({ error: 'Failed to start generation' });
  }
});

/**
 * GET /api/content/prompts/:promptId/suggestion
 * The prompt's open content opportunity, if any: { existingId } (or null).
 * The row menu asks once the month's quota is used up, so a prompt that
 * already has a suggestion can still open it (PROMPT-006).
 */
router.get(
  '/prompts/:promptId/suggestion',
  // Reads only: a workspace whose plan ended still opens its suggestion.
  requireFeature('content_optimization', { readOnly: true }),
  async (req, res) => {
    const { promptId } = req.params;
    try {
      const [prompt] = await assertPromptAccess(promptId, req.user.id);
      const existingId = await openOpportunityForPrompt(prompt.prompt_sets.brand_id, promptId);
      return res.json({ existingId });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      req.log.error({ err: error }, 'prompt content suggestion lookup error');
      return res.status(500).json({ error: 'Failed to look up the suggestion' });
    }
  },
);

const promptSuggestionSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
});

/**
 * POST /api/content/prompts/:promptId/suggest
 * "Suggest content" from a prompt's row in the prompts table (PROMPT-006).
 * Returns { existingId } (200) when an open opportunity already answers the
 * prompt, so the page offers that one instead of a duplicate. Otherwise it
 * queues exactly one opportunity for the prompt's cluster, tagged `prompt`,
 * against the monthly quota (its slot handed back on failure): { jobId }
 * (202), or 429 'quota_exhausted'. A repeated idempotency key, or a
 * suggestion for the prompt that is still being written, returns that job.
 * The job's result carries the new opportunity's id.
 */
router.post(
  '/prompts/:promptId/suggest',
  requireFeature('content_optimization'),
  async (req, res) => {
    const parsed = promptSuggestionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    const { promptId } = req.params;
    const { idempotencyKey } = parsed.data;

    try {
      const [prompt] = await assertPromptAccess(promptId, req.user.id);
      await assertRole(req.user.id, MANAGER_ROLES, GENERATE_OPPORTUNITIES_REFUSAL);
      const { brand_id: brandId, brands } = prompt.prompt_sets;

      const previous = await startedJob(brandId, idempotencyKey);
      if (previous) return res.status(202).json({ jobId: previous.id });

      // A suggestion still being written is followed, not started twice.
      const running = await runningSuggestionJob(brandId, promptId);
      if (running) return res.status(202).json({ jobId: running });

      const existingId = await openOpportunityForPrompt(brandId, promptId);
      if (existingId) return res.json({ existingId });

      const allowance = await requestAllowance(brands.organization_id);
      if (allowance.max <= 0) return quotaExhausted(res, allowance);

      const job = await createJob({
        type: 'content',
        brandId,
        data: { brandId, model: null, request: promptSuggestionRequest(promptId, idempotencyKey) },
        maxAttempts: 2,
      });
      runContentJob(job.id, req.app.get('io'));

      return res.status(202).json({ jobId: job.id });
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return res.status(error.statusCode).json({
          success: false,
          error: 'plan_limit',
          message: error.message,
        });
      }
      if (error.status) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      req.log.error({ err: error }, 'prompt content suggestion error');
      return res.status(500).json({ error: 'Failed to start generation' });
    }
  },
);

/**
 * GET /api/content/job/:jobId
 * Returns job state and progress for content generation.
 */
router.get('/job/:jobId', async (req, res) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job) {
      return res.json({ success: true, status: 'not_found' });
    }

    await assertBrandAccess(job.brand_id, req.user.id);

    const progress = job.progress || {};

    return res.json({
      success: true,
      status: job.status,
      progress: progress && typeof progress === 'object' && progress.phase ? progress : null,
      result: job.status === 'completed' ? job.result : null,
      failedReason: job.status === 'failed' ? job.failed_reason : null,
    });
  } catch (error) {
    req.log.error({ err: error }, 'content job status error');
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

/**
 * The cluster a filtered prompt belongs to, and the clusters of a filtered
 * topic, so the list can match opportunities through their clusters (#857).
 * Both are scoped to the brand, so ids from another brand match nothing.
 */
async function clusterScope(brandId, promptId, topicId) {
  const [memberRes, topicRes] = await Promise.all([
    promptId
      ? supabaseAdmin
          .from('prompt_cluster_members')
          .select('cluster_id, prompt_clusters!inner(brand_id)')
          .eq('prompt_id', promptId)
          .eq('prompt_clusters.brand_id', brandId)
          .maybeSingle()
      : { data: null },
    topicId
      ? supabaseAdmin
          .from('prompt_clusters')
          .select('id')
          .eq('brand_id', brandId)
          .eq('topic_id', topicId)
      : { data: [] },
  ]);
  if (memberRes.error) throw new Error(memberRes.error.message);
  if (topicRes.error) throw new Error(topicRes.error.message);
  return {
    promptCluster: memberRes.data?.cluster_id ?? null,
    topicClusters: (topicRes.data || []).map((c) => c.id),
  };
}

/**
 * GET /api/content/brand/:brandId
 * List opportunities for a brand with optional filters.
 */
router.get('/brand/:brandId', async (req, res) => {
  try {
    const { brandId } = req.params;
    await assertBrandAccess(brandId, req.user.id);
    const {
      status,
      impact,
      type,
      q,
      prompt_id: promptId,
      topic_id: topicId,
      source,
      created_from: createdFrom,
      created_to: createdTo,
      limit = 50,
      offset = 0,
      sort = 'score',
    } = req.query;

    const search = q ? String(q).replace(/[,()]/g, ' ') : null;
    const isoOrNull = (v) => (v && Number.isFinite(Date.parse(String(v))) ? String(v) : null);
    const fromBound = isoOrNull(createdFrom);
    const toBound = isoOrNull(createdTo);
    const { promptCluster, topicClusters } = await clusterScope(
      brandId,
      promptId ? String(promptId) : null,
      topicId ? String(topicId) : null,
    );
    const applyFilters = (query) => {
      let filteredQuery = query.eq('brand_id', brandId);

      // Archived opportunities (the per-prompt backlog, #857) show only when asked for.
      filteredQuery = status
        ? filteredQuery.eq('status', status)
        : filteredQuery.neq('status', 'archived');

      if (impact) {
        filteredQuery = filteredQuery.eq('impact', impact);
      }

      if (type) {
        filteredQuery = filteredQuery.eq('type', type);
      }

      // system (nightly), manual ("+ New") or prompt ("Suggest Content").
      if (source) {
        filteredQuery = filteredQuery.eq('source', source);
      }

      // When it was suggested (CONTENT-002's date filter).
      if (fromBound) filteredQuery = filteredQuery.gte('created_at', fromBound);
      if (toBound) filteredQuery = filteredQuery.lte('created_at', toBound);

      // A prompt matches its cluster's opportunities, own or merged, and any
      // older opportunity written for the prompt itself.
      if (promptId) {
        filteredQuery = promptCluster
          ? filteredQuery.or(
              `prompt_id.eq.${promptId},cluster_id.eq.${promptCluster},related_cluster_ids.cs.{${promptCluster}}`,
            )
          : filteredQuery.eq('prompt_id', promptId);
      }

      if (topicId) {
        filteredQuery = topicClusters.length
          ? filteredQuery.or(
              `cluster_id.in.(${topicClusters.join(',')}),related_cluster_ids.ov.{${topicClusters.join(',')}}`,
            )
          : filteredQuery.in('id', []);
      }

      if (q) {
        filteredQuery = filteredQuery.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
      }

      return filteredQuery;
    };

    let dataQuery = supabaseAdmin.from('content_opportunities').select('*', { count: 'exact' });

    dataQuery = applyFilters(dataQuery);

    if (sort === 'score') {
      dataQuery = dataQuery.order('opportunity_score', {
        ascending: false,
      });
    } else if (sort === 'newest' || sort === 'oldest') {
      dataQuery = dataQuery.order('created_at', {
        ascending: sort === 'oldest',
      });
    }
    // One generation writes many rows at the same moment and score; id keeps
    // their order stable, so paging never repeats or skips a row.
    dataQuery = dataQuery.order('id', { ascending: true });

    dataQuery = dataQuery.range(Number(offset), Number(offset) + Number(limit) - 1);

    const aggregateQuery = supabaseAdmin.rpc('content_opportunity_aggregates', {
      p_brand_id: brandId,
      p_status: status ? String(status) : null,
      p_impact: impact ? String(impact) : null,
      p_type: type ? String(type) : null,
      p_q: search,
      p_prompt_id: promptId ? String(promptId) : null,
      p_topic_id: topicId ? String(topicId) : null,
      p_source: source ? String(source) : null,
      p_created_from: fromBound,
      p_created_to: toBound,
    });

    const [
      { data, error: dataError, count },
      { data: aggregateData, error: aggregateError },
      competitors,
    ] = await Promise.all([dataQuery, aggregateQuery, competitorNames(brandId)]);

    if (dataError) {
      throw new Error(dataError.message);
    }

    if (aggregateError) {
      throw new Error(aggregateError.message);
    }

    const aggregates = aggregateData?.[0] ?? {
      avg_score: 0,
      high_impact_count: 0,
      sent_count: 0,
      signal_count: 0,
    };

    return res.json({
      opportunities: (data || []).map((row) => mapOpportunityRow(row, competitors)),

      total: count || 0,

      aggregates: {
        avgScore: Math.round(Number(aggregates.avg_score) || 0),
        highImpactCount: Number(aggregates.high_impact_count) || 0,
        sentCount: Number(aggregates.sent_count) || 0,
        signalCount: Number(aggregates.signal_count) || 0,
      },
    });
  } catch (error) {
    req.log.error({ err: error }, 'list opportunities error');

    return res.status(error.status || 500).json({
      error: 'Failed to list opportunities',
      details: error.message,
    });
  }
});

const FACET_PAGE_SIZE = 1000;

/**
 * A brand's listed (not archived) opportunities with the prompts each one
 * answers: its cluster's members, merged clusters included, or for an older
 * per-prompt opportunity its prompt_id (#857). Paged: PostgREST caps a
 * response at 1,000 rows and a large brand holds more opportunities.
 */
async function opportunityPrompts(brandId) {
  const opportunities = [];
  for (let from = 0; ; from += FACET_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .select('prompt_id, cluster_id, related_cluster_ids')
      .eq('brand_id', brandId)
      .neq('status', 'archived')
      .order('id')
      .range(from, from + FACET_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    opportunities.push(...(data || []));
    if (!data || data.length < FACET_PAGE_SIZE) break;
  }

  const clusters = await loadClusters(brandId);
  const byCluster = new Map(clusters.map((c) => [c.id, c]));
  return {
    clusters: byCluster,
    rows: opportunities.map((o) => {
      const ids = [o.cluster_id, ...(o.related_cluster_ids || [])].filter((id) =>
        byCluster.has(id),
      );
      return {
        clusterIds: ids,
        promptIds: ids.length
          ? ids.flatMap((id) => byCluster.get(id).prompt_ids)
          : [o.prompt_id].filter(Boolean),
      };
    }),
  };
}

/**
 * GET /api/content/brand/:brandId/prompts
 * The prompts this brand's opportunities answer, with how many each has,
 * most first — the options for the Content page's prompt filter (#836).
 * Opportunities whose prompt was deleted are left out: there is nothing to
 * name them by.
 */
router.get('/brand/:brandId/prompts', async (req, res) => {
  try {
    const { brandId } = req.params;
    await assertBrandAccess(brandId, req.user.id);

    const { rows } = await opportunityPrompts(brandId);
    const counts = new Map();
    for (const row of rows) {
      for (const id of new Set(row.promptIds)) counts.set(id, (counts.get(id) || 0) + 1);
    }

    const { data: prompts, error: promptError } = await selectInChunks(
      [...counts.keys()],
      (chunk) => supabaseAdmin.from('prompts').select('id, text').in('id', chunk),
    );
    if (promptError) throw new Error(promptError.message);

    return res.json({
      prompts: (prompts || [])
        .map((p) => ({ promptId: p.id, text: p.text, count: counts.get(p.id) || 0 }))
        .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)),
    });
  } catch (error) {
    req.log.error({ err: error }, 'list opportunity prompts error');
    return res.status(error.status || 500).json({ error: 'Failed to list opportunity prompts' });
  }
});

/**
 * GET /api/content/brand/:brandId/topics
 * The topics this brand's opportunities belong to, through their own or
 * merged clusters, with how many each has — the topic filter's options.
 */
router.get('/brand/:brandId/topics', async (req, res) => {
  try {
    const { brandId } = req.params;
    await assertBrandAccess(brandId, req.user.id);

    const { rows, clusters } = await opportunityPrompts(brandId);
    const counts = new Map();
    for (const row of rows) {
      const topics = new Set(row.clusterIds.map((id) => clusters.get(id).topic_id).filter(Boolean));
      for (const id of topics) counts.set(id, (counts.get(id) || 0) + 1);
    }

    const { data: topics, error } = await supabaseAdmin
      .from('topics')
      .select('id, name')
      .eq('brand_id', brandId);
    if (error) throw new Error(error.message);

    return res.json({
      topics: (topics || [])
        .filter((t) => counts.has(t.id))
        .map((t) => ({ topicId: t.id, name: t.name, count: counts.get(t.id) }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    });
  } catch (error) {
    req.log.error({ err: error }, 'list opportunity topics error');
    return res.status(error.status || 500).json({ error: 'Failed to list opportunity topics' });
  }
});

/**
 * GET /api/content/brand/:brandId/availability
 * What "+ New" can still write for (opportunityAvailability.js): per topic
 * and in all, the needs with answers and no opportunity yet, and the prompts
 * whose need has an open opportunity, so its dialog doesn't send a request
 * that writes nothing.
 */
router.get(
  '/brand/:brandId/availability',
  requireFeature('content_optimization', { readOnly: true }),
  async (req, res) => {
    try {
      const { brandId } = req.params;
      await assertBrandAccess(brandId, req.user.id);
      return res.json(await loadNeedAvailability(brandId));
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      req.log.error({ err: error }, 'opportunity availability error');
      return res.status(500).json({ error: 'Failed to read what New can write for' });
    }
  },
);

/**
 * POST /api/content/bulk/status
 * Update the status of multiple opportunities at once: admins and managers,
 * as the database's update rule on content_opportunities.
 */
router.post('/bulk/status', async (req, res) => {
  try {
    const { ids, status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const validStatuses = VALID_OPPORTUNITY_STATUSES;
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    await assertOpportunitiesAccess(ids, req.user.id);
    await assertRole(
      req.user.id,
      MANAGER_ROLES,
      'Only admins and managers can change opportunities in bulk.',
    );

    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', ids)
      .select('id');

    if (error) throw new Error(error.message);

    return res.json({ updated: data?.length || 0 });
  } catch (error) {
    req.log.error({ err: error }, 'bulk status update error');
    return res.status(error.status || 500).json({
      error: 'Failed to bulk update status',
      details: error.message,
    });
  }
});

/**
 * POST /api/content/bulk/delete
 *
 * Permanently remove opportunities (#731). Dismissing only hides a row behind
 * a status filter, which is no help to a brand carrying hundreds of stale
 * suggestions — this is the way to actually clear them.
 *
 * The generated brief lives on the opportunity row, so deleting takes it with
 * it. `brief_usage.opportunity_id` is ON DELETE SET NULL, so the metered usage
 * record survives and quota already spent stays spent — deleting must not hand
 * back a brief allowance. Admins and managers only, as the database's delete
 * rule.
 */
router.post('/bulk/delete', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    await assertOpportunitiesAccess(ids, req.user.id);
    await assertRole(
      req.user.id,
      MANAGER_ROLES,
      'Only admins and managers can delete opportunities.',
    );

    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .delete()
      .in('id', ids)
      .select('id');

    if (error) throw new Error(error.message);

    return res.json({ deleted: data?.length || 0 });
  } catch (error) {
    req.log.error({ err: error }, 'bulk delete error');
    return res.status(error.status || 500).json({
      error: 'Failed to delete opportunities',
      details: error.message,
    });
  }
});

/**
 * POST /api/content/bulk/send-webhook
 * Send multiple opportunities to webhook.
 */
router.post('/bulk/send-webhook', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    await assertOpportunitiesAccess(ids, req.user.id);

    const { data: opportunities, error: oppErr } = await supabaseAdmin
      .from('content_opportunities')
      .select('*')
      .in('id', ids);

    if (oppErr) throw new Error(oppErr.message);
    if (!opportunities?.length) {
      return res.status(404).json({ error: 'No opportunities found' });
    }

    const brandId = opportunities[0].brand_id;

    const { data: webhookConfig } = await supabaseAdmin
      .from('webhook_configs')
      .select('*')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!webhookConfig) {
      return res.status(400).json({ error: 'No workflow connected', code: 'no_webhook' });
    }
    if (!webhookConfig.events?.includes('opportunity.sent')) {
      return res.status(409).json({
        error: 'Webhook is not subscribed to Opportunity sent events.',
        code: 'webhook_not_subscribed',
      });
    }

    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('name, industry')
      .eq('id', brandId)
      .single();

    const { data: domains } = await supabaseAdmin
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', brandId)
      .eq('is_primary', true)
      .limit(1);

    const serverUrl =
      process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
    // The content type is postJson's own.
    const headers = {};
    if (webhookConfig.webhook_secret) {
      headers['X-Webhook-Secret'] = webhookConfig.webhook_secret;
    }

    let sent = 0;
    let failed = 0;
    // Failed because the address redirects: every row meets the same one.
    let redirected = 0;
    // What the workflow receives reads the way the page shows it.
    const competitors = await competitorNames(brandId);

    for (const stored of opportunities) {
      const opportunity = cleanStoredOpportunity(stored, competitors);
      try {
        let prompt = null;
        if (opportunity.prompt_id) {
          const { data: p } = await supabaseAdmin
            .from('prompts')
            .select('text, category')
            .eq('id', opportunity.prompt_id)
            .single();
          prompt = p;
        }

        const payload = {
          event: 'opportunity.sent',
          opportunity: {
            id: opportunity.id,
            title: opportunity.title,
            description: opportunity.description,
            type: opportunity.type,
            impact: opportunity.impact,
            opportunity_score: parseFloat(opportunity.opportunity_score),
          },
          prompt: prompt ? { text: prompt.text, category: prompt.category } : null,
          data: opportunity.source_data || {},
          brief: opportunity.brief || null,
          brand: {
            name: brand?.name || '',
            domain: domains?.[0]?.domain || '',
            industry: brand?.industry || '',
          },
          callback_url: `${serverUrl}/webhooks/content/${opportunity.id}/status`,
          callback_method: 'POST',
        };

        // As Send to CMS posts: no private address on Cloud, no redirect followed, 15 s.
        const webhookRes = await postJson(webhookConfig.webhook_url, JSON.stringify(payload), {
          headers,
        });
        // A redirect isn't followed, so nothing arrived: not sent.
        if (isRedirect(webhookRes.status)) {
          failed++;
          redirected++;
          continue;
        }
        const responseBody = webhookRes.answer;

        // A workflow may call callback_url before it sends its HTTP response.
        // Guard the write with the state observed before POST so this delayed
        // response cannot overwrite a newer in_progress/done callback.
        await supabaseAdmin
          .from('content_opportunities')
          .update({
            status: 'sent',
            webhook_sent_at: new Date().toISOString(),
            webhook_response: {
              status: webhookRes.status,
              body: responseBody.slice(0, 1000),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', stored.id)
          .eq('status', stored.status)
          .eq('updated_at', stored.updated_at);

        sent++;
      } catch {
        failed++;
      }
    }

    return res.json({ sent, failed, redirected });
  } catch (error) {
    req.log.error({ err: error }, 'bulk send webhook error');
    return res.status(500).json({
      error: 'Failed to bulk send webhooks',
      details: error.message,
    });
  }
});

/**
 * PATCH /api/content/:id/status
 * Update the status of an opportunity. Any member records progress;
 * dismissing one, or moving a dismissed one back, is for admins and managers.
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    const validStatuses = VALID_OPPORTUNITY_STATUSES;
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    let current = await assertOpportunityAccess(id, req.user.id);
    if (status === 'dismissed' || current.status === 'dismissed') {
      await assertRole(
        req.user.id,
        MANAGER_ROLES,
        'Only admins and managers can dismiss an opportunity or bring one back.',
      );
    }

    // Why it was dismissed (CONTENT-006) rides in source_data, which other
    // writers touch too (an Action Center send, a duplicate merge). The row
    // is written only if it hasn't changed since it was read; otherwise it is
    // read again and the change applied once more on the fresh copy.
    let data = null;
    let error = null;
    for (let attempt = 0; attempt < 2 && !data && !error; attempt++) {
      if (attempt > 0) {
        const fresh = await supabaseAdmin
          .from('content_opportunities')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (fresh.error) throw new Error(fresh.error.message);
        if (!fresh.data) break;
        current = fresh.data;
      }
      const sourceData = sourceDataForStatus(current.source_data, status, reason);
      let update = supabaseAdmin
        .from('content_opportunities')
        .update({
          status,
          updated_at: new Date().toISOString(),
          ...(sourceData ? { source_data: sourceData } : {}),
        })
        .eq('id', id);
      if (sourceData) update = update.eq('updated_at', current.updated_at);
      ({ data, error } = await update.select().maybeSingle());
    }

    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Opportunity not found' });

    return res.json(mapOpportunityRow(data, await competitorNames(data.brand_id)));
  } catch (error) {
    req.log.error({ err: error }, 'update opportunity status error');
    return res.status(error.status || 500).json({
      error: 'Failed to update status',
      details: error.message,
    });
  }
});

/**
 * POST /api/content/:id/send-webhook
 * Send an opportunity to the configured webhook endpoint.
 */
router.post('/:id/send-webhook', async (req, res) => {
  try {
    const { id } = req.params;

    // What the workflow receives reads the way the page shows it.
    const stored = await assertOpportunityAccess(id, req.user.id);
    const opportunity = cleanStoredOpportunity(stored, await competitorNames(stored.brand_id));

    const { data: webhookConfig } = await supabaseAdmin
      .from('webhook_configs')
      .select('*')
      .eq('brand_id', opportunity.brand_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!webhookConfig) {
      return res.status(400).json({ error: 'No workflow connected', code: 'no_webhook' });
    }
    if (!webhookConfig.events?.includes('opportunity.sent')) {
      return res.status(409).json({
        error: 'Webhook is not subscribed to Opportunity sent events.',
        code: 'webhook_not_subscribed',
      });
    }

    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('name, industry')
      .eq('id', opportunity.brand_id)
      .single();

    const { data: domains } = await supabaseAdmin
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', opportunity.brand_id)
      .eq('is_primary', true)
      .limit(1);

    let prompt = null;
    if (opportunity.prompt_id) {
      const { data: p } = await supabaseAdmin
        .from('prompts')
        .select('text, category')
        .eq('id', opportunity.prompt_id)
        .single();
      prompt = p;
    }

    const serverUrl =
      process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;

    const payload = {
      event: 'opportunity.sent',
      opportunity: {
        id: opportunity.id,
        title: opportunity.title,
        description: opportunity.description,
        type: opportunity.type,
        impact: opportunity.impact,
        opportunity_score: parseFloat(opportunity.opportunity_score),
      },
      prompt: prompt ? { text: prompt.text, category: prompt.category } : null,
      data: opportunity.source_data || {},
      brief: opportunity.brief || null,
      brand: {
        name: brand?.name || '',
        domain: domains?.[0]?.domain || '',
        industry: brand?.industry || '',
      },
      callback_url: `${serverUrl}/webhooks/content/${opportunity.id}/status`,
      callback_method: 'POST',
    };

    const headers = {};
    if (webhookConfig.webhook_secret) {
      headers['X-Webhook-Secret'] = webhookConfig.webhook_secret;
    }

    // As the bulk send above posts.
    const webhookRes = await postJson(webhookConfig.webhook_url, JSON.stringify(payload), {
      headers,
    });
    // A redirect isn't followed, so the payload never arrived: the
    // opportunity keeps its status, as Send to CMS fails a 3xx.
    if (isRedirect(webhookRes.status)) {
      return res.status(502).json({
        error: WEBHOOK_REDIRECT_ERROR,
        code: 'webhook_redirect',
        webhookStatus: webhookRes.status,
      });
    }
    const responseBody = webhookRes.answer;

    const { data: statusUpdate } = await supabaseAdmin
      .from('content_opportunities')
      .update({
        status: 'sent',
        webhook_sent_at: new Date().toISOString(),
        webhook_response: {
          status: webhookRes.status,
          body: responseBody.slice(0, 1000),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', stored.status)
      .eq('updated_at', stored.updated_at)
      .select('status')
      .maybeSingle();

    // If the conditional write missed, a callback or user changed the record
    // during delivery. Return the actual latest status instead of claiming it
    // was changed to sent.
    let opportunityStatus = statusUpdate?.status;
    if (!statusUpdate) {
      const { data: latest } = await supabaseAdmin
        .from('content_opportunities')
        .select('status')
        .eq('id', id)
        .maybeSingle();
      opportunityStatus = latest?.status ?? stored.status;
    }

    return res.json({
      success: true,
      webhookStatus: webhookRes.status,
      opportunityStatus,
    });
  } catch (error) {
    req.log.error({ err: error }, 'send webhook error');
    return res.status(error.status || 500).json({
      error: 'Failed to send webhook',
      details: error.message,
    });
  }
});

/** Who can set up a brand's webhook, and so test one for it. */
const WEBHOOK_ROLES = ['admin', 'manager'];

/** The brand is the caller's, and the caller can edit its webhook; else 404 / 403. */
async function assertWebhookEditor(brandId, userId) {
  await assertBrandAccess(brandId, userId);
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!WEBHOOK_ROLES.includes(profile?.role)) {
    const err = new Error('Only admins and managers can test the webhook.');
    err.status = 403;
    err.code = 'forbidden';
    throw err;
  }
}

const webhookTestSchema = z.object({
  brandId: z.guid(),
  webhookUrl: z.string().trim().min(1),
  webhookSecret: z.string().nullish(),
});

/**
 * POST /api/content/webhook-test
 * Test a webhook URL with a dummy payload, for a brand whose webhook the
 * caller can edit (admins and managers), 10 a minute.
 * Body: { brandId, webhookUrl, webhookSecret? }. Answers { success, status,
 * statusText }, with `location` for a redirect; { success: false, status: 0,
 * error } when the address is refused or can't be reached (with the network
 * error's code, e.g. ENOTFOUND).
 */
router.post('/webhook-test', webhookTestLimiter, async (req, res) => {
  const parsed = webhookTestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  }
  const { brandId, webhookUrl, webhookSecret } = parsed.data;

  try {
    await assertWebhookEditor(brandId, req.user.id);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    req.log.error({ err: error }, 'webhook test access error');
    return res.status(500).json({ error: 'Failed to test webhook' });
  }

  try {
    const payload = {
      event: 'webhook.test',
      message: 'This is a test webhook from AEO platform.',
      timestamp: new Date().toISOString(),
    };

    const headers = {};
    if (webhookSecret) {
      headers['X-Webhook-Secret'] = webhookSecret;
    }

    // Posted as a real send is, so the test says what a send would meet:
    // on Cloud a private address is refused, and a redirect is an answer.
    const webhookRes = await postJson(webhookUrl, JSON.stringify(payload), {
      headers,
      timeoutMs: 10_000,
    });

    return res.json({
      success: webhookRes.status >= 200 && webhookRes.status < 300,
      status: webhookRes.status,
      statusText: STATUS_CODES[webhookRes.status] ?? '',
      // A redirect in a send's words, and where it points (postJson gives
      // it for a 3xx only), so the dialog can name the address to use.
      ...(isRedirect(webhookRes.status) ? { error: WEBHOOK_REDIRECT_ERROR } : {}),
      ...(webhookRes.location ? { location: webhookRes.location } : {}),
    });
  } catch (error) {
    return res.json({
      success: false,
      status: 0,
      // Why it couldn't be reached: PageFetchError's errno (ENOTFOUND,
      // ECONNREFUSED, a TLS error…); a system error's own errno is a number.
      error:
        typeof error.errno === 'string' && error.errno
          ? `${error.message} (${error.errno})`
          : error.message,
    });
  }
});

const briefSchema = z.object({
  suggestedTitle: z.string(),
  contentType: z.enum([
    'blog-post',
    'comparison-page',
    'landing-page',
    'faq-page',
    'guide',
    'case-study',
  ]),
  targetWordCount: z.number(),
  outline: z
    .array(
      z.object({
        heading: z.string(),
        keyPoints: z.array(z.string()),
      }),
    )
    .min(3)
    .max(8),
  targetKeywords: z.array(z.string()).min(3).max(10),
  competitorInsights: z.string(),
  callToAction: z.string(),
});

const BRIEF_SYSTEM_PROMPT = `You are a senior content strategist specializing in Answer Engine Optimization (AEO). Given a content opportunity with its data (prompt text, visibility scores, competitor gaps, etc.), generate a comprehensive content brief that will help a writer create content optimized for AI-generated answers.

Rules:
- The suggested title must be compelling and SEO-friendly.
- The outline should have 3-8 sections with specific key points per section.
- Target keywords should be relevant to the prompt and opportunity.
- Competitor insights should reference the actual competitors cited and their visibility advantage.
- The call to action should be specific and relevant to the content type.
- Target word count should be appropriate for the content type (e.g. blog post: 1500-3000, guide: 3000-5000).`;

/**
 * What a brief is told about the Action Center task an opportunity was sent
 * from (AC-004): it does what the task says, where it says, until its check
 * is met. Empty for an opportunity that wasn't.
 */
export function briefTaskContext(sourceData) {
  const task = sourceData?.fromAction?.task;
  if (!task) return '';
  const lines = [
    task.where && `- Where: ${task.where}`,
    task.why && `- Why: ${task.why}`,
    task.how?.length && `- Steps: ${task.how.map((step, i) => `${i + 1}) ${step}`).join(' ')}`,
    task.doneWhen && `- Done when: ${task.doneWhen}`,
  ].filter(Boolean);
  return lines.length ? `\nFrom an Action Center task:\n${lines.join('\n')}\n` : '';
}

/**
 * Generate (or fetch) an AI brief for a content opportunity.
 *
 * Shared core for both the user-facing dashboard route below and the
 * `/api/internal/content/:id/brief` MCP route in server.js. Keeping one
 * implementation here means MCP and dashboard can't drift in cost or
 * output shape.
 *
 * Behavior:
 *   - opportunity not found → throws Error with `.status = 404`
 *   - opportunity has a brief AND `force` is false → returns the cached
 *     brief with `regenerated: false` (no LLM call, no quota charge)
 *   - quota exhausted → throws PlanLimitError (statusCode 403/402)
 *   - otherwise runs the LLM, records usage, writes the result back,
 *     returns `{ brief, generated_at, regenerated: true }`
 */
export async function generateBriefForOpportunity(opportunityId, { force = false, model } = {}) {
  const { data: opportunity, error: oppErr } = await supabaseAdmin
    .from('content_opportunities')
    .select('*')
    .eq('id', opportunityId)
    .single();

  if (oppErr || !opportunity) {
    const err = new Error('Opportunity not found');
    err.status = 404;
    throw err;
  }

  if (opportunity.brief && !force) {
    return {
      brief: opportunity.brief,
      generated_at: opportunity.updated_at,
      regenerated: false,
    };
  }

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('name, industry, description, organization_id, language')
    .eq('id', opportunity.brand_id)
    .single();

  const langName = getLanguageName(brand?.language);

  // Quota is charged to the opportunity's org, and enforced here in the
  // shared core so the dashboard route and the internal MCP route draw
  // from the same monthly pool. Cached reads above never hit this.
  const orgId = brand?.organization_id || null;
  if (orgId) {
    await enforceBriefQuota(orgId);
  }

  const { data: domains } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', opportunity.brand_id);

  let promptText = opportunity.source_data?.promptText || '';
  let latestResults = [];

  if (opportunity.prompt_id) {
    const { data: prompt } = await supabaseAdmin
      .from('prompts')
      .select('text, category')
      .eq('id', opportunity.prompt_id)
      .single();

    if (prompt) promptText = prompt.text;

    const { data: results } = await supabaseAdmin
      .from('prompt_results')
      .select(
        'platform, visibility_score, mention_count, citation_count, sentiment, response, competitor_mentions',
      )
      .eq('prompt_id', opportunity.prompt_id)
      .order('created_at', { ascending: false })
      .limit(10);

    latestResults = results || [];
  }

  const { data: competitors } = await supabaseAdmin
    .from('competitors')
    .select('name, domain')
    .eq('brand_id', opportunity.brand_id);

  const sourceData = opportunity.source_data || {};

  // A cluster opportunity (#857) answers several prompts: the brief treats
  // them as the questions the piece must answer, and the searches AI engines
  // ran for them as the related searches to cover.
  // What to do with the brand's existing pages (#857, Phase 2): the brief
  // works on the named page instead of drafting a new one beside it.
  const targetPages = sourceData.targetPages || [];
  const decisionContext =
    opportunity.decision && opportunity.decision !== 'create' && targetPages.length
      ? `
Decision: ${opportunity.decision} the existing page${targetPages.length > 1 ? 's' : ''} below rather than writing a new one.
${targetPages.map((p) => `- ${p.title || p.url} (${p.url})`).join('\n')}
`
      : opportunity.decision === 'create'
        ? '\nDecision: create a new page; the site has none for this need.\n'
        : '';

  const taskContext = briefTaskContext(sourceData);

  const clusterContext = sourceData.prompts?.length
    ? `
Questions this content must answer (the cluster's prompts):
${sourceData.prompts.map((p) => `- ${p}`).join('\n')}
Searches AI engines ran while answering them: ${(sourceData.queries?.top || []).map((q) => q.query).join('; ') || 'none recorded'}
`
    : '';

  // The brief is written from the text as users read it, not leaked indexes.
  const readable = cleanStoredOpportunity(
    opportunity,
    (competitors || []).map((c) => c.name),
  );
  const userPrompt = `Brand: ${brand?.name || 'Unknown'}
Industry: ${brand?.industry || 'Not specified'}
Description: ${brand?.description || 'N/A'}
Domain: ${(domains || []).map((d) => d.domain).join(', ') || 'N/A'}
Competitors: ${(competitors || []).map((c) => `${c.name} (${c.domain})`).join(', ') || 'None'}

Opportunity:
- Title: ${readable.title}
- Description: ${readable.description}
- Type: ${opportunity.type}
- Impact: ${opportunity.impact}
- Score: ${opportunity.opportunity_score}

Related Prompt: "${promptText}"
${clusterContext}${decisionContext}${taskContext}Intent: ${sourceData.intent || 'unknown'}
Current Visibility: ${sourceData.visibilityScore || 0}%
Competitor Gap: ${sourceData.competitorGap || 0}%
Keywords: ${(sourceData.keywords || []).join(', ') || 'none'}
Competitors Cited: ${(sourceData.competitorsCited || []).join(', ') || 'none'}

Latest Results Summary:
${latestResults.map((r) => `- ${r.platform}: visibility ${r.visibility_score}%, mentions: ${r.mention_count}, citations: ${r.citation_count}, sentiment: ${r.sentiment}`).join('\n') || 'No results yet'}

Generate a detailed content brief for this opportunity.

IMPORTANT: Write every brief field in ${langName}.`;

  const aiModel = resolveModel(model);

  const { object: brief } = await generateObject({
    model: aiModel,
    schema: briefSchema,
    system: BRIEF_SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  const generatedAt = new Date().toISOString();

  await supabaseAdmin
    .from('content_opportunities')
    .update({ brief, updated_at: generatedAt })
    .eq('id', opportunityId);

  if (orgId) {
    await supabaseAdmin.from('brief_usage').insert({
      organization_id: orgId,
      opportunity_id: opportunityId,
    });
  }

  return { brief, generated_at: generatedAt, regenerated: true };
}

/**
 * GET /api/content/briefs/quota
 * Current monthly brief-generation quota for the user's org.
 * Returns { used, limit, remaining } — limit -1 means unlimited.
 */
router.get('/briefs/quota', async (req, res) => {
  try {
    const orgId = await getOrgIdForUser(req.user.id);
    if (!orgId) {
      // Self-hosted single-user setups may have no org row; no quota applies.
      return res.json({ used: 0, limit: -1, remaining: -1 });
    }
    // Read-only once the plan has ended (2026-10-27): no plan reads as a limit of 0.
    const quota = await getBriefQuotaStatus(orgId, { readOnly: true });
    return res.json(quota);
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'plan_limit',
        message: error.message,
      });
    }
    req.log.error({ err: error }, 'content brief quota status error');
    return res.status(500).json({ error: 'Failed to get brief quota', details: error.message });
  }
});

/**
 * GET /api/content/usage
 * Both monthly content counters for the user's org (CONTENT-001), so the
 * Content page, the MCP server and agents read the same figures:
 * { plan, planName, periodStart, periodEnd, opportunities, briefs }, each
 * counter { used, limit, remaining } with limit -1 meaning unlimited.
 */
router.get('/usage', async (req, res) => {
  try {
    const orgId = await getOrgIdForUser(req.user.id);
    if (!orgId) {
      // Self-hosted single-user setups may have no org row; no quota applies.
      const unlimited = { used: 0, limit: -1, remaining: -1 };
      return res.json({
        plan: 'self_hosted',
        planName: null,
        periodStart: null,
        periodEnd: null,
        opportunities: { ...unlimited, perRequest: 5 },
        briefs: unlimited,
      });
    }
    // Read-only once the plan has ended (2026-10-27): no plan reads as limits of 0.
    return res.json(await getContentUsage(orgId, { readOnly: true }));
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'plan_limit',
        message: error.message,
      });
    }
    req.log.error({ err: error }, 'content usage error');
    return res.status(500).json({ error: 'Failed to get content usage', details: error.message });
  }
});

/**
 * POST /api/content/:id/brief
 * Generate an AI-powered content brief for an opportunity.
 *
 * Dashboard-facing route. Preserves the existing cache-on-existing-brief
 * behavior — to force a re-generate, the MCP route in server.js calls
 * `generateBriefForOpportunity` with `{ force: true }` directly.
 *
 * Enforces the monthly brief quota (via the shared core) and returns the
 * updated quota alongside the brief so the UI can refresh its counter.
 */
router.post('/:id/brief', async (req, res) => {
  try {
    const { id } = req.params;
    const { model } = req.body;

    // Ownership check — the quota is charged to the opportunity's org, so
    // only members of that org may trigger generation.
    const { data: opp } = await supabaseAdmin
      .from('content_opportunities')
      .select('brand_id')
      .eq('id', id)
      .single();

    if (!opp) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    // The caller's organization, which the brief is charged to: a caller
    // without one reaches no brand (lib/access.js).
    const { orgId: userOrgId } = await assertBrandAccess(opp.brand_id, req.user.id);
    await assertRole(req.user.id, MANAGER_ROLES, GENERATE_BRIEF_REFUSAL);

    const result = await generateBriefForOpportunity(id, { model });
    const quota = await getBriefQuotaStatus(userOrgId);
    return res.json({ brief: result.brief, quota, regenerated: result.regenerated });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'quota_exceeded',
        message: error.message,
      });
    }
    if (error.status === 404) {
      return res.status(404).json({ error: error.message });
    }
    if (error.status === 403) {
      return res.status(403).json({ error: error.message, code: error.code });
    }
    req.log.error({ err: error }, 'content brief generation error');
    return res.status(500).json({
      error: 'Failed to generate brief',
      details: error.message,
    });
  }
});

/**
 * GET /api/content/:id
 * Get a single opportunity by ID.
 */
/**
 * POST /api/content/:id/action
 * Send the opportunity, or one of its assets ({ assetKey }), to the Action
 * Center. Sending the same thing again returns the action already open.
 */
router.post('/:id/action', async (req, res) => {
  try {
    const opp = await assertOpportunityAccess(req.params.id, req.user.id);
    const assetKey = typeof req.body?.assetKey === 'string' ? req.body.assetKey : null;
    // The action's title and assets read the way the page shows them; the
    // opportunity's own stored text is left as it is.
    const readable = cleanStoredOpportunity(opp, await competitorNames(opp.brand_id));
    const result = await sendToActionCenter(opp, { assetKey, userId: req.user.id, readable });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    req.log.error({ err: error }, 'send opportunity to action center error');
    return res.status(error.status || 500).json({
      error: 'Failed to send to the Action Center',
      details: error.message,
    });
  }
});

router.get('/:id/basket', async (req, res) => {
  try {
    const opp = await assertOpportunityAccess(req.params.id, req.user.id);
    const clusterIds = [opp.cluster_id, ...(opp.related_cluster_ids || [])].filter(Boolean);
    if (!clusterIds.length) {
      // An opportunity from the per-prompt generator rests on its one prompt:
      // the Action Center lists it like a one-prompt group.
      if (!opp.prompt_id) return res.json({ clusters: [], queries: [] });
      const { data: prompt, error: promptErr } = await supabaseAdmin
        .from('prompts')
        .select('id, text')
        .eq('id', opp.prompt_id)
        .maybeSingle();
      if (promptErr) throw new Error(promptErr.message);
      return res.json({
        clusters: prompt
          ? [
              {
                id: `prompt:${prompt.id}`,
                label: prompt.text,
                need: '',
                topicName: null,
                prompts: [prompt],
              },
            ]
          : [],
        queries: [],
      });
    }

    const [clustersRes, membersRes, queriesRes] = await Promise.all([
      supabaseAdmin
        .from('prompt_clusters')
        .select('id, label, primary_intent, topics(name)')
        .in('id', clusterIds),
      supabaseAdmin
        .from('prompt_cluster_members')
        .select('cluster_id, prompts(id, text)')
        .in('cluster_id', clusterIds),
      supabaseAdmin
        .from('prompt_cluster_queries')
        .select('query, times_searched, included, reason')
        .in('cluster_id', clusterIds),
    ]);
    const failed = clustersRes.error || membersRes.error || queriesRes.error;
    if (failed) throw new Error(failed.message);

    // A query searched for several of the opportunity's clusters is listed once.
    const queries = new Map();
    for (const q of queriesRes.data || []) {
      const prior = queries.get(q.query);
      queries.set(q.query, {
        query: q.query,
        timesSearched: (prior?.timesSearched || 0) + q.times_searched,
        included: prior?.included || false || q.included,
        reason: prior?.included ? prior.reason : q.reason,
      });
    }

    return res.json({
      clusters: clusterIds
        .map((id) => (clustersRes.data || []).find((c) => c.id === id))
        .filter(Boolean)
        .map((c) => ({
          id: c.id,
          label: c.label,
          need: c.primary_intent,
          topicName: c.topics?.name ?? null,
          prompts: (membersRes.data || [])
            .filter((m) => m.cluster_id === c.id && m.prompts)
            .map((m) => ({ id: m.prompts.id, text: m.prompts.text })),
        })),
      queries: [...queries.values()].sort((a, b) => b.timesSearched - a.timesSearched),
    });
  } catch (error) {
    req.log.error({ err: error }, 'get opportunity basket error');
    return res.status(error.status || 500).json({
      error: 'Failed to get opportunity basket',
      details: error.message,
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const opp = await assertOpportunityAccess(id, req.user.id);

    return res.json(mapOpportunityRow(opp, await competitorNames(opp.brand_id)));
  } catch (error) {
    req.log.error({ err: error }, 'get opportunity error');
    return res.status(error.status || 500).json({
      error: 'Failed to get opportunity',
      details: error.message,
    });
  }
});

export default router;
