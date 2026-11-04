/**
 * Citations daily-rollup maintenance (00118).
 *
 * The Citations page reads per-day domain and URL counts instead of
 * aggregating a window of citation rows per load; this module is the only
 * thing that writes them, through the `refresh_citations_daily` SQL function.
 * It rides on the Insights rollup callers (insightsRollups.js): a run's days
 * are refreshed when the run stamps, and the daily sweep re-refreshes the
 * trailing days and rebuilds brands whose prompts changed topic or whose
 * domains changed.
 *
 * Best-effort like the Insights rollups: the rows are derived state, always
 * recomputable from prompt_result_citations, so a failure costs freshness
 * until the next sweep and never throws into a tracking run.
 */

import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/** Days per refresh call when recomputing a brand's whole history. */
export const HISTORY_CHUNK_DAYS = 14;

function utcDay(iso = undefined) {
  return (iso ? new Date(iso) : new Date()).toISOString().slice(0, 10);
}

/** `day` plus `n` calendar days, as 'YYYY-MM-DD'. */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d.toISOString());
}

/** Inclusive [from, to] ranges of at most `size` days covering firstDay..lastDay. */
export function dayChunks(firstDay, lastDay, size = HISTORY_CHUNK_DAYS) {
  const chunks = [];
  for (let from = firstDay; from <= lastDay; from = addDays(from, size)) {
    const end = addDays(from, size - 1);
    chunks.push([from, end < lastDay ? end : lastDay]);
  }
  return chunks;
}

/**
 * Recompute one brand's citation rollups for an inclusive UTC day range.
 * Resolves to true on success, false otherwise; never throws.
 */
export async function refreshCitationsDaily(brandId, dayFrom, dayTo) {
  const { error } = await supabaseAdmin.rpc('refresh_citations_daily', {
    p_brand_id: brandId,
    p_day_from: dayFrom,
    p_day_to: dayTo,
  });
  if (error) {
    logger.error({ err: error, brandId, dayFrom, dayTo }, '[citations-rollups] refresh failed');
    return false;
  }
  return true;
}

/** UTC day of a brand's first or last result, or null when it has none. */
export async function resultDayBound(brandId, ascending) {
  const { data, error } = await supabaseAdmin
    .from('prompt_results')
    .select('created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.created_at ? utcDay(data[0].created_at) : null;
}

/**
 * Recompute a brand's whole citation history, a chunk at a time so no call
 * nears the service role's statement timeout. Resolves to the number of
 * chunks written; throws when a chunk fails, so the caller can retry later.
 */
export async function refreshCitationHistory(brandId, { pauseMs = 0 } = {}) {
  const firstDay = await resultDayBound(brandId, true);
  if (!firstDay) return 0;
  const lastDay = await resultDayBound(brandId, false);

  const chunks = dayChunks(firstDay, lastDay);
  for (const [from, to] of chunks) {
    const ok = await refreshCitationsDaily(brandId, from, to);
    if (!ok) throw new Error(`citation rollup refresh failed for ${brandId} ${from}..${to}`);
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return chunks.length;
}

/** How often the server drains the rebuild queue outside the nightly sweep. */
export const REBUILD_QUEUE_SCHEDULE = '*/5 * * * *';

/** The drain in progress, if any; a full-history rebuild takes minutes. */
let rebuildInFlight = null;

/**
 * Rebuild the brands queued by a topic move (the trigger on prompts in
 * 00118) or a brand domain change (the trigger on brand_domains in 00203).
 * Topic is stored in the rollup rows, so a prompt moved to another topic
 * leaves its history under the old one until this runs; and Competitor Gaps'
 * rows record whether the brand was present, which its own domains decide.
 * A queue entry is cleared only if nothing re-queued the brand while it was
 * rebuilt.
 *
 * Called on its own schedule and at the end of the nightly sweep. Runs never
 * overlap: a call made while one is in progress returns at once with
 * `skipped: true`, and anything it would have picked up is left for the next.
 */
export async function rebuildQueuedCitationRollups() {
  if (rebuildInFlight) return { rebuilt: 0, failed: 0, skipped: true };
  rebuildInFlight = drainRebuildQueue();
  try {
    return await rebuildInFlight;
  } finally {
    rebuildInFlight = null;
  }
}

async function drainRebuildQueue() {
  const { data: queued, error } = await supabaseAdmin
    .from('citation_rollup_rebuilds')
    .select('brand_id, requested_at');
  if (error) {
    logger.error({ err: error }, '[citations-rollups] could not read the rebuild queue');
    return { rebuilt: 0, failed: 0 };
  }

  let rebuilt = 0;
  let failed = 0;
  for (const { brand_id: brandId, requested_at: requestedAt } of queued ?? []) {
    try {
      await refreshCitationHistory(brandId);
      await supabaseAdmin
        .from('citation_rollup_rebuilds')
        .delete()
        .eq('brand_id', brandId)
        .lte('requested_at', requestedAt);
      rebuilt++;
    } catch (err) {
      failed++;
      logger.error({ err, brandId }, '[citations-rollups] queued rebuild failed');
    }
  }

  if (rebuilt + failed > 0) {
    logger.info({ rebuilt, failed }, '[citations-rollups] queued rebuilds complete');
  }
  return { rebuilt, failed };
}
