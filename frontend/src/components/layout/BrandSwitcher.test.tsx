import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { BrandSwitcher } from './BrandSwitcher';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { DemoBrandContext, type DemoBrandState } from '@/components/context/DemoBrandProvider';
import { PlanProvider } from '@/components/context/PlanProvider';

const push = vi.fn();
const refresh = vi.fn();
const nav = vi.hoisted(() => ({ pathname: '/dashboard/content' }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => nav.pathname,
  Link: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const brand = (id: string, name: string, isDemo = false) => ({
  id,
  name,
  logoUrl: undefined,
  isActive: true,
  isDemo,
  domains: [
    { id: `${id}-d`, brandId: id, domain: `${name.toLowerCase()}.example`, isPrimary: true },
  ],
});
const store = vi.hoisted(() => ({
  brands: [] as ReturnType<typeof brand>[],
  loaded: true,
  activeBrandId: null as string | null,
  setActiveBrand: vi.fn(),
  addBrand: vi.fn(),
  removeBrand: vi.fn(),
}));
vi.mock('@/state/useBrandStore', () => ({ useBrandStore: () => store }));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => role }));
const setDemoHidden = vi.hoisted(() => vi.fn());
vi.mock('@/lib/demo/demoClient', () => ({ setDemoHidden }));
const getBrandById = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/brand', () => ({ getBrandById }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const onNavigate = vi.fn();
const openUpgrade = vi.fn();

const noDemo: DemoBrandState = {
  isDemo: false,
  demoBrand: null,
  offer: 'first_month',
  neverSubscribed: false,
};

async function render(
  collapsed = false,
  isLocked = false,
  demo: Partial<DemoBrandState> = {},
  subscriptionActive = true,
) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanProvider planId="starter" subscriptionActive={subscriptionActive}>
          <DemoBrandContext.Provider value={{ ...noDemo, ...demo }}>
            <UpgradeDialogContext.Provider
              value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
            >
              <BrandSwitcher collapsed={collapsed} onNavigate={onNavigate} />
            </UpgradeDialogContext.Provider>
          </DemoBrandContext.Provider>
        </PlanProvider>
      </NextIntlClientProvider>,
    ),
  );
}
const trigger = () => container.querySelector<HTMLButtonElement>('[aria-label="Switch brand"]')!;
const settings = () =>
  container.querySelector<HTMLAnchorElement>('[aria-label="Visit Brand Setting"]');
async function openMenu() {
  await act(async () => {
    trigger().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger().click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  store.brands = [brand('b1', 'Acme'), brand('b2', 'Globex')];
  store.activeBrandId = 'b1';
  store.loaded = true;
  push.mockReset();
  onNavigate.mockReset();
  openUpgrade.mockReset();
  store.setActiveBrand.mockReset();
  store.addBrand.mockReset();
  store.removeBrand.mockReset();
  refresh.mockReset();
  setDemoHidden.mockReset();
  getBrandById.mockReset();
  toastError.mockReset();
  nav.pathname = '/dashboard/content';
  role.canManage = true;
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllEnvs();
});

describe('BrandSwitcher', () => {
  it("links the selected brand's settings beside the switcher, not inside it", async () => {
    await render();
    expect(trigger().textContent).toContain('Acme');
    const link = settings()!;
    expect(link.getAttribute('href')).toBe('/dashboard/brands/b1/settings');
    expect(trigger().contains(link)).toBe(false);
    // jsdom can't follow a link: keep the click, not the navigation.
    link.addEventListener('click', (e) => e.preventDefault());
    await act(async () => link.click());
    expect(onNavigate).toHaveBeenCalled();
  });

  it('lists the brands, then all brands and a new one', async () => {
    await render();
    const items = await openMenu();
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain('acme.example');
    expect(items[1].textContent).toContain('globex.example');
    expect(items.slice(2).map((i) => i.textContent?.trim())).toEqual([
      'Show My All Brands',
      'Add Brand',
    ]);
    await act(async () => items[2].click());
    expect(push).toHaveBeenCalledWith('/dashboard/brands');
    expect(onNavigate).toHaveBeenCalled();
  });

  it("switches brands in place, or to the same page of a brand's own pages", async () => {
    await render();
    let items = await openMenu();
    await act(async () => items[1].click());
    expect(store.setActiveBrand).toHaveBeenCalledWith('b2');
    expect(push).not.toHaveBeenCalled();

    act(() => root.unmount());
    document.body.replaceChildren(container);
    root = createRoot(container);
    nav.pathname = '/dashboard/brands/b1/settings';
    await render();
    items = await openMenu();
    await act(async () => items[1].click());
    expect(push).toHaveBeenCalledWith('/dashboard/brands/b2/settings');
  });

  it('adds a brand on its own page', async () => {
    await render();
    const items = await openMenu();
    await act(async () => items[3].click());
    expect(push).toHaveBeenCalledWith('/dashboard/brands/new');
  });

  it('adds no brand on a read-only workspace: Add Brand opens the upgrade dialog', async () => {
    await render(false, true);
    const items = await openMenu();
    await act(async () => items[3].click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Adding brands needs a plan');
    expect(push).not.toHaveBeenCalled();
    // The mobile menu closes first, so the dialog isn't left behind it.
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(onNavigate.mock.invocationCallOrder[0]).toBeLessThan(
      openUpgrade.mock.invocationCallOrder[0],
    );
    // All brands is reading: it stays open.
    await act(async () => (await openMenu())[2].click());
    expect(push).toHaveBeenCalledWith('/dashboard/brands');

    // With no brand yet, the menu is the Add Brand button.
    act(() => root.unmount());
    document.body.replaceChildren(container);
    root = createRoot(container);
    store.brands = [];
    push.mockReset();
    await render(false, true);
    onNavigate.mockReset();
    await act(async () => container.querySelector('button')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Adding brands needs a plan');
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  // brands: admin/manager insert — the others would hit the wizard's first error.
  it('offers Add Brand to admins and managers only', async () => {
    role.canManage = false;
    await render();
    const items = await openMenu();
    expect(items.map((i) => i.textContent?.trim()).slice(2)).toEqual(['Show My All Brands']);

    act(() => root.unmount());
    document.body.replaceChildren(container);
    root = createRoot(container);
    store.brands = [];
    await render();
    expect(container.textContent).toBe('');
  });

  // A new browser: no brand listed yet isn't no brand at all.
  it('offers no Add Brand before the brands are loaded', async () => {
    store.brands = [];
    store.loaded = false;
    await render();
    expect(container.textContent).toBe('');
  });

  it('has no room for the settings link when the sidebar is collapsed', async () => {
    await render(true);
    expect(trigger()).not.toBeNull();
    expect(settings()).toBeNull();
  });
});

describe('BrandSwitcher and the demo brand', () => {
  const labels = (items: HTMLElement[]) => items.map((i) => i.textContent?.trim());

  it('says the demo brand is one with sample data, in place of a domain', async () => {
    store.brands = [brand('b1', 'Acme'), brand('demo', 'Brewline Coffee', true)];
    await render(false, false, { demoBrand: { id: 'demo', hidden: false } });
    const items = await openMenu();
    expect(items[0].textContent).toContain('acme.example');
    expect(items[1].textContent).toContain('Brewline Coffee');
    expect(items[1].textContent).toContain('Demo · sample data');
    expect(items[1].textContent).not.toContain('brewline coffee.example');
  });

  it("says a brand isn't tracked yet in a workspace that never had a plan", async () => {
    store.brands = [brand('b1', 'Acme'), brand('demo', 'Brewline Coffee', true)];
    await render(false, true, { neverSubscribed: true }, false);
    const items = await openMenu();
    expect(items[0].textContent).toContain('Not tracked yet');
    expect(items[0].textContent).not.toContain('acme.example');
    expect(items[1].textContent).toContain('Demo · sample data');
  });

  it('hides the demo brand from the menu, for an admin or a manager', async () => {
    store.brands = [brand('b1', 'Acme'), brand('demo', 'Brewline Coffee', true)];
    store.activeBrandId = 'demo';
    setDemoHidden.mockResolvedValue({ ok: true, brandId: 'demo', hidden: true });
    await render(false, false, { demoBrand: { id: 'demo', hidden: false } });
    const items = await openMenu();
    expect(labels(items).at(-1)).toBe('Hide the demo brand');
    await act(async () => items.at(-1)!.click());
    expect(setDemoHidden).toHaveBeenCalledWith(true);
    expect(store.removeBrand).toHaveBeenCalledWith('demo');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows a hidden demo brand again, and opens it', async () => {
    const demo = brand('demo', 'Brewline Coffee', true);
    setDemoHidden.mockResolvedValue({ ok: true, brandId: 'demo', hidden: false });
    getBrandById.mockResolvedValue(demo);
    await render(false, false, { demoBrand: { id: 'demo', hidden: true } });
    const items = await openMenu();
    expect(labels(items).at(-1)).toBe('Show the demo brand');
    await act(async () => items.at(-1)!.click());
    expect(setDemoHidden).toHaveBeenCalledWith(false);
    expect(store.addBrand).toHaveBeenCalledWith(demo);
    expect(store.setActiveBrand).toHaveBeenCalledWith('demo');
    expect(refresh).toHaveBeenCalled();
  });

  it('says so when the demo brand could not be changed', async () => {
    setDemoHidden.mockResolvedValue({ ok: false, status: 500 });
    await render(false, false, { demoBrand: { id: 'demo', hidden: true } });
    const items = await openMenu();
    await act(async () => items.at(-1)!.click());
    expect(toastError).toHaveBeenCalledWith("Couldn't change the demo brand. Try again.");
    expect(store.addBrand).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('offers neither without a demo brand, nor to other members', async () => {
    await render();
    let items = await openMenu();
    expect(labels(items)).not.toContain('Hide the demo brand');

    act(() => root.unmount());
    document.body.replaceChildren(container);
    root = createRoot(container);
    role.canManage = false;
    await render(false, false, { demoBrand: { id: 'demo', hidden: true } });
    items = await openMenu();
    expect(labels(items)).not.toContain('Show the demo brand');
  });
});
