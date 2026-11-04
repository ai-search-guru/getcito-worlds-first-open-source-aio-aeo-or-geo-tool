import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type { Brand } from '@/types';

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

/**
 * Each provider's status as the API answers it: a failure is a read that
 * didn't come back (timed out or failed), a promise one still on its way.
 */
type StatusAnswer =
  string | { ok: false; reason: 'timeout' | 'failed' } | Promise<{ ok: true; value: string }>;
const statuses: Record<string, StatusAnswer> = {};
/** The server's config: whether it offers Merchant Center, null when it can't be read. */
const config = vi.hoisted(() => ({
  answer: { googleMerchantCenter: true } as
    { googleMerchantCenter: boolean } | null | Promise<{ googleMerchantCenter: boolean } | null>,
}));
const integrations = vi.hoisted(() => ({
  disconnectIntegration: vi.fn(),
  getGscBrandMappings: vi.fn(),
  setBrandGscProperty: vi.fn(),
  getGaBrandMappings: vi.fn(),
  setBrandGaProperty: vi.fn(),
}));
vi.mock('@/lib/actions/integrations', () => integrations);
const client = vi.hoisted(() => ({
  readIntegrationStatus: vi.fn(),
  readIntegrationsConfig: vi.fn(),
  readGscProperties: vi.fn(),
  readGaProperties: vi.fn(),
  INTEGRATION_READ_TIMEOUT_MS: 10_000,
  withReadTimeout: <T,>(promise: Promise<T>) => promise,
  isTimeout: (err: unknown) => (err as { name?: string })?.name === 'TimeoutError',
}));
vi.mock('@/lib/integrationsClient', () => client);
vi.mock('@/hooks/useIntegrationConnect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// The cards read on their own (tested beside them): here they stand by their names,
// the catalog card keeping how it reports its reads, the category pages showing their key.
const catalogCard = vi.hoisted(() => ({
  onSources: null as null | ((read: { brandId: string; sources: [] | null } | null) => void),
}));
vi.mock('./CatalogSourcesCard', () => ({
  CatalogSourcesCard: ({ onSources }: { onSources: typeof catalogCard.onSources }) => {
    catalogCard.onSources = onSources;
    return <div data-card="catalog">Product catalog</div>;
  },
}));
vi.mock('./MerchantCenterAccounts', () => ({ MerchantCenterAccounts: () => null }));
vi.mock('./CatalogCategoryPages', () => ({
  CatalogCategoryPages: ({ refreshKey }: { refreshKey: number }) => (
    <div data-card="categories">{refreshKey}</div>
  ),
}));
vi.mock('./WebflowCard', () => ({ WebflowCard: () => <div data-card="webflow">Webflow</div> }));
vi.mock('./WixCard', () => ({ WixCard: () => <div data-card="wix">Wix</div> }));

const { IntegrationsSection } = await import('./IntegrationsSection');
const { DemoBrandContext } = await import('@/components/context/DemoBrandProvider');
const { useBrandStore } = await import('@/state/useBrandStore');
const { toast } = await import('sonner');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations: its cards in groups a screen reader finds by their headings. */

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(statuses)) delete statuses[key];
  config.answer = { googleMerchantCenter: true };
  client.readIntegrationsConfig.mockImplementation(async () => config.answer);
  client.readIntegrationStatus.mockImplementation(async (provider: string) => {
    const status = statuses[provider] ?? 'not_connected';
    if (typeof status === 'string') return { ok: true, value: status };
    return status;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

/** `isLocked`: a read-only workspace (plan not active). `isDemo`: the demo brand on screen. */
async function render(isLocked = false, isDemo = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DemoBrandContext.Provider
          value={{ isDemo, demoBrand: null, offer: 'trial', neverSubscribed: false }}
        >
          <UpgradeDialogContext.Provider
            value={{
              isLocked: isLocked || isDemo,
              isDemo,
              reason: isDemo ? 'demo' : 'ended',
              adminName: null,
              openUpgrade,
            }}
          >
            <IntegrationsSection />
          </UpgradeDialogContext.Provider>
        </DemoBrandContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}
/** The elements a screen reader lists as headings. */
const headings = () => [
  ...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]'),
];
/** The heading that names the group an element is in. */
function groupOf(element: Element | null) {
  const section = element?.closest('section');
  const id = section?.getAttribute('aria-labelledby');
  return id ? document.getElementById(id)?.textContent : null;
}
const byText = (text: string) =>
  [...container.querySelectorAll('p')].find((p) => p.textContent === text) ?? null;
/** A card by its name: its row and the lines under it. */
const cardOf = (label: string) => byText(label)?.closest('.space-y-4') ?? null;
const merchantCenter = () => cardOf('Google Merchant Center');
/** A group's section, by its heading. */
const groupNamed = (title: string) =>
  headings()
    .find((h) => h.textContent === title)
    ?.closest('section') ?? null;
/** The badges a card shows, by their words. */
const badges = (card: Element) =>
  [...card.querySelectorAll('[class*="group/badge"]')].map((b) => b.textContent);

describe('IntegrationsSection', () => {
  it('names its groups with headings, each group labelled by its own', async () => {
    await render();
    expect(headings().map((h) => [h.tagName, h.textContent])).toEqual([
      ['H3', 'Stores and marketplaces'],
      ['H3', 'Content management systems'],
    ]);
    for (const heading of headings()) {
      expect(heading.closest('section')?.getAttribute('aria-labelledby')).toBe(heading.id);
    }
  });

  it('puts Merchant Center and the catalog with the stores, and Webflow with the CMSs', async () => {
    await render();
    expect(groupOf(byText('Google Merchant Center'))).toBe('Stores and marketplaces');
    expect(groupOf(container.querySelector('[data-card="catalog"]'))).toBe(
      'Stores and marketplaces',
    );
    expect(groupOf(container.querySelector('[data-card="webflow"]'))).toBe(
      'Content management systems',
    );
    // The Google data sources come first, in no group.
    expect(groupOf(byText('Google Search Console'))).toBeNull();
    expect(groupOf(byText('Google Analytics'))).toBeNull();
  });

  it("hides Merchant Center's card where the server doesn't offer it, with no Coming soon", async () => {
    config.answer = { googleMerchantCenter: false };
    await render();
    expect(byText('Google Merchant Center')).toBeNull();
    expect(container.textContent).not.toContain('Coming soon');
    expect(container.textContent).not.toContain('COMPOSIO_GMC_AUTH_CONFIG_ID');
    // Its status isn't read at all.
    expect(client.readIntegrationStatus).not.toHaveBeenCalledWith('google-merchant-center');
    // The group keeps its heading, with the product catalog alone in it.
    const stores = groupNamed('Stores and marketplaces')!;
    expect(stores.querySelector('[data-card="catalog"]')).not.toBeNull();
    expect(stores.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it("hides Merchant Center's card when the config can't be read: an older API offers nothing", async () => {
    config.answer = null;
    await render();
    expect(byText('Google Merchant Center')).toBeNull();
    expect(byText('Google Search Console')).not.toBeNull();
    expect(container.querySelector('[data-card="catalog"]')).not.toBeNull();
  });

  it("shows no skeleton for Merchant Center while the config is read, and doesn't wait on a status", async () => {
    let offer!: (answer: { googleMerchantCenter: boolean }) => void;
    config.answer = new Promise((resolve) => (offer = resolve));
    // Search Console's status still on its way: the config doesn't wait for it.
    statuses['google-search-console'] = new Promise(() => {});
    await render();
    const stores = groupNamed('Stores and marketplaces')!;
    expect(byText('Google Merchant Center')).toBeNull();
    expect(stores.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(stores.querySelector('[data-card="catalog"]')).not.toBeNull();

    await act(async () => offer({ googleMerchantCenter: true }));
    expect(groupOf(byText('Google Merchant Center'))).toBe('Stores and marketplaces');
    expect(cardOf('Google Search Console')!.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it('keeps the set-up line on a server without credentials for a provider', async () => {
    statuses['google-search-console'] = 'not_configured';
    await render();
    const gsc = cardOf('Google Search Console')!;
    expect(badges(gsc)).toEqual(['Not configured']);
    expect(gsc.textContent).toContain('COMPOSIO_GSC_AUTH_CONFIG_ID');
  });

  it('reads each card on its own: a status that hangs leaves the others ready', async () => {
    statuses['google-analytics'] = new Promise(() => {});
    await render();
    // Analytics waits on its own skeleton…
    expect(cardOf('Google Analytics')!.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    // …while Search Console and Merchant Center can connect, and the catalog is there.
    for (const label of ['Google Search Console', 'Google Merchant Center']) {
      expect([...cardOf(label)!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
        'Connect',
      ]);
    }
    expect(container.querySelector('[data-card="catalog"]')).not.toBeNull();
  });

  it.each([
    ['timeout', 'Checking Google Analytics took too long. Try again in a moment.'],
    ['failed', "Couldn't check whether Google Analytics is connected. Try again in a moment."],
  ] as const)(
    "says a status that %s couldn't be checked, with Try again in place of the skeleton",
    async (reason, message) => {
      statuses['google-analytics'] = { ok: false, reason };
      await render();
      const ga = cardOf('Google Analytics')!;
      expect(ga.querySelector('[data-slot="skeleton"]')).toBeNull();
      expect(ga.querySelector('[role="status"]')?.textContent).toBe(message);
      // Not a Connect that may not be needed, nor a toast.
      const retry = [...ga.querySelectorAll('button')];
      expect(retry.map((b) => b.textContent)).toEqual(['Try again']);
      expect(toast.error).not.toHaveBeenCalled();

      // Try again reads it again.
      statuses['google-analytics'] = 'not_connected';
      await act(async () => retry[0].click());
      expect(client.readIntegrationStatus).toHaveBeenLastCalledWith('google-analytics');
      expect([...ga.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Connect']);
      expect(ga.querySelector('[role="status"]')).toBeNull();
    },
  );

  it('connects Merchant Center as before where the server offers it', async () => {
    statuses['google-merchant-center'] = 'not_connected';
    await render();
    const card = merchantCenter()!;
    expect(badges(card)).toEqual([]);
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Connect']);
    expect(card.textContent).not.toContain('Coming soon');
    expect(card.textContent).not.toContain('Until it');

    act(() => root.unmount());
    root = createRoot(container);
    statuses['google-merchant-center'] = 'connected';
    await render();
    expect(badges(merchantCenter()!)).toEqual(['Connected']);
    expect(merchantCenter()!.textContent).toContain('Disconnect');
  });

  it("reads the category pages again on each read of a brand's sources after its first", async () => {
    await render();
    const key = () => container.querySelector('[data-card="categories"]')?.textContent;
    const report = async (read: { brandId: string; sources: [] | null } | null) => {
      await act(async () => catalogCard.onSources!(read));
    };
    // The brand's first read: the category pages read with it already.
    await report({ brandId: 'b1', sources: [] });
    expect(key()).toBe('0');
    // A feed added, synced or uploaded: the sources read again.
    const again = { brandId: 'b1', sources: [] as [] };
    await report(again);
    expect(key()).toBe('1');
    // The same read heard twice counts once.
    await report(again);
    expect(key()).toBe('1');
    // Another brand: its first read, while loading, then back.
    await report(null);
    await report({ brandId: 'b2', sources: null });
    expect(key()).toBe('1');
    await report({ brandId: 'b2', sources: [] });
    expect(key()).toBe('2');
  });
});

/** Picks a property for the nth brand row's picker. */
async function pick(row: number, label: string) {
  await act(async () => {
    container.querySelectorAll<HTMLElement>('[role="combobox"]')[row].click();
  });
  // A picker with a value keeps its list mounted: the one just opened is the last.
  const option = [
    ...[...document.querySelectorAll('[role="listbox"]')]
      .at(-1)!
      .querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((o) => o.textContent === label)!;
  await act(async () => {
    option.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  });
  await act(async () => option.click());
}

/**
 * A connected Search Console on a read-only workspace (plan not active): no
 * brand is mapped to a property by itself, and picking one opens the upgrade
 * dialog instead of saving it. On an active plan both save.
 */
describe('IntegrationsSection property mapping', () => {
  beforeEach(() => {
    client.readIntegrationStatus.mockImplementation(async (provider: string) => ({
      ok: true,
      value: provider === 'google-search-console' ? 'connected' : 'not_configured',
    }));
    client.readGscProperties.mockResolvedValue({
      ok: true,
      value: [
        { siteUrl: 'https://acme.com/', permissionLevel: 'siteOwner' },
        { siteUrl: 'https://other.example/', permissionLevel: 'siteOwner' },
      ],
    });
    // Acme matches one property by its domain; Beta matches none.
    integrations.getGscBrandMappings.mockResolvedValue([
      { brandId: 'b1', brandName: 'Acme', gscProperty: null, domains: ['acme.com'] },
      { brandId: 'b2', brandName: 'Beta', gscProperty: null, domains: ['beta.test'] },
    ]);
    integrations.setBrandGscProperty.mockResolvedValue(undefined);
  });

  it('maps nothing on a read-only workspace: no auto-match, and a pick opens the upgrade dialog', async () => {
    await render(true);
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(2);
    expect(integrations.setBrandGscProperty).not.toHaveBeenCalled();

    await pick(1, 'https://other.example/');
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Choosing a property needs a plan');
    expect(integrations.setBrandGscProperty).not.toHaveBeenCalled();
  });

  it('maps a matching brand by itself and saves a pick on an active plan', async () => {
    await render(false);
    expect(integrations.setBrandGscProperty).toHaveBeenCalledExactlyOnceWith(
      'b1',
      'https://acme.com/',
    );

    await pick(1, 'https://other.example/');
    expect(integrations.setBrandGscProperty).toHaveBeenLastCalledWith(
      'b2',
      'https://other.example/',
    );
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('says the properties took too long, and reads them again on Try again', async () => {
    client.readGscProperties.mockResolvedValueOnce({ ok: false, reason: 'timeout' });
    await render(false);
    expect(container.textContent).toContain("Couldn't load Search Console properties.");
    expect(container.textContent).toContain(
      'Reading the properties took too long. Try again in a moment.',
    );
    const retry = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    )!;
    await act(async () => retry.click());
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(2);
  });
});

describe('IntegrationsSection on the demo brand', () => {
  const demoBrand: Brand = {
    id: 'demo',
    organizationId: 'org1',
    name: 'Brewline Coffee',
    slug: 'brewline-coffee',
    shoppingModeEnabled: true,
    isActive: true,
    isDemo: true,
    domains: [{ id: 'd1', brandId: 'demo', domain: 'brewline.example', isPrimary: true }],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
  const card = (label: string) => byText(label)?.closest('.space-y-4') ?? null;
  const row = (id: string) => container.querySelector(`[data-integration="${id}"]`);

  beforeEach(() => {
    useBrandStore.setState({ brands: [demoBrand], activeBrandId: 'demo' });
  });

  it('shows Search Console and Analytics connected with sample data, read from nowhere', async () => {
    await render(false, true);
    for (const label of ['Google Search Console', 'Google Analytics']) {
      expect(badges(card(label)!)).toEqual(['Connected', 'Sample data']);
    }
    expect(client.readIntegrationStatus).not.toHaveBeenCalled();
    expect(client.readGscProperties).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Composio');
    // Each is mapped to the demo brand's sample property.
    await vi.waitFor(() =>
      expect(card('Google Search Console')!.textContent).toContain('1 of 1 brand mapped'),
    );
    expect(card('Google Search Console')!.textContent).toContain('Brewline Coffee');
    expect(card('Google Search Console')!.textContent).toContain('sc-domain:brewline.example');
    expect(card('Google Analytics')!.textContent).toContain('Brewline Coffee · GA4 (100000000)');
  });

  it('opens the plan dialog from Disconnect, which ends nothing', async () => {
    await render(false, true);
    const disconnect = [...card('Google Analytics')!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Disconnect',
    )!;
    await act(async () => disconnect.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith(
      'Disconnecting an integration needs a plan',
    );
    expect(integrations.disconnectIntegration).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the integrations still to come as Coming soon, in their groups', async () => {
    await render(false, true);
    expect(badges(merchantCenter()!)).toEqual(['Coming soon']);
    expect(groupOf(row('shopify'))).toBe('Stores and marketplaces');
    expect(row('shopify')!.textContent).toContain('Shopify');
    // Live now, with cards of their own: no Coming soon row.
    expect(row('wordpress')).toBeNull();
    expect(row('framer')).toBeNull();
    expect(row('wix')).toBeNull();
    expect(groupOf(container.querySelector('[data-card="wix"]'))).toBe(
      'Content management systems',
    );
  });

  it('shows none of those rows on another brand', async () => {
    await render();
    expect(row('shopify')).toBeNull();
    expect(row('wix')).toBeNull();
    expect(client.readIntegrationStatus).toHaveBeenCalled();
  });
});
