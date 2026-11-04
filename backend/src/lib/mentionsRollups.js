/**
 * Mentions daily-rollup maintenance (00157).
 *
 * The Mentions & Sentiment page reads per-day mention rows instead of
 * re-reading a window of answers per load; this module is the only thing
 * that writes them, through the `refresh_mentions_daily` and
 * `refresh_mention_terms` SQL functions. It rides on the Insights rollup
 * callers (insightsRollups.js), as the Citations rollups do: a run's days
 * are refreshed when the run stamps, and the daily sweep re-refreshes the
 * trailing days.
 *
 * Best-effort like the other rollups: the rows are derived state, always
 * recomputable from prompt_results, so a failure costs freshness until the
 * next sweep and never throws into a tracking run.
 */

import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { dayChunks, resultDayBound } from './citationsRollups.js';

/**
 * Recompute one brand's mention rollups (00157) and its answers' terms
 * (00161) for an inclusive UTC day range. Separate calls, because a
 * sentiment correction (00160) refreshes only the rollups: the rollups in
 * one, then the terms a day per call, since they read each answer's text
 * and a few busy days of the largest brand would near the service role's
 * statement timeout (MENTION_HISTORY_CHUNK_DAYS). A small brand may pass a
 * longer `termDays` (the demo brand refreshes its month in one call), and
 * `together` to refresh the rollups beside the terms rather than before
 * them (each takes its own lock and writes its own tables). Resolves to true
 * when every call succeeds, false at the first that fails; never throws.
 */
export async function refreshMentionsDaily(
  brandId,
  dayFrom,
  dayTo,
  { termDays = MENTION_HISTORY_CHUNK_DAYS, together = false } = {},
) {
  const call = async ([fn, from, to]) => {
    const { error } = await supabaseAdmin.rpc(fn, {
      p_brand_id: brandId,
      p_day_from: from,
      p_day_to: to,
    });
    if (error) {
      logger.error(
        { err: error, brandId, dayFrom: from, dayTo: to, fn },
        '[mentions-rollups] refresh failed',
      );
      return false;
    }
    return true;
  };
  const inTurn = async (calls) => {
    for (const args of calls) {
      if (!(await call(args))) return false;
    }
    return true;
  };
  const rollups = [['refresh_mentions_daily', dayFrom, dayTo]];
  const terms = dayChunks(dayFrom, dayTo, termDays).map(([from, to]) => [
    'refresh_mention_terms',
    from,
    to,
  ]);
  if (!together) return inTurn([...rollups, ...terms]);
  const done = await Promise.all([inTurn(rollups), inTurn(terms)]);
  return done.every(Boolean);
}

/** The Perception windows precomputed for the tab's default view (00241). */
export const PERCEPTION_SNAPSHOT_DAYS = [7, 30, 90];

/**
 * Recompute a brand's precomputed Perception views (00241) from its
 * rollups: the last 7, 30 and 90 days on every platform and region, the view
 * everyone opens, which the tab then reads in one lookup. One window per
 * call, so the largest brand's 90 days stay well inside the service role's
 * statement timeout. Called once the brand's Mentions rollups are fresh.
 * Resolves to true when every window is written, false at the first that
 * fails (the tab reads the rollups live meanwhile); never throws. Before
 * 00241 is applied there is no function to call: quietly false.
 */
export async function refreshPerceptionSnapshots(brandId) {
  for (const days of PERCEPTION_SNAPSHOT_DAYS) {
    const { error } = await supabaseAdmin.rpc('refresh_mentions_perception_snapshot', {
      p_brand_id: brandId,
      p_days: days,
    });
    if (error?.code === 'PGRST202') return false;
    if (error) {
      logger.error({ err: error, brandId, days }, '[mentions-rollups] Perception snapshot failed');
      return false;
    }
  }
  return true;
}

/**
 * Rebuild the Perception tab's daily rollups (00231) from the answers' terms
 * already written, a week per call: for the days a deleted prompt leaves,
 * whose terms went with its answers (the terms refresh above rebuilds them
 * itself). No answer text is read. Resolves to true when every call
 * succeeds, false at the first that fails; never throws.
 */
export async function refreshMentionTermsDaily(brandId, dayFrom, dayTo) {
  for (const [from, to] of dayChunks(dayFrom, dayTo, MENTION_TERMS_ROLLUP_CHUNK_DAYS)) {
    const { error } = await supabaseAdmin.rpc('refresh_mention_terms_daily', {
      p_brand_id: brandId,
      p_day_from: from,
      p_day_to: to,
    });
    if (error) {
      logger.error(
        { err: error, brandId, dayFrom: from, dayTo: to },
        '[mentions-rollups] terms rollup refresh failed',
      );
      return false;
    }
  }
  return true;
}

/** The first or last UTC day of a brand's answers' terms (00161), or null with none. */
async function termsDayBound(brandId, ascending) {
  const { data, error } = await supabaseAdmin
    .from('mentions_answer_terms')
    .select('created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending })
    .limit(1);
  if (error) throw new Error(error.message);
  const at = data?.[0]?.created_at;
  return at ? new Date(at).toISOString().slice(0, 10) : null;
}

/**
 * Rebuild a brand's Perception rollups (00231) over its whole terms history,
 * a week per call, from the terms already written: the backfill that runs
 * after 00231 and the server deploy, before 00237 moves the read onto the
 * rollups. Resolves to the number of calls; throws when one fails, so the
 * backfill can be run again.
 */
export async function refreshMentionTermsHistory(brandId, { pauseMs = 0 } = {}) {
  const firstDay = await termsDayBound(brandId, true);
  if (!firstDay) return 0;
  const lastDay = await termsDayBound(brandId, false);

  const chunks = dayChunks(firstDay, lastDay, MENTION_TERMS_ROLLUP_CHUNK_DAYS);
  for (const [from, to] of chunks) {
    const ok = await refreshMentionTermsDaily(brandId, from, to);
    if (!ok) throw new Error(`mention terms rollup refresh failed for ${brandId} ${from}..${to}`);
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return chunks.length;
}

/** Days per terms rollup call: a week of the largest brand's terms, counted. */
export const MENTION_TERMS_ROLLUP_CHUNK_DAYS = 7;

/**
 * Days per history refresh call. Shorter than the citation rollups' two
 * weeks: the terms (00161) read each answer's text, a few milliseconds per
 * answer and entity named. The largest brand's busiest days take tens of
 * seconds each, so even three of them would near the service role's
 * statement timeout.
 */
export const MENTION_HISTORY_CHUNK_DAYS = 1;

/**
 * Recompute a brand's whole mention history, a chunk at a time so no call
 * nears the service role's statement timeout. Resolves to the number of
 * chunks written; throws when a chunk fails, so the caller can retry later.
 */
export async function refreshMentionHistory(brandId, { pauseMs = 0 } = {}) {
  const firstDay = await resultDayBound(brandId, true);
  if (!firstDay) return 0;
  const lastDay = await resultDayBound(brandId, false);

  const chunks = dayChunks(firstDay, lastDay, MENTION_HISTORY_CHUNK_DAYS);
  for (const [from, to] of chunks) {
    const ok = await refreshMentionsDaily(brandId, from, to);
    if (!ok) throw new Error(`mention rollup refresh failed for ${brandId} ${from}..${to}`);
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return chunks.length;
}
