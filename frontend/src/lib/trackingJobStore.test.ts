import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TRACKING_JOB_KEEP_MS,
  doneMessage,
  loadTrackingJob,
  saveTrackingJob,
} from './trackingJobStore';

/** The tracking job this browser started, kept across refreshes. */

// An in-memory localStorage: the test environment has none.
const kept = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
    clear: () => kept.clear(),
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('loadTrackingJob', () => {
  it('keeps the job as long as the worker may wait on its answers, then drops it', () => {
    const startedAt = Date.now();
    saveTrackingJob({ jobId: 'j1', brandId: 'b1', startedAt });

    // A long first run: past the old 60 minutes, the banner is still restored.
    vi.setSystemTime(startedAt + 149 * 60_000);
    expect(loadTrackingJob()).toEqual({ jobId: 'j1', brandId: 'b1', startedAt });

    vi.setSystemTime(startedAt + TRACKING_JOB_KEEP_MS + 1);
    expect(loadTrackingJob()).toBeNull();
    expect(localStorage.getItem('aeo:tracking-job')).toBeNull();
  });
});

describe('doneMessage', () => {
  it('gives the answers saved, the ones so far while late ones arrive, or no number', () => {
    expect(doneMessage({ resultCount: 640 })).toEqual({ key: 'doneCount', count: 640 });
    expect(doneMessage({ resultCount: 350, stillArriving: true })).toEqual({
      key: 'doneSoFar',
      count: 350,
    });
    // Nothing counted, or an older server's answer: no "0 results saved".
    expect(doneMessage({ resultCount: 0 })).toEqual({ key: 'done' });
    expect(doneMessage(null)).toEqual({ key: 'done' });
    expect(doneMessage(undefined)).toEqual({ key: 'done' });
  });
});
