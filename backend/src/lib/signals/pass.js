/**
 * The nightly signal pass, and the sweep that picks up the ones it lost.
 *
 * Recording signals and consolidating them into actions are two steps of one
 * thing: a night either produced both or produced nothing useful. They were
 * chained inline in the job runner, fire-and-forget, with a `.catch` that
 * logged. That is how the biggest brand went six days without a single signal
 * — every night its metric queries crossed the database's statement timeout,
 * every night the chain threw, and every night the error went into a log file
 * nobody reads while the Action Center quietly showed week-old work.
 *
 * Two things change here. The pass writes a row when it finishes, so "did it
 * run?" is a question the database can answer. And a sweep re-runs the passes
 * that have no row, so a night lost to a timeout, a deploy or an OOM is
 * recovered the next morning instead of never.
 *
 * The daily pulse has had both since #702. This is the same shape for the
 * half of the same trigger that never got it.
 */

import supabaseAdmin from '../../config/supabase.js';
import { activeBrandFilter, isBrandActive } from '../activeSubscriptions.js';
import { logger } from '../logger.js';
import { recordSignalsForBrand } from './record.js';
import { generateActionsForBrand } from '../action-center/generate.js';
import { rescoreBrandActions } from '../action-center/priorityData.js';
import { sweepActionTasks } from '../action-center/task-writer/index.js';
import { sweepStaleActions } from '../action-center/stale.js';

/**
 * How far back the sweep looks. Long enough to cover a missed night plus the
 * gap between two runs, short enough that a brand paused a week ago does not
 * get a pass it has no use for.
 */
const CATCH_UP_WINDOW_MS = 36 * 60 * 60 * 1000;

/**
 * The brand's most recent stamped run, or null. Nightly runs only unless
 * `anySource` — a manual run is what a brand's first pass has to go on.
 */
async function latestStampedRun(brandId, { anySource = false } = {}) {
  let query = supabaseAdmin
    .from('tracking_runs')
    .select('completed_at')
    .eq('brand_id', brandId)
    .not('completed_at', 'is', null);
  if (!anySource) query = query.eq('source', 'cron');
  const { data, error } = await query.order('completed_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.completed_at ?? null;
}

/**
 * A night with no fresh results runs no generator, and the generator is what
 * scores the brand's active actions again. Without this, a brand whose
 * tracking is quiet keeps last night's scores, and an action opened before
 * scores existed keeps none. Best effort, as the generator's rescoring is: a
 * score that can't be worked out is no reason to fail the pass.
 */
async function rescoreSkippedNight(brandId, now) {
  try {
    return { rescored: await rescoreBrandActions(brandId, { now }) };
  } catch (err) {
    logger.warn({ brandId, err: err.message }, '[actions] rescore on a skipped night failed');
    return null;
  }
}

/**
 * Actions left New with no one on them for a month are marked stale every
 * night (action-center/stale.js), skipped nights too. Best effort: a list
 * that can't be marked is no reason to fail the pass.
 */
async function markStaleActions(brandId, now) {
  try {
    return await sweepStaleActions(brandId, { now });
  } catch (err) {
    logger.warn({ brandId, err: err.message }, '[actions] stale sweep failed');
    return null;
  }
}

/**
 * Record signals and consolidate them into actions for one brand, then log
 * the pass against the run it covered.
 *
 * The ledger row is written last and only on success: a pass that threw
 * halfway leaves no row, which is precisely what makes the sweep able to find
 * it. Idempotent on (brand, run) so a sweep racing the inline trigger cannot
 * run the same night twice.
 *
 * @param {string} brandId
 * @param {{ runAt?: string, now?: Date }} [options] runAt names the tracking
 *   run this pass covers; omitted, the brand's most recent stamped run.
 */
export async function runSignalPass(brandId, { runAt, now = new Date() } = {}) {
  // Once the plan has ended, no signal is recorded and no action raised,
  // whichever way the pass was started (a run's stamp, a late stamp, the
  // first pass, the catch-up). No row either: should a plan be bought within
  // the catch-up's window, the night is still there to catch up.
  if (!(await isBrandActive(brandId))) return { skipped: 'subscription_inactive' };

  const trackingRunAt = runAt ?? (await latestStampedRun(brandId));
  if (!trackingRunAt) {
    logger.info({ brandId }, '[signals] no stamped run to record against');
    return { skipped: 'no_stamped_run' };
  }

  const recorded = await recordSignalsForBrand(brandId, { now });
  const generated = recorded.skipped
    ? await rescoreSkippedNight(brandId, now)
    : await generateActionsForBrand(brandId, { now });
  const stale = await markStaleActions(brandId, now);

  const { error } = await supabaseAdmin.from('signal_runs').upsert(
    {
      brand_id: brandId,
      tracking_run_at: trackingRunAt,
      ran_at: now.toISOString(),
      outcome: recorded.skipped ? 'skipped' : 'recorded',
      detail: { signals: recorded, actions: generated, stale },
    },
    { onConflict: 'brand_id,tracking_run_at' },
  );
  if (error) throw new Error(error.message);

  // Tonight's new actions get their tasks written (AC-004) without holding up
  // the pass: a slow or failed model call costs only the template tasks.
  if (generated?.created > 0) {
    sweepActionTasks({ brandId, now }).catch((err) => {
      logger.error({ err, brandId }, '[task-writer] sweep after the pass crashed');
    });
  }

  return { trackingRunAt, signals: recorded, actions: generated, stale };
}

/**
 * A brand's first pass, straight after its first run.
 *
 * Passes ride the nightly run, and a brand's first run is not one: onboarding
 * starts it by hand, so a new brand used to open an empty Action Center and
 * wait for the next night — up to a day — before anything appeared. Its first
 * complete run now gets a pass of its own.
 *
 * Only the first. Every later manual run would otherwise re-run detection on
 * a refresh, and the nightly pass is what the rest of the engine is paced
 * around.
 *
 * @param {string} brandId
 */
export async function runFirstSignalPass(brandId, { now = new Date() } = {}) {
  const { data: passes, error } = await supabaseAdmin
    .from('signal_runs')
    .select('brand_id')
    .eq('brand_id', brandId)
    .limit(1);
  if (error) throw new Error(error.message);
  if ((passes ?? []).length > 0) return { skipped: 'not_first' };

  const runAt = await latestStampedRun(brandId, { anySource: true });
  if (!runAt) return { skipped: 'no_stamped_run' };
  return runSignalPass(brandId, { runAt, now });
}

/**
 * Re-run the passes that never finished.
 *
 * Every brand whose nightly run stamped within the window but has no pass
 * logged against that run. A brand whose pass succeeded is skipped by the
 * ledger row, so the sweep costs one query on a healthy night.
 */
export async function runSignalCatchUp({ now = new Date() } = {}) {
  try {
    const since = new Date(now.getTime() - CATCH_UP_WINDOW_MS).toISOString();
    const { data: runs, error } = await supabaseAdmin
      .from('tracking_runs')
      .select('brand_id, completed_at')
      .eq('source', 'cron')
      .not('completed_at', 'is', null)
      .gte('completed_at', since)
      .order('completed_at', { ascending: false });
    if (error) throw new Error(error.message);

    const latestByBrand = new Map();
    for (const run of runs ?? []) {
      if (!latestByBrand.has(run.brand_id)) latestByBrand.set(run.brand_id, run.completed_at);
    }
    if (latestByBrand.size === 0) return { recovered: 0, healthy: 0, failed: 0 };

    const { data: passes, error: passErr } = await supabaseAdmin
      .from('signal_runs')
      .select('brand_id, tracking_run_at')
      .gte('tracking_run_at', since);
    if (passErr) throw new Error(passErr.message);
    const done = new Set((passes ?? []).map((row) => `${row.brand_id}|${row.tracking_run_at}`));
    // Once the plan has ended, no pass is caught up: its actions, and the
    // tasks written for them, are work the organization no longer pays for.
    const isActive = await activeBrandFilter([...latestByBrand.keys()]);

    let recovered = 0;
    let healthy = 0;
    let failed = 0;
    let inactive = 0;

    for (const [brandId, completedAt] of latestByBrand) {
      if (!isActive(brandId)) {
        inactive += 1;
        continue;
      }
      if (done.has(`${brandId}|${completedAt}`)) {
        healthy += 1;
        continue;
      }
      try {
        await runSignalPass(brandId, { runAt: completedAt, now });
        logger.info({ brandId, runCompletedAt: completedAt }, '[signals] catch-up pass completed');
        recovered += 1;
      } catch (err) {
        // One brand's failure must not cost every brand behind it in the loop.
        logger.error({ err, brandId }, '[signals] catch-up pass failed');
        failed += 1;
      }
    }

    if (recovered > 0 || failed > 0) {
      logger.info({ recovered, healthy, failed, inactive }, '[signals] catch-up sweep completed');
    }
    return { recovered, healthy, failed, inactive };
  } catch (err) {
    logger.error({ err }, '[signals] catch-up sweep failed');
    return { error: true };
  }
}
