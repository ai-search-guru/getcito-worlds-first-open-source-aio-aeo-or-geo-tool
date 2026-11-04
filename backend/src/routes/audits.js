/**
 * Site Audit routes — implements the AEO/GEO scoring rubric ourselves rather
 * than calling any third-party API.
 *
 *   POST /api/audits        { url, brandId, force? } → run a single-page audit
 *   GET  /api/audits/:id                      → fetch a stored audit + signals
 *   GET  /api/audits?brandId=…&limit=&offset= → recent audits for a brand (paged)
 *
 * The audit runs synchronously: one Scrape.do fetch, the deterministic signal
 * engine, one batched LLM round-trip for the semantic signals, and a Wikidata
 * lookup — a few seconds total. Crawl / multi-page moves to a job later.
 */

import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import logger from '../lib/logger.js';
import { assertAllBrands, assertBrandAccess } from '../lib/access.js';
import {
  requireFeature,
  enforceSiteAuditQuota,
  getSiteAuditQuotaStatus,
  getOrgIdForUser,
  PlanLimitError,
} from '../lib/planGuard.js';
import { buildAuditContext, normalizeUrl } from '../lib/audit/context.js';
import { normStoredDomain } from '../lib/audit/host.js';
import {
  AUDIT_RUN_TIMEOUT_MS,
  buildAuditPages,
  buildTrendPoints,
  findPreviousCompletedAudit,
  pageKey,
  parseListPage,
  TREND_LIMIT,
} from '../lib/audit/history.js';
import { readAllRpcRows } from '../lib/rpcPages.js';
import { AUTHORITY_CATEGORIES, buildOverview, primaryPages } from '../lib/audit/overview.js';
import {
  aiVisitsByPage,
  buildOpportunities,
  competitorGapPages,
  EXCLUDE_PATTERN_MAX_LENGTH,
  EXCLUDE_PATTERNS_MAX,
  excludePatternMatcher,
  normalizeExcludePattern,
  opportunityKey,
  siteCoverage,
} from '../lib/audit/opportunities.js';
import { AUTO_AUDIT } from '../lib/audit/autoAudit.js';
import { rankOpportunities } from '../lib/audit/priority.js';
import { readSiteTrust } from '../lib/siteTrust.js';
import { isOrgActive } from '../lib/activeSubscriptions.js';
import { SUBSCRIPTION_INACTIVE } from '../middleware/subscription.js';
import { buildTemplates, templateOf, templateOpportunities } from '../lib/audit/templates.js';
import { ENGINE_THRESHOLDS } from '../config/actionEngine.js';
import { runSignals } from '../lib/audit/engine.js';
import { evaluateLlmSignals, LLM_SIGNAL_KEYS } from '../lib/audit/llmSignals.js';
import { lastPageVerdicts } from '../lib/audit/llmVerdicts.js';
import { evaluateBrandEntity } from '../lib/audit/externalSignals.js';
import { brandFactsFor, generateRecommendations } from '../lib/audit/recommendations.js';
import { readBrandRules } from '../lib/brandRulesRead.js';
import { scoreAudit } from '../lib/audit/scorer.js';
import { signalsByKey, TOTAL_SIGNALS, RUBRIC_VERSION } from '../lib/audit/rubric.js';

const router = Router();

/**
 * Merge a stored audit row + its signal results with the rubric copy the UI
 * needs (label / what / why / howToFix / impactTier).
 */
function assembleAudit(audit, signalRows) {
  const signals = signalRows.map((row) => {
    const meta = signalsByKey[row.signal_key] ?? {};
    return {
      key: row.signal_key,
      category: row.category ?? meta.category ?? null,
      status: row.status,
      score: row.score === null ? null : Number(row.score),
      evidence: row.evidence ?? {},
      label: meta.label ?? row.signal_key,
      what: meta.what ?? null,
      why: meta.why ?? null,
      howToFix: meta.howToFix ?? null,
      impactTier: meta.impactTier ?? null,
    };
  });

  return {
    id: audit.id,
    brandId: audit.brand_id,
    url: audit.url,
    finalUrl: audit.final_url ?? null,
    status: audit.status,
    totalScore: audit.total_score === null ? null : Number(audit.total_score),
    partial: audit.partial === true,
    categoryScores: audit.category_scores ?? {},
    signalsEvaluated: audit.signals_evaluated ?? null,
    signalsTotal: audit.signals_total ?? TOTAL_SIGNALS,
    rubricVersion: audit.rubric_version ?? RUBRIC_VERSION,
    error: audit.error ?? null,
    createdAt: audit.created_at,
    completedAt: audit.completed_at ?? null,
    signals,
    recommendations: audit.recommendations ?? [],
  };
}

/** The brand's primary domain as stored (else its first domain), or null. */
async function primaryDomainOf(brandId) {
  const { data: domainRows } = await supabaseAdmin
    .from('brand_domains')
    .select('domain, is_primary')
    .eq('brand_id', brandId);
  return (
    (domainRows ?? []).find((d) => d.is_primary)?.domain ?? (domainRows ?? [])[0]?.domain ?? null
  );
}

// 20 audits × 48 signals stays under PostgREST's 1000-row page.
const ISSUE_COUNT_CHUNK = 20;

/** Every audit of the brand, newest first, read past PostgREST's 1000-row page. */
function readBrandAudits(brandId) {
  return readAllRpcRows('site_audits', (from, to) =>
    supabaseAdmin
      .from('site_audits')
      .select('id, url, final_url, status, total_score, partial, created_at, source')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
}

/** Rows for the given audit ids, read a chunk of ids at a time by `query`. */
async function readByAuditIds(ids, chunkSize, query) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map(query));
  const rows = [];
  for (const { data, error } of results) {
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

/** Failed and warning signals per audit id. */
async function countIssues(auditIds) {
  const rows = await readByAuditIds(auditIds, ISSUE_COUNT_CHUNK, (ids) =>
    supabaseAdmin
      .from('audit_signal_results')
      .select('audit_id')
      .in('audit_id', ids)
      .in('status', ['fail', 'warn']),
  );
  const counts = new Map();
  for (const row of rows) counts.set(row.audit_id, (counts.get(row.audit_id) ?? 0) + 1);
  return counts;
}

/**
 * The brand as an audit run reads it: its name and description, and the
 * sites it trusts (00449). A database without that column yet (the API
 * deployed ahead of its migration) reads none trusted.
 */
async function readAuditBrand(brandId) {
  const read = await supabaseAdmin
    .from('brands')
    .select('name, description, trusted_sources')
    .eq('id', brandId)
    .single();
  const missing =
    (read.error?.code === '42703' || read.error?.code === 'PGRST204') &&
    (read.error.message ?? '').includes('trusted_sources');
  return missing
    ? supabaseAdmin.from('brands').select('name, description').eq('id', brandId).single()
    : read;
}

/** site_audits/site_audit_usage.source for a run's audits; a user's are the column default. */
const sourceColumn = (source) => (source === 'auto' ? { source } : {});

/**
 * Run the full audit (fetch → deterministic + LLM + Wikidata → score →
 * persist) for an already-created `running` row. Runs detached from the
 * request so the client gets an id immediately and polls GET /:id. Always
 * resolves — on failure it marks the row `failed` rather than throwing.
 */
async function runAuditJob(auditId, brandId, url, orgId, source = 'user') {
  try {
    // The brand name is needed for the Wikidata brand-entity lookup. The page
    // is otherwise evaluated entirely on its own terms — the LLM infers the
    // page's own target topic from its content, so an arbitrary URL (a
    // competitor blog, any page) is never judged against this brand's topics.
    const [{ data: brandRow }, { data: domainRows }] = await Promise.all([
      readAuditBrand(brandId),
      supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
    ]);

    const ctx = await buildAuditContext(url);
    // The sites the brand trusts count as authority links (00449).
    ctx.trustedSources = brandRow?.trusted_sources ?? [];

    // Deterministic engine, the LLM pass, and the Wikidata lookup run
    // concurrently. The latter two degrade to 'na' internally on failure; a
    // failed LLM call keeps the page's last verdicts, else marks it partial.
    const [deterministic, llm, brandEntity] = await Promise.all([
      runSignals(ctx),
      evaluateLlmSignals(ctx, {
        lastVerdicts: () => lastPageVerdicts(brandId, ctx.url, LLM_SIGNAL_KEYS),
      }),
      evaluateBrandEntity(brandRow?.name),
    ]);
    const results = [...deterministic, ...llm.results, brandEntity];

    const { totalScore, categoryScores } = scoreAudit(results);
    const signalsEvaluated = results.filter((r) => r.status !== 'na').length;

    const signalRows = results.map((r) => ({
      audit_id: auditId,
      signal_key: r.key,
      category: signalsByKey[r.key]?.category ?? null,
      status: r.status,
      score: r.score,
      evidence: r.evidence ?? {},
    }));
    const { error: sigErr } = await supabaseAdmin.from('audit_signal_results').insert(signalRows);
    if (sigErr) throw sigErr;

    // AI fix recommendations for the fixable failing signals (own LLM call;
    // degrades to [] on failure so it never blocks completion). Brand facts
    // (name, description, domains) may be reused only on the brand's own pages.
    const recommendations = await generateRecommendations(ctx, {
      results,
      brand: brandFactsFor(ctx.url, brandRow, domainRows),
      // The brand's rules (00450) shape what's recommended on any page it audits.
      rules: await readBrandRules(brandId),
      auditId,
    });

    const { error: completeErr } = await supabaseAdmin
      .from('site_audits')
      .update({
        status: 'completed',
        final_url: ctx.url,
        total_score: totalScore,
        partial: llm.partial,
        category_scores: categoryScores,
        signals_evaluated: signalsEvaluated,
        signals_total: TOTAL_SIGNALS,
        recommendations,
        completed_at: new Date().toISOString(),
      })
      .eq('id', auditId);
    // Don't let a failed completion update leave the row stuck in 'running'.
    if (completeErr) throw completeErr;

    // Charge the monthly quota only for audits that actually completed, and
    // not for a partial one, whose AI checks didn't run; an auto-audit run's
    // audits are charged as its own (SA-006).
    if (orgId && !llm.partial) {
      await supabaseAdmin
        .from('site_audit_usage')
        .insert({ organization_id: orgId, audit_id: auditId, ...sourceColumn(source) });
    }
  } catch (err) {
    logger.error({ err, auditId, brandId }, 'audit run failed');
    await supabaseAdmin
      .from('site_audits')
      .update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() })
      .eq('id', auditId);
  }
}

/** Minutes after a page's audit finished in which a new one asks first. */
export const RECENT_AUDIT_MINUTES = 10;

/** Postgres's unique_violation: another start of the page got there first (00431). */
const UNIQUE_VIOLATION = '23505';

/**
 * A page to audit: the address asked for and its page key (00431 page_key),
 * the key of its normalized address, so /pricing, /pricing/ and ?utm= are
 * one page. Throws a 400-status error for something that isn't an address.
 */
function auditPage(url) {
  return { url, key: pageKey(normalizeUrl(url)).key };
}

/**
 * The brand's audits of these pages that hold a start back, by page key: the
 * one running, and the latest finished in the last RECENT_AUDIT_MINUTES. A
 * run older than AUDIT_RUN_TIMEOUT_MS was cut short by a restart and never
 * completes: it is marked failed first, so it doesn't hold its page.
 */
async function pageAudits(brandId, keys, now = Date.now()) {
  const running = new Map();
  const recent = new Map();
  if (keys.length === 0) return { running, recent };

  const { error: staleErr } = await supabaseAdmin
    .from('site_audits')
    .update({
      status: 'failed',
      error: 'The audit was cut short.',
      completed_at: new Date(now).toISOString(),
    })
    .eq('brand_id', brandId)
    .eq('status', 'running')
    .in('page_key', keys)
    .lt('created_at', new Date(now - AUDIT_RUN_TIMEOUT_MS).toISOString());
  if (staleErr) throw staleErr;

  const since = new Date(now - RECENT_AUDIT_MINUTES * 60 * 1000).toISOString();
  const [runningRes, recentRes] = await Promise.all([
    supabaseAdmin
      .from('site_audits')
      .select('*')
      .eq('brand_id', brandId)
      .eq('status', 'running')
      .in('page_key', keys),
    supabaseAdmin
      .from('site_audits')
      .select('id, page_key, completed_at')
      .eq('brand_id', brandId)
      .eq('status', 'completed')
      .in('page_key', keys)
      .gte('completed_at', since)
      .order('completed_at', { ascending: false }),
  ]);
  if (runningRes.error) throw runningRes.error;
  if (recentRes.error) throw recentRes.error;
  for (const row of runningRes.data ?? []) running.set(row.page_key, row);
  for (const row of recentRes.data ?? []) {
    if (!recent.has(row.page_key)) {
      recent.set(row.page_key, { auditId: row.id, finishedAt: row.completed_at });
    }
  }
  return { running, recent };
}

/**
 * The `running` rows of a brand's pages. A page another start got to first
 * (00431's one running audit per page) is left out: when the insert of all
 * of them fails on it, the pages are inserted one by one.
 */
async function insertRunningAudits(brandId, pages, source) {
  const rowOf = (page) => ({
    brand_id: brandId,
    url: page.url,
    page_key: page.key,
    status: 'running',
    rubric_version: RUBRIC_VERSION,
    ...sourceColumn(source),
  });
  const { data, error } = await supabaseAdmin
    .from('site_audits')
    .insert(pages.map(rowOf))
    .select('*');
  if (!error) return data;
  if (error.code !== UNIQUE_VIOLATION) throw error;

  const created = [];
  for (const page of pages) {
    const { data: row, error: rowErr } = await supabaseAdmin
      .from('site_audits')
      .insert(rowOf(page))
      .select('*')
      .single();
    if (rowErr?.code === UNIQUE_VIOLATION) continue;
    if (rowErr) throw rowErr;
    created.push(row);
  }
  return created;
}

/**
 * Start audits of a brand's pages, one running audit per page (00431):
 *
 * - a page with an audit running gets that audit back, with no new credit;
 * - a page audited in the last RECENT_AUDIT_MINUTES isn't started unless
 *   `force` (the client's Audit again), and comes back in `recent` so the
 *   client can ask;
 * - the quota is checked for the pages started only (PlanLimitError, and
 *   then nothing starts).
 *
 * Returns the rows started, the rows already running and the recent pages.
 */
async function startPages(brandId, pages, orgId, { source = 'user', force = false } = {}) {
  const { running, recent } = await pageAudits(
    brandId,
    pages.map((p) => p.key),
  );
  const isRecent = (p) => !force && recent.has(p.key);
  const toStart = pages.filter((p) => !running.has(p.key) && !isRecent(p));
  // An auto-audit run's starts are checked against the whole quota (SA-006).
  if (toStart.length > 0 && source === 'auto') {
    await enforceSiteAuditQuota(orgId, toStart.length, { source });
  } else if (toStart.length > 0) {
    await enforceSiteAuditQuota(orgId, toStart.length);
  }

  const created = toStart.length > 0 ? await insertRunningAudits(brandId, toStart, source) : [];
  // A page another request started meanwhile: its audit, as if it had been running.
  const startedKeys = new Set(created.map((row) => row.page_key));
  const lost = toStart.filter((p) => !startedKeys.has(p.key)).map((p) => p.key);
  if (lost.length > 0) {
    const again = await pageAudits(brandId, lost);
    for (const [key, row] of again.running) running.set(key, row);
  }

  return {
    created,
    running: pages.flatMap((p) =>
      !startedKeys.has(p.key) && running.has(p.key) ? [running.get(p.key)] : [],
    ),
    recent: pages
      .filter((p) => !running.has(p.key) && isRecent(p))
      .map((p) => ({ url: p.url, ...recent.get(p.key) })),
  };
}

/**
 * Start an audit of one page and kick off its detached job, as startPages
 * does: `{ audit }` with the new `running` audit, or the page's audit
 * already running (`alreadyRunning`, no new credit); `{ recent }` when the
 * page was audited in the last RECENT_AUDIT_MINUTES and `force` isn't set.
 * Shared by the dashboard POST handler and the internal MCP endpoint. Throws
 * PlanLimitError when the quota is exhausted — nothing is created then.
 */
export async function createAndRunAudit(brandId, url, orgId, { force = false } = {}) {
  const { created, running, recent } = await startPages(brandId, [auditPage(url)], orgId, {
    force,
  });
  if (recent.length > 0) {
    const { auditId, finishedAt } = recent[0];
    return { recent: { auditId, finishedAt } };
  }
  const [row] = created;
  if (!row) return { audit: assembleAudit(running[0], []), alreadyRunning: true };

  // Fire-and-forget — the work continues after the response is sent.
  runAuditJob(row.id, brandId, row.url, orgId).catch((err) =>
    logger.error({ err, auditId: row.id, brandId }, 'audit background job crashed'),
  );

  return { audit: assembleAudit(row, []) };
}

/** What a start answers for a page audited in the last minutes (409 recently_audited). */
export function recentAuditBody(recent, now = Date.now()) {
  const minutes = Math.max(1, Math.round((now - Date.parse(recent.finishedAt)) / 60_000));
  return {
    success: false,
    error: 'recently_audited',
    message: `This page was audited ${minutes} min ago. Open that audit, or audit it again.`,
    recent,
  };
}

/** Pages one bulk request may audit: the Pages list's own page size. */
export const BULK_AUDIT_MAX = 50;

/** Bulk audits run at once; the rest wait their turn, still `running`. */
export const BULK_AUDIT_CONCURRENCY = 3;

/** Auto-audit runs' audits at once: their own pool, so a run doesn't hold up a user's bulk audit. */
export const AUTO_AUDIT_CONCURRENCY = 2;

/**
 * A pool running audit jobs a few at a time; the rest wait their turn. Each
 * job's promise resolves when it has run (runAuditJob never rejects).
 */
function auditPool(concurrency, label) {
  const queue = [];
  let active = 0;
  const drain = () => {
    while (active < concurrency && queue.length > 0) {
      const { job, resolve } = queue.shift();
      active += 1;
      job()
        .catch((err) => logger.error({ err }, `${label} audit job crashed`))
        .finally(() => {
          active -= 1;
          resolve();
          drain();
        });
    }
  };
  return (job) =>
    new Promise((resolve) => {
      queue.push({ job, resolve });
      drain();
    });
}

// One pool for every bulk request, so 50 re-audits don't fetch and score 50
// pages at the same time; another for the auto-audit runs.
const runInBulkPool = auditPool(BULK_AUDIT_CONCURRENCY, 'bulk');
const runInAutoPool = auditPool(AUTO_AUDIT_CONCURRENCY, 'auto');

/** One page per spelling: repeat spellings of a page are audited once. */
function uniquePages(urls) {
  const byPage = new Map();
  for (const url of urls) {
    const page = auditPage(url);
    if (!byPage.has(page.key)) byPage.set(page.key, page);
  }
  return [...byPage.values()];
}

/**
 * Start audits of several pages of a brand, as startPages does. The quota is
 * checked for the pages started, so either every one is queued or none is
 * (PlanLimitError). Repeat spellings of one page are audited once. Returns
 * the running rows (started now or already running) and the pages audited
 * in the last minutes, left out unless `force`.
 */
export async function createAndQueueAudits(brandId, urls, orgId, { force = false } = {}) {
  const { created, running, recent } = await startPages(brandId, uniquePages(urls), orgId, {
    force,
  });
  for (const row of created) {
    runInBulkPool(() => runAuditJob(row.id, brandId, row.url, orgId));
  }
  return { audits: [...created, ...running].map((row) => assembleAudit(row, [])), recent };
}

/**
 * Start an auto-audit run's audits of a brand's pages (SA-006): checked
 * against the whole quota, the run's reserved slots included, and charged
 * as auto. A page with an audit running is left out, with no credit; the
 * run already leaves out the pages audited lately. Returns the started
 * rows' ids, and `done`, which resolves once every one of them has
 * completed or failed.
 */
export async function startAutoAudits(brandId, urls, orgId) {
  const { created } = await startPages(brandId, uniquePages(urls), orgId, {
    source: 'auto',
    force: true,
  });
  const done = Promise.all(
    created.map((row) => runInAutoPool(() => runAuditJob(row.id, brandId, row.url, orgId, 'auto'))),
  );
  return { auditIds: created.map((row) => row.id), done };
}

const bulkSchema = z.object({
  brandId: z.guid(),
  urls: z
    .array(z.string().trim().min(1).max(2048))
    .min(1)
    .max(BULK_AUDIT_MAX)
    .refine((urls) => urls.every((url) => pageKey(url)), 'Every URL must be a full URL'),
  force: z.boolean().optional().default(false),
});

/**
 * Internal/MCP entry point: start an audit addressed by brand id + url.
 * Org-ownership is verified upstream in the web MCP layer; here we resolve the
 * brand's org ourselves so the quota is charged authoritatively server-side.
 * Throws a 404-status error when the brand doesn't exist.
 */
export async function startSiteAuditForBrand(brandId, url, { force = false } = {}) {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand) {
    const err = new Error('Brand not found');
    err.status = 404;
    throw err;
  }
  return createAndRunAudit(brandId, url, brand.organization_id, { force });
}

// POST /api/audits — start an audit. Returns immediately with a `running`
// row, or the page's audit already running; the client polls GET /:id until
// it flips to completed/failed. A page audited in the last minutes answers
// 409 recently_audited with that audit, unless `force` (Audit again).
router.post('/', requireFeature('content_optimization'), async (req, res) => {
  const userId = req.user?.id;
  const { url, brandId, force } = req.body || {};

  if (!url || !brandId) {
    return res.status(400).json({ success: false, message: 'url and brandId are required' });
  }

  try {
    const { orgId } = await assertBrandAccess(brandId, userId);
    const started = await createAndRunAudit(brandId, url, orgId, { force: force === true });
    if (started.recent) return res.status(409).json(recentAuditBody(started.recent));
    return res.status(202).json({
      success: true,
      audit: started.audit,
      alreadyRunning: started.alreadyRunning === true,
    });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit start failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/audits/bulk — re-audit several pages at once ({ brandId, urls,
// force? }, up to BULK_AUDIT_MAX). All the pages started must fit the monthly
// quota, or none starts. Returns 202 with the running rows (they run a few at
// a time) and `recent`: the pages audited in the last minutes, not started
// unless `force`.
router.post('/bulk', requireFeature('content_optimization'), async (req, res) => {
  const userId = req.user?.id;
  const parsed = bulkSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid request',
    });
  }
  const { brandId, urls, force } = parsed.data;

  try {
    const { orgId } = await assertBrandAccess(brandId, userId);
    const { audits, recent } = await createAndQueueAudits(brandId, urls, orgId, { force });
    return res.status(202).json({ success: true, audits, recent });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'bulk audit start failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits/quota — the org's monthly audit allowance (used/limit/remaining).
// Registered before /:id so "quota" isn't matched as an audit id.
router.get('/quota', async (req, res) => {
  try {
    const orgId = await getOrgIdForUser(req.user?.id);
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'No organization found for user.' });
    }
    // Read-only once the plan has ended (2026-10-27): no plan reads as a limit of 0.
    const quota = await getSiteAuditQuotaStatus(orgId, { readOnly: true });
    return res.json({ success: true, quota });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    req.log.error({ err }, 'audit quota failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits/trend?brandId=… — completed audits of the brand's PRIMARY
// domain over time (score + category scores), for the hub trend chart. Reads
// the newest TREND_LIMIT completed audits so the chart always ends at the
// latest one, then returns the points oldest → newest.
// Registered before /:id so "trend" isn't matched as an audit id.
router.get('/trend', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const primary = await primaryDomainOf(brandId);
    const primaryHost = normStoredDomain(primary);

    const { data: rows } = await supabaseAdmin
      .from('site_audits')
      .select('id, url, final_url, total_score, partial, category_scores, created_at')
      .eq('brand_id', brandId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(TREND_LIMIT);

    const points = buildTrendPoints(rows, primaryHost);

    return res.json({ success: true, primaryDomain: primary, points });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit trend failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits/pages?brandId=…&limit=50&offset=0 — one row per audited
// page (repeat audits of a URL share it), most recently audited first, with
// its latest score, the previous one, its first one, a status, its trend, its
// open issues and its runs. `total` is the number of pages, for paging.
// Registered before /:id so "pages" isn't matched as an audit id.
router.get('/pages', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  const { limit, offset } = parseListPage(req.query);
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const [primary, { data: rows, error }] = await Promise.all([
      primaryDomainOf(brandId),
      readBrandAudits(brandId),
    ]);
    if (error) throw error;

    const all = buildAuditPages(rows);
    const pages = all.slice(offset, offset + limit);
    const issues = await countIssues(pages.filter((p) => p.score !== null).map((p) => p.auditId));
    const primaryHost = normStoredDomain(primary);

    return res.json({
      success: true,
      pages: pages.map((p) => ({
        ...p,
        issues: p.score === null ? null : (issues.get(p.auditId) ?? 0),
        // The page's template on the primary domain, for Group by template (SA-007).
        template: p.host === primaryHost ? templateOf(p.path) : null,
      })),
      total: all.length,
      primaryHost,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit pages failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits/overview?brandId=… — the hub's KPI cards: site score and
// its change, pages audited, and the Authority / E-E-A-T scores with their
// biggest gaps, over the latest audit of each page on the primary domain.
// Registered before /:id so "overview" isn't matched as an audit id.
router.get('/overview', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const [primary, { data: rows, error }] = await Promise.all([
      primaryDomainOf(brandId),
      readBrandAudits(brandId),
    ]);
    if (error) throw error;

    const primaryHost = normStoredDomain(primary);
    const { own, otherPages } = primaryPages(buildAuditPages(rows), primaryHost);
    const ids = own.map((p) => p.auditId);

    const [scoreRows, failingRows] = await Promise.all([
      readByAuditIds(ids, 100, (chunk) =>
        supabaseAdmin.from('site_audits').select('id, category_scores').in('id', chunk),
      ),
      // 50 audits × 16 Authority and E-E-A-T signals stays under 1000 rows.
      readByAuditIds(ids, 50, (chunk) =>
        supabaseAdmin
          .from('audit_signal_results')
          .select('audit_id, signal_key')
          .in('audit_id', chunk)
          .in('category', AUTHORITY_CATEGORIES)
          .in('status', ['fail', 'warn']),
      ),
    ]);
    const categoryScoresById = new Map(scoreRows.map((r) => [r.id, r.category_scores ?? {}]));

    return res.json({
      success: true,
      overview: {
        primaryHost,
        otherPages,
        ...buildOverview(own, categoryScoresById, failingRows),
      },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit overview failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

/** The window the Opportunities inbox counts AI visits and citations over. */
const OPPORTUNITY_VISITS_DAYS = 30;

/**
 * Pages closest to the prompts a competitor is cited on and the brand never
 * is, over the last 30 days (empty without competitor domains).
 */
async function competitorOpportunityPages(brandId, sitePages) {
  const [{ data: competitors, error: compErr }, { data: domains, error: domErr }] =
    await Promise.all([
      supabaseAdmin.from('competitors').select('name, domain').eq('brand_id', brandId),
      supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
    ]);
  if (compErr) throw compErr;
  if (domErr) throw domErr;

  const competitorNames = new Map();
  for (const c of competitors ?? []) {
    const host = normStoredDomain(c.domain);
    if (host) competitorNames.set(host, c.name);
  }
  const ownHosts = (domains ?? []).map((d) => normStoredDomain(d.domain)).filter(Boolean);
  if (competitorNames.size === 0 || ownHosts.length === 0) return [];

  const { data: prompts, error } = await supabaseAdmin.rpc('audit_competitor_cited_prompts', {
    p_brand_id: brandId,
    p_since: new Date(Date.now() - OPPORTUNITY_VISITS_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    p_own_domains: ownHosts,
    p_competitor_domains: [...competitorNames.keys()],
  });
  // A server deployed before migration 00166 lists the other sources without this one.
  if (error?.code === 'PGRST202') return [];
  if (error) throw error;

  const gaps = (prompts ?? []).filter((p) => Number(p.own_results) === 0);
  if (gaps.length === 0) return [];
  const { data: targetUrls, error: targetErr } = await supabaseAdmin
    .from('prompt_target_urls')
    .select('prompt_id, url')
    .in(
      'prompt_id',
      gaps.map((p) => p.prompt_id),
    );
  if (targetErr) throw targetErr;

  return competitorGapPages({
    prompts: gaps,
    targetUrls: targetUrls ?? [],
    sitePages,
    competitorNames,
  });
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * AI visits per page over the last 30 days (null when the brand has neither
 * Google Analytics nor the tracking snippet, so 0 would be a guess).
 */
async function opportunityAiVisits(brandId, urls) {
  if (urls.length === 0) return new Map();
  const [{ data: brand }, { data: logs }] = await Promise.all([
    supabaseAdmin.from('brands').select('ga_property_id').eq('id', brandId).maybeSingle(),
    supabaseAdmin.from('ai_traffic_logs').select('id').eq('brand_id', brandId).limit(1),
  ]);
  if (!brand?.ga_property_id && (logs ?? []).length === 0) return null;

  const now = Date.now();
  const from = isoDay(now - OPPORTUNITY_VISITS_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await supabaseAdmin.rpc('ae_page_traffic_evidence', {
    p_brand_id: brandId,
    p_pages: urls,
    p_cur_from: from,
    p_cur_to: isoDay(now),
    // No comparison window: the previous one is left empty.
    p_prev_from: from,
    p_prev_to: isoDay(now - (OPPORTUNITY_VISITS_DAYS + 1) * 24 * 60 * 60 * 1000),
  });
  if (error) throw error;
  return aiVisitsByPage(data);
}

/**
 * The brand's template groups (SA-007): its primary-domain pages by template,
 * with the gaps most of a template's audited pages share. Reads the failing
 * and warning signals of those pages' latest audits.
 */
async function readTemplateGroups({ primaryHost, sitePages, auditPages }) {
  if (!primaryHost) return [];
  const ids = auditPages
    .filter((p) => p.host === primaryHost && p.score !== null && templateOf(p.path))
    .map((p) => p.auditId);
  const failingRows = await readByAuditIds(ids, ISSUE_COUNT_CHUNK, (chunk) =>
    supabaseAdmin
      .from('audit_signal_results')
      .select('audit_id, signal_key')
      .in('audit_id', chunk)
      .in('status', ['fail', 'warn']),
  );
  return buildTemplates({ primaryHost, sitePages, auditPages, failingRows });
}

/** A brand's exclude patterns (SA-006 settings), as stored. */
async function readExcludePatterns(brandId) {
  const { data, error } = await supabaseAdmin
    .from('site_audit_brand_settings')
    .select('exclude_patterns')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) throw error;
  return data?.exclude_patterns ?? [];
}

/**
 * The Opportunities inbox of a brand (SA-004): its pages worth auditing,
 * each with why, scored and ordered by priority (SA-005), plus the excluded
 * pages to put back. The route shows it; auto-audit runs take their pages
 * from it (SA-006).
 */
/** An inbox read slower than this logs how long each of its steps took. */
const SLOW_INBOX_MS = 2000;

export async function readOpportunityInbox(brandId) {
  const startedAt = Date.now();
  const [primary, gaPages, sitePages, audits, prefs, excludePatterns] = await Promise.all([
    primaryDomainOf(brandId),
    // Up to 30% of GA's 5,000 pages a day: past PostgREST's 1000-row page.
    readAllRpcRows('page_opportunities', (from, to) =>
      supabaseAdmin
        .from('page_opportunities')
        .select('landing_page, value_signal, value_percentile, sessions, citation_state, citations')
        .eq('brand_id', brandId)
        .eq('kind', 'no_ai_traffic')
        .is('resolved_at', null)
        .order('landing_page', { ascending: true })
        .range(from, to),
    ),
    supabaseAdmin
      .from('site_pages')
      .select('url, title, h1, description, ga_sessions, ai_citations')
      .eq('brand_id', brandId),
    readBrandAudits(brandId),
    supabaseAdmin
      .from('site_audit_page_prefs')
      .select('page_key, url, state')
      .eq('brand_id', brandId),
    readExcludePatterns(brandId),
  ]);
  for (const read of [gaPages, sitePages, audits, prefs]) if (read.error) throw read.error;
  const readsDoneAt = Date.now();

  const primaryHost = normStoredDomain(primary);
  const auditPages = buildAuditPages(audits.data);
  const [competitorPages, templates] = await Promise.all([
    competitorOpportunityPages(brandId, sitePages.data ?? []),
    readTemplateGroups({ primaryHost, sitePages: sitePages.data ?? [], auditPages }),
  ]);
  const sourcesDoneAt = Date.now();
  const { rows, excluded } = buildOpportunities({
    primaryHost,
    gaPages: gaPages.data ?? [],
    sitePages: sitePages.data ?? [],
    auditPages,
    competitorPages,
    prefs: prefs.data ?? [],
    excludePatterns,
    staleDays: ENGINE_THRESHOLDS.detection.auditMaxAgeDays,
  });
  // How much of the site has a current audit, by the same rules (item 11).
  const coverage = siteCoverage({
    sitePages: sitePages.data ?? [],
    auditPages,
    prefs: prefs.data ?? [],
    excludePatterns,
    staleDays: ENGINE_THRESHOLDS.detection.auditMaxAgeDays,
  });
  // Templates whose pages share gaps are rows too (SA-007, the mockup's
  // "/blog/* · 38 pages"), with their pages' AI visits added up.
  const shared = templates.filter((t) => t.sharedGaps.length > 0);
  const templateRows = templateOpportunities(shared, excludePatternMatcher(excludePatterns));
  const urlsOf = new Map(shared.map((t) => [`template:${t.template}`, t.urls]));
  const visits = await opportunityAiVisits(brandId, [
    ...new Set([...rows.map((r) => r.url), ...templateRows.flatMap((r) => urlsOf.get(r.key))]),
  ]);
  const visitsOf = (urls) =>
    visits === null ? null : urls.reduce((sum, url) => sum + (visits.get(url) ?? 0), 0);

  // The hub waits on this read (13 s on production, 2026-10-19): say which
  // step is slow, so it can be made faster.
  const doneAt = Date.now();
  if (doneAt - startedAt >= SLOW_INBOX_MS) {
    logger.warn(
      {
        brandId,
        rows: rows.length + templateRows.length,
        ms: {
          reads: readsDoneAt - startedAt,
          competitorsAndTemplates: sourcesDoneAt - readsDoneAt,
          aiVisits: doneAt - sourcesDoneAt,
          total: doneAt - startedAt,
        },
      },
      '[audit] slow opportunities inbox read',
    );
  }

  return {
    // Scored and ordered once each page has its AI visits (SA-005); a page
    // whose template shares its gaps is easier to fix (SA-007).
    opportunities: rankOpportunities(
      [
        ...rows.map((r) => ({ ...r, aiVisits: visitsOf([r.url]) })),
        ...templateRows.map((r) => ({ ...r, aiVisits: visitsOf(urlsOf.get(r.key)) })),
      ],
      (sitePages.data ?? []).map((p) => p.ga_sessions),
      new Set(shared.map((t) => t.template)),
    ),
    excluded,
    coverage,
  };
}

// GET /api/audits/opportunities?brandId=… — the Opportunities inbox (SA-004):
// the brand's pages worth auditing, each with why (Google Analytics pages
// without AI traffic, pages never audited or audited long ago), pinned pages
// first, plus the excluded pages to put back, and how much of the site has a
// current audit (coverage, item 11).
// Registered before /:id so "opportunities" isn't matched as an audit id.
router.get('/opportunities', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);
    const { opportunities, excluded, coverage } = await readOpportunityInbox(brandId);
    return res.json({
      success: true,
      opportunities,
      excluded,
      coverage,
      staleDays: ENGINE_THRESHOLDS.detection.auditMaxAgeDays,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit opportunities failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Roles that may change Site Audit settings and the brand's pinned and
 * excluded pages, as for Daily Pulse's.
 */
const SETTINGS_ROLES = ['admin', 'manager'];

async function canChangeSettings(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return SETTINGS_ROLES.includes(data?.role);
}

const prefsSchema = z.object({
  brandId: z.guid(),
  urls: z
    .array(z.string().trim().min(1).max(2048))
    .min(1)
    .max(BULK_AUDIT_MAX)
    .refine((urls) => urls.every((url) => opportunityKey(url)), 'Every URL must be a full URL'),
  // null clears the page's pin or exclusion.
  state: z.enum(['pinned', 'excluded']).nullable(),
});

// PUT /api/audits/opportunities/prefs — pin, exclude or clear pages of the
// Opportunities inbox ({ brandId, urls, state }). They hold for the whole
// brand, so admins and managers only, as the settings.
router.put('/opportunities/prefs', async (req, res) => {
  const userId = req.user?.id;
  const parsed = prefsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid request',
    });
  }
  const { brandId, urls, state } = parsed.data;

  try {
    await assertBrandAccess(brandId, userId);
    if (!(await canChangeSettings(userId))) {
      return res.status(403).json({
        success: false,
        message: 'Only admins and managers can pin or exclude pages.',
      });
    }

    const byKey = new Map(urls.map((url) => [opportunityKey(url), url]));
    const { error } =
      state === null
        ? await supabaseAdmin
            .from('site_audit_page_prefs')
            .delete()
            .eq('brand_id', brandId)
            .in('page_key', [...byKey.keys()])
        : await supabaseAdmin.from('site_audit_page_prefs').upsert(
            [...byKey].map(([pageKeyValue, url]) => ({
              brand_id: brandId,
              page_key: pageKeyValue,
              url,
              state,
              created_by: userId ?? null,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: 'brand_id,page_key' },
          );
    if (error) throw error;

    return res.json({ success: true, pages: byKey.size, state });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit opportunity prefs failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits/templates?brandId=… — the brand's template groups (SA-007):
// "/blog/* · 38 pages", with the gaps most of its audited pages share.
// Registered before /:id so "templates" isn't matched as an audit id.
router.get('/templates', async (req, res) => {
  const { brandId } = req.query;
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }
  try {
    await assertBrandAccess(brandId, req.user?.id);
    const [primary, sitePages, audits] = await Promise.all([
      primaryDomainOf(brandId),
      supabaseAdmin.from('site_pages').select('url').eq('brand_id', brandId),
      readBrandAudits(brandId),
    ]);
    for (const read of [sitePages, audits]) if (read.error) throw read.error;

    const templates = await readTemplateGroups({
      primaryHost: normStoredDomain(primary),
      sitePages: sitePages.data ?? [],
      auditPages: buildAuditPages(audits.data),
    });
    return res.json({ success: true, templates });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit templates failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Site Audit settings as the Settings dialog shows them (SA-006): the org's
 * auto-audit switch and e-mail, the brand's exclude patterns and pinned
 * pages. Without an active plan (read-only, 2026-10-27), auto-audit reads as
 * off with a limit of 0, and the rest as kept.
 */
async function readAuditSettings(brandId, orgId) {
  const [quota, excludePatterns, { data: pinned, error }] = await Promise.all([
    getSiteAuditQuotaStatus(orgId, { readOnly: true }),
    readExcludePatterns(brandId),
    supabaseAdmin
      .from('site_audit_page_prefs')
      .select('page_key, url')
      .eq('brand_id', brandId)
      .eq('state', 'pinned')
      .order('page_key', { ascending: true }),
  ]);
  if (error) throw error;
  return {
    autoAudit: {
      enabled: quota.auto.enabled,
      // The org's own choice; null follows the plan.
      setting: quota.auto.setting,
      perRun: quota.auto.perRun,
      limit: quota.limit,
    },
    emailAfterRun: quota.auto.emailAfterRun,
    excludePatterns,
    pinned: (pinned ?? []).map((p) => ({ key: p.page_key, url: p.url })),
  };
}

/** Express's reply for a failed settings or run read/write. */
function sendAuditError(req, res, err, message) {
  if (err instanceof PlanLimitError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  if (err.status) {
    return res
      .status(err.status)
      .json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  req.log.error({ err }, message);
  return res.status(500).json({ success: false, message: err.message });
}

// GET /api/audits/settings?brandId=… — the Site Audit settings (SA-006).
// Registered before /:id so "settings" isn't matched as an audit id.
router.get('/settings', async (req, res) => {
  const { brandId } = req.query;
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }
  try {
    const { orgId } = await assertBrandAccess(brandId, req.user?.id);
    return res.json({ success: true, settings: await readAuditSettings(brandId, orgId) });
  } catch (err) {
    return sendAuditError(req, res, err, 'audit settings read failed');
  }
});

const settingsSchema = z.object({
  brandId: z.guid(),
  // null follows the plan's default again.
  autoAudit: z.boolean().nullable().optional(),
  emailAfterRun: z.boolean().optional(),
  excludePatterns: z
    .array(z.string().max(EXCLUDE_PATTERN_MAX_LENGTH * 2))
    .max(EXCLUDE_PATTERNS_MAX)
    .optional(),
});

// PUT /api/audits/settings — change the org's auto-audit switch and e-mail,
// and the brand's exclude patterns ({ brandId, autoAudit?, emailAfterRun?,
// excludePatterns? }). Admins and managers only.
router.put('/settings', async (req, res) => {
  const userId = req.user?.id;
  const parsed = settingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid request',
    });
  }
  const { brandId, autoAudit, emailAfterRun, excludePatterns } = parsed.data;

  const patterns = [];
  for (const raw of excludePatterns ?? []) {
    const pattern = normalizeExcludePattern(raw);
    if (!pattern) {
      return res.status(400).json({
        success: false,
        message: `"${raw.trim()}" isn't a page path. Start it with /, as in /legal/*.`,
      });
    }
    if (!patterns.includes(pattern)) patterns.push(pattern);
  }

  try {
    const { orgId } = await assertBrandAccess(brandId, userId);
    if (!(await canChangeSettings(userId))) {
      return res.status(403).json({
        success: false,
        message: 'Only admins and managers can change Site Audit settings.',
      });
    }

    const now = new Date().toISOString();
    if (autoAudit !== undefined || emailAfterRun !== undefined) {
      // The switch and the e-mail are the organization's, for every brand:
      // a person with Selected brands changes only their brand's patterns.
      await assertAllBrands(userId);
      const { error } = await supabaseAdmin.from('site_audit_settings').upsert(
        {
          organization_id: orgId,
          ...(autoAudit !== undefined ? { auto_audit: autoAudit } : {}),
          ...(emailAfterRun !== undefined ? { email_after_run: emailAfterRun } : {}),
          updated_by: userId ?? null,
          updated_at: now,
        },
        { onConflict: 'organization_id' },
      );
      if (error) throw error;
    }
    if (excludePatterns !== undefined) {
      const { error } = await supabaseAdmin.from('site_audit_brand_settings').upsert(
        {
          brand_id: brandId,
          exclude_patterns: patterns,
          updated_by: userId ?? null,
          updated_at: now,
        },
        { onConflict: 'brand_id' },
      );
      if (error) throw error;
    }

    return res.json({ success: true, settings: await readAuditSettings(brandId, orgId) });
  } catch (err) {
    return sendAuditError(req, res, err, 'audit settings update failed');
  }
});

/** Runs the latest-run summary looks back over, newest first. */
const LATEST_RUNS_READ = 5;

// GET /api/audits/auto-runs/latest?brandId=… — the org's latest auto-audit
// run that audited pages of this brand, in the last 30 days, with what it
// found there (SA-006's in-app notice). run is null when there's none.
router.get('/auto-runs/latest', async (req, res) => {
  const { brandId } = req.query;
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }
  try {
    const { orgId } = await assertBrandAccess(brandId, req.user?.id);
    const since = new Date(Date.now() - AUTO_AUDIT.freshDays * 24 * 60 * 60 * 1000);
    const { data: runs, error } = await supabaseAdmin
      .from('site_audit_auto_runs')
      .select('id, run_day, status, audit_ids, started_at, finished_at')
      .eq('organization_id', orgId)
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false })
      .limit(LATEST_RUNS_READ);
    if (error) throw error;

    const ids = [...new Set((runs ?? []).flatMap((r) => r.audit_ids ?? []))];
    const audits = await readByAuditIds(ids, 100, (chunk) =>
      supabaseAdmin
        .from('site_audits')
        .select('id, status')
        .in('id', chunk)
        .eq('brand_id', brandId),
    );
    const statusById = new Map(audits.map((a) => [a.id, a.status]));
    const run = (runs ?? []).find((r) => (r.audit_ids ?? []).some((id) => statusById.has(id)));
    if (!run) return res.json({ success: true, run: null });

    const own = run.audit_ids.filter((id) => statusById.has(id));
    const completed = own.filter((id) => statusById.get(id) === 'completed');
    let criticalIssues = 0;
    if (completed.length > 0) {
      const { count, error: countErr } = await supabaseAdmin
        .from('audit_signal_results')
        .select('audit_id', { count: 'exact', head: true })
        .in('audit_id', completed)
        .eq('status', 'fail');
      if (countErr) throw countErr;
      criticalIssues = count ?? 0;
    }

    return res.json({
      success: true,
      run: {
        id: run.id,
        day: run.run_day,
        status: run.status,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        pages: own.length,
        completed: completed.length,
        running: own.filter((id) => statusById.get(id) === 'running').length,
        criticalIssues,
      },
    });
  } catch (err) {
    return sendAuditError(req, res, err, 'auto-audit run read failed');
  }
});

// GET /api/audits/site-trust?brandId=…&refresh=1 — the brand's five site
// trust checks (Content Editor Quality, CE-043): the day's read, or a new
// one when asked again (siteTrust.js). Once the plan has ended, only the
// kept read, however old: 402 when none is kept. Registered before /:id.
router.get('/site-trust', async (req, res) => {
  const parsed = z.guid().safeParse(req.query.brandId);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }
  try {
    const { orgId } = await assertBrandAccess(parsed.data, req.user?.id);
    const keptOnly = !(await isOrgActive(orgId));
    const trust = await readSiteTrust(parsed.data, {
      refresh: req.query.refresh === '1',
      keptOnly,
    });
    if (!trust) return res.status(402).json(SUBSCRIPTION_INACTIVE);
    return res.json({ success: true, ...trust });
  } catch (err) {
    return sendAuditError(req, res, err, 'site trust read failed');
  }
});

// GET /api/audits/:id — fetch one stored audit with its signals
router.get('/:id', async (req, res) => {
  const userId = req.user?.id;
  const { id } = req.params;

  try {
    const { data: audit } = await supabaseAdmin
      .from('site_audits')
      .select('*')
      .eq('id', id)
      .single();
    if (!audit) {
      return res.status(404).json({ success: false, message: 'Audit not found' });
    }

    await assertBrandAccess(audit.brand_id, userId);

    // The history read is best-effort and can run alongside the signal read.
    // Its result uses the same page grouping as GET /pages.
    const historyPromise =
      audit.status === 'completed' && audit.total_score != null
        ? readBrandAudits(audit.brand_id).catch((historyErr) => {
            req.log.warn({ err: historyErr, auditId: id }, 'audit previous score lookup failed');
            return null;
          })
        : Promise.resolve(null);

    const [{ data: signalRows }, historyResult] = await Promise.all([
      supabaseAdmin.from('audit_signal_results').select('*').eq('audit_id', id),
      historyPromise,
    ]);

    if (historyResult?.error) {
      req.log.warn({ err: historyResult.error, auditId: id }, 'audit previous score lookup failed');
    }
    const previous =
      historyResult && !historyResult.error
        ? findPreviousCompletedAudit(historyResult.data ?? [], id)
        : null;

    return res.json({
      success: true,
      audit: {
        ...assembleAudit(audit, signalRows ?? []),
        previousScore: previous?.totalScore ?? null,
        previousCreatedAt: previous?.createdAt ?? null,
      },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit fetch failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits?brandId=…&limit=50&offset=0 — recent audits for a brand,
// newest first (list, no signals). `total` is the brand's full audit count so
// the client can page; omitting limit/offset returns the newest 50 as before.
router.get('/', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  const { limit, offset } = parseListPage(req.query);

  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const { data: audits, count } = await supabaseAdmin
      .from('site_audits')
      .select('id, url, status, total_score, signals_evaluated, signals_total, created_at', {
        count: 'exact',
      })
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);

    return res.json({ success: true, audits: audits ?? [], total: count ?? 0 });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit list failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/audits/:id — remove an audit (signal rows cascade via FK)
router.delete('/:id', async (req, res) => {
  const userId = req.user?.id;
  const { id } = req.params;

  try {
    const { data: audit } = await supabaseAdmin
      .from('site_audits')
      .select('id, brand_id')
      .eq('id', id)
      .single();
    if (!audit) {
      return res.status(404).json({ success: false, message: 'Audit not found' });
    }

    await assertBrandAccess(audit.brand_id, userId);

    const { error } = await supabaseAdmin.from('site_audits').delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit delete failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
