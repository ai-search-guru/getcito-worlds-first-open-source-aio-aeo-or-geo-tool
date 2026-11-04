import { Suspense } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brand } from '@/types';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const brand: Brand = {
  id: 'brand-id',
  organizationId: 'organization-id',
  name: 'Acme',
  slug: 'acme',
  industry: 'Technology',
  region: 'US',
  state: 'CA',
  shoppingModeEnabled: false,
  isActive: true,
  domains: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const translations: Record<string, string> = {
  'settings.region': 'Translated Region',
  'settings.stateOptional': 'Translated State',
  'settings.nationwide': 'Translated Nationwide',
  'settings.stateHint': 'Translated state hint',
};

vi.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign((key: string) => translations[key] ?? key, {
      rich: (key: string) => translations[key] ?? key,
    }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: () => ({
    brands: [brand],
    updateBrand: vi.fn(),
    removeBrand: vi.fn(),
  }),
}));

const role = vi.hoisted(() => ({ canAdmin: true, canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => role,
}));

// Whether the plan has the Shopping page (ChatGPT Shopping is tracked).
const plan = vi.hoisted(() => ({ shopping: true }));
vi.mock('@/hooks/useFeatureGate', () => ({
  useFeatureGate: () => ({
    canUse: (feature: string) => feature !== 'shopping_analytics' || plan.shopping,
    requiredPlanFor: () => 'Growth',
  }),
}));

const setBrandShoppingMode = vi.hoisted(() => vi.fn());
const updateBrand = vi.hoisted(() => vi.fn());
const deleteBrand = vi.hoisted(() => vi.fn());
const setBrandActive = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/brand', () => ({
  deleteBrand,
  setBrandActive,
  setBrandShoppingMode,
  updateBrand,
}));

vi.mock('@/lib/actions/brandDomain', () => ({
  syncDomains: vi.fn(),
}));

const getCompetitors = vi.hoisted(() => vi.fn());
const addCompetitor = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/competitor', () => ({
  addCompetitor,
  deleteCompetitor: vi.fn(),
  getCompetitors: (...args: unknown[]) => getCompetitors(...args),
}));

vi.mock('@/config/api', () => ({
  getPublicApiBaseUrl: () => null,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Brand facts are _BrandFactsTab.test.tsx's; here, when the tab is there.
vi.mock('./_BrandFactsTab', () => ({
  BrandFactsTab: ({ brandId }: { brandId: string }) => <p data-testid="brand-facts">{brandId}</p>,
}));

// The client logo is _ClientLogoCard.test.tsx's.
vi.mock('./_ClientLogoCard', () => ({ ClientLogoCard: () => null }));

import BrandSettingsPage from './page';

afterEach(() => {
  brand.state = 'CA';
  brand.industry = 'Technology';
  brand.siteType = undefined;
  updateBrand.mockReset();
  Object.assign(role, { canAdmin: true, canManage: true });
  setBrandShoppingMode.mockReset();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('brand settings location selects', () => {
  it('shows translated labels instead of stored codes', async () => {
    const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Suspense>
          <BrandSettingsPage params={Promise.resolve({ id: brand.id })} />
        </Suspense>,
      );
    });

    const values = Array.from(container.querySelectorAll('[data-slot="select-value"]'));

    expect(values.map((value) => value.textContent)).toEqual([
      'Technology',
      'siteTypes.b2b',
      'United States',
      'California',
    ]);
    expect(container.textContent).toContain('Translated Region');
    expect(container.textContent).toContain('Translated State');
    expect(container.textContent).toContain('Translated state hint');
    expect(consoleWarning).not.toHaveBeenCalledWith(expect.stringContaining('[ui/select]'));

    await act(async () => root.unmount());
  });

  it('shows the translated nationwide label when no state is selected', async () => {
    brand.state = undefined;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Suspense>
          <BrandSettingsPage params={Promise.resolve({ id: brand.id })} />
        </Suspense>,
      );
    });

    const values = Array.from(container.querySelectorAll('[data-slot="select-value"]'));

    expect(values[3]?.textContent).toBe('Translated Nationwide');

    await act(async () => root.unmount());
  });
});

describe('brand settings site type', () => {
  async function render() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Suspense>
          <BrandSettingsPage params={Promise.resolve({ id: brand.id })} />
        </Suspense>,
      );
    });
    const siteType = container.querySelector('#site-type [data-slot="select-value"]');
    return { container, root, siteType };
  }

  it('shows the guess from the industry until one is picked, and saves no guess', async () => {
    brand.industry = 'Travel & Hospitality';
    updateBrand.mockResolvedValue({ ...brand });
    const { container, root, siteType } = await render();
    expect(siteType?.textContent).toBe('siteTypes.b2c');
    expect(container.textContent).toContain('settings.siteTypeGuessed');

    const save = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'settings.saveChanges',
    )!;
    await act(async () => save.click());
    expect(updateBrand).toHaveBeenCalledWith(
      brand.id,
      expect.not.objectContaining({ siteType: expect.anything() }),
    );
    await act(async () => root.unmount());
  });

  it('shows the site type the brand chose, with no word of a guess', async () => {
    brand.siteType = 'ecommerce';
    const { container, root, siteType } = await render();
    expect(siteType?.textContent).toBe('siteTypes.ecommerce');
    expect(container.textContent).toContain('settings.siteTypeHint');
    expect(container.textContent).not.toContain('settings.siteTypeGuessed');
    await act(async () => root.unmount());
  });

  it('shows Mobile app when the brand chose it', async () => {
    brand.siteType = 'app';
    const { container, root, siteType } = await render();
    expect(siteType?.textContent).toBe('siteTypes.app');
    expect(container.textContent).not.toContain('settings.siteTypeGuessed');
    await act(async () => root.unmount());
  });
});

describe('brand settings Shopping mode', () => {
  async function render() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Suspense>
          <BrandSettingsPage params={Promise.resolve({ id: brand.id })} />
        </Suspense>,
      );
    });
    const checkbox = container.querySelector('#shopping-mode') as HTMLElement;
    return { container, root, checkbox };
  }

  it('lets a manager turn it on, as the brand and prompt writes allow', async () => {
    Object.assign(role, { canAdmin: false, canManage: true });
    setBrandShoppingMode.mockResolvedValue({ promptsUpdated: 3 });
    const { container, root, checkbox } = await render();

    expect(checkbox.hasAttribute('data-disabled')).toBe(false);
    expect(container.textContent).not.toContain('settings.shopping.managersOnly');
    await act(async () => checkbox.click());
    expect(setBrandShoppingMode).toHaveBeenCalledWith(brand.id, true);

    await act(async () => root.unmount());
  });

  it('says ChatGPT Shopping comes with Growth on a plan that does not track it', async () => {
    Object.assign(role, { canAdmin: true, canManage: true });
    plan.shopping = false;
    const { container, root } = await render();
    expect(container.textContent).toContain('settings.shopping.planNote');
    await act(async () => root.unmount());

    plan.shopping = true;
    const again = await render();
    expect(again.container.textContent).not.toContain('settings.shopping.planNote');
    await act(async () => again.root.unmount());
  });

  it('shows anyone else the setting without letting them change it', async () => {
    Object.assign(role, { canAdmin: false, canManage: false });
    const { container, root, checkbox } = await render();

    expect(checkbox.hasAttribute('data-disabled')).toBe(true);
    expect(container.textContent).toContain('settings.shopping.managersOnly');
    await act(async () => checkbox.click());
    expect(setBrandShoppingMode).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });
});

// The brand's writes follow its RLS: brands and brand_domains update and
// competitors writes for admins and managers, and a brand's delete for admins
// (the server's rule). The others read the settings, with a note.
describe('brand settings role gates', () => {
  // afterEach's restoreAllMocks clears the read the Competitors tab makes.
  beforeEach(() => getCompetitors.mockResolvedValue([]));

  async function render() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Suspense>
          <BrandSettingsPage params={Promise.resolve({ id: brand.id })} />
        </Suspense>,
      );
    });
    const openTab = async (name: string) => {
      const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
        (el) => el.textContent?.trim() === name,
      )!;
      await act(async () => {
        tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        tab.click();
      });
    };
    // The shown panel's fieldset: the hidden ones may stay mounted.
    const fieldset = () =>
      container.querySelector<HTMLFieldSetElement>('[role="tabpanel"]:not([hidden]) fieldset')!;
    return { container, root, openTab, fieldset };
  }

  it('lets an analyst read the brand, not change or delete it', async () => {
    Object.assign(role, { canAdmin: false, canManage: false });
    const { container, root, openTab, fieldset } = await render();

    expect(fieldset().disabled).toBe(true);
    expect(container.textContent).toContain('settings.managersOnlyEdit');
    for (const tab of ['settings.domainsTab', 'Competitors']) {
      await openTab(tab);
      expect(fieldset().disabled).toBe(true);
    }
    await openTab('settings.dangerTab');
    expect(fieldset().disabled).toBe(true);
    expect(container.textContent).toContain('settings.adminsOnlyDelete');

    await act(async () => root.unmount());
  });

  it('lets a manager change the brand, but leaves its delete to admins', async () => {
    Object.assign(role, { canAdmin: false, canManage: true });
    const { container, root, openTab, fieldset } = await render();

    expect(fieldset().disabled).toBe(false);
    expect(container.textContent).not.toContain('settings.managersOnlyEdit');
    await openTab('settings.dangerTab');
    expect(fieldset().disabled).toBe(true);
    expect(container.textContent).toContain('settings.adminsOnlyDelete');

    await act(async () => root.unmount());
  });

  it('lets an admin delete the brand', async () => {
    const { container, root, openTab, fieldset } = await render();
    await openTab('settings.dangerTab');
    expect(fieldset().disabled).toBe(false);
    expect(container.textContent).not.toContain('settings.adminsOnlyDelete');
    expect(container.textContent).not.toContain('settings.demoCantDelete');

    await act(async () => root.unmount());
  });

  it('never deletes the demo brand: it says to hide it instead', async () => {
    brand.isDemo = true;
    try {
      const { container, root, openTab, fieldset } = await render();
      await openTab('settings.dangerTab');
      const panel = container.querySelector('[role="tabpanel"]:not([hidden])')!;
      expect(panel.querySelector('[data-slot="demo-cant-delete"]')?.textContent).toBe(
        'settings.demoCantDelete',
      );
      expect(panel.querySelector('input')).toBeNull();
      expect(fieldset().disabled).toBe(true);
      const remove = [...panel.querySelectorAll('button')].find(
        (b) => b.textContent === 'settings.deleteButton',
      )!;
      expect(remove.disabled).toBe(true);
      await act(async () => remove.click());
      expect(deleteBrand).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    } finally {
      brand.isDemo = undefined;
    }
  });
});

describe('Brand facts tab (Quality CE-047)', () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) act(() => root.unmount());
  });
  const open = async (tab?: string) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <Suspense>
          <BrandSettingsPage
            params={Promise.resolve({ id: brand.id })}
            searchParams={Promise.resolve({ tab })}
          />
        </Suspense>,
      );
    });
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    return {
      container,
      labels: tabs.map((t) => t.textContent),
      selected: tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.textContent,
    };
  };

  it('is there with phase 2, and ?tab=facts opens it', async () => {
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '2');
    const { container, labels, selected } = await open('facts');
    expect(labels).toContain('settings.facts.tab');
    expect(selected).toBe('settings.facts.tab');
    expect(container.querySelector('[data-testid="brand-facts"]')?.textContent).toBe(brand.id);
  });

  it('isn’t before phase 2, where ?tab=facts opens General', async () => {
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '1');
    const { container, labels, selected } = await open('facts');
    expect(labels).not.toContain('settings.facts.tab');
    expect(selected).toBe('settings.generalTab');
    expect(container.querySelector('[data-testid="brand-facts"]')).toBeNull();
  });
});

// A read-only workspace (plan not active): the settings show; every change
// opens the upgrade dialog, named (next-intl is mocked: the label's key).
describe('brand settings on a read-only workspace', () => {
  beforeEach(() => getCompetitors.mockResolvedValue([]));
  const openUpgrade = vi.fn();

  async function render(isLocked: boolean) {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <Suspense>
            <BrandSettingsPage params={Promise.resolve({ id: brand.id })} />
          </Suspense>
        </UpgradeDialogContext.Provider>,
      );
    });
    const button = (name: string) =>
      [...container.querySelectorAll<HTMLElement>('button')].find(
        (b) => b.textContent?.trim() === name,
      )!;
    const openTab = async (name: string) => {
      const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
        (el) => el.textContent?.trim() === name,
      )!;
      await act(async () => {
        tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        tab.click();
      });
    };
    const type = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    const panel = () => container.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
    return { container, root, button, openTab, type, panel };
  }

  it('saves, pauses and adds nothing, each opening the upgrade dialog, but deletes', async () => {
    openUpgrade.mockReset();
    deleteBrand.mockResolvedValue({ deleted: true });
    const { container, root, button, openTab, type, panel } = await render(true);

    await act(async () => button('settings.saveChanges').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('saveBrandSettings');
    await act(async () => (container.querySelector('#shopping-mode') as HTMLElement).click());
    expect(openUpgrade).toHaveBeenLastCalledWith('changeShoppingMode');
    await act(async () => button('Pause tracking').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('pauseBrands');

    await openTab('Competitors');
    await type(
      panel().querySelector<HTMLInputElement>('input[placeholder="Competitor name"]')!,
      'Rival',
    );
    await act(async () => button('Add').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('addCompetitors');

    await openTab('settings.dangerTab');
    await type(panel().querySelector<HTMLInputElement>('input')!, 'Acme');
    await act(async () => button('settings.deleteButton').click());
    expect(deleteBrand).toHaveBeenCalledOnce();

    expect(openUpgrade).toHaveBeenCalledTimes(4);
    expect(updateBrand).not.toHaveBeenCalled();
    expect(setBrandShoppingMode).not.toHaveBeenCalled();
    expect(setBrandActive).not.toHaveBeenCalled();
    expect(addCompetitor).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('pauses the brand on an active plan', async () => {
    openUpgrade.mockReset();
    setBrandActive.mockResolvedValue(undefined);
    const { root, button } = await render(false);
    await act(async () => button('Pause tracking').click());
    expect(setBrandActive).toHaveBeenCalledWith(brand.id, false);
    expect(openUpgrade).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
