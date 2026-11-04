import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * A new brand on a read-only workspace (plan not active), also when the page
 * is opened directly: the second step's Continue, which creates the brand,
 * opens the upgrade dialog and creates nothing. On an active plan it creates
 * the brand.
 */

const brandActions = vi.hoisted(() => ({
  createBrand: vi.fn(),
  markBrandAsEcommerce: vi.fn(),
  updateBrand: vi.fn(),
}));
vi.mock('@/lib/actions/brand', () => brandActions);
vi.mock('@/lib/actions/brandDomain', () => ({ syncDomains: vi.fn() }));
vi.mock('@/lib/actions/topic', () => ({ createTopics: vi.fn() }));
vi.mock('@/lib/actions/prompt', () => ({ getPromptCapacity: vi.fn(), savePromptSet: vi.fn() }));
vi.mock('@/lib/actions/competitor', () => ({ addCompetitor: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({ triggerTrackingCheck: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ bootstrapBrandVolumes: vi.fn() }));
const suggestTopics = vi.hoisted(() => vi.fn());
const detectSiteType = vi.hoisted(() => vi.fn());
vi.mock('@/lib/aiBrandSetup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/aiBrandSetup')>()),
  suggestTopics,
  detectSiteType,
  generatePromptsFromTopics: vi.fn(),
  suggestCompetitors: vi.fn(),
}));
// The org's row: no plan read here, the user and their organization only.
const single = async () => ({ data: { organization_id: 'org-1' } });
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}));
vi.mock('@/components/context/PlanProvider', () => ({
  usePlanContext: () => ({ allowedModelIds: null }),
}));
const store = vi.hoisted(() => ({
  addBrand: vi.fn(),
  setActiveBrand: vi.fn(),
  updateBrand: vi.fn(),
}));
vi.mock('@/state/useBrandStore', () => ({ useBrandStore: () => store }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: NewBrandPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  brandActions.createBrand.mockResolvedValue({
    brand: { id: 'b1', name: 'Acme', domains: [{ domain: 'acme.com', isPrimary: true }] },
  });
  suggestTopics.mockResolvedValue({ topics: [] });
  detectSiteType.mockResolvedValue({ siteType: null, industry: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <NewBrandPage />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

async function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const clickContinue = () =>
  act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Continue')!.click(),
  );

/** Fills the first step and goes on to the second, which creates the brand. */
async function reachCreate() {
  await type('brandName', 'Acme');
  await type('website', 'acme.com');
  await clickContinue();
}

describe('the new brand page', () => {
  it('creates no brand on a read-only workspace: Continue opens the upgrade dialog', async () => {
    await render(true);
    await reachCreate();
    await clickContinue();
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Adding brands needs a plan');
    expect(brandActions.createBrand).not.toHaveBeenCalled();
    expect(suggestTopics).not.toHaveBeenCalled();
    expect(detectSiteType).not.toHaveBeenCalled();
  });

  it('creates the brand on an active plan', async () => {
    await render(false);
    await reachCreate();
    await clickContinue();
    expect(brandActions.createBrand).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', name: 'Acme' }),
    );
    expect(openUpgrade).not.toHaveBeenCalled();
    // Its kind of site is read from its home page (Step 0), in the background.
    expect(detectSiteType).toHaveBeenCalledExactlyOnceWith('b1');
  });

  it('takes the detected site type into the brand', async () => {
    detectSiteType.mockResolvedValue({ siteType: 'ecommerce', industry: 'E-commerce & Retail' });
    await render(false);
    await reachCreate();
    await clickContinue();
    expect(store.updateBrand).toHaveBeenCalledWith('b1', {
      siteType: 'ecommerce',
      siteTypeSource: 'auto',
      industry: 'E-commerce & Retail',
    });
  });

  it('goes on to the topics when the detection fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    detectSiteType.mockRejectedValue(new Error('down'));
    await render(false);
    await reachCreate();
    await clickContinue();
    expect(suggestTopics).toHaveBeenCalled();
    expect(store.updateBrand).not.toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ siteType: expect.anything() }),
    );
  });
});
