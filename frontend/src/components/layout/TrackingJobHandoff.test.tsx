import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The payment lands on the Action Center with the first tracking run's id;
 * it is kept for Visibility's progress bar and taken out of the address.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const { saveTrackingJob, nav } = vi.hoisted(() => ({
  saveTrackingJob: vi.fn(),
  nav: { pathname: '/dashboard/action-center/actions', brandId: 'b1' as string | null },
}));

vi.mock('@/i18n/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: { activeBrandId: string | null }) => unknown) =>
    selector({ activeBrandId: nav.brandId }),
}));
vi.mock('@/lib/trackingJobStore', () => ({ saveTrackingJob }));

const { TrackingJobHandoff } = await import('./TrackingJobHandoff');

let root: Root;

async function render() {
  await act(async () => root.render(<TrackingJobHandoff />));
}

beforeEach(() => {
  saveTrackingJob.mockReset();
  nav.pathname = '/dashboard/action-center/actions';
  nav.brandId = 'b1';
  window.history.replaceState(null, '', '/dashboard/action-center/actions?jobId=j1&x=1');
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
});

describe('TrackingJobHandoff', () => {
  it("keeps the run's id for Visibility and takes it out of the address", async () => {
    await render();
    expect(saveTrackingJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'j1', brandId: 'b1' }),
    );
    expect(window.location.search).toBe('?x=1');
  });

  it('waits for the brand', async () => {
    nav.brandId = null;
    await render();
    expect(saveTrackingJob).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?jobId=j1&x=1');
  });

  it('leaves Visibility, which reads the id itself, alone', async () => {
    nav.pathname = '/dashboard/insights';
    await render();
    expect(saveTrackingJob).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?jobId=j1&x=1');
  });

  it('does nothing without an id', async () => {
    window.history.replaceState(null, '', '/dashboard/action-center/actions');
    await render();
    expect(saveTrackingJob).not.toHaveBeenCalled();
  });
});
