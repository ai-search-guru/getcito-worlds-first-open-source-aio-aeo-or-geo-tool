'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useBrandStore } from '@/state/useBrandStore';
import { getJobStatus, getTrackingWindow, type TrackingJobStatus } from '@/lib/actions/tracking';
import { loadTrackingJob } from '@/lib/trackingJobStore';
import { etaParts, minutesLeft, withSample, type ProgressSample } from '@/lib/trackingEta';

/**
 * How often a brand's first run is read again while it goes on: often, since
 * it is someone's first look and the count is what tells them it's working.
 */
export const FIRST_RUN_POLL_MS = 12_000;

/**
 * After this many reads in a row with no run going (a brand never tracked,
 * or a run that failed before the ledger had it), read only every
 * FIRST_RUN_IDLE_POLL_MS: the pages that show the run are open for long.
 */
export const FIRST_RUN_IDLE_READS = 5;
export const FIRST_RUN_IDLE_POLL_MS = 60_000;

/** A saved job the worker hasn't finished: queued, delayed or running. */
const LIVE_JOB = new Set<TrackingJobStatus['status']>(['waiting', 'delayed', 'active']);

/** A brand's first tracking run while it goes on. */
export interface FirstRun {
  brandId: string;
  /** Queued: the worker hasn't started it, so the ledger has no row yet. */
  queued: boolean;
  /** Checks done of the run's total, from the job this browser saved; null without one. */
  progress: { current: number; total: number } | null;
  /** About how long is left at the pace so far; null until there is enough to go on. */
  left: { minutes: number } | { hours: number } | null;
}

interface Watch {
  run: FirstRun | null;
  /** The run was seen going: its end is news ("Your first results are ready"). */
  seen: boolean;
  /** The run's pace while the page watches it, for the time left. */
  pace: ProgressSample[];
  listeners: Set<() => void>;
  /** False once nobody watches, or the brand has a completed run. */
  live: boolean;
  /** Reads in a row that found no run going. */
  idle: number;
  /** The next read waits for the tab to be shown again. */
  paused: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

// One read loop per brand, however many parts of the page show the run.
const watches = new Map<string, Watch>();
// Told once when a run a page watched finishes.
const finishedListeners = new Set<(brandId: string) => void>();

function emit(watch: Watch) {
  for (const listener of watch.listeners) listener();
}

const tabHidden = () => typeof document !== 'undefined' && document.hidden;

let resumeListening = false;
// A hidden tab reads nothing; shown again, every paused watch reads at once.
function resumeOnShow() {
  if (resumeListening || typeof document === 'undefined') return;
  resumeListening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    for (const [brandId, watch] of watches) {
      if (!watch.paused || !watch.live) continue;
      watch.paused = false;
      void tick(brandId, watch);
    }
  });
}

/** The next read: later while nothing goes on, and not while the tab is hidden. */
function schedule(brandId: string, watch: Watch) {
  const wait = watch.idle >= FIRST_RUN_IDLE_READS ? FIRST_RUN_IDLE_POLL_MS : FIRST_RUN_POLL_MS;
  watch.timer = setTimeout(() => {
    if (!watch.live) return;
    if (tabHidden()) {
      watch.paused = true;
      resumeOnShow();
      return;
    }
    void tick(brandId, watch);
  }, wait);
}

/**
 * One read: from the tracking_runs ledger (any browser's run), or, while the
 * job still waits for the worker, from the job this browser saved
 * (TrackingJobHandoff), which also gives the progress. It stops reading
 * once the brand has a completed run. A failed read keeps what it said
 * until the next one.
 */
async function tick(brandId: string, watch: Watch) {
  const win = await getTrackingWindow(brandId).catch(() => null);
  if (!watch.live) return;
  if (win?.lastRunAt) {
    // The first run is done: this brand never needs reading again.
    watch.live = false;
    watch.run = null;
    emit(watch);
    if (watch.seen) for (const listener of finishedListeners) listener(brandId);
    return;
  }
  if (win) {
    const saved = loadTrackingJob();
    const job =
      saved?.brandId === brandId ? await getJobStatus(saved.jobId).catch(() => null) : null;
    if (!watch.live) return;
    const live = job !== null && LIVE_JOB.has(job.status);
    const progress = live && job.progress ? job.progress : null;
    if (progress) {
      watch.pace = withSample(watch.pace, { at: Date.now(), current: progress.current });
    }
    const eta = progress ? minutesLeft(watch.pace, progress.total) : null;
    watch.run =
      win.activeRun || live
        ? {
            brandId,
            queued: !win.activeRun && job?.status !== 'active',
            progress: progress ? { current: progress.current, total: progress.total } : null,
            left: eta === null ? null : etaParts(eta),
          }
        : null;
    if (watch.run) watch.seen = true;
    watch.idle = watch.run ? 0 : watch.idle + 1;
    emit(watch);
  }
  schedule(brandId, watch);
}

function watchFirstRun(brandId: string, listener: () => void) {
  let watch = watches.get(brandId);
  if (!watch) {
    watch = {
      run: null,
      seen: false,
      pace: [],
      listeners: new Set(),
      live: true,
      idle: 0,
      paused: false,
    };
    watches.set(brandId, watch);
    void tick(brandId, watch);
  }
  const current = watch;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    current.live = false;
    clearTimeout(current.timer);
    if (watches.get(brandId) === current) watches.delete(brandId);
  };
}

const noWatch = () => () => {};

/**
 * Called with the brand's id when a first run a page watched finishes (the
 * brand's first completed run): not for one already done when first read.
 * Returns the way to stop listening.
 */
export function onFirstRunFinished(listener: (brandId: string) => void) {
  finishedListeners.add(listener);
  return () => {
    finishedListeners.delete(listener);
  };
}

/**
 * The active brand's first tracking run while it goes on, or null: before
 * the first read, when no run is under way, and once the brand has a
 * completed run. Another brand's run never shows under this one. With
 * `enabled` false: nothing, and no reads.
 */
export function useFirstRun({ enabled = true }: { enabled?: boolean } = {}): FirstRun | null {
  const brandId = useBrandStore((s) => s.activeBrandId);
  const subscribe = useCallback(
    (listener: () => void) => (brandId && enabled ? watchFirstRun(brandId, listener) : noWatch()),
    [brandId, enabled],
  );
  const run = useSyncExternalStore(
    subscribe,
    () => (brandId && enabled ? (watches.get(brandId)?.run ?? null) : null),
    () => null,
  );
  return run && run.brandId === brandId ? run : null;
}
