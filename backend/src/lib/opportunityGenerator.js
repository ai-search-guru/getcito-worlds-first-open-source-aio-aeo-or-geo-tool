/**
 * Content opportunity generation, per prompt cluster (#857).
 *
 * Shared by the nightly run after each tracking cycle and the queued job
 * behind the Generate button. Each run takes the highest-scoring clusters
 * that have no opportunity yet and asks the model to write one opportunity
 * per cluster. A cluster that needs the same content as an existing
 * opportunity in another topic is merged into it instead.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from './aiProvider.js';
import { getLanguageName } from './languages.js';
import supabaseAdmin from '../config/supabase.js';
import { selectInChunks } from './chunkedIn.js';
import { logger } from './logger.js';
import {
  OPPORTUNITIES_PER_RUN,
  OPPORTUNITY_WINDOW_DAYS,
  clusterMetrics,
  coveredClusterIds,
  openOpportunityOn,
  openlyCoveredClusterIds,
  opportunityScore,
  pickClusters,
  scoreComponents,
} from './opportunityLimits.js';
import { loadClusterOpportunities, loadOpportunityBaskets } from './openOpportunities.js';
import { basket, duplicateThreshold, findDuplicate, storedBasket } from './opportunityDedup.js';
import {
  candidateOf,
  clustersOf,
  findSameQuestion,
  isOpen,
  mergeOpportunity,
} from './opportunitySameQuestion.js';
import { loadClusters } from './promptClusters.js';
import { cleanOpportunityText } from './opportunityText.js';
import { yearRule } from './currentYear.js';
import {
  focusClusters,
  loadPageFocus,
  pageFocusInstruction,
  pickPageCluster,
} from './opportunityPageFocus.js';
import { reopenStrengthened } from './opportunityReopen.js';
import {
  claimOpportunitySlots,
  linkOpportunitySlots,
  releaseOpportunitySlots,
} from './planGuard.js';
import {
  DECISIONS,
  MAX_SUPPORTING_ASSETS,
  assetTypes,
  buildAssets,
  candidatePages,
} from './pageMatching.js';
import { SITE_TYPE_NAMES, sitePageTypeLines, siteTypeOf } from './contentPageTypes.js';
import { brandRulesSection } from './brandRules.js';
import { readBrandRules } from './brandRulesRead.js';

/** Existing opportunities shown to the model for the cross-topic check. */
const EXISTING_SHOWN = 60;
/**
 * Clusters an opportunity may absorb from other topics. Past this it stops
 * being offered as a merge target: one opportunity that keeps absorbing
 * neighbouring needs turns into a catch-all no single page can answer.
 */
export const MAX_MERGED_CLUSTERS = 3;
/** Included fan-out queries kept on an opportunity, most searched first. */
const QUERIES_KEPT = 15;
const PROMPTS_SHOWN = 12;

const SYSTEM_PROMPT = `You are an AEO content strategist. Each cluster below is a group of prompts that one piece of content can answer. Write one content opportunity per cluster.

Rules:
- One opportunity per cluster, for the content that answers all of its prompts. Name the need, not a single prompt.
- Be concrete and actionable, and reference the data: visibility, the strongest competitor's visibility, competitors. Don't state a search volume: it is an estimate the page shows with its source.
- Categorize as "owned" (content the brand controls) or "earned" (third-party content, PR, reviews).
- Existing opportunities from other topics are listed. If a cluster needs the same content as one of them — the same user need and the same piece of content, answering the cluster's prompts without becoming a different page — set sameAs to its bracketed E index. Otherwise set sameAs to null. Sharing words, a topic or a product category is not enough.
- Decide what the content is, given the brand's pages listed under each cluster:
  - create: no listed page answers this need. Write a new page.
  - optimize: a listed page already targets this need. Make it the answer AI engines pick: structure, evidence, direct answers, FAQ.
  - expand: a listed page covers part of the need. Add the angles it misses.
  - refresh: a listed page covers the need but is out of date (old year, old last-modified date, stale facts).
  - consolidate: two or more listed pages are each mainly about this same need, close to duplicates, and split its signals. Merge them into one. Pages of different kinds (a head-to-head comparison and a general list, a glossary entry and a guide) are not duplicates: pick the page closest to the need and expand or optimize it instead.
  - defend: the brand is already visible for this need and a listed page answers it. Keep it ahead of competitors.
  Set pageIndexes to the bracketed P indexes of the pages the decision is about, and leave it empty for create. The title should say what to do with which page, for example "Expand the AI rank tracker comparison with Google AI Overviews coverage".
- The opportunity is the primary asset above. Set assetType to what that content is: the content type, of those listed for the brand's site, that answers this need there.
- Add supporting assets only when the data calls for them, up to ${MAX_SUPPORTING_ASSETS}, each a different piece of work. Owned ones are of the brand's content types too. For example: a comparison or alternatives page when people compare named products; a definition or FAQ page for a term the main content relies on; an earned third-party article when competitors are visible and the brand is not; a backlink when the brand's page exists but is not cited. Give each a short title saying what to make or do. Most opportunities need none or one.
- Earned assets (third_party_article, backlink) live on other sites: set their channel to "earned", decision to "create" and pageIndexes to empty.
- Write for the brand's marketing team: do not use the words "cluster" or "prompt" in titles or descriptions.
- Titles and descriptions follow the year rule given with the clusters: a year in them goes stale on New Year's Day.
- Refer to clusters and existing opportunities only through clusterIndex and sameAs. Never mention a bracketed index in a title or description.
- When BRAND RULES are given, every opportunity follows them: shape it to fit a rule, and when no opportunity for a cluster can, write the closest one that does, never one against a rule.`;

/** @param {string[]} types - what an asset can be on the brand's site (assetTypes) */
function buildSchema(count, types) {
  return z.object({
    opportunities: z
      .array(
        z.object({
          clusterIndex: z.number().describe('The bracketed index of the cluster'),
          sameAs: z
            .number()
            .nullable()
            .describe('The E index of an existing opportunity needing the same content, or null'),
          title: z.string().describe('A specific, actionable content recommendation'),
          description: z
            .string()
            .describe('1-2 sentences on why it matters, referencing the metrics'),
          type: z.enum(['owned', 'earned']),
          impact: z.enum(['high', 'medium', 'low']),
          decision: z.enum(DECISIONS),
          pageIndexes: z
            .array(z.number())
            .describe('The P indexes of the existing pages the decision is about'),
          assetType: z.enum(types).describe('What the primary content is'),
          supportingAssets: z
            .array(
              z.object({
                type: z.enum(types),
                channel: z.enum(['owned', 'earned']),
                decision: z.enum(DECISIONS),
                pageIndexes: z.array(z.number()),
                title: z.string().describe('What to make or do, in a few words'),
              }),
            )
            .describe('Further assets the data calls for; often empty'),
        }),
      )
      .max(count),
  });
}

/** Everything the opportunity carries about its cluster(s), for the detail page and the brief. */
function sourceData({ clusters, topicName, metrics, components, queries }) {
  const [primary, ...related] = clusters;
  return {
    promptText: metrics.representative?.text,
    clusterLabel: primary.label,
    topicName: topicName(primary),
    relatedTopics: related.map(topicName),
    prompts: clusters.flatMap((c) => c.promptTexts),
    // What the score's demand adds up; the opportunity's volume is its
    // question's (questionVolume), as the page shows it.
    estAiVolume: metrics.demand,
    questionVolume: metrics.representative?.volume ?? 0,
    visibilityScore: metrics.visibility,
    topCompetitorVisibility: metrics.topCompetitorVisibility,
    competitorGap: metrics.competitorGap,
    intent: metrics.intent,
    keywords: metrics.keywords,
    competitorsCited: metrics.competitorsCited,
    queries,
    scoreComponents: components,
    windowDays: OPPORTUNITY_WINDOW_DAYS,
  };
}

/** Included/excluded counts and the most searched included queries across clusters. */
function basketSummary(clusterIds, basketRows) {
  const rows = basketRows.filter((r) => clusterIds.includes(r.cluster_id));
  const times = new Map();
  for (const r of rows)
    if (r.included) times.set(r.query, (times.get(r.query) || 0) + r.times_searched);
  return {
    included: new Set(rows.filter((r) => r.included).map((r) => r.query)).size,
    excluded: new Set(rows.filter((r) => !r.included).map((r) => r.query)).size,
    top: [...times]
      .sort((a, b) => b[1] - a[1])
      .slice(0, QUERIES_KEPT)
      .map(([query, timesSearched]) => ({ query, timesSearched })),
  };
}

/** Clusters per basket request; a cluster can hold dozens of fan-out queries. */
const BASKET_CHUNK = 10;

/**
 * Drops the open clusters that duplicate an existing opportunity (CONTENT-004)
 * by adding them to `covered`, and folds each into its match when the match
 * is still open and has room, counting it on the match as `duplicatesMerged`
 * for the detail panel. A dismissed match only keeps the cluster out; after
 * DISMISSED_BLOCK_DAYS it may be suggested again. Returns how many were
 * skipped.
 */
async function skipDuplicates(brandId, open, { rows, clusterById, basketRows, covered }) {
  if (!open.length) return 0;
  const existing = rows.map((row) => ({
    ...row,
    basket: storedBasket(row.source_data),
  }));
  if (!existing.length) return 0;

  const threshold = duplicateThreshold();
  let skipped = 0;
  for (const cand of open) {
    const c = clusterById.get(cand.id);
    const candidate = basket({
      prompts: c.promptTexts,
      queries: basketSummary([c.id], basketRows).top.map((q) => q.query),
    });
    const match = findDuplicate(candidate, existing, { threshold });
    if (!match) continue;
    covered.add(cand.id);
    skipped += 1;

    const row = match.row;
    const related = row.related_cluster_ids || [];
    if (
      row.status === 'dismissed' ||
      !row.cluster_id ||
      related.length >= MAX_MERGED_CLUSTERS ||
      related.includes(cand.id)
    ) {
      continue;
    }
    row.related_cluster_ids = [...related, cand.id];
    row.source_data = {
      ...(row.source_data || {}),
      duplicatesMerged: (row.source_data?.duplicatesMerged || 0) + 1,
    };
    const { error } = await supabaseAdmin
      .from('content_opportunities')
      .update({
        related_cluster_ids: row.related_cluster_ids,
        source_data: row.source_data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
  }
  if (skipped) logger.info({ brandId, skipped }, '[opportunities] duplicates skipped');
  return skipped;
}

/**
 * One open opportunity per question (opportunitySameQuestion.js): a cluster
 * whose question an open opportunity already answers joins that one, with its
 * prompts, AI searches and signal, instead of being written. Like a basket
 * duplicate it costs neither a model call nor a slot of the quota. The
 * clusters taken in leave `open` and become covered; returns which
 * opportunity each went to.
 *
 * A cluster an open opportunity already holds (its cluster or a related one)
 * joined it before and isn't merged again. An opportunity with no cluster of
 * its own, as Send to Content and a task make, doesn't make its clusters
 * covered (loadClusterOpportunities reads only rows with one), so the same
 * cluster comes back every night; merging it again would add its times
 * searched again (N, 2N, 3N…).
 *
 * @returns {Promise<Map<string, string>>} cluster id → opportunity id
 */
export async function mergeSameQuestion(
  open,
  rows,
  { clusterById, basketRows, covered, topicName, source },
) {
  const into = new Map();
  let merged = 0;
  for (const cand of [...open]) {
    const c = clusterById.get(cand.id);
    const question = cand.metrics.representative;
    const holder = rows.find((row) => isOpen(row) && clustersOf(row).includes(c.id));
    const target =
      holder ??
      findSameQuestion(
        { question: question?.text, promptId: question?.id, clusterIds: [c.id] },
        rows,
      );
    if (!target) continue;
    into.set(c.id, target.id);
    covered.add(c.id);
    open.splice(open.indexOf(cand), 1);
    // Already in it: its AI searches count once.
    if (holder) continue;
    const update = mergeOpportunity(
      target,
      {
        cluster_id: c.id,
        opportunity_score: cand.score,
        source_data: sourceData({
          clusters: [c],
          topicName,
          metrics: cand.metrics,
          components: cand.components,
          queries: basketSummary([c.id], basketRows),
        }),
      },
      { source, clusterId: c.id, question: question?.text ?? null },
    );
    const { error } = await supabaseAdmin
      .from('content_opportunities')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', target.id);
    if (error) throw new Error(error.message);
    // A later cluster in this run may land on the same one.
    Object.assign(target, update);
    merged += 1;
  }
  if (merged) logger.info({ merged }, '[opportunities] same question merged');
  return into;
}

async function loadPromptTexts(promptIds) {
  const { data, error } = await selectInChunks(promptIds, (chunk) =>
    supabaseAdmin.from('prompts').select('id, text').in('id', chunk),
  );
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * The clusters a run may write for: those with answers to go on that aren't
 * covered yet, within the request's focus. "Another angle" (CONTENT-006) is
 * for its own cluster only.
 */
export function openCandidates(candidates, { covered, inFocus, alternativeOf = null }) {
  if (alternativeOf) return candidates.filter((c) => c.id === alternativeOf.clusterId);
  return candidates.filter((c) => c.metrics.tested > 0 && !covered.has(c.id) && inFocus(c));
}

/**
 * What the model is told when the user asks for another angle on an existing
 * opportunity (CONTENT-006): the original, and that this one must differ in
 * kind, not just in wording.
 */
export function alternativeInstruction({ title, description, decision }) {
  const about = [
    `"${title}"`,
    description ? `(${description})` : null,
    decision ? `decided as "${decision}"` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return `This cluster already has the opportunity ${about}. The user wants a different angle on the same need: write one opportunity that differs clearly in content type, format, audience or decision. Don't repeat its title or approach.`;
}

/** Longest idea a "+ New" request may carry into the model prompt. */
export const IDEA_MAX_LENGTH = 500;

/**
 * @param {string} brandId
 * @param {{
 *   model?: string,
 *   onProgress?: (p: {phase: string, message: string}) => void,
 *   count?: number,
 *   topicId?: string | null,
 *   promptId?: string | null,
 *   idea?: string | null,
 *   source?: 'system' | 'manual' | 'prompt',
 *   alternativeOf?: { id: string, title: string, description?: string|null, decision?: string|null, clusterId: string } | null,
 *   explicit?: boolean,
 *   pagePath?: string | null,
 * }} [opts] - `count`, the focus (`topicId` / `promptId`) and `idea` come from
 *   an on-demand request (CONTENT-003); the nightly run passes none of them.
 *   `alternativeOf` asks for one more opportunity on that opportunity's
 *   cluster with a different angle (CONTENT-006): the user wants a second
 *   take on a need that's already covered, so neither coverage nor the
 *   duplicate check stands in its way, and it isn't merged into anything.
 *   `explicit` is a request for the focused prompt's cluster itself (PROMPT-006
 *   "Suggest content"): it is written even if the cluster was covered by a
 *   dismissed or finished opportunity, never when an open one covers it, and
 *   never merged away.
 *   `pagePath` asks for one page's content (AT-006 part B3): it is written
 *   from the clusters about that page (opportunityPageFocus.js), like an
 *   explicit request, with the page first among the candidate pages; with no
 *   such cluster nothing is written and `noMatch` says so.
 *   Every request but `alternativeOf` adds a cluster whose question an open
 *   opportunity already answers to that one instead (opportunitySameQuestion.js).
 * @returns {Promise<{ generated: number, merged: number, reopened?: number, duplicates?: number, sameQuestion?: number, limited?: boolean, noMatch?: boolean, opportunityIds?: string[], existingId?: string }>}
 */
export async function generateContentOpportunities(
  brandId,
  {
    model,
    onProgress,
    count,
    topicId = null,
    promptId = null,
    idea = null,
    source = 'system',
    alternativeOf = null,
    explicit = false,
    pagePath = null,
  } = {},
) {
  // The user asked for this cluster, or this page, by name: the duplicate
  // check, merging into another opportunity and reopening finished ones
  // don't apply.
  const targeted = !!alternativeOf || explicit || !!pagePath;
  onProgress?.({ phase: 'collecting_data', message: 'Fetching clusters and metrics...' });

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name, industry, language, organization_id, site_type, shopping_mode_enabled')
    .eq('id', brandId)
    .single();
  if (!brand) return { generated: 0, merged: 0 };
  // The brand's rules (00450): they shape the opportunities, not their scores.
  const brandRules = brandRulesSection(
    await readBrandRules(brandId),
    "BRAND RULES (the brand's own; follow every one):",
  );

  const clusters = await loadClusters(brandId);
  if (!clusters.length) return { generated: 0, merged: 0 };

  const since = new Date(Date.now() - OPPORTUNITY_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const memberIds = clusters.flatMap((c) => c.prompt_ids);
  const [prompts, volumes, metricsRes, topicsRes, domainsRes, existing, pagesRes, competitorsRes] =
    await Promise.all([
      loadPromptTexts(memberIds),
      selectInChunks(memberIds, (chunk) =>
        supabaseAdmin
          .from('prompt_volumes')
          .select('prompt_id, est_ai_volume, intent, keywords')
          .in('prompt_id', chunk),
      ),
      supabaseAdmin.rpc('brand_prompt_opportunity_metrics', {
        p_brand_id: brandId,
        p_since: since,
      }),
      supabaseAdmin.from('topics').select('id, name').eq('brand_id', brandId),
      supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
      loadClusterOpportunities(brandId),
      // Pages that answered when last read; a 404 is not a page to work on.
      supabaseAdmin
        .from('site_pages')
        .select('url, title, h1, description, lastmod, ai_citations, ga_sessions')
        .eq('brand_id', brandId)
        .eq('fetch_status', 200),
      supabaseAdmin.from('competitors').select('name').eq('brand_id', brandId),
    ]);
  if (volumes.error) throw new Error(volumes.error.message);
  if (pagesRes.error) throw new Error(pagesRes.error.message);
  const competitorNamesList = (competitorsRes.data || []).map((c) => c.name);
  if (metricsRes.error) throw new Error(metricsRes.error.message);

  const byPrompt = new Map(prompts.map((p) => [p.id, { text: p.text }]));
  for (const v of volumes.data || []) {
    if (byPrompt.has(v.prompt_id)) byPrompt.get(v.prompt_id).volume = v;
  }
  for (const m of metricsRes.data || []) {
    if (byPrompt.has(m.prompt_id)) byPrompt.get(m.prompt_id).metrics = m;
  }

  const topicNames = new Map((topicsRes.data || []).map((t) => [t.id, t.name]));
  const topicName = (c) => (c.topic_id ? topicNames.get(c.topic_id) || null : null);
  const clusterById = new Map(
    clusters.map((c) => [
      c.id,
      {
        ...c,
        promptTexts: c.prompt_ids.map((id) => byPrompt.get(id)?.text).filter(Boolean),
      },
    ]),
  );

  // One page's content (AT-006 part B3) comes from the clusters about it;
  // without one there is nothing to write from, and no slot is claimed.
  const focus = pagePath ? await loadPageFocus(brandId, pagePath, memberIds) : null;
  const focusIds = focus
    ? focusClusters([...clusterById.values()], focus.page, focus.targetedPromptIds)
    : null;
  if (focusIds && !focusIds.length) return { generated: 0, merged: 0, noMatch: true };

  const measure = (clusterIds) => {
    const metrics = clusterMetrics(
      clusterIds.flatMap((id) => clusterById.get(id)?.prompt_ids || []),
      byPrompt,
    );
    const components = scoreComponents(metrics);
    return { metrics, components, score: opportunityScore(components) };
  };

  // Finished opportunities whose signals moved go back to New before any new
  // ones are written; they keep their clusters, so nothing is duplicated. A
  // run asked for one cluster leaves that to the next regular run: reopening
  // that cluster's own would put two open opportunities on it.
  let reopened = 0;
  if (!targeted) {
    try {
      // Not while another open opportunity answers its question.
      const answeredElsewhere = (opp) =>
        !!findSameQuestion(
          candidateOf(opp),
          existing.filter((o) => o.id !== opp.id),
        );
      reopened = await reopenStrengthened(brandId, existing, measure, { skip: answeredElsewhere });
    } catch (err) {
      logger.error({ err, brandId }, '[opportunities] re-opening finished opportunities failed');
    }
  }

  const candidates = clusters.map((c) => ({ id: c.id, topicId: c.topic_id, ...measure([c.id]) }));
  // A prompt's own request may revisit a cluster whose opportunity was
  // dismissed or finished, never one with an open opportunity.
  const covered =
    explicit || focusIds ? openlyCoveredClusterIds(existing) : coveredClusterIds(existing);

  // The fan-out baskets of every cluster still open for an opportunity: the
  // duplicate check compares them, and the prompt shows the picked ones'.
  // A focused request only considers its topic's clusters or its prompt's.
  const inFocus = (c) =>
    (!topicId || c.topicId === topicId) &&
    (!promptId || clusterById.get(c.id).prompt_ids.includes(promptId)) &&
    (!focusIds || focusIds.includes(c.id));
  const open = openCandidates(candidates, { covered, inFocus, alternativeOf });
  // A page's request goes to its best-matching cluster that has an open
  // opportunity, which it points at, or answers, which it writes from.
  if (focusIds) {
    const pick = pickPageCluster(focusIds, { openIds: new Set(open.map((c) => c.id)), covered });
    if (pick && 'existing' in pick) {
      return { generated: 0, merged: 0, existingId: openOpportunityOn(existing, pick.existing) };
    }
    open.splice(0, open.length, ...open.filter((c) => c.id === pick?.write));
  }
  const { data: basketRows, error: basketErr } = await selectInChunks(
    open.map((c) => c.id),
    (chunk) =>
      supabaseAdmin
        .from('prompt_cluster_queries')
        .select('cluster_id, query, times_searched, included')
        .in('cluster_id', chunk),
    BASKET_CHUNK,
  );
  if (basketErr) throw new Error(basketErr.message);

  // A cluster whose question an open opportunity answers joins it. An asked-
  // for one too: a prompt's or a page's request then points at it. Only
  // "Another angle" is a second take on purpose.
  const rows = alternativeOf ? [] : await loadOpportunityBaskets(brandId);
  const sameQuestion = alternativeOf
    ? new Map()
    : await mergeSameQuestion(open, rows, {
        clusterById,
        basketRows: basketRows || [],
        covered,
        topicName,
        source,
      });

  // CONTENT-004: a cluster whose baskets match an existing opportunity is
  // that opportunity again. It is never written, so it costs neither a model
  // call nor a slot of the quota; an open match takes it in as a related
  // cluster, so it is covered from now on.
  const duplicates = targeted
    ? 0
    : await skipDuplicates(brandId, open, {
        rows,
        clusterById,
        basketRows: basketRows || [],
        covered,
      });

  const wanted = targeted
    ? open.slice(0, count ?? 1)
    : pickClusters(open, covered, count ?? OPPORTUNITIES_PER_RUN, {
        fill: count !== undefined,
      });
  if (!wanted.length) {
    logger.info(
      {
        brandId,
        clusters: clusters.length,
        opportunities: existing.length,
        reopened,
        duplicates,
        sameQuestion: sameQuestion.size,
      },
      '[opportunities] every cluster with answers already has an opportunity',
    );
    // A request for one prompt that an open opportunity already answers
    // points at it (PROMPT-006): regrouping or another run may have covered
    // the prompt since the request was checked, or its question is answered
    // by another one. A page's request points at the one its cluster joined.
    const promptCluster = promptId
      ? clusters.find((c) => c.prompt_ids.includes(promptId))?.id
      : null;
    const existingId =
      sameQuestion.get(promptCluster) ??
      openOpportunityOn(existing, promptCluster) ??
      (targeted ? ([...sameQuestion.values()][0] ?? null) : null);
    return {
      generated: 0,
      merged: 0,
      reopened,
      duplicates,
      sameQuestion: sameQuestion.size,
      ...(existingId ? { existingId } : {}),
    };
  }

  // Each new opportunity takes one of the organization's monthly slots
  // (CONTENT-001). They are claimed before the model call, so two runs at
  // once can't overshoot; whatever this run doesn't use is handed back.
  const slots = await claimOpportunitySlots(brand.organization_id, wanted.length);
  const picked = slots.unlimited ? wanted : wanted.slice(0, slots.ids.length);
  if (!picked.length) {
    logger.info({ brandId }, '[opportunities] monthly opportunity limit reached');
    return { generated: 0, merged: 0, reopened, limited: true };
  }
  const releaseAll = () =>
    releaseOpportunitySlots(slots.ids).catch((err) =>
      logger.error({ err, brandId }, '[opportunities] handing back slots failed'),
    );

  // An asked-for opportunity is its own, never folded into another one.
  const shown = (targeted ? [] : existing)
    .filter(
      (o) =>
        o.status !== 'dismissed' &&
        clusterById.has(o.cluster_id) &&
        (o.related_cluster_ids || []).length < MAX_MERGED_CLUSTERS,
    )
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, EXISTING_SHOWN);

  // Each cluster's candidate pages, by the words its need shares with them.
  const pagesFor = new Map(
    picked.map((cand) => {
      const c = clusterById.get(cand.id);
      const basket = basketSummary([c.id], basketRows || []);
      const need = [c.label, c.primary_intent, ...c.promptTexts, ...basket.top.map((q) => q.query)];
      const pages = candidatePages(need.join(' '), pagesRes.data || []);
      // The page asked about leads, so the model can work on it ([P0]).
      return [
        cand.id,
        focus ? [focus.page, ...pages.filter((p) => p.url !== focus.page.url)] : pages,
      ];
    }),
  );
  const pageLine = (p, i) =>
    `[P${i}] ${p.title || p.h1 || p.url} — ${p.url} | AI citations (30d): ${p.ai_citations} | GA sessions (30d): ${p.ga_sessions} | Last modified: ${p.lastmod ? p.lastmod.slice(0, 10) : 'unknown'}`;

  const clusterLine = (cand, i) => {
    const c = clusterById.get(cand.id);
    const m = cand.metrics;
    const basket = basketSummary([c.id], basketRows || []);
    const pages = pagesFor.get(cand.id);
    return `[${i}] ${c.label} (topic: ${topicName(c) || 'none'})
Need: ${c.primary_intent}
Prompts:
${c.promptTexts
  .slice(0, PROMPTS_SHOWN)
  .map((t) => `- ${t}`)
  .join('\n')}
Searches AI engines ran for these prompts: ${basket.top.map((q) => q.query).join('; ') || 'none recorded'}
Brand visibility: ${m.visibility}% | Strongest competitor: ${m.topCompetitorVisibility}% | Competitors visible: ${m.competitorsCited.join(', ') || 'none'}
Brand pages that may cover this need:
${pages.map(pageLine).join('\n') || 'none found'}`;
  };

  // The content types follow the brand's kind of site, as the Content Editor's
  // page types do: a shop gets product pages, a SaaS brand feature pages.
  const siteType = siteTypeOf({
    siteType: brand.site_type,
    industry: brand.industry,
    shoppingModeEnabled: brand.shopping_mode_enabled,
  });
  const types = assetTypes(siteType);

  const userPrompt = `Brand: ${brand.name}
Industry: ${brand.industry || 'Not specified'}
Domain: ${(domainsRes.data || []).map((d) => d.domain).join(', ') || 'N/A'}
Site type: ${SITE_TYPE_NAMES[siteType]}
${brandRules ? `\n${brandRules}\n` : ''}
Content types for the brand's site (owned assets):
${sitePageTypeLines(siteType)}

Clusters (highest opportunity first):
${picked.map(clusterLine).join('\n\n')}

Existing opportunities in other topics:
${shown.map((o, i) => `[E${i}] ${o.title} (topic: ${topicName(clusterById.get(o.cluster_id)) || 'none'})`).join('\n') || 'none'}

${alternativeOf ? `${alternativeInstruction(alternativeOf)}\n\n` : ''}${
    focus ? `${pageFocusInstruction(focus.page)}\n\n` : ''
  }${
    idea
      ? `The user asked for ideas around: "${idea.slice(0, IDEA_MAX_LENGTH)}". Shape the opportunities toward it wherever the clusters' prompts allow; never invent a need the data doesn't show.\n\n`
      : ''
  }Year rule for titles and descriptions:
${yearRule()}

Write every title and description in ${getLanguageName(brand.language)}.`;

  onProgress?.({ phase: 'analyzing', message: 'Generating opportunities with AI...' });
  const { object } = await generateObject({
    model: resolveModel(model),
    schema: buildSchema(picked.length, types),
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  }).catch(async (err) => {
    // A failed generation creates nothing, so it uses none of the quota.
    await releaseAll();
    throw err;
  });

  onProgress?.({ phase: 'saving', message: 'Saving opportunities...' });
  const done = new Set();
  const inserts = [];
  let merged = 0;

  for (const opp of object.opportunities) {
    const cand = picked[opp.clusterIndex];
    if (!Number.isInteger(opp.clusterIndex) || !cand || done.has(cand.id)) continue;
    done.add(cand.id);

    // CONTENT-005: any bracketed index the model repeated becomes what it
    // stood for in this run, and misspelled competitors their real names.
    const clean = (text) =>
      cleanOpportunityText(text, {
        clusters: picked.map((p) => clusterById.get(p.id).label),
        pages: pagesFor.get(cand.id),
        existing: shown.map((o) => o.title),
        competitors: competitorNamesList,
        // The prompt numbered clusters [0], [1]…: a lone index is one of them.
        bare: true,
      });
    opp.title = clean(opp.title);
    opp.description = clean(opp.description);
    opp.supportingAssets = (opp.supportingAssets || []).map((a) => ({
      ...a,
      title: clean(a.title),
    }));

    const target = Number.isInteger(opp.sameAs) ? shown[opp.sameAs] : null;
    if (target) {
      // Related clusters deleted by a re-clustering since are dropped here.
      const ids = [target.cluster_id, ...(target.related_cluster_ids || []), cand.id].filter((id) =>
        clusterById.has(id),
      );
      const { metrics, components, score } = measure(ids);
      const { error } = await supabaseAdmin
        .from('content_opportunities')
        .update({
          related_cluster_ids: ids.slice(1),
          opportunity_score: score,
          source_data: {
            ...sourceData({
              clusters: ids.map((id) => clusterById.get(id)),
              topicName,
              metrics,
              components,
              queries: basketSummary(ids, basketRows || []),
            }),
            // The decision, its pages and the assets stay as first made.
            ...(target.targetPages ? { targetPages: target.targetPages } : {}),
            ...(target.assets ? { assets: target.assets } : {}),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id);
      if (error) throw new Error(error.message);
      // A later cluster in this run may name the same target.
      target.related_cluster_ids = ids.slice(1);
      merged += 1;
      continue;
    }

    const c = clusterById.get(cand.id);
    const assets = buildAssets(
      {
        type: opp.assetType,
        channel: opp.type,
        decision: opp.decision,
        pageIndexes: opp.pageIndexes,
        title: opp.title,
      },
      opp.supportingAssets,
      pagesFor.get(cand.id),
      types,
    );
    const [primary] = assets;
    inserts.push({
      brand_id: brandId,
      cluster_id: c.id,
      prompt_id: cand.metrics.representative?.id ?? null,
      title: opp.title,
      description: opp.description,
      type: opp.type,
      impact: opp.impact,
      opportunity_score: cand.score,
      status: 'new',
      source,
      decision: primary.decision,
      source_data: {
        ...sourceData({
          clusters: [c],
          topicName,
          metrics: cand.metrics,
          components: cand.components,
          queries: basketSummary([c.id], basketRows || []),
        }),
        targetPages: primary.pages,
        assets,
        ...(alternativeOf
          ? { alternativeOf: { id: alternativeOf.id, title: alternativeOf.title } }
          : {}),
        // Asked for from AI Traffic's Pages section, for this page.
        ...(focus ? { forPage: { path: pagePath, url: focus.page.url } } : {}),
      },
    });
  }

  let created = [];
  if (inserts.length) {
    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .insert(inserts)
      .select('id');
    if (error) {
      await releaseAll();
      throw new Error(error.message);
    }
    created = data || [];
  }
  if (!slots.unlimited) {
    await linkOpportunitySlots(
      created.map((row, i) => ({ usageId: slots.ids[i], opportunityId: row.id })),
    );
    // Merged or skipped clusters created nothing: their slots go back.
    await releaseOpportunitySlots(slots.ids.slice(created.length));
  }
  logger.info(
    {
      brandId,
      generated: inserts.length,
      merged,
      reopened,
      duplicates,
      sameQuestion: sameQuestion.size,
      clusters: clusters.length,
    },
    '[opportunities] generated',
  );
  // The new rows' ids, so a caller that asked for one can open it.
  return {
    generated: inserts.length,
    merged,
    reopened,
    duplicates,
    sameQuestion: sameQuestion.size,
    opportunityIds: created.map((row) => row.id),
  };
}
