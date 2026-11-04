import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { TrackingJobStatus, TrackingWindow } from '@/lib/actions/tracking';

/**
 * The Action Center's "First tracking running" line (#1238's review): people
 * land on Actions while a new brand's first run goes on, and only Visibility
 * showed it. One thin line; Details unfolds the rest.
 */

const { getTrackingWindow, getJobStatus, loadTrackingJob, store } = vi.hoisted(() => ({
  getTrackingWindow: vi.fn(),
  getJobStatus: vi.fn(),
  loadTrackingJob: vi.fn(),
  store: { brandId: 'b1' as string | null },
}));
vi.mock('@/lib/actions/tracking', () => ({ getTrackingWindow, getJobStatus }));
vi.mock('@/lib/trackingJobStore', () => ({ loadTrackingJob }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: { activeBrandId: string | null }) => unknown) =>
    selector({ activeBrandId: store.brandId }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { FirstRunNote } = await import('./FirstRunNote');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const win = (over: Partial<TrackingWindow> = {}): TrackingWindow => ({
  anchored: null,
  activeRun: null,
  lastRunAt: null,
  nextRunAt: null,
  ...over,
});
const job = (over: Partial<TrackingJobStatus> = {}): TrackingJobStatus => ({
  status: 'active',
  progress: null,
  result: null,
  failedReason: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function render(count = 1) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {Array.from({ length: count }, (_, i) => (
          <FirstRunNote key={i} />
        ))}
      </NextIntlClientProvider>,
    );
  });
}
const text = () => container.textContent ?? '';
const details = () => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;

beforeEach(() => {
  vi.useFakeTimers();
  getTrackingWindow.mockReset().mockResolvedValue(win());
  getJobStatus.mockReset().mockResolvedValue(job());
  loadTrackingJob.mockReset().mockReturnValue(null);
  store.brandId = 'b1';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('FirstRunNote', () => {
  it("says the first tracking is running from the ledger, whoever's browser started it", async () => {
    getTrackingWindow.mockResolvedValue(
      win({ activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'manual' } }),
    );
    await render();
    expect(text()).toContain('First tracking running');
    expect(getJobStatus).not.toHaveBeenCalled();
  });

  it('is one line, and Details unfolds what it means and the way to Brand Visibility', async () => {
    getTrackingWindow.mockResolvedValue(
      win({ activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'manual' } }),
    );
    await render();
    expect(container.querySelector('.h-9')?.textContent).toBe('First tracking runningDetails');
    expect(text()).not.toContain('Actions, signals and KPIs fill in once it finishes');
    expect(container.querySelector('a')).toBeNull();
    expect(details().getAttribute('aria-expanded')).toBe('false');

    await act(async () => details().click());
    expect(details().getAttribute('aria-expanded')).toBe('true');
    expect(text()).toContain('Actions, signals and KPIs fill in once it finishes');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard/insights');

    await act(async () => details().click());
    expect(text()).not.toContain('Actions, signals and KPIs fill in once it finishes');
  });

  it("says it's queued before the worker starts it, from the job this browser saved", async () => {
    loadTrackingJob.mockReturnValue({ jobId: 'j1', brandId: 'b1', startedAt: 1 });
    getJobStatus.mockResolvedValue(job({ status: 'waiting' }));
    await render();
    expect(getJobStatus).toHaveBeenCalledWith('j1');
    expect(text()).toContain('First tracking queued');
    await act(async () => details().click());
    expect(text()).toContain('Yours starts the moment a slot opens');
  });

  it("shows the saved job's progress while it runs", async () => {
    getTrackingWindow.mockResolvedValue(
      win({ activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'manual' } }),
    );
    loadTrackingJob.mockReturnValue({ jobId: 'j1', brandId: 'b1', startedAt: 1 });
    getJobStatus.mockResolvedValue(job({ progress: { current: 12, total: 40 } }));
    await render();
    // Checks, not answers: a task can end without one.
    expect(text()).toContain('First tracking running · 12 of 40 checks');
  });

  it('reads again every 12 seconds, and says about how long is left once the pace shows', async () => {
    getTrackingWindow.mockResolvedValue(
      win({ activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'manual' } }),
    );
    loadTrackingJob.mockReturnValue({ jobId: 'j1', brandId: 'b1', startedAt: 1 });
    let reads = 0;
    getJobStatus.mockImplementation(async () =>
      job({ progress: { current: 12 + 4 * reads++, total: 400 } }),
    );
    await render();
    expect(text()).toContain('12 of 400 checks');
    expect(text()).not.toContain('left');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(getTrackingWindow).toHaveBeenCalledTimes(2);

    // A minute in: 20 checks done, 368 to go at that pace, about 18 min.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(48_000);
    });
    expect(text()).toContain('32 of 400 checks · ~20 min left');
  });

  it('reads once for every line on the page', async () => {
    getTrackingWindow.mockResolvedValue(
      win({ activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'manual' } }),
    );
    loadTrackingJob.mockReturnValue({ jobId: 'j1', brandId: 'b1', startedAt: 1 });
    getJobStatus.mockResolvedValue(job({ progress: { current: 12, total: 40 } }));
    await render(2);
    expect(text()).toBe(
      'First tracking running · 12 of 40 checksDetailsFirst tracking running · 12 of 40 checksDetails',
    );
    expect(getTrackingWindow).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(getTrackingWindow).toHaveBeenCalledTimes(2);
  });

  it('shows nothing once the brand has a completed run, and stops reading', async () => {
    getTrackingWindow.mockResolvedValue(
      win({
        lastRunAt: '2026-10-19T09:00:00Z',
        activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'cron' },
      }),
    );
    await render();
    expect(text()).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(getTrackingWindow).toHaveBeenCalledTimes(1);
  });

  it("ignores another brand's saved job, and one that failed", async () => {
    loadTrackingJob.mockReturnValue({ jobId: 'j1', brandId: 'b2', startedAt: 1 });
    await render();
    expect(text()).toBe('');
    expect(getJobStatus).not.toHaveBeenCalled();

    loadTrackingJob.mockReturnValue({ jobId: 'j2', brandId: 'b1', startedAt: 1 });
    getJobStatus.mockResolvedValue(job({ status: 'failed', failedReason: 'boom' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getJobStatus).toHaveBeenCalledWith('j2');
    expect(text()).toBe('');
  });

  it('keeps the note through a failed read, and goes when the first run is done', async () => {
    getTrackingWindow.mockResolvedValueOnce(
      win({ activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'manual' } }),
    );
    await render();
    expect(text()).toContain('First tracking running');

    // One read each: the line reads again every 12 seconds.
    getTrackingWindow.mockRejectedValueOnce(new Error('timeout'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(text()).toContain('First tracking running');

    getTrackingWindow.mockResolvedValueOnce(win({ lastRunAt: '2026-10-20T09:40:00Z' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(text()).toBe('');
  });
});
