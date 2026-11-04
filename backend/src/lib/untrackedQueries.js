/**
 * Google queries you don't track yet (AT-009, spec §3.6): the brand's
 * Search Console queries with clicks in a window, most clicks first, that no
 * active tracked prompt covers — by the rule Prompt Suggestions uses for
 * Google queries (gscSuggestions.js), so the two pages agree. Read on
 * request, nothing stored; tracking one adds it as a prompt.
 */

import supabaseAdmin from '../config/supabase.js';
import { isCoveredByTokenSets, promptTokenSets } from './gscSuggestions.js';
import { readAllRpcRows } from './rpcPages.js';

/** The most clicked queries checked; past it the count reads "N+". */
export const UNTRACKED_QUERY_SCAN = 5000;

/** The brand's active prompts' texts, every one. */
async function activePromptTexts(brandId) {
  const { data, error } = await readAllRpcRows('prompts', (from, to) =>
    supabaseAdmin
      .from('prompts')
      .select('id, text, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      .order('id')
      .range(from, to),
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => p.text).filter(Boolean);
}

/**
 * `since` null reads all time; `latest` ends the window on the latest day
 * Google has reported, keeping its length. Returns the first `limit`
 * untracked queries and how many there are (`capped`: more than the scan).
 */
export async function untrackedGoogleQueries(brandId, { since, until, latest = true, limit = 10 }) {
  const [{ data, error }, texts] = await Promise.all([
    supabaseAdmin.rpc('ai_traffic_google_queries', {
      p_brand_id: brandId,
      p_since: since,
      p_until: until,
      p_latest: latest,
      p_limit: UNTRACKED_QUERY_SCAN,
    }),
    activePromptTexts(brandId),
  ]);
  if (error) throw new Error(error.message);
  const raw = data ?? {};
  const tokenSets = promptTokenSets(texts);
  const untracked = (Array.isArray(raw.rows) ? raw.rows : [])
    .filter((r) => r.query && !isCoveredByTokenSets(r.query, tokenSets))
    .map((r) => ({
      query: r.query,
      clicks: Number(r.clicks) || 0,
      impressions: Number(r.impressions) || 0,
    }));
  return {
    lastDay: raw.last_day ?? null,
    since: raw.since ?? null,
    until: raw.until ?? null,
    count: untracked.length,
    capped: raw.capped === true,
    rows: untracked.slice(0, Math.max(0, limit)),
  };
}
