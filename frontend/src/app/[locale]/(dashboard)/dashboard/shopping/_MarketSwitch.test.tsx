import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { ShoppingMarketSwitch, useShoppingMarket } from './_MarketSwitch';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const countriesByBrand = new Map<string, string[]>();
vi.mock('@/lib/actions/shoppingMarket', () => ({
  getBrandMarketCountries: vi.fn(async (brandId: string) => countriesByBrand.get(brandId) ?? []),
}));

let container: HTMLDivElement;
let root: Root;
const onRegionReset = vi.fn();

function Harness({ brandId, region }: { brandId: string; region: string }) {
  const state = useShoppingMarket(brandId, region);
  return (
    <>
      <output
        data-testid="state"
        data-ready={String(state.ready)}
        data-market={state.market ?? ''}
        data-filter={state.filter ?? ''}
      />
      <ShoppingMarketSwitch
        state={state}
        onSelect={(market) => {
          state.select(market);
          onRegionReset();
        }}
      />
    </>
  );
}

async function render(brandId: string, region = 'all') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Harness brandId={brandId} region={region} />
      </NextIntlClientProvider>,
    );
  });
}

const state = () => container.querySelector<HTMLOutputElement>('[data-testid="state"]')!.dataset;
const group = () => container.querySelector<HTMLElement>('[role="group"]');
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;
const pressed = () =>
  [...container.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent);

async function click(name: string) {
  await act(async () => {
    button(name).click();
  });
}

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};

beforeEach(() => {
  store.clear();
  countriesByBrand.clear();
  onRegionReset.mockClear();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ShoppingMarketSwitch', () => {
  it('opens on the US for a brand with US countries, with OpenAI as the source', async () => {
    countriesByBrand.set('b1', ['DE', 'US-CA']);
    await render('b1');

    expect(state()).toMatchObject({ ready: 'true', market: 'us', filter: 'us' });
    expect(pressed()).toEqual(['US']);
    expect(container.textContent).toContain('OpenAI product index · via Shopify');
  });

  it('opens on Europe for a brand whose countries are all European', async () => {
    countriesByBrand.set('b1', ['de', 'GB', 'CH']);
    await render('b1');

    expect(state()).toMatchObject({ market: 'europe', filter: 'europe' });
    expect(pressed()).toEqual(['Europe']);
    expect(container.textContent).toContain('Google Shopping · via Merchant Center');
  });

  it('shows no switch and makes no claim for a brand with no market', async () => {
    countriesByBrand.set('b1', ['TR', 'IN']);
    await render('b1');

    expect(state()).toMatchObject({ ready: 'true', market: '', filter: '' });
    expect(group()).toBeNull();
    expect(container.textContent).not.toContain('product source');
  });

  it('switches the market and its source line, and remembers it per brand', async () => {
    countriesByBrand.set('b1', ['US']);
    countriesByBrand.set('b2', ['US']);
    await render('b1');

    await click('Europe');
    expect(state()).toMatchObject({ market: 'europe', filter: 'europe' });
    expect(pressed()).toEqual(['Europe']);
    expect(container.textContent).toContain('Google Shopping · via Merchant Center');
    expect(store.get('aeo:shopping-market:b1')).toBe('europe');
    expect(onRegionReset).toHaveBeenCalledTimes(1);

    // Another brand keeps its own default.
    await render('b2');
    expect(state()).toMatchObject({ market: 'us' });

    // Back on the first brand, the choice is remembered.
    await render('b1');
    expect(state()).toMatchObject({ market: 'europe' });
  });

  it('ignores a remembered market for a brand that has no market', async () => {
    store.set('aeo:shopping-market:b1', 'us');
    countriesByBrand.set('b1', ['TR']);
    await render('b1');

    expect(state()).toMatchObject({ market: '', filter: '' });
    expect(group()).toBeNull();
  });

  it('works without browser storage', async () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: broken });
    countriesByBrand.set('b1', ['FR']);
    await render('b1');

    expect(state()).toMatchObject({ market: 'europe' });
    await click('US');
    expect(state()).toMatchObject({ market: 'us', filter: 'us' });
  });

  it('follows a picked region, which narrows the cards on its own', async () => {
    countriesByBrand.set('b1', ['US', 'DE', 'TR']);

    await render('b1', 'DE');
    expect(state()).toMatchObject({ market: 'us', filter: '' });
    expect(pressed()).toEqual(['Europe']);
    expect(container.textContent).toContain('Google Shopping · via Merchant Center');

    // A region outside both markets: nothing pressed, no source claim.
    await render('b1', 'TR');
    expect(pressed()).toEqual([]);
    expect(container.textContent).not.toContain('product source');
  });

  it('is a labelled group of native buttons, so the keyboard reaches each market', async () => {
    countriesByBrand.set('b1', ['US']);
    await render('b1');

    const labelId = group()!.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)?.textContent).toBe('ChatGPT Shopping market');
    for (const name of ['US', 'Europe']) {
      expect(button(name).getAttribute('type')).toBe('button');
      expect(button(name).hasAttribute('aria-pressed')).toBe(true);
    }
  });
});
