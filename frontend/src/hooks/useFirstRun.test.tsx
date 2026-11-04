import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackingWindow } from '@/lib/actions/tracking';

/**
 * The first run's read loop is on Brand Visibility, Prompts and the Action
 * Center, which stay open for long: a brand with nothing going on is read
 * less often, and a hidden tab reads nothing until it is shown again.
 */

const { getTrackingWindow, getJobStatus, loadTrackingJob } = vi.hoisted(() => ({
  getTrackingWindow: vi.fn(),
  getJobStatus: vi.fn(),
  loadTrackingJob: vi.fn(),
}));
vi.mock('@/lib/actions/tracking', () => ({ getTrackingWindow, getJobStatus }));
vi.mock('@/lib/trackingJobStore', () => ({ loadTrackingJob }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: { activeBrandId: string | null }) => unknown) =>
    selector({ activeBrandId: 'b1' }),
}));

const { useFirstRun, FIRST_RUN_IDLE_READS, FIRST_RUN_IDLE_POLL_MS, FIRST_RUN_POLL_MS } =
  await import('./useFirstRun');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const win = (over: Partial<TrackingWindow> = {}): TrackingWindow => ({
  anchored: null,
  activeRun: null,
  lastRunAt: null,
  nextRunAt: null,
  ...over,
});
const running = win({ activeRun: { startedAt: '2026-10-30T09:00:00Z', source: 'manual' } });

function Watcher() {
  useFirstRun();
  return null;
}

let container: HTMLDivElement;
let root: Root;
let hidden = false;

const render = () =>
  act(async () => {
    root.render(<Watcher />);
  });
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const setHidden = (value: boolean) =>
  act(async () => {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  });

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  getTrackingWindow.mockReset().mockResolvedValue(win());
  getJobStatus.mockReset();
  loadTrackingJob.mockReset().mockReturnValue(null);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useFirstRun read loop', () => {
  it('reads less often after a few reads with no run going', async () => {
    await render();
    await wait(FIRST_RUN_POLL_MS * (FIRST_RUN_IDLE_READS - 1));
    expect(getTrackingWindow).toHaveBeenCalledTimes(FIRST_RUN_IDLE_READS);

    // Idle now: no read at the usual pace, one at the slower one.
    await wait(FIRST_RUN_POLL_MS);
    expect(getTrackingWindow).toHaveBeenCalledTimes(FIRST_RUN_IDLE_READS);
    await wait(FIRST_RUN_IDLE_POLL_MS - FIRST_RUN_POLL_MS);
    expect(getTrackingWindow).toHaveBeenCalledTimes(FIRST_RUN_IDLE_READS + 1);

    // A run shows up: back to the usual pace.
    getTrackingWindow.mockResolvedValue(running);
    await wait(FIRST_RUN_IDLE_POLL_MS);
    const seen = getTrackingWindow.mock.calls.length;
    await wait(FIRST_RUN_POLL_MS);
    expect(getTrackingWindow).toHaveBeenCalledTimes(seen + 1);
  });

  it('keeps the usual pace while a run goes on', async () => {
    getTrackingWindow.mockResolvedValue(running);
    await render();
    await wait(FIRST_RUN_POLL_MS * 10);
    expect(getTrackingWindow).toHaveBeenCalledTimes(11);
  });

  it('reads nothing while the tab is hidden, and reads at once when it is shown', async () => {
    getTrackingWindow.mockResolvedValue(running);
    await render();
    expect(getTrackingWindow).toHaveBeenCalledTimes(1);

    await setHidden(true);
    await wait(FIRST_RUN_POLL_MS * 10);
    expect(getTrackingWindow).toHaveBeenCalledTimes(1);

    await setHidden(false);
    expect(getTrackingWindow).toHaveBeenCalledTimes(2);
    await wait(FIRST_RUN_POLL_MS);
    expect(getTrackingWindow).toHaveBeenCalledTimes(3);
  });

  it('does not come back for a page that was closed while the tab was hidden', async () => {
    getTrackingWindow.mockResolvedValue(running);
    await render();
    await setHidden(true);
    await wait(FIRST_RUN_POLL_MS);
    act(() => root.unmount());
    root = createRoot(container);

    await setHidden(false);
    await wait(FIRST_RUN_POLL_MS * 3);
    expect(getTrackingWindow).toHaveBeenCalledTimes(1);
  });
});
