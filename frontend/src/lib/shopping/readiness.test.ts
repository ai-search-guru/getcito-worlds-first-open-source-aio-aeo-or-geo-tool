import { describe, expect, it } from 'vitest';
import type { CatalogSource } from '@/lib/catalog';
import { productRows, type CatalogProductRow } from './products';
import { pageKey } from '@/lib/content/feedMatch';
import { channelState, readinessChecklist, type ShoppingSearchAppearance } from './readiness';

/** Product Visibility's Readiness (ECOM-015). */

const source = (kind: string): CatalogSource => ({
  id: kind,
  kind,
  format: 'auto',
  url: null,
  account: null,
  label: null,
  lastSyncedAt: null,
  lastStatus: 'ok',
  lastError: null,
  lastCounts: null,
  products: 2,
});

const product = (id: string, over: Partial<CatalogProductRow> = {}): CatalogProductRow => ({
  id,
  title: `Product ${id}`,
  url: `https://shop.example/products/${id}?utm_source=chatgpt.com&utm_medium=feed`,
  productType: 'Backpacks',
  brand: 'Northwind',
  description: `A 30 litre hiking backpack ${'with plenty of room for long days on the trail '.repeat(3)}`,
  image: 'https://cdn.example/x.jpg',
  category: 'Bags > Backpacks',
  price: 100,
  currency: 'USD',
  inStock: true,
  hasGtin: true,
  ...over,
});

describe('readinessChecklist', () => {
  it('passes a shop whose catalog, feed and prices are in order, and scores it 100', () => {
    const rows = productRows([product('a'), product('b')], [], []);
    const { score, items } = readinessChecklist({
      market: 'europe',
      catalog: [source('feed_url'), source('merchant_center')],
      merchantCenterOffered: true,
      // Both product pages in Google's shopping results.
      searchAppearance: { state: 'read', pages: rows.map((row) => pageKey(row.product.url)!) },
      products: rows,
      openAi: null,
      cheaperResellers: 0,
      amazonDrop: null,
    });
    expect(items.map((item) => [item.key, item.state])).toEqual([
      ['catalog', 'pass'],
      ['merchantCenter', 'pass'],
      ['googleShopping', 'pass'],
      ['firstWords', 'pass'],
      ['feedFields', 'pass'],
      ['feedLinks', 'pass'],
      ['wrongPrice', 'pass'],
      ['resellerCheaper', 'pass'],
    ]);
    expect(score).toBe(100);
  });

  it("says what's missing, a wrong price with its example, and leaves the unknown out of the score", () => {
    const rows = productRows(
      [
        product('a', {
          hasGtin: false,
          url: 'https://shop.example/products/a',
          description: 'Our story.',
        }),
        product('b'),
      ],
      [
        {
          productId: 'b',
          shelf: 'q:chatgpt-shopping',
          rank: 1,
          price: 139,
          currency: 'USD',
          platform: 'chatgpt-shopping',
        },
      ],
      [],
    );
    const { score, items } = readinessChecklist({
      market: 'us',
      catalog: [source('feed_url')],
      merchantCenterOffered: true,
      searchAppearance: null,
      products: rows,
      openAi: { directFeed: false, ownCards: 3 },
      cheaperResellers: 2,
      amazonDrop: { from: 0.31, to: 0.04 },
    });
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey.merchantCenter).toMatchObject({ state: 'warn', action: 'settings' });
    expect(byKey.openAiIndex).toMatchObject({ state: 'warn', values: { status: 'found' } });
    expect(byKey.verifiedSeller.state).toBe('unknown');
    expect(byKey.firstWords).toMatchObject({
      state: 'fail',
      values: { count: 1 },
      action: 'products',
    });
    expect(byKey.feedFields).toMatchObject({
      state: 'fail',
      values: { percent: 50, gtin: 1, image: 0 },
    });
    expect(byKey.feedLinks).toMatchObject({ state: 'warn', values: { count: 1 } });
    expect(byKey.wrongPrice).toMatchObject({
      state: 'fail',
      values: { count: 1, product: 'Product b', seen: 139, yours: 100, currency: 'USD' },
    });
    expect(byKey.resellerCheaper).toMatchObject({ state: 'fail', values: { count: 2 } });
    expect(byKey.amazonShare).toMatchObject({ state: 'warn', values: { from: 31, to: 4 } });
    // pass 1 (catalog), warn ×4 (MC, OpenAI, feed links, Amazon), fail ×4: (1 + 2) / 9.
    expect(score).toBe(Math.round((100 * 3) / 9));
  });

  it('checks the first 40 words only on products with a type, and not at all without one', () => {
    const untyped = { productType: null, category: null };
    const firstWords = (products: CatalogProductRow[]) =>
      readinessChecklist({
        market: 'us',
        catalog: [source('shopify')],
        merchantCenterOffered: true,
        searchAppearance: null,
        products: productRows(products, [], []),
        openAi: null,
        cheaperResellers: null,
        amazonDrop: null,
      }).items.find((item) => item.key === 'firstWords');
    // One typed product, whose description names it: the untyped one doesn't fail it.
    expect(firstWords([product('a'), product('b', untyped)])).toMatchObject({
      state: 'pass',
      values: { count: 0 },
    });
    // None typed: unknown, so the score leaves it out.
    expect(firstWords([product('a', untyped), product('b', untyped)])).toMatchObject({
      state: 'unknown',
      values: { count: 0 },
      action: undefined,
    });
  });

  it('asks for the catalog when there is none, and lists no product checks without products', () => {
    const { items } = readinessChecklist({
      market: 'europe',
      catalog: [],
      merchantCenterOffered: true,
      searchAppearance: null,
      products: null,
      openAi: null,
      cheaperResellers: null,
      amazonDrop: null,
    });
    expect(items.map((item) => [item.key, item.state, item.action])).toEqual([
      ['catalog', 'fail', 'settings'],
      ['merchantCenter', 'fail', 'settings'],
    ]);
  });

  it("doesn't fail Merchant Center on catalog sources that couldn't be read", () => {
    const { items } = readinessChecklist({
      market: 'europe',
      catalog: null,
      merchantCenterOffered: true,
      searchAppearance: null,
      products: null,
      openAi: null,
      cheaperResellers: null,
      amazonDrop: null,
    });
    expect(items.map((item) => [item.key, item.state, item.action])).toEqual([
      ['catalog', 'unknown', 'settings'],
      ['merchantCenter', 'unknown', undefined],
    ]);
  });

  describe('where Merchant Center is not offered', () => {
    const base = {
      market: 'us' as const,
      products: null,
      openAi: null,
      cheaperResellers: null,
      amazonDrop: null,
      merchantCenterOffered: false,
      searchAppearance: null,
    };

    it('neither lists nor scores it, in the US and in Europe', () => {
      for (const market of ['us', 'europe'] as const) {
        const { score, items } = readinessChecklist({
          ...base,
          market,
          catalog: [source('feed_url')],
        });
        expect(items.map((item) => item.key)).not.toContain('merchantCenter');
        // The catalog connected is the one check made: 100, not pulled down.
        expect(score).toBe(100);
      }
      expect(
        readinessChecklist({ ...base, catalog: null }).items.map((item) => item.key),
      ).not.toContain('merchantCenter');
    });

    it('still says a Merchant Center source connected before is', () => {
      const { items } = readinessChecklist({
        ...base,
        catalog: [source('merchant_center')],
      });
      expect(items.find((item) => item.key === 'merchantCenter')).toMatchObject({
        state: 'pass',
        action: undefined,
      });
    });
  });

  describe("Google's shopping results (Search Console)", () => {
    const rows = productRows(
      ['a', 'b', 'c'].map((id) =>
        product(id, { url: `https://www.shop.example/products/${id}/?utm_medium=feed` }),
      ),
      [],
      [],
    );
    const check = (searchAppearance: ShoppingSearchAppearance | null, products = rows) =>
      readinessChecklist({
        market: 'us',
        catalog: [source('feed_url')],
        merchantCenterOffered: false,
        searchAppearance,
        products,
        openAi: null,
        cheaperResellers: null,
        amazonDrop: null,
      });
    const item = (searchAppearance: ShoppingSearchAppearance | null, products = rows) =>
      check(searchAppearance, products).items.find((i) => i.key === 'googleShopping');

    it('passes from half the product pages shown, warns below, fails with none', () => {
      expect(
        item({ state: 'read', pages: ['shop.example/products/a', 'shop.example/products/b'] }),
      ).toEqual({ key: 'googleShopping', state: 'pass', values: { count: 2, total: 3 } });
      expect(
        item({ state: 'read', pages: ['shop.example/products/c', 'shop.example/blog'] }),
      ).toEqual({ key: 'googleShopping', state: 'warn', values: { count: 1, total: 3 } });
      expect(item({ state: 'read', pages: [] })).toEqual({
        key: 'googleShopping',
        state: 'fail',
        values: { count: 0, total: 3 },
      });
    });

    it("doesn't know, nor scores it, without Search Console or before its first read", () => {
      expect(item({ state: 'not_connected', pages: [] })).toEqual({
        key: 'googleShopping',
        state: 'unknown',
        values: { reason: 'not_connected' },
        action: 'settings',
      });
      expect(item({ state: 'not_synced', pages: [] })).toMatchObject({
        state: 'unknown',
        values: { reason: 'not_synced' },
      });
      expect(item(null)).toMatchObject({ state: 'unknown', values: { reason: 'unread' } });
      // The catalog connected is the one scored check.
      expect(check({ state: 'not_connected', pages: [] }).score).toBe(100);
      const unlinked = productRows([product('a', { url: null })], [], []);
      expect(item({ state: 'read', pages: [] }, unlinked)).toMatchObject({
        state: 'unknown',
        values: { reason: 'no_pages' },
      });
    });

    it('is no check without products', () => {
      expect(item({ state: 'read', pages: [] }, [])).toBeUndefined();
    });
  });
});

describe('channelState', () => {
  it("reads a channel as showing the brand's products, tracked without them, or not tracked", () => {
    const own = new Map([['copilot-web', 4]]);
    expect(channelState('copilot-web', ['copilot-web', 'google-aimode'], own)).toBe('showing');
    expect(channelState('google-aimode', ['copilot-web', 'google-aimode'], own)).toBe('notShowing');
    expect(channelState('gemini-web', ['copilot-web'], own)).toBe('notTracked');
  });
});
