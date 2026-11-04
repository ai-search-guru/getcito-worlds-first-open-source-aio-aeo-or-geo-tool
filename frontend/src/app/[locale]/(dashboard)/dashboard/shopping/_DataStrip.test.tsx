import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { CatalogSource } from '@/lib/catalog';
import type { SourceState } from '@/lib/actions/integrations';

/** Product Visibility's data sources and marketplaces row (ECOM-009). */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/useIntegrationConnect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect: vi.fn() }),
}));
vi.mock('@/lib/actions/catalog', () => ({ listCatalogSources: vi.fn() }));
vi.mock('@/lib/actions/traffic', () => ({ getTrafficSources: vi.fn() }));
vi.mock('../traffic/_BotsConnect', () => ({ BotsSource: () => null }));

const { ProductDataStrip } = await import('./_DataStrip');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-27T12:00:00Z'), toFake: ['Date'] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const off: SourceState = {
  configured: true,
  connected: false,
  mapped: false,
  firstDataAt: null,
  lastDataAt: null,
  property: null,
};

const source = (over: Partial<CatalogSource>): CatalogSource => ({
  id: 's1',
  kind: 'feed_url',
  format: 'auto',
  url: 'https://shop.example/feed.xml',
  account: null,
  label: null,
  lastSyncedAt: '2026-10-27T11:00:00Z',
  lastStatus: 'ok',
  lastError: null,
  lastCounts: null,
  products: 200,
  ...over,
});

function render(
  catalog: CatalogSource[] | null,
  canConnect = true,
  loaded = true,
  merchantCenterOffered = true,
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ProductDataStrip
          sources={{
            loaded,
            catalog,
            google: {
              snippetLastVisitAt: null,
              snippetFoundAt: null,
              snippetCheckedAt: null,
              ga: off,
              gsc: off,
            },
            merchantCenterOffered,
            reload: () => {},
          }}
          domain="shop.example"
          canConnect={canConnect}
          onConnected={() => {}}
        />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

const chip = (id: string) => container.querySelector(`[data-marketplace="${id}"]`)?.textContent;

describe('ProductDataStrip', () => {
  it("counts the catalog's products and its last sync, and says what GA and GSC add here", () => {
    const text = render([
      source({}),
      source({ id: 's2', products: 120, lastSyncedAt: '2026-10-26T12:00:00Z' }),
    ]);
    expect(text).toContain('Product catalog');
    expect(text).toContain('320 products · synced');
    expect(text).toContain('Not connected · see the path from AI visit to order');
    expect(text).toContain('Not connected · shopping questions from your real searches');
    expect(container.querySelector('a[href="/dashboard/settings/integrations"]')?.textContent).toBe(
      'Manage',
    );
  });

  it('asks for the catalog when there is none, with Connect for those who may connect it', () => {
    expect(render([])).toContain(
      "Not connected · add your product feed's URL (read every day) or upload a file",
    );
    expect([...container.querySelectorAll('a')].some((a) => a.textContent === 'Connect')).toBe(
      true,
    );
    render([], false);
    expect([...container.querySelectorAll('a')].some((a) => a.textContent === 'Connect')).toBe(
      false,
    );
  });

  it('marks Merchant Center connected when it is a catalog source, and the marketplaces as to come', () => {
    render([source({})]);
    expect(chip('merchant_center')).toContain('Connect');
    expect(chip('amazon')).toBe('aAmazonSoon');
    expect(chip('hepsiburada')).toBe('HHepsiburadaSoon');
    render([source({ kind: 'merchant_center' })]);
    expect(chip('merchant_center')).toBe('GGoogle Merchant CenterConnected');
    render([source({})], false);
    expect(chip('merchant_center')).toBe('GGoogle Merchant CenterNot connected');
  });

  it("calls Merchant Center Soon where this server doesn't offer it, unless the brand has it", () => {
    render([source({})], true, true, false);
    expect(chip('merchant_center')).toBe('GGoogle Merchant CenterSoon');
    render([source({ kind: 'merchant_center' })], true, true, false);
    expect(chip('merchant_center')).toBe('GGoogle Merchant CenterConnected');
  });

  it("says when the catalog couldn't be read, and waits while it loads", () => {
    expect(render(null)).toContain("Couldn't be read right now");
    render(null, true, false);
    expect(container.textContent).toBe('');
  });
});
