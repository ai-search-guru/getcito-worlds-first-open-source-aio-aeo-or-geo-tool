import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import type { Brand } from '@/types';

/**
 * Explore the demo / See the demo: the demo brand made or brought up to
 * date, shown again if hidden, selected, and opened on the Action Center.
 */

// An in-memory localStorage for the brand store, before it loads: the test environment has none.
vi.hoisted(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, String(value)),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
});

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => router }));
const demoClient = vi.hoisted(() => ({
  prepareDemoBrand: vi.fn(),
  setDemoHidden: vi.fn(),
  demoPreparation: vi.fn((): { startedAt: number; answered: boolean } | null => null),
}));
vi.mock('@/lib/demo/demoClient', () => demoClient);
const getBrandById = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/brand', () => ({ getBrandById }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

const { useExploreDemo, usePreloadDemo } = await import('./useExploreDemo');
const { DemoSetupDialog } = await import('@/components/demo/DemoSetupDialog');
const { useBrandStore } = await import('@/state/useBrandStore');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function brand(id: string, extra: Partial<Brand> = {}): Brand {
  return {
    id,
    organizationId: 'org1',
    name: id,
    slug: id,
    shoppingModeEnabled: false,
    isActive: true,
    domains: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...extra,
  };
}

function Probe() {
  const { explore, opening, setupDialog } = useExploreDemo();
  return (
    <>
      <button type="button" data-opening={String(opening)} onClick={() => void explore()}>
        Explore
      </button>
      <DemoSetupDialog {...setupDialog} />
    </>
  );
}

async function clickExplore() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Probe />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => container.querySelector('button')!.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  demoClient.demoPreparation.mockReturnValue(null);
  useBrandStore.setState({ brands: [brand('own')], activeBrandId: 'own' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  container.remove();
});

describe('useExploreDemo', () => {
  it('makes the demo brand, lists it, selects it and opens the Action Center', async () => {
    const demo = brand('demo', { isDemo: true, name: 'Brewline Coffee' });
    demoClient.prepareDemoBrand.mockResolvedValue({
      ok: true,
      brandId: 'demo',
      version: 1,
      rebuilt: true,
    });
    getBrandById.mockResolvedValue(demo);
    await clickExplore();
    expect(getBrandById).toHaveBeenCalledWith('demo');
    expect(useBrandStore.getState().brands.map((b) => b.id)).toEqual(['own', 'demo']);
    expect(useBrandStore.getState().activeBrandId).toBe('demo');
    expect(router.push).toHaveBeenCalledWith('/dashboard/action-center');
    expect(router.refresh).toHaveBeenCalled();
    expect(demoClient.setDemoHidden).not.toHaveBeenCalled();
  });

  it('shows a hidden demo brand again first', async () => {
    const demo = brand('demo', { isDemo: true, demoHiddenAt: '2026-10-20T00:00:00Z' });
    demoClient.prepareDemoBrand.mockResolvedValue({ ok: true, brandId: 'demo', version: 1 });
    getBrandById.mockResolvedValue(demo);
    demoClient.setDemoHidden.mockResolvedValue({ ok: true, brandId: 'demo', hidden: false });
    await clickExplore();
    expect(demoClient.setDemoHidden).toHaveBeenCalledWith(false);
    expect(useBrandStore.getState().brands.find((b) => b.id === 'demo')?.demoHiddenAt).toBeNull();
    expect(useBrandStore.getState().activeBrandId).toBe('demo');
  });

  it('opens a demo brand already listed when the API refuses the call', async () => {
    useBrandStore.setState({
      brands: [brand('own'), brand('demo', { isDemo: true })],
      activeBrandId: 'own',
    });
    demoClient.prepareDemoBrand.mockResolvedValue({ ok: false, status: 403 });
    await clickExplore();
    expect(getBrandById).not.toHaveBeenCalled();
    expect(useBrandStore.getState().activeBrandId).toBe('demo');
    expect(router.push).toHaveBeenCalledWith('/dashboard/action-center');
  });

  it('says so, and stays, when there is no demo brand to open', async () => {
    demoClient.prepareDemoBrand.mockResolvedValue({ ok: false, status: 500 });
    await clickExplore();
    expect(toastError).toHaveBeenCalledWith("Couldn't open the demo brand. Try again.");
    expect(useBrandStore.getState().activeBrandId).toBe('own');
    expect(router.push).not.toHaveBeenCalled();
    expect(container.querySelector('button')!.dataset.opening).toBe('false');
  });
});

describe('useExploreDemo while the demo is still being prepared', () => {
  /** A setup asked `ago` ms before the click, its answer held until `answer` is called. */
  function preparing(ago: number) {
    let answer: (value: unknown) => void = () => {};
    demoClient.prepareDemoBrand.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    demoClient.demoPreparation.mockReturnValue({ startedAt: Date.now() - ago, answered: false });
    return (value: unknown) => act(async () => answer(value));
  }
  const step = (key: string) =>
    document.body.querySelector<HTMLElement>(`[data-step="${key}"]`)?.dataset.state;
  const dialogText = () => document.body.querySelector('[data-slot="dialog-content"]')?.textContent;

  it('shows the setup screen from where it stands, then opens the demo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    const answer = preparing(2500);
    getBrandById.mockResolvedValue(brand('demo', { isDemo: true }));
    await clickExplore();
    expect(dialogText()).toContain('Preparing your demo');
    // Asked 2.5 s ago (on an earlier onboarding step): the brand is set up.
    expect(step('brand')).toBe('done');
    expect(step('answers')).toBe('now');
    expect(step('reports')).toBe('next');
    await advance(2000);
    expect(step('answers')).toBe('done');
    expect(step('citations')).toBe('now');
    expect(router.push).not.toHaveBeenCalled();

    await answer({ ok: true, brandId: 'demo', version: 3, rebuilt: true });
    // The steps left run through first, quickly.
    await advance(300);
    expect(router.push).not.toHaveBeenCalled();
    expect(step('mentions')).toBe('done');
    expect(step('reports')).not.toBe('done');
    await advance(600);
    // Everything done a moment, then the demo opens.
    expect(step('reports')).toBe('done');
    expect(dialogText()).toContain('Ready. Opening the Action Center…');
    expect(router.push).not.toHaveBeenCalled();
    await advance(600);
    expect(router.push).toHaveBeenCalledWith('/dashboard/action-center');
    expect(useBrandStore.getState().activeBrandId).toBe('demo');
    vi.useRealTimers();
    await vi.waitFor(() => expect(dialogText()).toBeUndefined());
  });

  it('says a failure in the screen, and tries again from it', async () => {
    const answer = preparing(60_000);
    await clickExplore();
    await answer({ ok: false, status: 500 });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't prepare the demo. Check your connection and try again.",
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(container.querySelector('button')!.dataset.opening).toBe('false');

    preparing(0);
    const retry = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    )!;
    await act(async () => retry.click());
    expect(demoClient.prepareDemoBrand).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    expect(step('brand')).toBe('now');
  });

  it('closes on Close, and a setup answering later opens nothing', async () => {
    const answer = preparing(60_000);
    await clickExplore();
    await answer({ ok: false, status: 500 });
    const close = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Close',
    )!;
    await act(async () => close.click());
    await vi.waitFor(() => expect(dialogText()).toBeUndefined());
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens at once, without the screen, when the setup asked ahead is done', async () => {
    demoClient.prepareDemoBrand.mockResolvedValue({ ok: true, brandId: 'demo', version: 3 });
    demoClient.demoPreparation.mockReturnValue({ startedAt: Date.now() - 20_000, answered: true });
    getBrandById.mockResolvedValue(brand('demo', { isDemo: true }));
    await clickExplore();
    expect(dialogText()).toBeUndefined();
    expect(router.push).toHaveBeenCalledWith('/dashboard/action-center');
  });
});

describe('usePreloadDemo', () => {
  function Preload({ enabled }: { enabled: boolean }) {
    usePreloadDemo(enabled);
    return null;
  }

  it('starts the setup ahead while it is asked to, and not otherwise', async () => {
    demoClient.prepareDemoBrand.mockResolvedValue({ ok: false, status: 0 });
    await act(async () => root.render(<Preload enabled={false} />));
    expect(demoClient.prepareDemoBrand).not.toHaveBeenCalled();
    await act(async () => root.render(<Preload enabled />));
    expect(demoClient.prepareDemoBrand).toHaveBeenCalledTimes(1);
    // A failure says nothing: the click asks again.
    expect(toastError).not.toHaveBeenCalled();
  });

  it('opens the demo with the setup started ahead, asked once', async () => {
    const demo = brand('demo', { isDemo: true });
    demoClient.prepareDemoBrand.mockResolvedValue({
      ok: true,
      brandId: 'demo',
      version: 1,
      rebuilt: false,
    });
    getBrandById.mockResolvedValue(demo);
    await act(async () => root.render(<Preload enabled />));
    await clickExplore();
    expect(useBrandStore.getState().activeBrandId).toBe('demo');
    expect(demoClient.prepareDemoBrand).toHaveBeenCalledTimes(2);
  });
});
