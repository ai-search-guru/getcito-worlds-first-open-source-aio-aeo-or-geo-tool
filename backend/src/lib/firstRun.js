/**
 * The first tracking run after a payment (POST /api/internal/trigger-tracking).
 *
 * Two callers ask for it: the Stripe return page and Stripe's webhook (a
 * completed checkout, or a subscription whose delayed payment went through).
 * Either may come alone — the person can close the tab before the return page
 * loads, and the webhook can be late — and both often come within the same
 * second. So a run is started once per purchase: a call finds the run the
 * other one started and hands back its id, which the return page carries to
 * the dashboard's progress bar. The job is marked `afterPayment`.
 *
 * Calls for the same brand are taken one at a time in this process, so two
 * calls cannot both find nothing and both start a run. The job queue already
 * lives in this one process (jobRunner.js).
 */

import supabaseAdmin from '../config/supabase.js';
import { createJob } from './jobManager.js';

/** How far back a run counts as this purchase's when the caller gives no time. */
export const DEFAULT_SINCE_MS = 15 * 60_000;

/**
 * How far back a run still waiting or running is looked for. As the recovery
 * sweep's limit (jobRunner.js): an older waiting job is not restarted.
 */
export const LIVE_LOOKBACK_MS = 20 * 60 * 60_000;

const LIVE = new Set(['waiting', 'active']);

/** A run of every prompt, not a single-prompt or new-prompts run. */
export function isFullRun(job) {
  const data = job?.data ?? {};
  return !data.promptId && !(Array.isArray(data.promptIds) && data.promptIds.length > 0);
}

/**
 * The run that already covers this purchase, if any: a run of every prompt
 * that is still waiting or running, or one started since `sinceIso` that did
 * not fail or get cancelled. `jobs` are the brand's tracking jobs, newest
 * first.
 */
export function pickStartedRun(jobs, sinceIso) {
  const since = Date.parse(sinceIso);
  return (
    (jobs ?? []).find(
      (job) =>
        isFullRun(job) &&
        (LIVE.has(job.status) ||
          (job.status === 'completed' && Date.parse(job.created_at) >= since)),
    ) ?? null
  );
}

/**
 * The brand's tracking jobs that could cover the purchase: back to whichever
 * is earlier, the purchase or LIVE_LOOKBACK_MS ago. From the purchase, so a
 * return page opened again a day later still finds the run that finished.
 */
async function brandTrackingJobs(brandId, sinceIso, now) {
  const floor = Math.min(Date.parse(sinceIso), now - LIVE_LOOKBACK_MS);
  const { data, error } = await supabaseAdmin
    .from('jobs')
    .select('id, status, data, created_at')
    .eq('brand_id', brandId)
    .eq('type', 'tracking')
    .in('status', ['waiting', 'active', 'completed'])
    .gte('created_at', new Date(floor).toISOString())
    .order('created_at', { ascending: false })
    .limit(50);
  // A failed read must not start a second run: the caller logs it, and the
  // nightly run tracks the brand.
  if (error) throw new Error(`Failed to read tracking jobs: ${error.message}`);
  return data ?? [];
}

async function startOnce(brandId, sinceIso) {
  const now = Date.now();
  const since = sinceIso ?? new Date(now - DEFAULT_SINCE_MS).toISOString();
  const started = pickStartedRun(await brandTrackingJobs(brandId, since, now), since);
  if (started) return { job: started, created: false };

  const job = await createJob({
    type: 'tracking',
    brandId,
    data: { brandId, immediate: true, afterPayment: true },
    maxAttempts: 3,
  });
  return { job, created: true };
}

/** Calls in progress, per brand: each waits for the one before it. */
const starting = new Map();

/**
 * Start a brand's first run after a purchase, unless one already covers it.
 * `since` is when the purchase began (ISO); without it, the last
 * DEFAULT_SINCE_MS count. Resolves to the job and whether this call created
 * it — only a created job needs running.
 *
 * @param {{ brandId: string, since?: string }} opts
 * @returns {Promise<{ job: { id: string }, created: boolean }>}
 */
export function startFirstRun({ brandId, since }) {
  const previous = starting.get(brandId) ?? Promise.resolve();
  const call = previous.catch(() => {}).then(() => startOnce(brandId, since));
  starting.set(brandId, call);
  const forget = () => {
    if (starting.get(brandId) === call) starting.delete(brandId);
  };
  call.then(forget, forget);
  return call;
}
