import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { TrackingWindow } from '@/lib/actions/tracking';

/**
 * "Your first results are ready", on any page, when the brand's first run
 * finishes: watched there while this browser holds the run's job, and told
 * by whatever part of the page watched it otherwise.
 */

const { getTrackingWindow, getJobStatus, loadTrackingJob, store, toast } = vi.hoisted(() => ({
  getTrackingWindow: vi.fn(),
  getJobStatus: vi.fn(),
  loadTrackingJob: vi.fn(),
  store: { activeBrandId: 'b1' as string | null },
  toast: { success: vi.fn() },
}));
vi.mock('@/lib/actions/tracking', () => ({ getTrackingWindow, getJobStatus }));
vi.mock('@/lib/trackingJobStore', () => ({ loadTrackingJob }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: Object.assign(
    (selector: (state: { activeBrandId: string | null }) => unknown) => selector(store),
    { getState: () => store },
  ),
}));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/dashboard/settings' }));
vi.mock('sonner', () => ({ toast }));

const { FirstRunReady } = await import('./FirstRunReady');
const { useFirstRun } = await import('@/hooks/useFirstRun');

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
const done = win({ lastRunAt: '2026-10-30T09:45:00Z' });

/** A part of the page that shows the run (the Action Center's line). */
function Watcher() {
  useFirstRun();
  return null;
}

let container: HTMLDivElement;
let root: Root;

async function render(withWatcher = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <FirstRunReady />
        {withWatcher && <Watcher />}
      </NextIntlClientProvider>,
    );
  });
}
const nextRead = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(12_000);
  });

beforeEach(() => {
  vi.useFakeTimers();
  getTrackingWindow.mockReset().mockResolvedValue(running);
  getJobStatus.mockReset().mockResolvedValue({ status: 'active', progress: null });
  loadTrackingJob.mockReset().mockReturnValue(null);
  toast.success.mockReset();
  store.activeBrandId = 'b1';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('FirstRunReady', () => {
  it('watches the run on any page while this browser holds its job, and says when it is done', async () => {
    loadTrackingJob.mockReturnValue({ jobId: 'j1', brandId: 'b1', startedAt: 1 });
    await render();
    expect(getTrackingWindow).toHaveBeenCalledWith('b1');
    expect(toast.success).not.toHaveBeenCalled();

    getTrackingWindow.mockResolvedValue(done);
    await nextRead();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Your first results are ready');

    // Done: no more reads, and nothing said again.
    await nextRead();
    await nextRead();
    expect(getTrackingWindow).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("reads nothing without the run's job, but says it when another part of the page watched it", async () => {
    await render();
    expect(getTrackingWindow).not.toHaveBeenCalled();

    await render(true);
    expect(getTrackingWindow).toHaveBeenCalledTimes(1);
    getTrackingWindow.mockResolvedValue(done);
    await nextRead();
    expect(toast.success).toHaveBeenCalledWith('Your first results are ready');
  });

  it('says nothing for a brand whose first run was done when first read', async () => {
    getTrackingWindow.mockResolvedValue(done);
    await render(true);
    await nextRead();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says nothing for another brand's run, finished after a switch", async () => {
    loadTrackingJob.mockReturnValue({ jobId: 'j1', brandId: 'b1', startedAt: 1 });
    await render();
    store.activeBrandId = 'b2';
    getTrackingWindow.mockResolvedValue(done);
    await nextRead();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
