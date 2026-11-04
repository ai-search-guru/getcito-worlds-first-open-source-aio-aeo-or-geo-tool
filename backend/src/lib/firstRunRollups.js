/**
 * A brand's first tracking run, folded into the daily rollups while its
 * answers are still landing.
 *
 * The rollups (Insights 00066, Citations 00118, Mentions 00157) take a run's
 * days once it stamps (runSettlement.js), so a half-delivered run never
 * replaces a complete day. A brand's first run has no complete day to keep:
 * until it stamps — at 95% of its answers, or when nothing is pending, or up
 * to two hours later — every view that reads the rollups (Citations,
 * Mentions, Brand Visibility's 7/30/90-day ranges) shows nothing. So a first
 * run refreshes its days as answers land, now and then, and the stamp's own
 * refresh settles them.
 *
 * The SQL refresh functions take a per-brand advisory lock, so two refreshes
 * of the same days never interleave. They are still started one at a time
 * here, and the stamp waits for the last (runSettlement.js): a refresh
 * started while another holds the lock only sits on a database connection
 * until it can go.
 */

import supabaseAdmin from '../config/supabase.js';
import { refreshRunDays } from './insightsRollups.js';
import { logger } from './logger.js';

/** At least this long between two refreshes of a first run's days. */
export const PROGRESSIVE_REFRESH_MS = 2 * 60_000;

/**
 * And at least this many times as long as the last refresh took, so a brand
 * whose refresh is slow does not refresh back to back.
 */
export const REFRESH_DURATION_FACTOR = 5;

/**
 * How often a first run that ended short of complete checks again whether it
 * can stamp (runSettlement.js; two counts a poll). Its stamp is what fills
 * the Action Center, so a first run checks every 30 s instead of every 2 min.
 */
export const FIRST_RUN_LATE_POLL_MS = 30_000;

/**
 * Whether a brand has never had a run stamped, so the run starting now is its
 * first. A failed read says no: the run then behaves as any other.
 */
export async function isFirstRun(brandId) {
  const { data, error } = await supabaseAdmin
    .from('tracking_runs')
    .select('id')
    .eq('brand_id', brandId)
    .not('completed_at', 'is', null)
    .limit(1);
  if (error) {
    logger.warn({ err: error, brandId }, 'could not tell whether this is the first run');
    return false;
  }
  return (data ?? []).length === 0;
}

/**
 * The refresher for one run. All three do nothing unless `enabled`.
 *
 * - `note(landed)`, with a count that changes as answers land: starts a
 *   refresh when it changed since the last one, none is running, and the
 *   wait since the last one started is over. Never waits.
 * - `idle()`: resolves once no refresh is running. The stamp waits for it.
 * - `flush(landed)`: once idle, refreshes now, whatever the wait; for a run
 *   whose stamp has to wait for late answers.
 *
 * @param {{ brandId: string, startedAt: string | null, enabled: boolean,
 *   intervalMs?: number, now?: () => number }} opts
 */
export function progressiveRollups({
  brandId,
  startedAt,
  enabled,
  intervalMs = PROGRESSIVE_REFRESH_MS,
  now = Date.now,
}) {
  const on = Boolean(enabled && startedAt);
  let lastStartedAt = null;
  let lastTookMs = 0;
  let lastLanded = 0;
  let inFlight = null;

  const start = (landed) => {
    const began = now();
    lastStartedAt = began;
    lastLanded = landed;
    inFlight = refreshRunDays(brandId, startedAt)
      .catch((err) => {
        logger.warn({ err, brandId }, 'first-run rollup refresh failed');
      })
      .finally(() => {
        lastTookMs = now() - began;
        inFlight = null;
      });
    return inFlight;
  };

  const idle = async () => {
    while (inFlight) await inFlight;
  };

  return {
    note(landed) {
      if (!on || inFlight || landed === lastLanded) return;
      const wait = Math.max(intervalMs, REFRESH_DURATION_FACTOR * lastTookMs);
      if (lastStartedAt !== null && now() - lastStartedAt < wait) return;
      start(landed);
    },
    idle,
    async flush(landed) {
      if (!on) return;
      await idle();
      await start(landed);
    },
  };
}
