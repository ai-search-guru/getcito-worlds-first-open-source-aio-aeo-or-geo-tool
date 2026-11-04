/**
 * Job runner — orchestrates async job execution with concurrency
 * control, retry logic, and Socket.IO notifications.
 * Replaces Bull's queue.process() mechanism.
 */

import {
  getJob,
  cancelClaimedJob,
  cancelWaitingJob,
  claimWaitingJob,
  listWaitingJobs,
  completeJob,
  failJob,
  updateJobProgress,
  registerActiveJob,
  unregisterActiveJob,
} from './jobManager.js';
import { brandStopReason, brandStopReasons } from './activeSubscriptions.js';
import { processTrackingJob } from '../workers/trackingWorker.js';
import { processContentJob } from '../workers/contentWorker.js';
import { generatePulseForBrand } from './pulse/engine.js';
import { runFirstSignalPass, runSignalPass } from './signals/pass.js';
import { sendFirstResultsEmail } from './firstResultsEmail.js';
import { emitToBrand } from './socketRooms.js';
import logger from './logger.js';

// Concurrency counters (the default of 2 per queue is inherited from the Bull
// setup this replaced). Tracking jobs spend almost all of their time waiting on
// scraper callbacks rather than burning CPU, so the ceiling mostly decides how
// many brands sit in the nightly queue behind each other — raise it to shorten
// the cycle, watching memory on small instances.
let activeTrackingCount = 0;
const MAX_CONCURRENT_TRACKING = Number(process.env.TRACKING_CONCURRENCY) || 2;

// The first run after a payment is the person's first look at the product, and
// they are watching it. It goes ahead of the queue: it may take this many
// slots beyond the limit, so it never waits behind the nightly runs, each of
// which holds its slot through a Cloro drain that can last an hour; and while
// one still waits for a slot, the others step aside. 0 turns the extra slot
// off, leaving only the place in the queue.
const PRIORITY_EXTRA_SLOTS = /^\d+$/.test(process.env.TRACKING_PRIORITY_SLOTS ?? '')
  ? Number(process.env.TRACKING_PRIORITY_SLOTS)
  : 1;
const PRIORITY_RETRY_MS = 1000;
const REGULAR_RETRY_MS = 5000;
// Priority jobs waiting for a slot right now.
const priorityWaiting = new Set();
let activeContentCount = 0;
const MAX_CONCURRENT_CONTENT = 2;

// Jobs with a live run chain in this process: waiting for a slot, waiting to
// retry, or running. The queue lives only in memory, so a job whose chain is
// lost — a restart, an error before it got a slot — would sit in 'waiting'
// forever; the recovery sweep restarts those, and this set keeps it from
// starting a second chain for a job this process is still handling.
const queuedJobs = new Set();

// The sweep leaves a job alone for its first minutes (the call that created
// it starts it) and gives up on it after 20h, when the next night's run has
// either started or is about to.
const RECOVERY_IDLE_MS = 2 * 60_000;
const RECOVERY_MAX_AGE_MS = 20 * 60 * 60_000;
const RECOVERABLE_TYPES = new Set(['tracking', 'content']);

/**
 * Create a mock job object that mirrors the Bull job interface
 * used by processTrackingJob / processContentJob.
 */
function createJobProxy(jobId, signal) {
  return {
    progress: (data) => updateJobProgress(jobId, data),
    signal,
  };
}

/**
 * Whether a claimed job may not run, cancelling it if so: its organization
 * has no active plan (2026-10-27), or its brand is a demo brand (00380),
 * whose data is sample data. Every way a job starts (the nightly run, "Run
 * now", the internal trigger, a retry, the recovery) ends in a claim, so
 * this is where tracking and content generation stop, with no Cloro, AI or
 * scraping spent and nothing counted: the job's own row is all that is left
 * (failed_reason says why). A read that fails throws, and the job retries as
 * after any failure.
 */
async function skipStopped(jobId, brandId) {
  const reason = await brandStopReason(brandId);
  if (!reason) return false;
  if (await cancelClaimedJob(jobId, reason)) {
    logger.info({ jobId, brandId, reason }, 'cancelled a job that may not run');
  } else {
    // Not cancelled (the write failed, or the row moved on): never left
    // 'active', where nothing would end it.
    logger.warn({ jobId, brandId, reason }, 'could not cancel a job that may not run; failing it');
    await failJob(jobId, reason);
  }
  return true;
}

/**
 * Tell the people who may reach the brand that its job finished (lib/
 * socketRooms.js), never every connected client. Not awaited: the job is
 * already done, and a failed read only costs the live refresh.
 */
function notifyBrand(io, brandId, event, payload) {
  if (!io) return;
  emitToBrand(io, brandId, event, payload).catch((err) => {
    logger.error({ err, brandId, event }, 'could not send a job event to its brand');
  });
}

/**
 * Run a tracking job. Call without await (fire-and-forget).
 * Handles concurrency gating, retry, and Socket.IO emit. `priority` is for
 * the first run after a payment (see PRIORITY_EXTRA_SLOTS).
 */
export function runTrackingJob(jobId, io, { priority = false } = {}) {
  if (queuedJobs.has(jobId)) return;
  queuedJobs.add(jobId);
  void attemptTrackingJob(jobId, io, priority);
}

async function attemptTrackingJob(jobId, io, priority = false) {
  const limit = MAX_CONCURRENT_TRACKING + (priority ? PRIORITY_EXTRA_SLOTS : 0);
  if (activeTrackingCount >= limit || (!priority && priorityWaiting.size > 0)) {
    if (priority) priorityWaiting.add(jobId);
    setTimeout(
      () => attemptTrackingJob(jobId, io, priority),
      priority ? PRIORITY_RETRY_MS : REGULAR_RETRY_MS,
    );
    return;
  }
  priorityWaiting.delete(jobId);

  // Take the slot before the first await. Otherwise every timer that fires
  // while the claim is in flight sees the same free slot, and a night once
  // ran nine jobs against a limit of three.
  activeTrackingCount++;
  const jobRow = await claimWaitingJob(jobId);
  if (!jobRow) {
    activeTrackingCount--;
    queuedJobs.delete(jobId);
    return;
  }

  const abortController = new AbortController();
  registerActiveJob(jobId, abortController);
  let retrying = false;

  try {
    const { brandId, promptId, promptIds, immediate } = jobRow.data;
    if (await skipStopped(jobId, brandId)) return;
    const proxy = createJobProxy(jobId, abortController.signal);

    const result = await processTrackingJob({
      brandId,
      promptId,
      promptIds,
      source: immediate ? 'manual' : 'cron',
      attempt: jobRow.attempts,
      job: proxy,
    });

    // The late-stamp promise is not job state; only the counts are stored.
    const { lateStamp, ...stored } = result;
    await completeJob(jobId, stored);

    notifyBrand(io, brandId, 'tracking:complete', {
      brandId,
      resultCount: result.resultCount,
      immediate: !!immediate,
    });

    const fullRun = !promptId && !promptIds?.length;

    // What a full run's stamp sets off. The run may stamp now, or later once
    // Cloro's late answers arrive (lib/run-settlement) — either way this runs
    // exactly once, after the stamp, so it reads the finished window.
    const afterStamp = () => {
      if (!fullRun) return;
      // The brand's first run: its results are in, and the people who
      // waited for them may have left the app (once per person).
      if (result.firstRun) {
        sendFirstResultsEmail(brandId).catch((err) => {
          logger.error({ err, brandId }, 'first results e-mail failed');
        });
      }
      if (!immediate) {
        // Daily Pulse (#540): after a full daily run only — never for manual
        // runs or single-prompt refreshes. The engine is self-contained:
        // eligibility checks, dedup and error handling inside.
        generatePulseForBrand(brandId).catch((err) => {
          logger.error({ err, brandId }, 'daily pulse trigger failed');
        });
        // Signal recording (Action Center) rides the same trigger but is
        // deliberately NOT inside the pulse engine: signals are a product
        // surface, so a brand with pulse emails off still gets them.
        //
        // Still fire-and-forget, but no longer forgettable: the pass logs
        // itself against the run it covered, and the nightly catch-up sweep
        // re-runs whatever has no row. A failure here costs the brand a few
        // hours now, not the night.
        runSignalPass(brandId).catch((err) => {
          logger.error({ err, brandId }, '[signals] pass failed — catch-up will retry');
        });
      } else {
        // A new brand's first run is a manual one, and passes otherwise wait
        // for the night. It gets one now so the Action Center is not empty
        // until tomorrow; the function is a no-op for a brand that already
        // had one.
        runFirstSignalPass(brandId).catch((err) => {
          logger.error(
            { err, brandId },
            '[signals] first pass failed — the nightly pass will cover it',
          );
        });
      }
    };

    // Skipped when the run never stamps (#702). An unstamped run left the 24h
    // anchor on the previous run, so the pulse would recompute that same
    // window and mail figures the recipient already received. The catch-up
    // sweep picks the day back up once a run does stamp.
    if (result?.stamped) {
      afterStamp();
    } else if (lateStamp) {
      lateStamp.then((stamped) => {
        if (stamped) afterStamp();
        else if (fullRun && !immediate) {
          logger.warn({ brandId }, 'skipping daily pulse — tracking run never stamped');
        }
      });
    } else if (fullRun && !immediate) {
      logger.warn(
        { brandId, resultCount: result?.resultCount },
        'skipping daily pulse — tracking run was not stamped, window would be stale',
      );
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      logger.info({ jobId }, 'tracking job was cancelled');
      return;
    }

    logger.error({ err, jobId }, 'tracking job failed');

    // Re-fetch to get latest attempts count
    const latest = await getJob(jobId);
    if (latest && latest.attempts < latest.max_attempts) {
      const delay = latest.attempts * 30_000; // exponential-ish backoff
      logger.info(
        { jobId, delayMs: delay, attempt: latest.attempts, attempts: latest.max_attempts },
        'retrying tracking job',
      );

      await failJob(jobId, err.message);
      // Reset to waiting for retry
      const supabaseAdmin = (await import('../config/supabase.js')).default;
      await supabaseAdmin
        .from('jobs')
        .update({ status: 'waiting', updated_at: new Date().toISOString() })
        .eq('id', jobId);

      retrying = true;
      setTimeout(() => attemptTrackingJob(jobId, io, priority), delay);
    } else {
      await failJob(jobId, err.message);
    }
  } finally {
    unregisterActiveJob(jobId);
    activeTrackingCount--;
    if (!retrying) queuedJobs.delete(jobId);
  }
}

/**
 * Run a content generation job. Call without await (fire-and-forget).
 */
export function runContentJob(jobId, io) {
  if (queuedJobs.has(jobId)) return;
  queuedJobs.add(jobId);
  void attemptContentJob(jobId, io);
}

async function attemptContentJob(jobId, io) {
  if (activeContentCount >= MAX_CONCURRENT_CONTENT) {
    setTimeout(() => attemptContentJob(jobId, io), 5000);
    return;
  }

  // Slot before the first await — see attemptTrackingJob.
  activeContentCount++;
  const jobRow = await claimWaitingJob(jobId);
  if (!jobRow) {
    activeContentCount--;
    queuedJobs.delete(jobId);
    return;
  }

  const abortController = new AbortController();
  registerActiveJob(jobId, abortController);
  let retrying = false;

  try {
    const { brandId, model, request } = jobRow.data;
    if (await skipStopped(jobId, brandId)) return;
    const proxy = createJobProxy(jobId, abortController.signal);

    const result = await processContentJob({ brandId, model, job: proxy, request });

    await completeJob(jobId, result);

    notifyBrand(io, brandId, 'content:generated', {
      brandId,
      generated: result.generated,
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      logger.info({ jobId }, 'content job was cancelled');
      return;
    }

    logger.error({ err, jobId }, 'content job failed');

    const latest = await getJob(jobId);
    if (latest && latest.attempts < latest.max_attempts) {
      const delay = latest.attempts * 15_000;
      logger.info(
        { jobId, delayMs: delay, attempt: latest.attempts, attempts: latest.max_attempts },
        'retrying content job',
      );

      await failJob(jobId, err.message);
      const supabaseAdmin = (await import('../config/supabase.js')).default;
      await supabaseAdmin
        .from('jobs')
        .update({ status: 'waiting', updated_at: new Date().toISOString() })
        .eq('id', jobId);

      retrying = true;
      setTimeout(() => attemptContentJob(jobId, io), delay);
    } else {
      await failJob(jobId, err.message);
    }
  } finally {
    unregisterActiveJob(jobId);
    activeContentCount--;
    if (!retrying) queuedJobs.delete(jobId);
  }
}

/**
 * Restart waiting jobs that have no run chain in this process. Runs at
 * startup and every minute (server.js). Returns how many it restarted.
 *
 * A job that may not run is cancelled instead, saying why: its
 * organization's plan has ended (it would track, scrape or write for an
 * organization that no longer pays for it), or its brand is a demo brand.
 * Left waiting, it would only be found again the next minute.
 */
export async function recoverWaitingJobs(io) {
  const jobs = (
    await listWaitingJobs({
      idleMs: RECOVERY_IDLE_MS,
      maxAgeMs: RECOVERY_MAX_AGE_MS,
    })
  ).filter((job) => !queuedJobs.has(job.id) && RECOVERABLE_TYPES.has(job.type));
  if (jobs.length === 0) return 0;
  const reasonFor = await brandStopReasons(jobs.map((job) => job.brand_id));

  let recovered = 0;
  let cancelled = 0;
  for (const job of jobs) {
    const reason = reasonFor(job.brand_id);
    if (reason) {
      if (await cancelWaitingJob(job.id, reason)) cancelled++;
      continue;
    }
    if (job.type === 'tracking') {
      runTrackingJob(job.id, io, { priority: job.data?.afterPayment === true });
    } else {
      runContentJob(job.id, io);
    }
    recovered++;
  }

  if (cancelled > 0) logger.info({ cancelled }, 'cancelled waiting jobs that may not run');
  if (recovered > 0) logger.warn({ recovered }, 'restarted waiting jobs that had no run chain');
  return recovered;
}
