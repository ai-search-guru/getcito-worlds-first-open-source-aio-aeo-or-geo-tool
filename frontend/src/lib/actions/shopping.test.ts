import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #922 — the Shopping page used to aggregate unpaged selects, which PostgREST
 * caps at 1,000 rows. These tests pin that the card reads page through every
 * row and that the Overview comes from the `shopping_overview` RPC.
 */

interface QueryState {
  table: string;
  eq: Record<string, unknown>;
  range?: [number, number];
  head?: boolean;
  or?: string;
}

const PAGE_CAP = 1000;

/** Applies the one `or` filter the actions build: `platform.neq.X,region.in.(A,B)`. */
function keptByOr(filter: string | undefined, row: Record<string, unknown>): boolean {
  if (!filter) return true;
  const match = /^platform\.neq\.([^,]+),region\.in\.\((.*)\)$/.exec(filter);
  if (!match) throw new Error(`unexpected or filter: ${filter}`);
  return row.platform !== match[1] || match[2].split(',').includes(String(row.region));
}

let cards: Array<Record<string, unknown>> = [];
let overviewRow: Record<string, unknown> = {};
let rpcData: Record<string, unknown> = {};
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let cardCalls: QueryState[] = [];

function resolveQuery(state: QueryState) {
  if (state.table === 'competitors') {
    return {
      data: [
        { id: 'c-1', name: 'Rival One', domain: 'rival-one.example' },
        { id: 'c-2', name: 'Rival Two', domain: 'rival-two.example' },
      ],
      error: null,
    };
  }
  if (state.table === 'prompt_result_shopping_cards') {
    const rows = cards.filter(
      (c) =>
        (state.eq.matched_brand_role === undefined ||
          c.matched_brand_role === state.eq.matched_brand_role) &&
        keptByOr(state.or, c),
    );
    if (state.head) return { data: null, count: rows.length, error: null };
    // Like PostgREST: an unpaged select still stops at the cap.
    const [from, to] = state.range ?? [0, PAGE_CAP - 1];
    return { data: rows.slice(from, Math.min(to + 1, from + PAGE_CAP)), error: null };
  }
  return { data: [], error: null };
}

function fakeQueryBuilder(table: string) {
  const state: QueryState = { table, eq: {} };
  const builder = {
    select: (_columns: string, opts?: { head?: boolean }) => {
      state.head = opts?.head;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      state.eq[column] = value;
      return builder;
    },
    gte: () => builder,
    lte: () => builder,
    in: () => builder,
    or: (filter: string) => {
      state.or = filter;
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) => {
      state.range = [from, to];
      return builder;
    },
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      if (table === 'prompt_result_shopping_cards') cardCalls.push({ ...state });
      return Promise.resolve(resolveQuery(state)).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => fakeQueryBuilder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: fn in rpcData ? rpcData[fn] : overviewRow, error: null };
    },
  }),
}));

import {
  getCompetitorProducts,
  getCompetitorSummary,
  getOwnProducts,
  getResellerPriceAlerts,
  getShoppingKpis,
  getShoppingMerchantSplit,
  getShoppingOverview,
} from './shopping';

function card(i: number, role: 'own' | 'competitor' | 'other', matched?: string) {
  return {
    id: `card-${i}`,
    created_at: '2026-10-01T12:00:00.000Z',
    platform: 'google-aimode',
    region: 'US',
    product_title: `Product ${i % 7}`,
    product_brand: 'Acme',
    price_amount: 10,
    price_currency: 'USD',
    image_url: null,
    merchant_url: null,
    merchant_domain: 'shop.example',
    raw: null,
    matched_brand_id: matched ?? null,
    matched_brand_role: role,
    prompt_results: { prompt: { id: 'p-1', text: 'Best running shoes?' } },
  };
}

beforeEach(() => {
  cards = [];
  rpcData = {};
  rpcCalls = [];
  cardCalls = [];
  overviewRow = {
    total_results: 4000,
    results_with_cards: 1000,
    total_cards: 5845,
    own_cards: 1169,
    top_merchant: { domain: 'shop.example', card_count: 900 },
    by_platform: [
      { platform: 'chatgpt', total_results: 3000, results_with_cards: 600 },
      { platform: 'google-aimode', total_results: 1000, results_with_cards: 400 },
      { platform: 'perplexity', total_results: 0, results_with_cards: 0 },
    ],
    trend: [],
  };
});

describe('getOwnProducts', () => {
  it('counts every own card past the 1,000-row cap', async () => {
    cards = Array.from({ length: 2500 }, (_, i) => card(i, 'own'));
    const products = await getOwnProducts('brand-1', { datePreset: '30d' });

    expect(products.reduce((sum, p) => sum + p.impressions, 0)).toBe(2500);
    expect(cardCalls.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
});

describe('getCompetitorProducts', () => {
  it('pages through competitor cards', async () => {
    cards = Array.from({ length: 1200 }, (_, i) => card(i, 'competitor', 'c-1'));
    const products = await getCompetitorProducts('brand-1', { datePreset: '30d' });

    expect(products.reduce((sum, p) => sum + p.impressions, 0)).toBe(1200);
    expect(products[0].competitor_name).toBe('Rival One');
  });
});

describe('getCompetitorSummary', () => {
  it('counts each competitor across pages', async () => {
    cards = [
      ...Array.from({ length: 1500 }, (_, i) => card(i, 'competitor', 'c-1')),
      ...Array.from({ length: 300 }, (_, i) => card(i, 'competitor', 'c-2')),
      ...Array.from({ length: 200 }, (_, i) => card(i, 'other')),
    ];
    const summary = await getCompetitorSummary('brand-1', { datePreset: '30d' });

    expect(summary.map((s) => [s.competitor_id, s.card_count])).toEqual([
      ['c-1', 1500],
      ['c-2', 300],
    ]);
    expect(summary[0].sov).toBeCloseTo(1500 / 2000);
  });
});

describe('ChatGPT Shopping market (#1278)', () => {
  const placed = (
    i: number,
    role: 'own' | 'competitor' | 'other',
    platform: string,
    region: string,
    matched?: string,
  ) => ({ ...card(i, role, matched), product_title: `Product ${i}`, platform, region });

  it("keeps ChatGPT Shopping's cards to the market and leaves other platforms alone", async () => {
    cards = [
      placed(1, 'own', 'chatgpt-shopping', 'DE'),
      placed(2, 'own', 'chatgpt-shopping', 'GB'),
      placed(3, 'own', 'chatgpt-shopping', 'US'),
      placed(4, 'own', 'chatgpt-shopping', 'TR'),
      placed(5, 'own', 'copilot-web', 'TR'),
      placed(6, 'own', 'google-aimode', 'US'),
    ];
    const products = await getOwnProducts('brand-1', {
      datePreset: '30d',
      chatgptMarket: 'europe',
    });

    expect(products.map((p) => p.product_title).sort()).toEqual([
      'Product 1',
      'Product 2',
      'Product 5',
      'Product 6',
    ]);
  });

  it('counts US states as the US market', async () => {
    cards = [
      placed(1, 'own', 'chatgpt-shopping', 'US-CA'),
      placed(2, 'own', 'chatgpt-shopping', 'DE'),
    ];
    const products = await getOwnProducts('brand-1', { datePreset: '30d', chatgptMarket: 'us' });

    expect(products.map((p) => p.product_title)).toEqual(['Product 1']);
  });

  it('applies to the share-of-voice total as well as the competitor cards', async () => {
    cards = [
      placed(1, 'competitor', 'chatgpt-shopping', 'US', 'c-1'),
      placed(2, 'competitor', 'chatgpt-shopping', 'FR', 'c-1'),
      placed(3, 'other', 'chatgpt-shopping', 'FR'),
      placed(4, 'other', 'copilot-web', 'FR'),
    ];
    const summary = await getCompetitorSummary('brand-1', {
      datePreset: '30d',
      chatgptMarket: 'us',
    });

    expect(summary[0]).toMatchObject({ competitor_id: 'c-1', card_count: 1 });
    expect(summary[0].sov).toBeCloseTo(1 / 2);
  });

  it("passes the market's regions to the Overview RPC only when a market applies", async () => {
    await getShoppingOverview('brand-1', { datePreset: '30d', chatgptMarket: 'europe' });
    await getShoppingOverview('brand-1', { datePreset: '30d' });

    expect(rpcCalls.map((c) => c.fn)).toEqual(['shopping_overview', 'shopping_overview']);
    expect(rpcCalls[0].args.p_chatgpt_regions).toEqual(
      expect.arrayContaining(['DE', 'FR', 'GB', 'CH']),
    );
    expect(rpcCalls[0].args.p_chatgpt_regions).not.toContain('US');
    expect(rpcCalls[0].args.p_regions).toBeUndefined();
    expect(rpcCalls[1].args.p_chatgpt_regions).toBeUndefined();
  });

  it("passes the market's regions to the merchant split and offers RPCs only with a market", async () => {
    rpcData.shopping_merchant_split = [];
    rpcData.shopping_own_product_offers = [];
    await getShoppingMerchantSplit('brand-1', { datePreset: '30d', chatgptMarket: 'us' });
    await getResellerPriceAlerts('brand-1', { datePreset: '30d', chatgptMarket: 'us' });
    await getShoppingMerchantSplit('brand-1', { datePreset: '30d' });
    await getResellerPriceAlerts('brand-1', { datePreset: '30d' });

    expect(rpcCalls.map((c) => c.fn)).toEqual([
      'shopping_merchant_split',
      'shopping_own_product_offers',
      'shopping_merchant_split',
      'shopping_own_product_offers',
    ]);
    for (const call of rpcCalls.slice(0, 2)) {
      expect(call.args.p_chatgpt_regions).toEqual(expect.arrayContaining(['US', 'US-CA']));
      expect(call.args.p_chatgpt_regions).not.toContain('DE');
      expect(call.args.p_regions).toBeUndefined();
    }
    for (const call of rpcCalls.slice(2)) {
      expect(call.args.p_chatgpt_regions).toBeUndefined();
    }
  });

  it('adds no filter without a market', async () => {
    cards = [placed(1, 'own', 'chatgpt-shopping', 'TR')];
    await getOwnProducts('brand-1', { datePreset: '30d' });

    expect(cardCalls.every((c) => c.or === undefined)).toBe(true);
  });
});

describe('getShoppingOverview', () => {
  it('builds KPIs and charts from one RPC call', async () => {
    const { kpis, charts } = await getShoppingOverview('brand-1', {
      datePreset: 'all',
      platforms: ['chatgpt'],
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('shopping_overview');
    expect(rpcCalls[0].args).toMatchObject({
      p_brand_id: 'brand-1',
      p_platforms: ['chatgpt'],
    });
    expect(rpcCalls[0].args.p_trend_from).toEqual(expect.any(String));

    expect(kpis).toEqual({
      shoppingCardRate: 0.25,
      shoppingCardRateSampleSize: 4000,
      productsSurfaced: 1169,
      shoppingSov: 1169 / 5845,
      topMerchant: { domain: 'shop.example', cardCount: 900 },
    });
    expect(charts.platformCardRate.map((p) => p.platform)).toEqual(['google-aimode', 'chatgpt']);
    expect(charts.ownPresenceTrend).toHaveLength(30);
  });

  it('places trend days on their UTC date and fills empty days with zeros', async () => {
    const today = new Date().toISOString().slice(0, 10);
    overviewRow.trend = [{ day: today, own_cards: 3, total_cards: 12 }];
    const { charts } = await getShoppingOverview('brand-1', { datePreset: '30d' });

    expect(charts.ownPresenceTrend.at(-1)).toEqual({ date: today, ownCards: 3, totalCards: 12 });
    expect(charts.ownPresenceTrend[0]).toMatchObject({ ownCards: 0, totalCards: 0 });
  });
});

describe('getShoppingKpis', () => {
  it('skips the trend', async () => {
    await getShoppingKpis('brand-1', { datePreset: '30d' });
    expect(rpcCalls[0].args.p_trend_from).toBeUndefined();
  });
});

describe('getShoppingMerchantSplit', () => {
  it("reads the split for the Overview's window and filters", async () => {
    rpcData.shopping_merchant_split = [
      {
        own_store_cards: 286,
        amazon_cards: 1200,
        walmart_cards: 400,
        ebay_cards: 90,
        other_marketplace_cards: 500,
        reseller_cards: 11752,
        unclassified_cards: '1404',
      },
    ];
    const split = await getShoppingMerchantSplit('brand-1', {
      datePreset: '30d',
      platforms: ['copilot-web'],
      regions: ['US'],
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('shopping_merchant_split');
    expect(rpcCalls[0].args).toMatchObject({
      p_brand_id: 'brand-1',
      p_from: expect.any(String),
      p_platforms: ['copilot-web'],
      p_regions: ['US'],
    });
    expect(split.classifiedCards).toBe(14228);
    expect(split.unclassifiedCards).toBe(1404);
    expect(split.parts.reduce((sum, p) => sum + p.cards, 0)).toBe(14228);
    expect(split.parts.reduce((sum, p) => sum + p.percent, 0)).toBe(100);
  });

  it('is all zeros when the RPC returns no row', async () => {
    rpcData.shopping_merchant_split = [];
    const split = await getShoppingMerchantSplit('brand-1', { datePreset: '7d' });
    expect(split.classifiedCards).toBe(0);
    expect(split.unclassifiedCards).toBe(0);
  });
});

describe('getResellerPriceAlerts', () => {
  it('flags a marketplace offer at least 5% under the store', async () => {
    rpcData.shopping_own_product_offers = [
      {
        merchant_kind: 'own',
        marketplace: null,
        merchant_domain: 'acme.example',
        merchant_url: 'https://acme.example/runner',
        listing_id: null,
        product_title: 'Acme Runner',
        price_amount: '120.00',
        price_currency: 'USD',
      },
      {
        merchant_kind: 'marketplace',
        marketplace: 'amazon',
        merchant_domain: 'amazon.com',
        merchant_url: 'https://www.amazon.com/dp/B000000001',
        listing_id: 'B000000001',
        product_title: 'Acme Runner',
        price_amount: 99,
        price_currency: 'USD',
      },
    ];
    const alerts = await getResellerPriceAlerts('brand-1', { datePreset: '90d' });

    expect(rpcCalls[0].fn).toBe('shopping_own_product_offers');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ ownPrice: 120, resellerPrice: 99, currency: 'USD' });
  });

  it('is empty when the RPC returns no offers', async () => {
    rpcData.shopping_own_product_offers = [];
    expect(await getResellerPriceAlerts('brand-1', { datePreset: '30d' })).toEqual([]);
  });
});
