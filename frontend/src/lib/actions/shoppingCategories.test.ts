import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Categories read (ECOM-008): the catalog's categories, their live products, the cards and the rivals. */

const BRAND = '33333333-3333-3333-3333-333333333333';

let tables: Record<string, Record<string, unknown>[]>;
let stats: Record<string, unknown>[];
// The pages of catalog_product_ai_stats read.
let statsPages: [number, number][];

/** An RPC's rows, a page of at most 1000 as PostgREST gives them. */
function rpcRows() {
  let range: [number, number] = [0, 999];
  const q = {
    order: () => q,
    range: (from: number, to: number) => ((range = [from, to]), statsPages.push(range), q),
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: stats.slice(range[0], Math.min(range[1], range[0] + 999) + 1), error: null }),
  };
  return q;
}

function query(table: string) {
  let range: [number, number] | undefined;
  const q = {
    select: () => q,
    eq: () => q,
    is: () => q,
    in: () => q,
    not: () => q,
    gte: () => q,
    lte: () => q,
    or: () => q,
    order: () => q,
    range: (from: number, to: number) => ((range = [from, to]), q),
    then: (resolve: (value: unknown) => void) => {
      const [from, to] = range ?? [0, 999];
      resolve({ data: (tables[table] ?? []).slice(from, to + 1), error: null });
    },
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: query,
    rpc: () => rpcRows(),
  })),
}));

const { getShoppingCategories } = await import('./shopping');

beforeEach(() => {
  tables = {};
  stats = [];
  statsPages = [];
});

describe('getShoppingCategories', () => {
  it('reads no categories as none', async () => {
    expect(await getShoppingCategories(BRAND, { datePreset: '30d' })).toBeNull();
  });

  it("counts a category's live products only, and names a competitor's card by the competitor", async () => {
    tables.catalog_categories = [{ id: 'packs', name: 'Hiking backpacks' }];
    tables.catalog_products = [{ id: 'ridge' }];
    tables.catalog_product_categories = [
      { product_id: 'ridge', category_id: 'packs' },
      { product_id: 'removed', category_id: 'packs' },
    ];
    tables.competitors = [{ id: 'c1', name: 'Summit Gear', domain: 'summitgear.example' }];
    tables.prompt_result_shopping_cards = [
      {
        matched_brand_role: 'competitor',
        matched_brand_id: 'c1',
        product_brand: 'Summit',
        merchant_domain: 'rei.com',
        catalog_product_id: null,
        prompt_results: { prompt: { id: 'q1', text: 'best hiking backpack' } },
      },
      {
        matched_brand_role: 'own',
        matched_brand_id: 'brand',
        product_brand: 'Northwind',
        merchant_domain: 'northwind.example',
        catalog_product_id: 'ridge',
        prompt_results: { prompt: { id: 'q1', text: 'best hiking backpack' } },
      },
      { matched_brand_role: 'other', prompt_results: null },
    ];
    stats = [{ product_id: 'ridge', ai_visits: 4, orders: 1, revenue: '119.00', currency: 'USD' }];
    expect(await getShoppingCategories(BRAND, { datePreset: '30d' })).toEqual([
      {
        id: 'packs',
        name: 'Hiking backpacks',
        leaf: 'Hiking backpacks',
        prompts: 1,
        promptIds: ['q1'],
        shelfShare: 0.5,
        productsOnShelf: 1,
        products: 1,
        topRival: { name: 'Summit Gear', domain: 'summitgear.example' },
        revenue: { value: 119, currency: 'USD' },
        needsAttention: false,
      },
    ]);
  });

  it("reads every page of the products' AI revenue, past PostgREST's 1000 rows", async () => {
    tables.catalog_categories = [{ id: 'packs', name: 'Hiking backpacks' }];
    tables.catalog_products = [{ id: 'p1200' }];
    tables.catalog_product_categories = [{ product_id: 'p1200', category_id: 'packs' }];
    stats = Array.from({ length: 1201 }, (_, i) => ({
      product_id: `p${i}`,
      ai_visits: 1,
      orders: 1,
      revenue: '10.00',
      currency: 'USD',
    }));
    const [packs] = (await getShoppingCategories(BRAND, { datePreset: '30d' }))!;
    expect(statsPages).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // The 1,201st product's revenue, past the first page.
    expect(packs.revenue).toEqual({ value: 10, currency: 'USD' });
  });
});
