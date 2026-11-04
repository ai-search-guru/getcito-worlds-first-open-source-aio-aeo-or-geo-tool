/**
 * Closing a full tracking run's ledger row (00044) — "stamping" it.
 *
 * The stamp is what everything downstream waits on: the 24h window the
 * dashboard and the Daily Pulse read ends at it, and the pulse, signal pass
 * and Insights rollup refresh all fire when it lands. Stamping while Cloro is
 * still delivering freezes a half-answered run into those windows: on the
 * largest brand the drain deadline passed with 54% of answers in, the run
 * stamped anyway (the old bar was 50%), and the pulse reported 495 of 709
 * prompts. The rest arrived over the next 37 minutes.
 *
 * So a run that ends its drain short of COMPLETE_RATIO is not stamped yet.
 * The worker hands back a promise instead and moves on — its concurrency slot
 * freed — while this module keeps counting in the background. The run stamps
 * as soon as it is complete, when nothing it submitted is pending any more,
 * or at the late deadline — then only if it reached MIN_STAMP_RATIO, the bar
 * that keeps a near-empty run from ever becoming the window.
 *
 * A restart during the wait loses it: the row stays unstamped, that day's
 * pulse is skipped, and the next run clears the row — the same outcome an
 * unstamped run always had.
 */

import supabaseAdmin from '../config/supabase.js';
import { refreshForCompletedRun } from './insightsRollups.js';
import { logger } from './logger.js';

export const COMPLETE_RATIO = 0.95;
export const MIN_STAMP_RATIO = 0.5;
const LATE_POLL_MS = 2 * 60_000;
const LATE_WAIT_MS = (Number(process.env.CLORO_LATE_WAIT_MIN) || 120) * 60_000;

/**
 * What to do with a run's ledger row given how many results it has.
 * `final` is true once waiting longer cannot help: the late deadline passed,
 * or nothing the run submitted is still pending.
 *
 * @returns {'stamp' | 'wait' | 'discard'}
 */
export function settleDecision({ resultCount, plannedTasks, final }) {
  if (resultCount <= 0) return final ? 'discard' : 'wait';
  if (plannedTasks <= 0 || resultCount >= plannedTasks * COMPLETE_RATIO) return 'stamp';
  if (!final) return 'wait';
  return resultCount >= plannedTasks * MIN_STAMP_RATIO ? 'stamp' : 'discard';
}

/**
 * The run's result count comes from the DB, not from the worker's counter:
 * in webhook mode the /cloro/callback handler inserts the scraper results,
 * so the worker only ever sees its own API-model phase.
 */
async function countRunResults(brandId, startedAt) {
  const { count, error } = await supabaseAdmin
    .from('prompt_results')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .gte('created_at', startedAt);
  return error ? null : (count ?? 0);
}

/** Cloro tasks this run submitted that have not been answered yet. */
async function countRunPending(brandId, startedAt) {
  const { count, error } = await supabaseAdmin
    .from('cloro_pending_tasks')
    .select('task_id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .gte('submitted_at', startedAt);
  return error ? null : (count ?? 0);
}

/**
 * Stamp the row, unless it is gone — a later run for the brand clears
 * unstamped rows, and a run that was superseded must not fire a pulse.
 */
async function stampRun(brandId, runId, startedAt, resultCount) {
  const { data, error } = await supabaseAdmin
    .from('tracking_runs')
    .update({ completed_at: new Date().toISOString(), result_count: resultCount })
    .eq('id', runId)
    .is('completed_at', null)
    .select('id');
  if (error) {
    logger.error({ err: error, brandId, runId }, 'failed to stamp tracking run');
    return false;
  }
  if (!data?.length) {
    logger.warn({ brandId, runId }, 'tracking run row gone before it stamped — superseded');
    return false;
  }
  logger.info({ brandId, runId, resultCount }, 'tracking run stamped');

  // Fold the run's days into the Insights rollups (00066). Anchored to the
  // stamp on purpose: a day enters the wide-window aggregates only once its
  // run completed, so mid-run partial counts never show. Best-effort inside —
  // a refresh failure never unstamps the run.
  await refreshForCompletedRun(brandId, startedAt);
  return true;
}

async function discardRun(brandId, runId, resultCount, plannedTasks) {
  logger.warn(
    { brandId, runId, resultCount, plannedTasks },
    'tracking run below stamp ratio — row removed; window stays on previous run',
  );
  await supabaseAdmin.from('tracking_runs').delete().eq('id', runId);
}

async function act(decision, { brandId, runId, startedAt, plannedTasks }, resultCount) {
  if (decision === 'stamp') return stampRun(brandId, runId, startedAt, resultCount);
  await discardRun(brandId, runId, resultCount, plannedTasks);
  return false;
}

async function awaitLateResults(run, { pollMs, waitMs, rollups }) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    await new Promise((r) => setTimeout(r, pollMs));
    const [resultCount, pending] = await Promise.all([
      countRunResults(run.brandId, run.startedAt),
      countRunPending(run.brandId, run.startedAt),
    ]);
    const pastDeadline = Date.now() >= deadline;
    if (resultCount === null) {
      // A failed count must not be read as "no results". Keep waiting; past
      // the deadline, leave the row for the next run to clear.
      if (pastDeadline) return false;
      continue;
    }
    const decision = settleDecision({
      resultCount,
      plannedTasks: run.plannedTasks,
      final: pastDeadline || pending === 0,
    });
    if (decision === 'wait') {
      // A first run's rollups follow the late answers too.
      rollups?.note(resultCount);
      continue;
    }
    logger.info(
      { brandId: run.brandId, runId: run.runId, resultCount, plannedTasks: run.plannedTasks },
      'late results settled the tracking run',
    );
    await rollups?.idle();
    return act(decision, run, resultCount);
  }
}

/**
 * Settle a full run's ledger row at the end of its drain.
 *
 * `rollups` is a brand's first run's refresher (firstRunRollups.js): the
 * stamp waits for a refresh it still has running, as it refreshes the same
 * days; and a run that has to wait for late answers refreshes once now, then
 * as they land.
 *
 * @returns {Promise<{ stamped: boolean, lateStamp: Promise<boolean> | null, resultCount: number | null }>}
 *   `stamped` when the row stamped now; otherwise `lateStamp` resolves true
 *   if and when it stamps later, false if it never does. `resultCount` is
 *   the run's answers stored so far, however they came (a webhook's
 *   included); null when they couldn't be counted.
 */
export async function settleTrackingRun(
  { brandId, runId, startedAt, plannedTasks },
  { pollMs = LATE_POLL_MS, waitMs = LATE_WAIT_MS, rollups = null } = {},
) {
  const run = { brandId, runId, startedAt, plannedTasks };
  const resultCount = await countRunResults(brandId, startedAt);
  if (resultCount === null) {
    // Leave the row uncompleted: the dashboard keeps the previous completed
    // run and the next run clears the dangling row.
    logger.error({ brandId, runId }, 'failed to count run results');
    return { stamped: false, lateStamp: null, resultCount: null };
  }

  const pending = await countRunPending(brandId, startedAt);
  const decision = settleDecision({ resultCount, plannedTasks, final: pending === 0 });
  if (decision !== 'wait') {
    await rollups?.idle();
    return { stamped: await act(decision, run, resultCount), lateStamp: null, resultCount };
  }

  logger.info(
    { brandId, runId, resultCount, plannedTasks, pending },
    'tracking run short of complete — waiting for late results before stamping',
  );
  const lateStamp = (async () => {
    await rollups?.flush(resultCount);
    return awaitLateResults(run, { pollMs, waitMs, rollups });
  })().catch((err) => {
    logger.error({ err, brandId, runId }, 'waiting for late results failed');
    return false;
  });
  return { stamped: false, lateStamp, resultCount };
}
