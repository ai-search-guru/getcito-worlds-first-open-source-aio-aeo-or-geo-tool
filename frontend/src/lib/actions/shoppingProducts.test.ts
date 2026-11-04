import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Products table's read (ECOM-007): the catalog, its cards on the shelves and its AI visits and orders. */

const BRAND = '33333333-3333-3333-3333-333333333333';

let tables: Record<string, Record<string, unknown>[]>;
let catalogCount: number;
let stats: Record<string, unknown>[];
const rpcCalls: { name: string; args: Record<string, unknown>; range?: [number, number] }[] = [];
const cardFilters: Record<string, unknown>[] = [];
// The id lists each read filtered by, as [table, column, how many].
let filtered: [string, string, number][];

/** A table read, or an RPC's rows (`rows`), with the PostgREST calls it gets; pages of 1000 at most. */
function query(
  table: string,
  rows?: () => Record<string, unknown>[],
  onRange?: (r: [number, number]) => void,
) {
  const state: {
    eq: Record<string, unknown>;
    in: [string, unknown[]][];
    not: string[];
    head?: boolean;
    range?: [number, number];
  } = {
    eq: {},
    in: [],
    not: [],
  };
  const q = {
    select: (_columns: string, opts?: { head?: boolean }) => ((state.head = opts?.head), q),
    eq: (column: string, value: unknown) => ((state.eq[column] = value), q),
    not: (column: string) => (state.not.push(column), q),
    is: () => q,
    in: (column: string, values: unknown[]) => (
      state.in.push([column, values]),
      filtered.push([table, column, values.length]),
      q
    ),
    gte: () => q,
    lte: () => q,
    or: () => q,
    order: () => q,
    range: (from: number, to: number) => ((state.range = [from, to]), onRange?.([from, to]), q),
    then: (resolve: (value: unknown) => void) => {
      if (state.head) return resolve({ data: null, count: catalogCount, error: null });
      if (table === 'prompt_result_shopping_cards')
        cardFilters.push({ ...state.eq, not: state.not });
      const [from, to] = state.range ?? [0, 999];
      const found = (rows ? rows() : (tables[table] ?? [])).filter((row) =>
        state.in.every(([column, values]) => values.includes(row[column])),
      );
      resolve({ data: found.slice(from, Math.min(to, from + 999) + 1), error: null });
    },
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => query(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      const call: (typeof rpcCalls)[number] = { name, args };
      rpcCalls.push(call);
      return query(
        name,
        () => stats,
        (range) => (call.range = range),
      );
    },
  })),
}));

const { getShoppingProducts } = await import('./shopping');

beforeEach(() => {
  tables = {};
  stats = [];
  catalogCount = 0;
  rpcCalls.length = 0;
  cardFilters.length = 0;
  filtered = [];
  vi.useFakeTimers({ now: new Date('2026-10-27T12:00:00Z'), toFake: ['Date'] });
});

describe('getShoppingProducts', () => {
  it('reads no catalog as none', async () => {
    expect(await getShoppingProducts(BRAND, { datePreset: '30d' })).toBeNull();
  });

  it("joins each product's variants, first photo, category, shelves and AI visits and orders", async () => {
    catalogCount = 2;
    tables.catalog_products = [
      {
        id: 'p1',
        title: 'Trail Runner X',
        url: null,
        product_type: 'Shoes',
        product_brand: 'Northwind',
        description: null,
      },
      {
        id: 'p2',
        title: 'Ridge 30L',
        url: null,
        product_type: null,
        product_brand: null,
        description: null,
      },
    ];
    tables.catalog_variants = [
      {
        product_id: 'p1',
        gtin: null,
        price: 149,
        sale_price: 129,
        currency: 'USD',
        availability: 'In Stock',
      },
      {
        product_id: 'p1',
        gtin: '0012345678905',
        price: 99,
        sale_price: null,
        currency: 'USD',
        availability: 'out of stock',
      },
      {
        product_id: 'p2',
        gtin: null,
        price: 119,
        sale_price: null,
        currency: 'USD',
        availability: 'out_of_stock',
      },
    ];
    tables.catalog_images = [
      { product_id: 'p1', url: 'https://cdn.example/b.jpg', position: 2 },
      { product_id: 'p1', url: 'https://cdn.example/a.jpg', position: 0 },
    ];
    tables.catalog_product_categories = [
      { product_id: 'p1', category: { name: 'Shoes > Trail running' } },
      { product_id: 'p1', category: { name: 'Sale' } },
    ];
    tables.prompt_result_shopping_cards = [
      {
        catalog_product_id: 'p1',
        position: 0,
        platform: 'chatgpt-shopping',
        prompt_results: { prompt_id: 'q1' },
      },
      {
        catalog_product_id: 'p1',
        position: 2,
        platform: 'copilot-web',
        prompt_results: { prompt_id: 'q1' },
      },
    ];
    stats = [{ product_id: 'p1', ai_visits: 318, orders: 41, revenue: '5300.00', currency: 'USD' }];

    const read = await getShoppingProducts(BRAND, { datePreset: '30d' });
    expect(read?.total).toBe(2);
    const [p1, p2] = read!.rows;
    // In stock: the in-stock variant's sale price, not the cheaper sold-out one.
    expect(p1.product).toMatchObject({
      image: 'https://cdn.example/a.jpg',
      category: 'Shoes > Trail running',
      price: 129,
      inStock: true,
      hasGtin: true,
    });
    // Every variant's prices, for an answer's price to be checked against (ECOM-016).
    expect(p1.product.prices).toEqual([
      { price: 149, currency: 'USD' },
      { price: 129, currency: 'USD' },
      { price: 99, currency: 'USD' },
    ]);
    expect(p1).toMatchObject({
      shelves: 2,
      winRate: 0.5,
      avgRank: 2,
      aiVisits: 318,
      orders: 41,
      revenue: 5300,
    });
    expect(p2.product).toMatchObject({ price: 119, inStock: false, image: null, category: null });
    expect(cardFilters[0]).toEqual({
      brand_id: BRAND,
      matched_brand_role: 'own',
      not: ['catalog_product_id'],
    });
    expect(rpcCalls).toEqual([
      {
        name: 'catalog_product_ai_stats',
        args: { p_brand_id: BRAND, p_from: '2026-09-27T12:00:00.000Z' },
        range: [0, 999],
      },
    ]);
    // A catalog the table holds whole is read by the brand, not by ids.
    expect(filtered).toEqual([]);
  });

  it('reads the last 90 days of visits and orders for All time', async () => {
    catalogCount = 1;
    tables.catalog_products = [
      {
        id: 'p1',
        title: 'X',
        url: null,
        product_type: null,
        product_brand: null,
        description: null,
      },
    ];
    await getShoppingProducts(BRAND, { datePreset: 'all' });
    expect(rpcCalls[0].args.p_from).toBe('2026-07-29T12:00:00.000Z');
  });

  it("reads every page of the products' AI visits and orders, past PostgREST's 1000 rows", async () => {
    catalogCount = 1500;
    tables.catalog_products = Array.from({ length: 1500 }, (_, i) => ({
      id: `p${String(i).padStart(4, '0')}`,
      title: `Product ${i}`,
    }));
    stats = tables.catalog_products.map(({ id }) => ({
      product_id: id,
      ai_visits: 1,
      orders: 0,
      revenue: null,
      currency: null,
    }));
    const read = await getShoppingProducts(BRAND, { datePreset: '30d' });
    expect(rpcCalls.map((call) => call.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(read!.rows.every((row) => row.aiVisits === 1)).toBe(true);
  });

  describe('a catalog bigger than the table', () => {
    const id = (i: number) => `p${String(i).padStart(5, '0')}`;
    beforeEach(() => {
      catalogCount = 3000;
      tables.catalog_products = Array.from({ length: 3000 }, (_, i) => ({
        id: id(i),
        title: `Product ${i}`,
      }));
      tables.catalog_variants = tables.catalog_products.map((p) => ({
        product_id: p.id,
        gtin: null,
        price: 10,
        sale_price: null,
        currency: 'USD',
        availability: 'in stock',
      }));
    });

    it('lists the products on a shelf or visited from AI first, then the rest by id', async () => {
      // Past the first 2,000 by id: one on a shelf, one visited, one sold.
      tables.prompt_result_shopping_cards = [
        {
          catalog_product_id: id(2900),
          position: 0,
          platform: 'chatgpt-shopping',
          prompt_results: { prompt_id: 'q1' },
        },
      ];
      stats = [
        { product_id: id(2950), ai_visits: 12, orders: 0, revenue: null, currency: null },
        { product_id: id(2990), ai_visits: 3, orders: 2, revenue: '80.00', currency: 'USD' },
      ];
      const read = await getShoppingProducts(BRAND, { datePreset: '30d' });
      expect(read!.total).toBe(3000);
      const ids = read!.rows.map((row) => row.product.id);
      expect(ids).toHaveLength(2000);
      expect(ids).toEqual(expect.arrayContaining([id(2900), id(2950), id(2990), id(0), id(1996)]));
      expect(ids).not.toContain(id(1997));
      expect(read!.rows.find((row) => row.product.id === id(2990))).toMatchObject({
        orders: 2,
        product: { price: 10, inStock: true },
      });
    });

    it("reads the listed products' rows, variants among them, a hundred ids at a time", async () => {
      await getShoppingProducts(BRAND, { datePreset: '30d' });
      for (const table of [
        'catalog_products',
        'catalog_variants',
        'catalog_images',
        'catalog_product_categories',
      ]) {
        const reads = filtered.filter(([name]) => name === table).map(([, , count]) => count);
        expect(reads, table).toHaveLength(20);
        expect(reads.every((count) => count === 100)).toBe(true);
      }
    });
  });
});
