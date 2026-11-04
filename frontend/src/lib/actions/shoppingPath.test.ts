import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Brief › Shopping path (shopping path, part 3): read, save, build and search. */

const DRAFT = '77777777-7777-7777-7777-777777777777';
const BRAND = '33333333-3333-3333-3333-333333333333';

interface Call {
  table: string;
  op: string;
  value?: unknown;
  filters: [string, string, unknown][];
  orders: [string, unknown][];
  limit?: number;
  range?: [number, number];
}
type Answer = { data: unknown; error: { message: string } | null };
let calls: Call[];
let read: Answer;
/** A read's answer by what it asks, where one table's reads differ; `read` otherwise. */
let answer: ((call: Call) => Answer | undefined) | null;
let written: { data: unknown; error: { message: string } | null };
let session: { access_token: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [], orders: [] };
      calls.push(call);
      const result = () => (call.op === 'update' ? written : (answer?.(call) ?? read));
      const filter = (kind: string) => (col: string, v: unknown) => (
        call.filters.push([kind, col, v]),
        chain
      );
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: filter('eq'),
        is: filter('is'),
        ilike: filter('ilike'),
        in: filter('in'),
        order: (col: string, opts: unknown) => (call.orders.push([col, opts]), chain),
        limit: (n: number) => ((call.limit = n), chain),
        range: (from: number, to: number) => ((call.range = [from, to]), chain),
        update: (value: unknown) => ((call.op = 'update'), (call.value = value), chain),
        maybeSingle: async () => result(),
        then: (resolve: (r: unknown) => void) => resolve(result()),
      };
      return chain;
    },
  })),
}));

const {
  buildDraftShoppingPath,
  getDraftShoppingPath,
  getProductsForBlock,
  getShoppingCheck,
  saveDraftShoppingPath,
  searchCatalogProducts,
  searchProductsForBlock,
} = await import('./shoppingPath');

const product = (id: string) => ({
  id,
  title: `Boot ${id}`,
  url: `https://s.example/p/${id}`,
  price: 129,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 5,
});

const STORED = {
  version: 1,
  builtAt: '2026-10-27T12:00:00.000Z',
  pageType: 'buying_guide',
  categories: [],
  // As the API wrote it: the tab reads it as "limited_availability".
  products: [{ ...product('a'), availability: 'Limited Availability' }, product('b')],
  leftOut: [],
  locked: ['a'],
  removed: [],
  added: [],
};

const fetchMock = vi.fn();
const respond = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  calls = [];
  read = { data: null, error: null };
  answer = null;
  written = { data: [{ id: DRAFT }], error: null };
  session = { access_token: 'jwt' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('getDraftShoppingPath', () => {
  it('reads the path, none until built, and none for a draft it can’t see', async () => {
    read.data = { shopping_path: STORED };
    expect(await getDraftShoppingPath(DRAFT)).toMatchObject({
      path: { builtAt: STORED.builtAt, products: [{ availability: 'limited_availability' }, {}] },
    });
    read.data = { shopping_path: null };
    expect(await getDraftShoppingPath(DRAFT)).toEqual({ path: null });
    read.data = null;
    expect(await getDraftShoppingPath(DRAFT)).toBeNull();
  });

  it('says a kept path it can’t read is unreadable, and a failed read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      read.data = { shopping_path: { ...STORED, version: 2 } };
      expect(await getDraftShoppingPath(DRAFT)).toEqual({ path: null, unreadable: true });
    } finally {
      error.mockRestore();
    }
    read = { data: null, error: { message: 'boom' } };
    await expect(getDraftShoppingPath(DRAFT)).rejects.toThrow('boom');
    await expect(getDraftShoppingPath('nope')).rejects.toThrow('invalid');
  });
});

describe('saveDraftShoppingPath', () => {
  const choices = { locked: [], removed: ['a'], added: ['c'] };

  it('saves the choices alone, over the path read, its removed products out', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-27T13:00:00.000Z') });
    read.data = { shopping_path: STORED };
    const saved = await saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, choices);

    const update = calls.find((c) => c.op === 'update')!;
    // The rest as the API wrote it, not as the tab reads it.
    expect(update.value).toEqual({
      shopping_path: {
        ...STORED,
        products: [product('b')],
        locked: [],
        removed: ['a'],
        added: ['c'],
        savedAt: '2026-10-27T13:00:00.000Z',
      },
    });
    expect(update.filters).toEqual([
      ['eq', 'id', DRAFT],
      ['eq', 'shopping_path->>builtAt', STORED.builtAt],
      ['is', 'shopping_path->>savedAt', null],
    ]);
    expect(saved).toMatchObject({
      path: { savedAt: '2026-10-27T13:00:00.000Z', products: [{ id: 'b' }], added: ['c'] },
    });
  });

  it('writes only over the last change read', async () => {
    const savedAt = '2026-10-27T12:30:00.000Z';
    read.data = { shopping_path: { ...STORED, savedAt } };
    await saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt, savedAt }, choices);
    expect(calls.find((c) => c.op === 'update')!.filters).toContainEqual([
      'eq',
      'shopping_path->>savedAt',
      savedAt,
    ]);
  });

  it('says the path changed when it was built or changed since it was read', async () => {
    read.data = { shopping_path: { ...STORED, builtAt: '2026-10-27T12:45:00.000Z' } };
    expect(await saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, choices)).toEqual({
      error: 'changed',
    });
    read.data = { shopping_path: { ...STORED, savedAt: '2026-10-27T12:50:00.000Z' } };
    expect(await saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, choices)).toEqual({
      error: 'changed',
    });
    expect(calls.some((c) => c.op === 'update')).toBe(false);

    // Between the read and the write: no row matched.
    read.data = { shopping_path: STORED };
    written = { data: [], error: null };
    expect(await saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, choices)).toEqual({
      error: 'changed',
    });
  });

  it('refuses choices past the caps, and fails on a failed write', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `i${i}`);
    await expect(
      saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, { ...choices, locked: ids }),
    ).rejects.toThrow('invalid');
    read.data = { shopping_path: STORED };
    written = { data: null, error: { message: 'denied' } };
    await expect(
      saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, choices),
    ).rejects.toThrow('denied');
  });
});

describe('buildDraftShoppingPath', () => {
  it('builds through the API and reads the path it answers', async () => {
    respond(200, { path: STORED });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toMatchObject({
      path: { builtAt: STORED.builtAt },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(new RegExp(`/api/content-drafts/${DRAFT}/shopping-path$`));
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ brandId: BRAND }) });
  });

  it('says why a draft takes none, a reason added since in general words', async () => {
    respond(200, { path: null, reason: 'no_match' });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ path: null, reason: 'no_match' });
    respond(200, { path: null, reason: 'paused' });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ path: null, reason: 'other' });
  });

  it('tells a change meanwhile and too many picks from a failure', async () => {
    respond(409, { error: 'The shopping path changed while it was built', code: 'changed' });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ error: 'changed' });
    respond(429, { success: false, message: 'Too many requests, please try again later.' });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ error: 'rate_limited' });
    respond(502, { code: 'failed' });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ error: 'failed' });
    respond(200, { path: { ...STORED, version: 2 } });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ error: 'failed' });
    session = null;
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ error: 'failed' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('searchCatalogProducts', () => {
  it('searches the live catalog for the words as typed, wildcards and all', async () => {
    read.data = [{ id: 'p9', title: '50% off boots', url: null }];
    expect(await searchCatalogProducts(BRAND, ' 50%_off\\ ')).toEqual([
      { id: 'p9', title: '50% off boots', url: null },
    ]);
    expect(calls[0].filters).toEqual([
      ['eq', 'brand_id', BRAND],
      ['is', 'removed_at', null],
      ['ilike', 'title', '%50\\%\\_off\\\\%'],
    ]);
  });

  it('waits for two letters, and fails on a failed read', async () => {
    expect(await searchCatalogProducts(BRAND, 'a')).toEqual([]);
    expect(calls).toHaveLength(0);
    read = { data: null, error: { message: 'boom' } };
    await expect(searchCatalogProducts(BRAND, 'boots')).rejects.toThrow('boom');
  });
});

describe('getProductsForBlock', () => {
  const id = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
  const [P1, P2, P3, P4, P5, P6] = [1, 2, 3, 4, 5, 6].map(id);
  const row = (n: number): { id: string; title: string; url: string | null } => ({
    id: id(n),
    title: `Boot ${n}`,
    url: `https://s.example/p/${n}`,
  });
  const variant = (price: number | null, availability: string | null, extra = {}) => ({
    url: null,
    price,
    sale_price: null,
    currency: 'USD',
    availability,
    ...extra,
  });
  const of = (call: Call) => call.filters.find(([, col]) => col === 'product_id')?.[2] as string;
  /** The catalog: its live products, and each one's variants and pictures, read by its id. */
  const catalog = ({
    products = [] as ReturnType<typeof row>[],
    variants = {} as Record<string, ReturnType<typeof variant>[]>,
    images = {} as Record<string, { url: string }[]>,
    errors = {} as Record<string, string>,
  }) => {
    answer = (call) => {
      if (errors[call.table]) return { data: null, error: { message: errors[call.table] } };
      if (call.table === 'catalog_products') return { data: products, error: null };
      if (call.table === 'catalog_variants') return { data: variants[of(call)] ?? [], error: null };
      if (call.table === 'catalog_images') return { data: images[of(call)] ?? [], error: null };
    };
  };

  it("shows each one's best stock, then its cheapest variant there, however the feed spells it, a sale price counted", async () => {
    catalog({
      products: [row(1), row(2), row(4)],
      variants: {
        // The cheapest sold out; "In Stock" is in stock.
        [P1]: [variant(99, 'Out of Stock'), variant(189, 'in_stock'), variant(149, 'In Stock')],
        // In stock before low stock, though the low-stock one sells for less
        // (as the agent's grid picks it, #1607); on sale, the cheapest it sells at.
        [P4]: [
          variant(130, 'LIMITED AVAILABILITY', { sale_price: 110, currency: 'EUR' }),
          variant(125, 'in_stock'),
          variant(140, 'in_stock', { sale_price: 115, currency: 'EUR' }),
        ],
        // All sold out: no price, not in stock.
        [P2]: [variant(50, 'sold out'), variant(40, 'preorder')],
      },
      images: { [P1]: [{ url: 'https://cdn.example/p1.jpg' }] },
    });
    expect(await getProductsForBlock(BRAND, [P1, P4, P2])).toEqual([
      {
        ...row(1),
        image: 'https://cdn.example/p1.jpg',
        price: 149,
        salePrice: null,
        currency: 'USD',
        inStock: true,
      },
      { ...row(4), image: null, price: 140, salePrice: 115, currency: 'EUR', inStock: true },
      { ...row(2), image: null, price: null, salePrice: null, currency: null, inStock: false },
    ]);
  });

  it('reads each product on its own: its live variants, its own picture first', async () => {
    catalog({ products: [row(1), row(2)] });
    await getProductsForBlock(BRAND, [P1, P2]);
    const variants = calls.filter((c) => c.table === 'catalog_variants');
    expect(variants.map((c) => c.filters)).toEqual([
      [
        ['eq', 'product_id', P1],
        ['is', 'removed_at', null],
      ],
      [
        ['eq', 'product_id', P2],
        ['is', 'removed_at', null],
      ],
    ]);
    expect(variants.every((c) => c.limit === undefined)).toBe(true);
    const images = calls.filter((c) => c.table === 'catalog_images');
    expect(images.map((c) => c.filters)).toEqual([
      [['eq', 'product_id', P1]],
      [['eq', 'product_id', P2]],
    ]);
    expect(images[0].orders).toEqual([
      ['variant_id', { ascending: true, nullsFirst: true }],
      ['position', { ascending: true }],
    ]);
    expect(images[0].limit).toBe(1);
    expect(calls.find((c) => c.table === 'catalog_products')!.filters).toEqual([
      ['eq', 'brand_id', BRAND],
      ['is', 'removed_at', null],
      ['in', 'id', [P1, P2]],
    ]);
  });

  it('keeps the order asked, leaves out one gone from the catalog, and reads four at most', async () => {
    catalog({
      // Read in another order; P3 is gone.
      products: [row(5), row(1), row(2), row(4), row(6)],
      variants: { [P1]: [variant(10, 'in_stock', { url: 'https://s.example/v/1' })] },
    });
    const read = await getProductsForBlock(BRAND, [P4, P3, P1, P1, 'nope', P2, P5, P6]);
    expect(read.map((p) => p.id)).toEqual([P4, P1, P2]);
    expect(calls.filter((c) => c.table === 'catalog_variants')).toHaveLength(4);
    // A product without a page of its own links its variant's.
    catalog({
      products: [{ ...row(1), url: null }],
      variants: { [P1]: [variant(10, 'in_stock', { url: 'https://s.example/v/1' })] },
    });
    expect((await getProductsForBlock(BRAND, [P1]))[0].url).toBe('https://s.example/v/1');
  });

  it('reads nothing for a brand or ids it cannot read, and fails on a failed read', async () => {
    expect(await getProductsForBlock('nope', [P1])).toEqual([]);
    expect(await getProductsForBlock(BRAND, ['nope'])).toEqual([]);
    expect(calls).toHaveLength(0);
    for (const table of ['catalog_products', 'catalog_variants', 'catalog_images']) {
      catalog({ products: [row(1)], errors: { [table]: `${table} down` } });
      await expect(getProductsForBlock(BRAND, [P1])).rejects.toThrow(`${table} down`);
    }
  });
});

describe('searchProductsForBlock', () => {
  it('finds products by name, each with its price and stock, without reading pictures', async () => {
    const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
    const P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
    answer = (call) => {
      if (call.table === 'catalog_products') {
        return {
          data: [
            { id: P1, title: 'Boot 1', url: 'https://s.example/p/1' },
            { id: P2, title: 'Boot 2', url: null },
          ],
          error: null,
        };
      }
      const id = call.filters.find(([, col]) => col === 'product_id')?.[2];
      return {
        data:
          id === P1
            ? [
                {
                  url: null,
                  price: 89,
                  sale_price: null,
                  currency: 'USD',
                  availability: 'In Stock',
                },
              ]
            : [
                {
                  url: null,
                  price: 59,
                  sale_price: null,
                  currency: 'USD',
                  availability: 'sold_out',
                },
              ],
        error: null,
      };
    };
    expect(await searchProductsForBlock(BRAND, 'boot')).toEqual([
      {
        id: P1,
        title: 'Boot 1',
        url: 'https://s.example/p/1',
        image: null,
        price: 89,
        salePrice: null,
        currency: 'USD',
        inStock: true,
      },
      {
        id: P2,
        title: 'Boot 2',
        url: null,
        image: null,
        price: null,
        salePrice: null,
        currency: null,
        inStock: false,
      },
    ]);
    expect(calls.some((c) => c.table === 'catalog_images')).toBe(false);
    expect(calls[0].filters).toContainEqual(['ilike', 'title', '%boot%']);
  });

  it('waits for two letters, and fails on a failed read', async () => {
    expect(await searchProductsForBlock(BRAND, 'b')).toEqual([]);
    expect(calls).toHaveLength(0);
    read = { data: null, error: { message: 'boom' } };
    await expect(searchProductsForBlock(BRAND, 'boots')).rejects.toThrow('boom');
  });
});

describe('getShoppingCheck', () => {
  const SHOP = '44444444-4444-4444-8444-444444444444';
  const P = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const inPath = (n: number, url = `https://shop.example/products/${n}`) => ({
    ...product(P(n)),
    title: `Boot ${n}`,
    url,
  });
  const pathOf = (over: Record<string, unknown> = {}) => ({
    ...STORED,
    categories: [
      { name: 'Boots', url: 'https://shop.example/collections/boots', title: null },
      // A link the path can't keep: nothing to check.
      { name: 'Odd', url: 'javascript:alert(1)', title: null },
    ],
    products: [],
    leftOut: [],
    locked: [],
    removed: [],
    added: [],
    ...over,
  });
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    id: P(n),
    brand_id: SHOP,
    title: `Catalog ${n}`,
    url: `https://shop.example/products/${n}`,
    removed_at: null,
    ...extra,
  });
  let variants = 0;
  const variant = (n: number, availability: string, extra: Record<string, unknown> = {}) => {
    variants += 1;
    return {
      id: `v${String(variants).padStart(6, '0')}`,
      brand_id: SHOP,
      product_id: P(n),
      external_id: `ext-${variants}`,
      url: null,
      availability,
      removed_at: null,
      ...extra,
    };
  };
  const issue = (v: { external_id: string }, context: string | null, severity = 'disapproved') => ({
    id: `i-${v.external_id}-${context}-${severity}`,
    brand_id: SHOP,
    external_id: v.external_id,
    severity,
    reporting_context: context,
  });

  /** The tables, read as PostgREST would: by their filters, a page at a time. */
  let db: Record<string, Record<string, unknown>[]>;
  let down: Record<string, string>;
  const draftRow = () => db.content_drafts[0];
  const of = (table: string) => calls.filter((c) => c.table === table);
  const inList = (call: Call) => call.filters.find(([kind]) => kind === 'in')?.[2] as string[];

  beforeEach(() => {
    variants = 0;
    down = {};
    db = {
      content_drafts: [
        {
          id: DRAFT,
          brand_id: SHOP,
          shopping_path: pathOf(),
          published_url: null,
          source_url: null,
        },
      ],
      brand_domains: [
        { brand_id: SHOP, domain: 'shop.example', is_primary: false },
        { brand_id: SHOP, domain: 'https://www.shop.example/', is_primary: true },
      ],
      catalog_products: [],
      catalog_variants: [],
      catalog_item_issues: [],
      catalog_sources: [],
    };
    answer = (call) => {
      if (down[call.table]) return { data: null, error: { message: down[call.table] } };
      let rows = (db[call.table] ?? []).filter((r) =>
        call.filters.every(([kind, col, v]) =>
          kind === 'eq'
            ? r[col] === v
            : kind === 'in'
              ? (v as unknown[]).includes(r[col])
              : kind === 'is'
                ? r[col] == null
                : true,
        ),
      );
      if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
      const single = call.table === 'content_drafts' || call.table === 'brand_domains';
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };
  });

  it('reads the price a card would show now, of the best stock, for each product that sells (#1610)', async () => {
    db.catalog_variants = [
      variant(1, 'limited_availability', { price: 149, sale_price: null, currency: 'USD' }),
      variant(1, 'in_stock', { price: 199, sale_price: 179, currency: 'USD' }),
      variant(2, 'in_stock', { price: null, sale_price: null, currency: 'USD' }),
      variant(3, 'out_of_stock', { price: 50, sale_price: null, currency: 'USD' }),
    ];
    db.catalog_products = [row(1), row(2), row(3)];
    draftRow().shopping_path = pathOf({ products: [1, 2, 3].map((n) => inPath(n)) });
    const check = await getShoppingCheck(DRAFT);
    expect(check?.products.map((p) => [p.state, p.price])).toEqual([
      ['ok', '$179.00'],
      ['ok', null],
      ['sold_out', null],
    ]);
  });

  it('reads each product now: gone, sold out, refused only when every variant in stock is', async () => {
    const v1 = variant(1, 'In Stock');
    const v3a = variant(3, 'in_stock');
    const v3b = variant(3, 'LIMITED AVAILABILITY');
    const v3c = variant(3, 'sold out');
    const v4a = variant(4, 'in_stock');
    const v4b = variant(4, 'in_stock');
    db.catalog_variants = [
      v1,
      variant(2, 'out_of_stock'),
      variant(2, 'preorder'),
      v3a,
      v3b,
      v3c,
      v4a,
      v4b,
      variant(7, 'in_stock'),
    ];
    db.catalog_item_issues = [
      // An ads refusal, and a warning for free listings: neither keeps it out.
      issue(v1, 'SHOPPING_ADS'),
      issue(v1, 'FREE_LISTINGS', 'warning'),
      // The free listings however written, or no destination: refused.
      issue(v3a, ' free_listings '),
      issue(v3b, null),
      // One variant refused, another in stock that isn't: it still sells.
      issue(v4a, 'FREE_LISTINGS'),
    ];
    db.catalog_products = [
      row(1),
      row(2),
      row(3),
      row(4),
      row(5, { removed_at: '2026-10-20' }),
      row(7),
    ];
    // 6 isn't in the catalog; 7's link the path couldn't keep.
    draftRow().shopping_path = pathOf({
      products: [1, 2, 3, 4, 5, 6].map((n) => inPath(n)).concat(inPath(7, '')),
    });

    expect(await getShoppingCheck(DRAFT)).toEqual({
      categories: ['shop.example/collections/boots'],
      products: (
        [
          [1, 'ok'],
          [2, 'sold_out'],
          [3, 'refused'],
          [4, 'ok'],
          [5, 'gone'],
          [6, 'gone'],
        ] as const
      ).map(([n, state]) => ({
        key: `shop.example/products/${n}`,
        title: `Boot ${n}`,
        state,
        inPath: true,
        // No variant here has a price.
        price: null,
      })),
      site: 'https://www.shop.example/',
      merchantCenter: false,
    });
    // The refusals of the variants in stock alone.
    expect(of('catalog_item_issues').flatMap(inList).sort()).toEqual(
      [v1, v3a, v3b, v4a, v4b, db.catalog_variants[8]].map((v) => v.external_id).sort(),
    );
  });

  it('checks the removed and left-out products that no longer sell, at the catalog’s page', async () => {
    db.catalog_products = [
      row(10),
      row(11),
      row(12, { removed_at: '2026-10-21' }),
      row(13, { url: null }),
    ];
    const v13 = variant(13, 'in_stock', { url: 'https://shop.example/products/13?variant=1' });
    db.catalog_variants = [variant(10, 'out_of_stock'), variant(11, 'in_stock'), v13];
    db.catalog_item_issues = [issue(v13, 'FREE_LISTINGS')];
    draftRow().shopping_path = pathOf({
      products: [inPath(1)],
      removed: [P(10), P(11), P(12), P(1)],
      leftOut: [
        { id: P(13), title: 'Left Boot', reason: 'refused' },
        { id: P(10), title: null, reason: 'sold_out' },
      ],
    });
    db.catalog_products.push(row(1));
    db.catalog_variants.push(variant(1, 'in_stock'));

    const check = await getShoppingCheck(DRAFT);
    expect(check!.products).toEqual([
      { key: 'shop.example/products/1', title: 'Boot 1', state: 'ok', inPath: true, price: null },
      // 11 still sells: linking it is fine.
      {
        key: 'shop.example/products/10',
        title: 'Catalog 10',
        state: 'sold_out',
        inPath: false,
        price: null,
      },
      {
        key: 'shop.example/products/12',
        title: 'Catalog 12',
        state: 'gone',
        inPath: false,
        price: null,
      },
      {
        key: 'shop.example/products/13?variant=1',
        title: 'Left Boot',
        state: 'refused',
        inPath: false,
        price: null,
      },
    ]);
  });

  it('reads the draft’s brand, 100 ids a request and every page of variants past 1,000', async () => {
    // 1,100 variants of the first, its 50 in stock on the second page.
    db.catalog_variants = Array.from({ length: 1100 }, (_, i) =>
      variant(1, i < 1050 ? 'out_of_stock' : 'in_stock'),
    );
    // 250 in stock, each refused: refused only once every refusal is read.
    const refusedOnes = Array.from({ length: 250 }, () => variant(2, 'in_stock'));
    db.catalog_variants.push(...refusedOnes);
    db.catalog_item_issues = refusedOnes.map((v) => issue(v, 'FREE_LISTINGS'));
    // 3 is another brand's: not this draft's catalog.
    db.catalog_products = [row(1), row(2), row(3, { brand_id: BRAND })];
    draftRow().shopping_path = pathOf({
      products: [inPath(1), inPath(2), inPath(3)],
      removed: Array.from({ length: 150 }, (_, i) => P(100 + i)),
    });

    const check = await getShoppingCheck(DRAFT);
    expect(check!.products.map((p) => p.state)).toEqual(['ok', 'refused', 'gone']);
    const catalog = ['catalog_products', 'catalog_variants', 'catalog_item_issues'].flatMap(of);
    for (const call of catalog) {
      expect(call.filters).toContainEqual(['eq', 'brand_id', SHOP]);
      expect(inList(call).length).toBeLessThanOrEqual(100);
      expect(call.limit).toBeUndefined();
    }
    expect(of('catalog_products').map((c) => inList(c).length)).toEqual([100, 53]);
    expect(of('catalog_variants').map((c) => c.range)).toContainEqual([1000, 1999]);
    expect(of('catalog_item_issues').map((c) => inList(c).length)).toEqual([100, 100, 100]);
  });

  it('says whether the brand has a Merchant Center account it read, none when it can’t be read', async () => {
    draftRow().shopping_path = pathOf({ products: [inPath(1)] });
    db.catalog_sources = [
      { id: 's1', brand_id: SHOP, kind: 'feed_url', last_status: 'ok' },
      { id: 's2', brand_id: BRAND, kind: 'merchant_center', last_status: 'ok' },
      { id: 's3', brand_id: SHOP, kind: 'merchant_center', last_status: 'auth_failed' },
      { id: 's4', brand_id: SHOP, kind: 'merchant_center', last_status: null },
    ];
    // A feed, another brand's Merchant Center, and this brand's never read
    // (its syncs failed, or none ran yet): none to claim it for.
    expect((await getShoppingCheck(DRAFT))!.merchantCenter).toBe(false);
    expect(of('catalog_sources').at(-1)!.filters).toEqual([
      ['eq', 'brand_id', SHOP],
      ['eq', 'kind', 'merchant_center'],
      ['eq', 'last_status', 'ok'],
    ]);
    db.catalog_sources.push({
      id: 's5',
      brand_id: SHOP,
      kind: 'merchant_center',
      last_status: 'ok',
    });
    expect((await getShoppingCheck(DRAFT))!.merchantCenter).toBe(true);

    // Unread: none said, and the rest of the check stands.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      down = { catalog_sources: 'down' };
      expect(await getShoppingCheck(DRAFT)).toMatchObject({
        products: [{ key: 'shop.example/products/1' }],
        merchantCenter: false,
      });
    } finally {
      error.mockRestore();
    }
  });

  it('reads a relative link against the live page, the page it optimizes, else the brand’s site', async () => {
    draftRow().published_url = 'https://shop.example/blog/boots';
    draftRow().source_url = 'https://shop.example/old';
    expect((await getShoppingCheck(DRAFT))!.site).toBe('https://shop.example/blog/boots');
    draftRow().published_url = null;
    expect((await getShoppingCheck(DRAFT))!.site).toBe('https://shop.example/old');
    expect(of('brand_domains')).toHaveLength(0);
    draftRow().source_url = null;
    expect((await getShoppingCheck(DRAFT))!.site).toBe('https://www.shop.example/');

    // The brand's site unread: no site, the rest of the check stands.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      down = { brand_domains: 'down' };
      expect(await getShoppingCheck(DRAFT)).toMatchObject({
        categories: ['shop.example/collections/boots'],
        site: null,
      });
    } finally {
      error.mockRestore();
    }
  });

  it('is null without a path, reads no catalog for an empty one, and fails on a failed read', async () => {
    draftRow().shopping_path = null;
    expect(await getShoppingCheck(DRAFT)).toBeNull();
    draftRow().shopping_path = pathOf();
    expect(await getShoppingCheck(DRAFT)).toMatchObject({ products: [], merchantCenter: false });
    expect(calls.some((c) => c.table.startsWith('catalog_'))).toBe(false);

    await expect(getShoppingCheck('nope')).rejects.toThrow('invalid');
    db.content_drafts = [];
    await expect(getShoppingCheck(DRAFT)).rejects.toThrow('not_found');
    for (const table of [
      'content_drafts',
      'catalog_products',
      'catalog_variants',
      'catalog_item_issues',
    ]) {
      db.content_drafts = [
        {
          id: DRAFT,
          brand_id: SHOP,
          shopping_path: pathOf({ products: [inPath(1)] }),
          published_url: null,
          source_url: null,
        },
      ];
      db.catalog_products = [row(1)];
      db.catalog_variants = [variant(1, 'in_stock')];
      down = { [table]: `${table} down` };
      await expect(getShoppingCheck(DRAFT)).rejects.toThrow(`${table} down`);
    }
  });

  it('is null for a kept path it can’t read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      draftRow().shopping_path = { ...pathOf(), version: 2 };
      expect(await getShoppingCheck(DRAFT)).toBeNull();
    } finally {
      error.mockRestore();
    }
  });
});
