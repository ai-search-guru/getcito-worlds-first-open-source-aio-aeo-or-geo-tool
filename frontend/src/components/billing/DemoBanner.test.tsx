import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { Brand } from '@/types';

/**
 * The demo brand's band: what the brand on screen is, and the way to the same
 * for the workspace's own brand. Only on the demo brand, and alone there.
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

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  usePathname: () => '/dashboard/action-center',
  useRouter: () => ({ push: vi.fn(), refresh }),
}));
const ensureDemoBrand = vi.fn();
vi.mock('@/lib/demo/demoClient', () => ({
  ensureDemoBrand: () => ensureDemoBrand(),
  prepareDemoBrand: vi.fn(async () => ({ ok: false, status: 0 })),
  demoPreparation: () => null,
}));

const { PlanProvider } = await import('@/components/context/PlanProvider');
const { RoleProvider } = await import('@/components/context/RoleProvider');
const { DemoBrandProvider } = await import('@/components/context/DemoBrandProvider');
const { UpgradeDialogProvider } = await import('@/components/context/UpgradeDialogProvider');
const { useBrandStore } = await import('@/state/useBrandStore');
const { ReadOnlyBanner } = await import('./ReadOnlyBanner');
const { DemoBanner, resetDemoFreshness } = await import('./DemoBanner');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function brand(id: string, isDemo = false): Brand {
  return {
    id,
    organizationId: 'org1',
    name: isDemo ? 'Brewline Coffee' : 'Acme Coffee',
    slug: id,
    shoppingModeEnabled: false,
    isActive: true,
    isDemo,
    domains: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

async function render({
  selected = 'demo',
  active = false,
  status = null,
  everSubscribed = false,
  ownBrand = true,
}: {
  selected?: 'own' | 'demo';
  active?: boolean;
  status?: string | null;
  everSubscribed?: boolean;
  /** The workspace has its own brand besides the demo. */
  ownBrand?: boolean;
} = {}) {
  useBrandStore.setState({
    brands: ownBrand ? [brand('own'), brand('demo', true)] : [brand('demo', true)],
    activeBrandId: selected,
    loaded: true,
  });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanProvider planId="starter" subscriptionActive={active} subscriptionStatus={status}>
          <RoleProvider role="admin">
            <DemoBrandProvider everSubscribed={everSubscribed}>
              <UpgradeDialogProvider>
                <ReadOnlyBanner />
                <DemoBanner />
              </UpgradeDialogProvider>
            </DemoBrandProvider>
          </RoleProvider>
        </PlanProvider>
      </NextIntlClientProvider>,
    );
  });
}

const bands = () => container.querySelectorAll('[role="status"]');
const band = () => container.querySelector('[data-slot="demo-band"]');
const bandButton = () => band()?.querySelector('button');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ valid: false })),
  );
  ensureDemoBrand.mockResolvedValue({ ok: true, brandId: 'demo', version: 1, rebuilt: false });
  resetDemoFreshness();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('DemoBanner', () => {
  it('says the brand is a demo, alone, and offers the trial to a new workspace for its own brand', async () => {
    await render();
    expect(bands()).toHaveLength(1);
    expect(band()?.textContent).toContain(
      "You're exploring Brewline Coffee, a demo brand with sample data. Start tracking Acme Coffee with a 14-day free trial, or get 50% off your first month.",
    );
    expect(band()?.textContent).not.toContain('then 50% off');
    expect([...band()!.querySelectorAll('strong')].map((b) => b.textContent)).toEqual([
      'Brewline Coffee',
      'Acme Coffee',
    ]);
    expect(bandButton()?.textContent).toBe('See plans');
    await act(async () => {
      bandButton()!.click();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Use GetCito for Acme Coffee',
    );
  });

  it('says it generally before the workspace has a brand of its own', async () => {
    await render({ ownBrand: false });
    expect(band()?.textContent).toContain(
      "You're exploring Brewline Coffee, a demo brand with sample data. Start a 14-day free trial, or get 50% off your first month.",
    );
    await act(async () => {
      bandButton()!.click();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Use GetCito for your own brand',
    );
  });

  it('offers 50% off the first month once the plan ended, and no trial', async () => {
    await render({ status: 'canceled', everSubscribed: true });
    expect(bands()).toHaveLength(1);
    expect(band()?.textContent).toContain(
      'a demo brand with sample data. Get 50% off your first month of tracking Acme Coffee.',
    );
    expect(band()?.textContent).not.toContain('trial');
    expect(bandButton()?.textContent).toBe('See plans');
  });

  it('says only the trial, or neither, with the first-month offer off', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIRST_MONTH_OFFER', 'off');
    await render();
    expect(band()?.textContent).toContain(
      'sample data. Start tracking Acme Coffee with a 14-day free trial.',
    );
    expect(band()?.textContent).not.toContain('50%');
    await render({ status: 'canceled', everSubscribed: true });
    expect(band()?.textContent).toContain('sample data. Pick a plan to track Acme Coffee.');
    await render({ status: 'canceled', everSubscribed: true, ownBrand: false });
    expect(band()?.textContent).toContain('sample data. Pick a plan to use it for your own brand.');
  });

  it('points back to the own brand, by name, while the plan is active', async () => {
    await render({ active: true, status: 'active', everSubscribed: true });
    expect(band()?.textContent).toContain('Nothing here runs or uses AI.');
    expect(bandButton()?.textContent).toBe('Switch to Acme Coffee');
    await act(async () => {
      bandButton()!.click();
    });
    expect(useBrandStore.getState().activeBrandId).toBe('own');
    expect(band()).toBeNull();
  });

  it("shows nothing on the workspace's own brand, where the read-only band is", async () => {
    await render({ selected: 'own', status: 'canceled', everSubscribed: true });
    expect(band()).toBeNull();
    expect(bands()).toHaveLength(1);
    expect(bands()[0].textContent).toContain('Your workspace is read-only');
  });

  it('brings the demo up to date once, and reads the pages again when it was rebuilt', async () => {
    ensureDemoBrand.mockResolvedValue({ ok: true, brandId: 'demo', version: 2, rebuilt: true });
    await render();
    expect(ensureDemoBrand).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await render();
    expect(ensureDemoBrand).toHaveBeenCalledTimes(1);
  });

  it('keeps quiet when the demo could not be brought up to date', async () => {
    ensureDemoBrand.mockResolvedValue({ ok: false, status: 403 });
    await render();
    expect(refresh).not.toHaveBeenCalled();
    expect(band()).not.toBeNull();
  });
});
