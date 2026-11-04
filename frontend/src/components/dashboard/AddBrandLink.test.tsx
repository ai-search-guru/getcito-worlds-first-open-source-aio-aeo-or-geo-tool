import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * The links to a new brand that AddBrandLink makes: the brands page's empty
 * state and the dashboard's "No brands yet". On a read-only workspace (plan
 * not active) they open the upgrade dialog instead of the new brand's page.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard/content',
  Link: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const store = vi.hoisted(() => ({
  brands: [] as unknown[],
  activeBrandId: null,
  loaded: true,
  setActiveBrand: vi.fn(),
  setBrands: vi.fn(),
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (select?: (state: typeof store) => unknown) => (select ? select(store) : store),
}));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ canManage: true }) }));

const { BrandsClient } = await import('@/app/[locale]/(dashboard)/dashboard/brands/_BrandsClient');
const { BrandGuard } = await import('@/components/context/BrandGuard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(ui: React.ReactNode, isLocked: boolean) {
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

/** Clicks the new brand's link; true when the page let it through. */
async function followAddBrand() {
  const link = container.querySelector<HTMLAnchorElement>('a[href="/dashboard/brands/new"]')!;
  // Read once the click has bubbled past React's handler; jsdom can't follow it.
  let followed = false;
  const seen = (e: Event) => {
    followed = !e.defaultPrevented;
    e.preventDefault();
  };
  document.addEventListener('click', seen);
  await act(async () =>
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
  );
  document.removeEventListener('click', seen);
  return followed;
}

describe.each([
  ['the brands page with no brand', () => <BrandsClient brands={[]} />],
  [
    "the dashboard's No brands yet",
    () => (
      <BrandGuard>
        <p>page</p>
      </BrandGuard>
    ),
  ],
])('Add Brand on %s', (_name, ui) => {
  it('opens the upgrade dialog, not the new brand page, on a read-only workspace', async () => {
    await render(ui(), true);
    expect(await followAddBrand()).toBe(false);
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Adding brands needs a plan');
  });

  it('goes to the new brand page on an active plan', async () => {
    await render(ui(), false);
    expect(await followAddBrand()).toBe(true);
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
