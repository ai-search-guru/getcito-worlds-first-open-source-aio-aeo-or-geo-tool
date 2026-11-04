/**
 * GSC-fed suggestion candidates (#648).
 *
 * Mines the brand's real Google queries (gsc_query_stats) for demand the
 * brand does not track in AI answers yet. Everything up to the LLM handoff
 * is deterministic: SQL aggregation → token-overlap coverage filter →
 * head + long-tail composition → click-based rationale badges → cached
 * DataForSEO competition enrichment. Any failure returns [] so the base
 * suggestion flow never degrades; brands without GSC data short-circuit on
 * the first (empty) query.
 */

import supabaseAdmin from '../config/supabase.js';
import { getSearchVolumes } from './dataforseo.js';
import { regionToLocationCode, languageToCode } from './dataforseoCodes.js';
import { logger } from './logger.js';

const WINDOW_DAYS = 28;
const MIN_IMPRESSIONS = 30;
const LONGTAIL_MIN_IMPRESSIONS = 10;
const LONGTAIL_MIN_WORDS = 4;
const HEAD_SLOTS = 10;
const LONGTAIL_SLOTS = 10;
export const MAX_CANDIDATES = HEAD_SLOTS + LONGTAIL_SLOTS;
const PROTECT_MIN_CLICKS = 10;
const CAPTURE_MIN_IMPRESSIONS = 100;
const CAPTURE_MAX_CTR = 0.01;
const LOW_COMPETITION_MAX_INDEX = 33;
const CACHE_TTL_DAYS = 30;
// Token-overlap ratio above which a query counts as already tracked.
const COVERAGE_OVERLAP = 0.6;

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'for',
  'to',
  'in',
  'on',
  'at',
  'is',
  'are',
  'was',
  'be',
  'do',
  'does',
  'how',
  'what',
  'which',
  'who',
  'why',
  'when',
  'where',
  'can',
  'i',
  'my',
  'your',
  'with',
  'vs',
  'best',
]);

export function normalizeTokens(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Each prompt's meaningful tokens, read once for checking many queries. */
export function promptTokenSets(promptTexts) {
  return promptTexts.map((text) => new Set(normalizeTokens(text)));
}

/** `isCoveredByPrompts` against prompts already split by `promptTokenSets`. */
export function isCoveredByTokenSets(query, tokenSets) {
  const queryTokens = normalizeTokens(query);
  if (queryTokens.length === 0) return true; // stopwords-only — nothing to track
  return tokenSets.some((promptTokens) => {
    const hits = queryTokens.filter((t) => promptTokens.has(t)).length;
    return hits / queryTokens.length >= COVERAGE_OVERLAP;
  });
}

/** True when the query's meaningful tokens are mostly present in one prompt. */
export function isCoveredByPrompts(query, promptTexts) {
  return isCoveredByTokenSets(query, promptTokenSets(promptTexts));
}

/** Click-based rationale: protect what earns traffic, capture what doesn't convert. */
export function classifyCandidate(c) {
  if (c.clicks >= PROTECT_MIN_CLICKS) return 'protect_traffic';
  const ctr = c.impressions > 0 ? c.clicks / c.impressions : 0;
  if (c.impressions >= CAPTURE_MIN_IMPRESSIONS && ctr < CAPTURE_MAX_CTR) return 'capture_demand';
  return null;
}

/**
 * Coverage-filter and slice the aggregated rows: top head demand plus
 * long-tail quick wins, capped at MAX_CANDIDATES. `excludedQueries` holds
 * normalized queries the user recently dismissed — GSC candidates are
 * deterministic, so without this a dismissed suggestion would resurrect on
 * every refresh.
 */
export function composeCandidates(rows, existingPromptTexts, excludedQueries = new Set()) {
  const open = (rows || [])
    .filter(
      (r) =>
        r.query &&
        !excludedQueries.has(r.query.trim().toLowerCase()) &&
        !isCoveredByPrompts(r.query, existingPromptTexts),
    )
    .map((r) => ({
      query: r.query,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      avgPosition: r.avg_position != null ? Math.round(r.avg_position * 10) / 10 : null,
    }));

  // The RPC returns everything down to the long-tail floor, so the head's own
  // floor is applied here — otherwise a quiet site's top slots fill with
  // queries that are neither head demand nor long-tail.
  const head = open.filter((c) => c.impressions >= MIN_IMPRESSIONS).slice(0, HEAD_SLOTS);
  const inHead = new Set(head.map((c) => c.query));
  const longtail = open
    .filter(
      (c) =>
        !inHead.has(c.query) &&
        c.impressions >= LONGTAIL_MIN_IMPRESSIONS &&
        c.query.trim().split(/\s+/).length >= LONGTAIL_MIN_WORDS,
    )
    .slice(0, LONGTAIL_SLOTS);

  return [...head, ...longtail].map((c) => ({ ...c, badge: classifyCandidate(c) }));
}

/** Attach competitionIndex via a 30-day cache + at most ONE batched call. */
async function enrichCompetition(candidates, brand) {
  if (process.env.GSC_SUGGESTION_ENRICHMENT === 'off') return candidates;
  if (candidates.length === 0) return candidates;

  const locationCode = (brand.region ? regionToLocationCode(brand.region) : 0) || 0;
  const languageCode = (brand.language ? languageToCode(brand.language) : '') || '';
  const keywords = candidates.map((c) => c.query);
  const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: cached } = await supabaseAdmin
    .from('dataforseo_competition_cache')
    .select('keyword, competition_index, competition')
    .in('keyword', keywords)
    .eq('location_code', locationCode)
    .eq('language_code', languageCode)
    .gte('fetched_at', cutoff);

  const byKeyword = new Map((cached || []).map((r) => [r.keyword, r]));
  const misses = keywords.filter((k) => !byKeyword.has(k));

  if (misses.length > 0) {
    const volumes = await getSearchVolumes(misses, {
      locationCode: locationCode || undefined,
      languageCode: languageCode || undefined,
    });
    const rows = misses.map((k) => ({
      keyword: k,
      location_code: locationCode,
      language_code: languageCode,
      competition_index: volumes[k]?.competitionIndex ?? null,
      competition: volumes[k]?.competition ?? null,
      fetched_at: new Date().toISOString(),
    }));
    await supabaseAdmin
      .from('dataforseo_competition_cache')
      .upsert(rows, { onConflict: 'keyword,location_code,language_code' });
    for (const r of rows) byKeyword.set(r.keyword, r);
  }

  return candidates.map((c) => {
    const hit = byKeyword.get(c.query);
    const competitionIndex = hit?.competition_index ?? null;
    const badge =
      c.badge ??
      (competitionIndex !== null && competitionIndex <= LOW_COMPETITION_MAX_INDEX
        ? 'low_competition'
        : null);
    return { ...c, competitionIndex, competition: hit?.competition ?? null, badge };
  });
}

/**
 * Candidate list for the suggestion generator. Empty array (never a throw)
 * for brands without GSC data or on any upstream failure.
 */
export async function getGscSuggestionCandidates(brandId, brand, existingPromptTexts) {
  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data: rows, error } = await supabaseAdmin.rpc('gsc_candidate_queries', {
      p_brand_id: brandId,
      p_since: since,
      // The long-tail floor, not the head's: anything the RPC drops never
      // reaches composeCandidates, so the lower long-tail threshold was dead.
      p_min_impressions: LONGTAIL_MIN_IMPRESSIONS,
    });
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return [];

    // Queries behind recently dismissed GSC suggestions stay off the table.
    const dismissedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: dismissed } = await supabaseAdmin
      .from('prompt_suggestions')
      .select('source_data')
      .eq('brand_id', brandId)
      .eq('source', 'gsc')
      .eq('status', 'dismissed')
      .gte('updated_at', dismissedCutoff);
    const excludedQueries = new Set(
      (dismissed || [])
        .map((d) => d.source_data?.query)
        .filter(Boolean)
        .map((q) => q.trim().toLowerCase()),
    );

    const composed = composeCandidates(rows, existingPromptTexts, excludedQueries);
    if (composed.length === 0) return [];

    try {
      return await enrichCompetition(composed, brand);
    } catch (err) {
      // Enrichment is optional garnish — candidates ship without badges.
      logger.warn({ err, brandId }, '[gsc-suggestions] competition enrichment failed');
      return composed;
    }
  } catch (err) {
    logger.error({ err, brandId }, '[gsc-suggestions] candidate mining failed');
    return [];
  }
}
