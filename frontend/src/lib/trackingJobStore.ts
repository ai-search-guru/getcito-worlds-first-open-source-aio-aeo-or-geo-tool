const TRACKING_STORAGE_KEY = 'aeo:tracking-job';

/**
 * How long a saved job is restored across refreshes: as long as the worker
 * may wait on a run's answers. Up to 90 minutes for the first answer
 * (CLORO_FIRST_RESULT_WAIT_MIN), then up to 60 for the rest
 * (CLORO_DRAIN_TAIL_MIN); a brand's first run, with nothing to compare its
 * pace with, can take all of it. Dropping the job sooner hid the progress
 * banner in the middle of a long first run.
 */
export const TRACKING_JOB_KEEP_MS = 150 * 60 * 1000;

export interface TrackingJob {
  jobId: string;
  brandId: string;
  startedAt: number;
}

export function saveTrackingJob(job: TrackingJob) {
  try {
    localStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(job));
  } catch {}
}

export function loadTrackingJob(): TrackingJob | null {
  try {
    const raw = localStorage.getItem(TRACKING_STORAGE_KEY);
    if (!raw) return null;
    const job = JSON.parse(raw) as TrackingJob;
    if (Date.now() - job.startedAt > TRACKING_JOB_KEEP_MS) {
      localStorage.removeItem(TRACKING_STORAGE_KEY);
      return null;
    }
    return job;
  } catch {
    return null;
  }
}

/**
 * What a finished job says (insights.tracking): its answers saved, or the
 * ones in so far while late answers still arrive; no number when it has
 * none to give (an older server, or a run that stored nothing).
 */
export function doneMessage(
  result: { resultCount?: number; stillArriving?: boolean } | null | undefined,
): { key: 'done' } | { key: 'doneCount' | 'doneSoFar'; count: number } {
  const count = Number(result?.resultCount) || 0;
  if (count <= 0) return { key: 'done' };
  return { key: result?.stillArriving ? 'doneSoFar' : 'doneCount', count };
}

export function clearTrackingJob() {
  try {
    localStorage.removeItem(TRACKING_STORAGE_KEY);
  } catch {}
}
