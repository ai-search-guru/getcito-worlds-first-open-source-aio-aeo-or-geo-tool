import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Getting started's explore steps are done when their page is opened. The
 * layout asks the server once per brand and step, until it records it.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const { markGettingStartedPageOpened, nav } = vi.hoisted(() => ({
  markGettingStartedPageOpened: vi.fn(),
  nav: { pathname: '/dashboard/mentions', brandId: 'b1' as string | null, isDemo: false },
}));

vi.mock('@/i18n/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (
    selector: (state: {
      activeBrandId: string | null;
      brands: { id: string; isDemo?: boolean }[];
    }) => unknown,
  ) =>
    selector({
      activeBrandId: nav.brandId,
      brands: nav.brandId ? [{ id: nav.brandId, isDemo: nav.isDemo }] : [],
    }),
}));
vi.mock('@/lib/actions/gettingStarted', () => ({ markGettingStartedPageOpened }));

const { GettingStartedPageOpened } = await import('./PageOpened');
const { UpgradeDialogContext } = await import('@/components/context/upgradeGate');

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

let container: HTMLDivElement;
let root: Root;

async function render(isLocked = false) {
  await act(async () =>
    root.render(
      <UpgradeDialogContext.Provider
        value={{ isLocked, reason: 'ended', adminName: null, openUpgrade: vi.fn() }}
      >
        <GettingStartedPageOpened />
      </UpgradeDialogContext.Provider>,
    ),
  );
}

beforeEach(() => {
  localStorage.clear();
  markGettingStartedPageOpened.mockReset();
  nav.pathname = '/dashboard/mentions';
  nav.brandId = 'b1';
  nav.isDemo = false;
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('GettingStartedPageOpened', () => {
  it('records an explore page once, then remembers it in this browser', async () => {
    markGettingStartedPageOpened.mockResolvedValue({ ok: true, recorded: true });
    await render();
    expect(markGettingStartedPageOpened).toHaveBeenCalledWith('b1', 'mentions');
    expect(localStorage.getItem('aeo:getting-started:b1:mentions')).toBe('1');

    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(markGettingStartedPageOpened).toHaveBeenCalledTimes(1);
  });

  it('asks again next time when the server did not record it (no answers yet)', async () => {
    markGettingStartedPageOpened.mockResolvedValue({ ok: true, recorded: false });
    await render();
    expect(localStorage.getItem('aeo:getting-started:b1:mentions')).toBeNull();
  });

  it('records nothing while the workspace is read-only (plan not active): it writes', async () => {
    await render(true);
    expect(markGettingStartedPageOpened).not.toHaveBeenCalled();
  });

  it('leaves other pages, and a missing brand, alone', async () => {
    nav.pathname = '/dashboard/action-center/actions';
    await render();
    nav.pathname = '/dashboard/mentions';
    nav.brandId = null;
    await render();
    expect(markGettingStartedPageOpened).not.toHaveBeenCalled();
  });

  it('asks nothing for the demo brand, whose sample data keeps no steps', async () => {
    nav.isDemo = true;
    await render();
    expect(markGettingStartedPageOpened).not.toHaveBeenCalled();
  });

  it('keeps the page working when the server call fails', async () => {
    markGettingStartedPageOpened.mockResolvedValue({ ok: false, failure: 'failed' });
    await render();
    expect(localStorage.getItem('aeo:getting-started:b1:mentions')).toBeNull();
    markGettingStartedPageOpened.mockRejectedValue(new Error('offline'));
    await render();
    expect(localStorage.getItem('aeo:getting-started:b1:mentions')).toBeNull();
  });
});
