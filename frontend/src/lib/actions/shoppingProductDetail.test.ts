import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resultTrend } from '@/lib/shopping/recheck';

/** A product's page read (ECOM-011). */

const BRAND = '33333333-3333-3333-3333-333333333333';
const PRODUCT = '11111111-0000-0000-0000-000000000001';

let tables: Record<string, Record<string, unknown>[]>;
// The id lists each read filtered by, as [table, column, how many].
let filtered: [string, string, number][];
let rpcArgs: Record<string, unknown>[];
// The id lists the catalog reads filtered by, as [table, column, the ids].
let byIds: [string, string, unknown[]][];
// The equality filters each read made, as [table, column, value].
let eqs: [string, string, unknown][];

function query(table: string) {
  let range: [number, number] | undefined;
  let single = false;
  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => (eqs.push([table, column, value]), q),
    is: () => q,
    in: (column: string, values: unknown[]) => (
      filtered.push([table, column, values.length]),
      byIds.push([table, column, values]),
      q
    ),
    not: () => q,
    gte: () => q,
    lte: () => q,
    lt: () => q,
    limit: () => q,
    or: () => q,
    order: () => q,
    maybeSingle: () => ((single = true), q),
    range: (from: number, to: number) => ((range = [from, to]), q),
    then: (resolve: (value: unknown) => void) => {
      const rows = tables[table] ?? [];
      if (single) return resolve({ data: rows[0] ?? null, error: null });
      const [from, to] = range ?? [0, 999];
      resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: query,
    rpc: async (_name: string, args: Record<string, unknown>) => {
      rpcArgs.push(args);
      return {
        data: [{ product_id: PRODUCT, ai_visits: 4, orders: 0, revenue: null, currency: null }],
        error: null,
      };
    },
  })),
}));

const { getProductAiSays, getShoppingActionResults, getShoppingProductDetail } =
  await import('./shopping');

beforeEach(() => {
  tables = {};
  filtered = [];
  rpcArgs = [];
  byIds = [];
  eqs = [];
});

const card = (over: Record<string, unknown>) => ({
  prompt_result_id: 'r1',
  position: 0,
  created_at: '2026-10-27T08:00:00Z',
  platform: 'chatgpt-shopping',
  product_title: 'Summit Daypack 30 W Hiking Backpack',
  price_amount: 110,
  price_currency: 'USD',
  rating: 4.8,
  review_count: 2140,
  merchant_domain: 'summitgear.example',
  image_url: null,
  matched_brand_role: 'competitor',
  catalog_product_id: null,
  prompt_results: {
    prompt_id: 'q1',
    prompt: { text: 'lightweight 30L hiking backpack for women' },
  },
  ...over,
});

describe('getShoppingProductDetail', () => {
  it("refuses a brand id that isn't one, and reads a product not in the catalog as none", async () => {
    await expect(getShoppingProductDetail('nope', PRODUCT, { datePreset: '30d' })).rejects.toThrow(
      'invalid',
    );
    // An address with no product's id in it: none, not a failure, and nothing read.
    expect(await getShoppingProductDetail(BRAND, 'nope', { datePreset: '30d' })).toBeNull();
    expect(byIds).toEqual([]);
    expect(await getShoppingProductDetail(BRAND, PRODUCT, { datePreset: '30d' })).toBeNull();
  });

  it('explains the shelf it misses beside its winner, with its rating as the answers showed it', async () => {
    tables.catalog_products = [
      {
        id: PRODUCT,
        title: 'Ridge 30L Backpack',
        url: null,
        product_type: 'Backpacks',
        product_brand: 'Northwind',
        description: null,
      },
    ];
    tables.catalog_product_categories = [
      { product_id: PRODUCT, category: { name: 'Hiking backpacks' } },
    ];
    tables.brand_domains = [{ domain: 'northwind.example' }];
    tables.prompts = [
      { id: 'q1', text: 'lightweight 30L hiking backpack for women' },
      { id: 'q7', text: 'espresso machine for home' },
    ];
    tables.prompt_results = [{ id: 'r1', search_queries: [{ query: 'women hiking backpack' }] }];
    tables.prompt_result_shopping_cards = [
      card({}),
      card({
        prompt_result_id: 'r0',
        created_at: '2026-10-20T08:00:00Z',
        product_title: 'Ridge 30L Backpack',
        matched_brand_role: 'own',
        catalog_product_id: PRODUCT,
        rating: 4.5,
        review_count: 86,
      }),
    ];
    const detail = await getShoppingProductDetail(BRAND, PRODUCT, { datePreset: '30d' });
    expect(detail?.focus).toMatchObject({
      promptId: 'q1',
      rank: null,
      winner: { title: 'Summit Daypack 30 W Hiking Backpack' },
    });
    expect(detail?.comparison.find((row) => row.key === 'rating')).toMatchObject({
      you: '4.5 · 86',
      winner: '4.8 · 2,140',
      state: 'weaker',
    });
    expect(detail?.comparison.find((row) => row.key === 'merchant')).toMatchObject({
      you: 'northwind.example',
      winner: 'summitgear.example',
    });
    expect(detail?.ai).toEqual({ visits: 4, orders: 0, revenue: null, currency: null });
    // Only this product: its catalog rows, and its own AI visits and orders.
    expect(byIds.filter(([table]) => table.startsWith('catalog_'))).toEqual([
      ['catalog_products', 'id', [PRODUCT]],
      ['catalog_variants', 'product_id', [PRODUCT]],
      ['catalog_images', 'product_id', [PRODUCT]],
      ['catalog_product_categories', 'product_id', [PRODUCT]],
    ]);
    expect(rpcArgs).toEqual([
      { p_brand_id: BRAND, p_from: expect.any(String), p_product_id: PRODUCT },
    ]);
    expect(detail?.result).toBeNull();
    // Its own cards, then the shelves of its questions alone, and AI's
    // searches for each shelf's latest answer only.
    expect(eqs).toContainEqual(['prompt_result_shopping_cards', 'catalog_product_id', PRODUCT]);
    expect(byIds).toContainEqual([
      'prompt_result_shopping_cards',
      'prompt_results.prompt_id',
      ['q1'],
    ]);
    expect(byIds).toContainEqual(['prompt_results', 'id', ['r1']]);
  });

  it('sets the week after its last done action beside the week before (ECOM-018)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
    try {
      tables.catalog_products = [{ id: PRODUCT, title: 'Ridge 30L Backpack', description: null }];
      tables.actions = [
        {
          id: 'a7',
          action_no: 7,
          completed_at: '2026-10-20T00:00:00Z',
          payload: { target: { type: 'product', id: PRODUCT }, promptIds: ['q1'] },
        },
        // An older one for the same product: the latest done counts.
        {
          id: 'a3',
          action_no: 3,
          completed_at: '2026-10-01T00:00:00Z',
          payload: { target: { type: 'product', id: PRODUCT }, promptIds: ['q1'] },
        },
      ];
      const prompt = {
        prompt_id: 'q1',
        prompt: { text: 'lightweight 30L hiking backpack for women' },
      };
      tables.prompt_result_shopping_cards = [
        card({
          prompt_result_id: 'r-1',
          created_at: '2026-10-15T08:00:00Z',
          prompt_results: prompt,
        }),
        card({
          prompt_result_id: 'r0',
          created_at: '2026-10-22T08:00:00Z',
          product_title: 'Ridge 30L Backpack',
          matched_brand_role: 'own',
          catalog_product_id: PRODUCT,
          prompt_results: prompt,
        }),
      ];
      const detail = await getShoppingProductDetail(BRAND, PRODUCT, { datePreset: '30d' });
      // One read for the action's one question (and one for the page's shelves of it).
      expect(filtered.filter(([, column]) => column === 'prompt_results.prompt_id')).toEqual([
        ['prompt_result_shopping_cards', 'prompt_results.prompt_id', 1],
        ['prompt_result_shopping_cards', 'prompt_results.prompt_id', 1],
      ]);
      expect(detail?.result).toEqual({
        actionId: 'a7',
        actionNo: 7,
        completedAt: '2026-10-20T00:00:00Z',
        readyAt: '2026-10-27T00:00:00.000Z',
        before: { shelves: 1, on: 0 },
        after: { shelves: 1, on: 1 },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getProductAiSays (ECOM-012)', () => {
  it('quotes the answers that showed the product, with the sources they cited', async () => {
    await expect(getProductAiSays(BRAND, 'nope', { datePreset: '30d' })).rejects.toThrow('invalid');
    expect(await getProductAiSays(BRAND, PRODUCT, { datePreset: '30d' })).toEqual({
      answers: 0,
      quotes: [],
      sources: [],
    });
    tables.catalog_products = [{ title: 'Ridge 30L Backpack' }];
    tables.prompt_result_shopping_cards = [
      { prompt_result_id: 'r1', product_title: 'Ridge 30L - Black', created_at: '2026-10-27' },
      { prompt_result_id: 'r0', product_title: null, created_at: '2026-10-20' },
    ];
    tables.prompt_results = [
      {
        id: 'r1',
        platform: 'chatgpt-shopping',
        created_at: '2026-10-27T08:00:00Z',
        response: 'Pick the **Ridge 30L** for its warranty. Others are lighter.',
        prompt: { text: 'best 30L hiking backpack' },
      },
    ];
    tables.prompt_result_citations = [
      {
        prompt_result_id: 'r1',
        url: {
          url: 'https://outdoorgear.example/best',
          domain: 'outdoorgear.example',
          title: null,
        },
      },
      { prompt_result_id: 'r1', url: null },
    ];
    expect(await getProductAiSays(BRAND, PRODUCT, { datePreset: '30d' })).toEqual({
      answers: 2,
      quotes: [
        {
          text: 'Pick the Ridge 30L for its warranty.',
          platform: 'chatgpt-shopping',
          at: '2026-10-27T08:00:00Z',
          promptText: 'best 30L hiking backpack',
        },
      ],
      sources: [
        {
          url: 'https://outdoorgear.example/best',
          domain: 'outdoorgear.example',
          title: null,
          answers: 1,
        },
      ],
    });
  });
});

describe('the re-check read (ECOM-018)', () => {
  it('reads the cards of every question, past 400, a hundred ids at a time', async () => {
    tables.catalog_products = [{ id: PRODUCT, title: 'Ridge 30L Backpack', description: null }];
    tables.actions = [
      {
        id: 'a7',
        action_no: 7,
        completed_at: new Date(Date.now() - 86_400_000).toISOString(),
        payload: {
          target: { type: 'product', id: PRODUCT },
          promptIds: Array.from({ length: 450 }, (_, i) => `q${i}`),
        },
      },
    ];
    await getShoppingProductDetail(BRAND, PRODUCT, { datePreset: '30d' });
    expect(
      filtered
        .filter(([, column]) => column === 'prompt_results.prompt_id')
        .map(([, , count]) => count),
    ).toEqual([100, 100, 100, 100, 50]);
  });

  it("counts a category's own products on its shelves, not the brand's others", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
    try {
      const CATEGORY = '22222222-0000-0000-0000-000000000002';
      tables.actions = [
        {
          id: 'a8',
          action_no: 8,
          completed_at: '2026-10-20T00:00:00Z',
          payload: { target: { type: 'category', id: CATEGORY }, promptIds: ['q1'] },
        },
      ];
      tables.catalog_product_categories = [{ product_id: 'boot', category_id: CATEGORY }];
      const prompt = { prompt_id: 'q1' };
      tables.prompt_result_shopping_cards = [
        // Before: one of the brand's products, not of the category.
        {
          created_at: '2026-10-15T08:00:00Z',
          platform: 'chatgpt-shopping',
          catalog_product_id: 'tee',
          prompt_results: prompt,
        },
        // After: the category's own.
        {
          created_at: '2026-10-22T08:00:00Z',
          platform: 'chatgpt-shopping',
          catalog_product_id: 'boot',
          prompt_results: prompt,
        },
      ];
      const results = await getShoppingActionResults(BRAND, [{ type: 'category', id: CATEGORY }]);
      expect(results[`category:${CATEGORY}`]).toMatchObject({
        before: { shelves: 1, on: 0 },
        after: { shelves: 1, on: 1 },
      });
      expect(byIds).toContainEqual(['catalog_product_categories', 'category_id', [CATEGORY]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't compare an action whose questions' cards stopped at the read's limit", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
    try {
      tables.actions = [
        {
          id: 'a9',
          action_no: 9,
          completed_at: '2026-10-20T00:00:00Z',
          payload: { target: { type: 'product', id: PRODUCT }, promptIds: ['q1'] },
        },
      ];
      // Only the week after's cards fit in the read, the newest first.
      const after = {
        created_at: '2026-10-22T08:00:00Z',
        platform: 'chatgpt-shopping',
        catalog_product_id: PRODUCT,
        prompt_results: { prompt_id: 'q1' },
      };
      const key = `product:${PRODUCT}`;
      tables.prompt_result_shopping_cards = Array.from({ length: 50_000 }, () => after);
      const cut = (await getShoppingActionResults(BRAND, [{ type: 'product', id: PRODUCT }]))[key];
      // The week before wasn't reached: not "new", nor "better".
      expect(cut).toMatchObject({ before: { shelves: 0 }, after: { shelves: 1, on: 1 } });
      expect(cut.partial).toBe(true);
      expect(resultTrend(cut)).toBeNull();
      // One card short of the limit: every card was read.
      tables.prompt_result_shopping_cards = Array.from({ length: 49_999 }, () => after);
      const whole = (await getShoppingActionResults(BRAND, [{ type: 'product', id: PRODUCT }]))[
        key
      ];
      expect(whole.partial).toBeUndefined();
      expect(resultTrend(whole)).toBe('new');
    } finally {
      vi.useRealTimers();
    }
  });
});
