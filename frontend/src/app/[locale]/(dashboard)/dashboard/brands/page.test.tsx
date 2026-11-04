import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

const profile = vi.hoisted(() => ({ organization_id: 'org-1', role: 'admin' }));
const brands = vi.hoisted(() => ({
  list: [] as { id: string; isDemo?: boolean; demoHiddenAt?: string | null }[],
  /** The organization's brands the plan counts (org_brand_count); by default the listed ones. */
  counted: null as number | null,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ single: async () => ({ data: profile }) }) }),
    rpc: async () => ({
      data: brands.counted ?? brands.list.filter((b) => !b.isDemo).length,
      error: null,
    }),
  }),
}));
vi.mock('@/lib/actions/brand', () => ({ getBrands: async () => brands.list }));
vi.mock('@/lib/guards/planGuard', () => ({
  getOrgPlan: async () => ({ limits: { maxBrands: 2 } }),
}));
const cloud = vi.hoisted(() => ({ on: false }));
// Partial, so modules the page reaches (e.g. the trial's Start my plan now) still get the rest.
vi.mock('@/config/plans', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPlan: () => ({ limits: { maxBrands: 2 } }),
  isCloud: () => cloud.on,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The list and the menu beside the button have their own tests.
const listed = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('./_BrandsClient', () => ({
  BrandsClient: ({ brands }: { brands: { id: string }[] }) => {
    listed.ids = brands.map((b) => b.id);
    return null;
  },
}));
vi.mock('@/components/layout/WorkspaceSettingsMenu', () => ({
  WorkspaceSettingsMenu: () => null,
}));

import BrandsPage from './page';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked = false) {
  const ui = await BrandsPage();
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          {ui}
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    ),
  );
}
const links = () => [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  profile.role = 'admin';
  brands.list = [];
  brands.counted = null;
  cloud.on = false;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// brands: admin/manager insert — the others would fail on the wizard's first step.
describe('the brands page', () => {
  it.each(['admin', 'manager'])('offers Add Brand to an %s', async (role) => {
    profile.role = role;
    await render();
    expect(links()).toEqual(['/dashboard/brands/new']);
  });

  it('adds no brand on a read-only workspace: Add Brand opens the upgrade dialog', async () => {
    openUpgrade.mockReset();
    await render(true);
    const add = container.querySelector<HTMLAnchorElement>('a[href="/dashboard/brands/new"]')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => add.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Adding brands needs a plan');
  });

  it('follows Add Brand on an active plan', async () => {
    openUpgrade.mockReset();
    await render();
    const add = container.querySelector<HTMLAnchorElement>('a[href="/dashboard/brands/new"]')!;
    // jsdom can't follow a link: whether the page let the click through is
    // read once it has bubbled past React's handler, then the link is stopped.
    let prevented: boolean | undefined;
    const seen = (e: Event) => {
      prevented = e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener('click', seen);
    await act(async () =>
      add.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    );
    document.removeEventListener('click', seen);
    expect(prevented).toBe(false);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it.each(['analyst', 'agency_partner'])('offers no Add Brand to an %s', async (role) => {
    profile.role = role;
    await render();
    expect(links()).toEqual([]);
  });

  it("sends a manager at the plan's limit to the upgrade, and no one else", async () => {
    brands.list = [{ id: 'b1' }, { id: 'b2' }];
    cloud.on = true;
    profile.role = 'manager';
    await render();
    expect(links()).toEqual(['/dashboard/settings?tab=billing']);

    act(() => root.unmount());
    root = createRoot(container);
    profile.role = 'analyst';
    await render();
    expect(links()).toEqual([]);
  });

  it("opens the upgrade dialog from Add Brand at the plan's limit on a read-only workspace", async () => {
    openUpgrade.mockReset();
    brands.list = [{ id: 'b1' }, { id: 'b2' }];
    cloud.on = true;
    await render(true);
    const add = container.querySelector<HTMLAnchorElement>(
      'a[href="/dashboard/settings?tab=billing"]',
    )!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => add.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Adding brands needs a plan');
  });
});

describe('the brands page and brand access', () => {
  it('counts every brand of the organization toward the plan, not only the ones shown (00390)', async () => {
    // A Selected-brands manager sees one brand; the organization has two.
    brands.list = [{ id: 'b1' }];
    brands.counted = 2;
    cloud.on = true;
    profile.role = 'manager';
    await render();
    expect(links()).toEqual(['/dashboard/settings?tab=billing']);
    expect(listed.ids).toEqual(['b1']);
  });
});

describe('the brands page and the demo brand', () => {
  it("doesn't count the demo brand toward the plan's brands", async () => {
    brands.list = [{ id: 'b1' }, { id: 'demo', isDemo: true, demoHiddenAt: null }];
    cloud.on = true;
    await render();
    expect(links()).toEqual(['/dashboard/brands/new']);
    expect(listed.ids).toEqual(['b1', 'demo']);
  });

  it('leaves a hidden demo brand out of the list', async () => {
    brands.list = [
      { id: 'b1' },
      { id: 'demo', isDemo: true, demoHiddenAt: '2026-10-28T00:00:00Z' },
    ];
    await render();
    expect(listed.ids).toEqual(['b1']);
  });
});
