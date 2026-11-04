/**
 * Supabase-based job manager — replaces Bull/Redis queue.
 * Provides CRUD operations for the `jobs` table and in-memory
 * AbortController tracking for cancellation support.
 */

import supabaseAdmin from '../config/supabase.js';
import logger from './logger.js';

/** @type {Map<string, AbortController>} */
const activeJobs = new Map();

/**
 * Insert a new job row and return it.
 * @param {{ type: 'tracking'|'content', brandId: string, data: object, maxAttempts?: number }} opts
 */
export async function createJob({ type, brandId, data, maxAttempts }) {
  const { data: job, error } = await supabaseAdmin
    .from('jobs')
    .insert({
      type,
      brand_id: brandId,
      data: data || {},
      max_attempts: maxAttempts ?? (type === 'tracking' ? 3 : 2),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create job: ${error.message}`);
  return job;
}

/**
 * Update job progress (called from workers during execution).
 */
export async function updateJobProgress(jobId, progress) {
  const { error } = await supabaseAdmin
    .from('jobs')
    .update({ progress, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  if (error) logger.error({ err: error, jobId }, 'failed to update job progress');
}

/**
 * Mark a job as completed with its result.
 */
export async function completeJob(jobId, result) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: 'completed',
      result,
      completed_at: now,
      updated_at: now,
    })
    .eq('id', jobId);

  if (error) logger.error({ err: error, jobId }, 'failed to complete job');
}

/**
 * Mark a job as failed.
 */
export async function failJob(jobId, reason) {
  const { error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: 'failed',
      failed_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) logger.error({ err: error, jobId }, 'failed to fail job');
}

/**
 * Atomically move a job from 'waiting' to 'active' and count the attempt.
 * Returns the job row, or null when it was not waiting — cancelled, already
 * taken by another run chain, or the read failed. The status guard is what
 * makes it safe for the recovery sweep and a job's own retry timer to race
 * for the same job: only one of them gets it.
 */
export async function claimWaitingJob(jobId) {
  const now = new Date().toISOString();
  const { data: job, error } = await supabaseAdmin
    .from('jobs')
    .update({ status: 'active', started_at: now, updated_at: now })
    .eq('id', jobId)
    .eq('status', 'waiting')
    .select('*')
    .maybeSingle();

  if (error) {
    logger.error({ err: error, jobId }, 'failed to claim job');
    return null;
  }
  if (!job) return null;

  const attempts = (job.attempts || 0) + 1;
  const { error: attemptsError } = await supabaseAdmin
    .from('jobs')
    .update({ attempts })
    .eq('id', jobId);
  if (attemptsError) logger.error({ err: attemptsError, jobId }, 'failed to count job attempt');

  return { ...job, attempts };
}

/**
 * Jobs left in 'waiting' — the recovery sweep's input. Only rows untouched
 * for `idleMs`, so a job created a moment ago is left to the call that
 * created it, and created within `maxAgeMs`, because an older nightly job
 * would duplicate the next night's run.
 */
export async function listWaitingJobs({ idleMs, maxAgeMs }) {
  const now = Date.now();
  const { data, error } = await supabaseAdmin
    .from('jobs')
    // `data` too: a run after a payment keeps its place ahead of the queue.
    .select('id, type, brand_id, data')
    .eq('status', 'waiting')
    .lt('updated_at', new Date(now - idleMs).toISOString())
    .gt('created_at', new Date(now - maxAgeMs).toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ err: error }, 'failed to list waiting jobs');
    return [];
  }
  return data ?? [];
}

/**
 * Fetch a single job by ID. Returns null if not found.
 */
export async function getJob(jobId) {
  const { data: job, error } = await supabaseAdmin
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) return null;
  return job;
}

/**
 * Cancel a job — updates DB status and aborts in-memory signal.
 */
export async function cancelJob(jobId) {
  const { error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) logger.error({ err: error, jobId }, 'failed to cancel job');

  const controller = activeJobs.get(jobId);
  if (controller) controller.abort();
}

/** Cancel a job while its status is `status`, keeping why; whether it was. */
async function cancelJobWhile(jobId, status, reason) {
  const { data, error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: 'cancelled',
      failed_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', status)
    .select('id');

  if (error) {
    logger.error({ err: error, jobId, status }, 'failed to cancel job');
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Cancel a job that is still waiting, saying why (`reason`, kept in
 * failed_reason): one already started, finished or cancelled is left as it
 * is. Returns whether it was cancelled.
 */
export async function cancelWaitingJob(jobId, reason) {
  return cancelJobWhile(jobId, 'waiting', reason);
}

/**
 * Cancel a job this process has just claimed (claimWaitingJob), before its
 * work starts, saying why: one cancelled meanwhile is left as it is.
 * Returns whether it was cancelled.
 */
export async function cancelClaimedJob(jobId, reason) {
  return cancelJobWhile(jobId, 'active', reason);
}

/** Register an active job's AbortController. */
export function registerActiveJob(jobId, abortController) {
  activeJobs.set(jobId, abortController);
}

/** Unregister a finished job. */
export function unregisterActiveJob(jobId) {
  activeJobs.delete(jobId);
}

/** Check if a job has been cancelled via its abort signal. */
export function isJobCancelled(jobId) {
  const controller = activeJobs.get(jobId);
  return controller ? controller.signal.aborted : false;
}

/**
 * On server startup, mark any leftover 'active' jobs as failed.
 */
export async function cleanupStaleJobs() {
  const { data, error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: 'failed',
      failed_reason: 'Server restarted during execution',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'active')
    .select('id');

  if (error) {
    logger.error({ err: error }, 'failed to cleanup stale jobs');
  } else if (data && data.length > 0) {
    logger.info({ count: data.length }, 'cleaned up stale active jobs');
  }
}

/**
 * Delete jobs older than 7 days. Call from daily cron.
 */
export async function cleanupOldJobs() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin.from('jobs').delete().lt('created_at', cutoff);

  if (error) {
    logger.error({ err: error }, 'failed to cleanup old jobs');
  }
}

/**
 * Delete orphaned Cloro pending tasks — rows for which Cloro never delivered a
 * webhook. They sit forever otherwise; left unchecked they accumulate and (with
 * a brand-wide count) used to poison every future run's drain loop. Two hours is
 * well past the worker's 60-minute drain deadline and any realistic Cloro
 * delivery window, so anything older is safe to drop.
 */
export async function cleanupStalePendingTasks() {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from('cloro_pending_tasks')
    .delete({ count: 'exact' })
    .lt('submitted_at', cutoff);

  if (error) {
    logger.error({ err: error }, 'failed to cleanup stale pending tasks');
  } else if (count && count > 0) {
    logger.info({ count }, 'cleaned up orphaned cloro pending tasks');
  }
}
