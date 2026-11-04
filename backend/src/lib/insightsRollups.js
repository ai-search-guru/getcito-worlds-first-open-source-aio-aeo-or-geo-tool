/**
 * Insights daily-rollup maintenance (00066).
 *
 * The Insights page reads pre-aggregated daily rows instead of recomputing a
 * brand's whole history per load; this module is the only thing that writes
 * them, by calling the `refresh_insights_daily` SQL function. Two callers:
 *
 *   - tracking-worker, the moment a run's ledger row is stamped — so a day
 *     enters the rollups only once its run completed, never mid-stream; a
 *     brand's first run, which has no complete day to keep, also while its
 *     answers land (firstRunRollups.js)
 *   - the daily sweep, which re-refreshes the trailing days for every brand
 *     as a backstop: runs that never stamped (partial, crashed, ghost tasks)
 *     and out-of-run writes (a prompt analyzed the moment it was added, #754)
 *     all get their day picked up the next morning
 *   - the rebuild queue, which refreshes the days of a deleted prompt
 *     (00192): its answers are gone, but the rows keep them until then
 *
 * Every entry point is best-effort. The rollups are derived state, always
 * recomputable from prompt_results; a refresh failure costs freshness until
 * the next sweep, so it must never take a tracking run down with it.
 */

import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { rebuildQueuedCitationRollups, refreshCitationsDaily } from './citationsRollups.js';
import {
  refreshMentionTermsDaily,
  refreshMentionsDaily,
  refreshPerceptionSnapshots,
} from './mentionsRollups.js';

/** How many trailing days the daily sweep recomputes, today included. */
export const SWEEP_DAYS = 3;

/** UTC calendar day of an ISO timestamp (or of now), as 'YYYY-MM-DD'. */
export function utcDay(iso = undefined) {
  return (iso ? new Date(iso) : new Date()).toISOString().slice(0, 10);
}

/**
 * Recompute one brand's rollup rows for an inclusive UTC day range.
 * Resolves to true when the refresh succeeded, false otherwise — callers
 * branch on it for logging only, never for control flow.
 */
export async function refreshInsightsDaily(brandId, dayFrom, dayTo) {
  const { error } = await supabaseAdmin.rpc('refresh_insights_daily', {
    p_brand_id: brandId,
    p_day_from: dayFrom,
    p_day_to: dayTo,
  });
  if (error) {
    logger.error({ err: error, brandId, dayFrom, dayTo }, '[insights-rollups] refresh failed');
    return false;
  }
  return true;
}

/**
 * Refresh the days a tracking run touched: from the run's start day through
 * today (a run crossing UTC midnight lands rows on two days). The Citations
 * (00118) and Mentions (00157) rollups are refreshed for the same days.
 * Resolves to whether the Insights refresh succeeded; never throws.
 */
export async function refreshRunDays(brandId, runStartedAtIso) {
  const dayFrom = utcDay(runStartedAtIso);
  const dayTo = utcDay();
  const ok = await refreshInsightsDaily(brandId, dayFrom, dayTo);
  await refreshCitationsDaily(brandId, dayFrom, dayTo);
  await refreshMentionsDaily(brandId, dayFrom, dayTo);
  return ok;
}

/** refreshRunDays for a run that has just stamped, then the Perception views. */
export async function refreshForCompletedRun(brandId, runStartedAtIso) {
  const ok = await refreshRunDays(brandId, runStartedAtIso);
  // The Perception tab's default view (00241) follows the rollups as they
  // now are. Not waited for: it never throws, and the run's stamp shouldn't
  // wait on three more reads.
  void refreshPerceptionSnapshots(brandId);
  return ok;
}

/** Days refreshed per call when a queued range is rebuilt, as the backfill chunks them. */
export const REBUILD_CHUNK_DAYS = 31;

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d.toISOString());
}

/** The drain in progress, if any. */
let rebuildInFlight = null;

/**
 * Refresh the days queued by a prompt delete (the trigger on prompts in
 * 00192). The prompt's answers cascade away, but insights_brand_daily keeps
 * them until those days are refreshed, and the sweep covers only the last
 * SWEEP_DAYS; the Mentions page, which reads existing prompts only, already
 * leaves them out. A queue entry is cleared only if nothing re-queued the
 * brand while it was refreshed.
 *
 * Called on the citation rebuilds' schedule and at the end of the nightly
 * sweep. Runs never overlap: a call made while one is in progress returns at
 * once with `skipped: true`.
 */
export async function rebuildQueuedInsightsRollups() {
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
    .from('insights_rollup_rebuilds')
    .select('brand_id, day_from, day_to, requested_at');
  if (error) {
    logger.error({ err: error }, '[insights-rollups] could not read the rebuild queue');
    return { rebuilt: 0, failed: 0 };
  }

  let rebuilt = 0;
  let failed = 0;
  for (const entry of queued ?? []) {
    const {
      brand_id: brandId,
      day_from: dayFrom,
      day_to: dayTo,
      requested_at: requestedAt,
    } = entry;
    let ok = true;
    for (let from = dayFrom; ok && from <= dayTo; from = addDays(from, REBUILD_CHUNK_DAYS)) {
      const end = addDays(from, REBUILD_CHUNK_DAYS - 1);
      ok = await refreshInsightsDaily(brandId, from, end < dayTo ? end : dayTo);
    }
    // The Perception rollups (00231) still count the deleted prompt's terms,
    // and the view precomputed from them (00241) follows them as they now
    // are. Not when the Insights days failed: the Perception rollups weren't
    // touched then, and a brand whose rebuild keeps failing would recompute
    // its views every drain.
    if (ok) {
      ok = await refreshMentionTermsDaily(brandId, dayFrom, dayTo);
      await refreshPerceptionSnapshots(brandId);
    }
    // A failed refresh logged itself; the entry stays for the next drain.
    if (!ok) {
      failed++;
      continue;
    }
    const { error: clearError } = await supabaseAdmin
      .from('insights_rollup_rebuilds')
      .delete()
      .eq('brand_id', brandId)
      .lte('requested_at', requestedAt);
    if (clearError) {
      logger.warn({ err: clearError, brandId }, '[insights-rollups] could not clear a rebuild');
    }
    rebuilt++;
  }

  if (rebuilt + failed > 0) {
    logger.info({ rebuilt, failed }, '[insights-rollups] deleted-prompt rebuilds complete');
  }
  return { rebuilt, failed };
}

/**
 * Daily backstop: refresh the trailing SWEEP_DAYS for every brand, Insights,
 * Citations and Mentions rollups alike, then rebuild the brands queued by
 * topic moves and prompt deletes.
 *
 * Deliberately every brand rather than "brands with recent results" — a
 * refresh over days with no rows deletes nothing and inserts nothing, so the
 * empty case costs one cheap call, and no discovery query can miss anyone.
 * Sequential on purpose: this shares the instance with live dashboards, and
 * finishing in half a minute instead of five seconds is the right trade.
 */
export async function sweepInsightsRollups({ days = SWEEP_DAYS } = {}) {
  // Not a demo brand's (00380): the demo generator refreshes its rollups as
  // it writes its sample answers, and nothing else writes any.
  const { data: brands, error } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('is_demo', false);
  if (error) {
    logger.error({ err: error }, '[insights-rollups] sweep could not list brands');
    return { refreshed: 0, failed: 0 };
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const dayFrom = utcDay(from.toISOString());
  const dayTo = utcDay(to.toISOString());

  let refreshed = 0;
  let failed = 0;
  for (const brand of brands ?? []) {
    const ok = await refreshInsightsDaily(brand.id, dayFrom, dayTo);
    const citationsOk = await refreshCitationsDaily(brand.id, dayFrom, dayTo);
    const mentionsOk = await refreshMentionsDaily(brand.id, dayFrom, dayTo);
    // The precomputed Perception view (00241) follows the rollups as they now
    // are; one that fails leaves the tab on the live read: logged, not counted.
    await refreshPerceptionSnapshots(brand.id);
    if (ok && citationsOk && mentionsOk) refreshed++;
    else failed++;
  }

  logger.info({ refreshed, failed, dayFrom, dayTo }, '[insights-rollups] sweep complete');

  // Brands whose prompts changed topic get their citation history rebuilt,
  // and the days of deleted prompts their Insights rows.
  await rebuildQueuedCitationRollups();
  await rebuildQueuedInsightsRollups();
  return { refreshed, failed };
}
