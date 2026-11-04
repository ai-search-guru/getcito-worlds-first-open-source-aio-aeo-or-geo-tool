import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * The catalog over MCP (B6a): its sources and last syncs, and a page of its
 * products as Product Visibility reads them, each with its readiness, its
 * Merchant Center issues and its page's AI visits and orders.
 */

const brandAllowed = vi.hoisted(() => vi.fn());
// The shopping reads' plan check: whether the plan has shopping analytics.
const planIncludes = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mcp/data', () => ({ brandAllowed, planIncludes }));
// The REST mirror's key: the organization's.
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
    role: 'admin',
  })),
}));

// The paged reads and the Merchant Center check run as they are; the
// Product Visibility reads answer what each test says.
const read = vi.hoisted(() => ({
  readCatalogSources: vi.fn(),
  readCatalogProducts: vi.fn(),
}));
vi.mock('@/lib/shopping/catalogRead', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shopping/catalogRead')>()),
  ...read,
}));

type Row = Record<string, unknown>;

/** What each table holds, and how many of its rows a count says. */
let tables: Record<string, Row[]>;
let counts: Record<string, number>;
/** Every filter asked, by table. */
let filters: [string, string, unknown][];
let rpcArgs: Record<string, unknown>[];
let stats: Row[];

/**
 * A PostgREST table as the service role reads it: `eq` and `in` filter the
 * rows that have the column, a page is `.range()`, a count is `count`, an
 * answer stops at max_rows' 1,000 rows, and an offset past the rows counted
 * is refused (416, PGRST103).
 */
const MAX_ROWS = 1000;

function query(table: string) {
  const where: [string, (value: unknown) => boolean][] = [];
  let counted = false;
  let head = false;
  const matched = () =>
    (tables[table] ?? []).filter((row) =>
      where.every(([column, keep]) => !(column in row) || keep(row[column])),
    );
  const total = () => counts[table] ?? matched().length;
  const chain = {
    select: (_columns: string, options?: { count?: string; head?: boolean }) => {
      counted = options?.count === 'exact';
      head = options?.head ?? false;
      return chain;
    },
    eq: (column: string, value: unknown) => {
      filters.push([table, column, value]);
      where.push([column, (v) => v === value]);
      return chain;
    },
    in: (column: string, values: unknown[]) => {
      filters.push([table, column, values]);
      where.push([column, (v) => values.includes(v)]);
      return chain;
    },
    is: () => chain,
    regexIMatch: (column: string, pattern: string) => {
      filters.push([table, column, pattern]);
      return chain;
    },
    order: () => chain,
    limit: async (n: number) => ({ data: matched().slice(0, n), error: null }),
    range: async (start: number, end: number) =>
      counted && start > total()
        ? {
            data: null,
            count: null,
            error: { code: 'PGRST103', message: 'Requested range not satisfiable' },
          }
        : {
            data: matched().slice(start, Math.min(end + 1, start + MAX_ROWS)),
            count: counted ? total() : null,
            error: null,
          },
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ data: head ? null : matched().slice(0, MAX_ROWS), count: total(), error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => query(table),
    rpc: (_fn: string, args: Record<string, unknown>) => {
      rpcArgs.push(args);
      return { order: () => ({ range: async () => ({ data: stats, error: null }) }) };
    },
  },
}));

const { getCatalogSourcesFor, listCatalogProductsFor } = await import('./catalog');
const { GET: productsRoute } = await import('@/app/api/mcp/catalog/products/route');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Boots ${id}`,
  url: `https://acme.example/p/${id}`,
  productType: 'Boots',
  brand: 'Acme',
  description: `Boots for the trail, waterproof and light. ${'They keep feet dry and warm on long walks. '.repeat(10)}`,
  image: 'https://acme.example/i.jpg',
  category: 'Shoes > Boots',
  price: 120,
  currency: 'USD',
  inStock: true,
  hasGtin: true,
  ...over,
});

const merchantCenter = (lastStatus = 'ok') => [
  { id: 's1', kind: 'merchant_center', last_status: lastStatus },
];

/** Every table read was the brand's, and only the brand's. */
function expectBrandScoped(brandId: string) {
  const read = new Set(filters.map(([table]) => table));
  for (const table of read) {
    expect(
      filters.filter(([t, column]) => t === table && column === 'brand_id').map(([, , v]) => v),
      table,
    ).toEqual(expect.arrayContaining([brandId]));
    expect(
      filters.some(([t, column, v]) => t === table && column === 'brand_id' && v !== brandId),
      table,
    ).toBe(false);
  }
  for (const args of rpcArgs) expect(args.p_brand_id).toBe(brandId);
}

beforeEach(() => {
  brandAllowed.mockReset().mockResolvedValue(true);
  planIncludes.mockReset().mockResolvedValue(true);
  read.readCatalogSources.mockReset();
  read.readCatalogProducts.mockReset();
  tables = {};
  counts = {};
  filters = [];
  rpcArgs = [];
  stats = [];
});

describe('getCatalogSourcesFor', () => {
  it("gives each source and its last sync in the MCP's names", async () => {
    read.readCatalogSources.mockResolvedValue([
      {
        id: 's1',
        kind: 'merchant_center',
        format: 'auto',
        url: null,
        account: '123456',
        label: 'Acme',
        lastSyncedAt: '2026-10-28T03:00:00Z',
        lastStatus: 'ok',
        lastError: null,
        lastCounts: { format: 'merchant_center', items: 40, skipped: 0 },
        products: 38,
      },
    ]);
    expect(await getCatalogSourcesFor(auth, 'brand-1')).toEqual([
      {
        id: 's1',
        kind: 'merchant_center',
        format: 'auto',
        url: null,
        account: '123456',
        label: 'Acme',
        last_synced_at: '2026-10-28T03:00:00Z',
        last_status: 'ok',
        last_error: null,
        last_counts: { format: 'merchant_center', items: 40, skipped: 0 },
        products: 38,
      },
    ]);
    expect(read.readCatalogSources).toHaveBeenCalledWith(expect.anything(), 'brand-1');
  });

  it("answers null for another organization's brand, without reading it", async () => {
    brandAllowed.mockResolvedValue(false);
    expect(await getCatalogSourcesFor(auth, 'brand-2')).toBeNull();
    expect(read.readCatalogSources).not.toHaveBeenCalled();
  });
});

describe('listCatalogProductsFor', () => {
  it('reads a page of products as Product Visibility does, with readiness, issues and AI stats', async () => {
    tables.catalog_products = [{ id: 'p1' }, { id: 'p2' }];
    counts.catalog_products = 5;
    tables.catalog_sources = merchantCenter();
    tables.catalog_variants = [
      { product_id: 'p1', external_id: 'offer-1' },
      { product_id: 'p2', external_id: 'offer-2' },
      { product_id: 'p2', external_id: 'offer-3' },
    ];
    tables.catalog_item_issues = [
      // One issue in two destinations and on two of its variants: once.
      { external_id: 'offer-2', severity: 'disapproved', code: 'missing_gtin', attribute: 'gtin' },
      { external_id: 'offer-2', severity: 'disapproved', code: 'missing_gtin', attribute: 'gtin' },
      { external_id: 'offer-3', severity: 'disapproved', code: 'missing_gtin', attribute: 'gtin' },
      { external_id: 'offer-3', severity: 'demoted', code: 'image_too_small', attribute: null },
      { external_id: 'offer-3', severity: 'unknown', code: 'odd', attribute: null },
    ];
    stats = [{ product_id: 'p1', ai_visits: 12, orders: 2, revenue: 240, currency: 'USD' }];
    // The catalog reads them in its own order; the page keeps the title order.
    read.readCatalogProducts.mockResolvedValue([
      product('p2', { hasGtin: false, inStock: false }),
      product('p1'),
    ]);

    const page = (await listCatalogProductsFor(auth, { brandId: 'brand-1', limit: 2 }))!;

    expect(read.readCatalogProducts).toHaveBeenCalledWith(expect.anything(), 'brand-1', [
      'p1',
      'p2',
    ]);
    expect(page.total).toBe(5);
    expect(page.next_offset).toBe(2);
    expect(page.products.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(page.products[0]).toMatchObject({
      title: 'Boots p1',
      readiness: { score: 100, missing: [], unknown: [] },
      merchant_center_issues: { disapproved: 0, demoted: 0, not_impacted: 0 },
      ai_visits_30d: 12,
      orders_30d: 2,
      revenue_30d: 240,
      revenue_currency: 'USD',
    });
    expect(page.products[1]).toMatchObject({
      in_stock: false,
      has_gtin: false,
      readiness: { missing: ['gtin', 'inStock'] },
      merchant_center_issues: { disapproved: 1, demoted: 1, not_impacted: 0 },
      ai_visits_30d: 0,
      orders_30d: 0,
      revenue_30d: null,
    });
    expect(planIncludes).toHaveBeenCalledWith('org-1', 'shopping_analytics');
    expectBrandScoped('brand-1');
  });

  describe('by plan: readiness, issues and AI visits are shopping analytics', () => {
    /** One product with a Merchant Center issue and AI visits. */
    const withAnalytics = () => {
      tables.catalog_products = [{ id: 'p1' }];
      tables.catalog_sources = merchantCenter();
      tables.catalog_variants = [{ product_id: 'p1', external_id: 'offer-1' }];
      tables.catalog_item_issues = [
        { external_id: 'offer-1', severity: 'demoted', code: 'image_too_small', attribute: null },
      ];
      stats = [{ product_id: 'p1', ai_visits: 12, orders: 2, revenue: 240, currency: 'USD' }];
      read.readCatalogProducts.mockResolvedValue([product('p1', { hasGtin: false })]);
    };
    const listed = {
      id: 'p1',
      title: 'Boots p1',
      price: 120,
      currency: 'USD',
      in_stock: true,
      has_gtin: false,
    };
    const rest = async () => {
      const res = await productsRoute(
        new Request('http://localhost/api/mcp/catalog/products?brand_id=brand-1'),
      );
      expect(res.status).toBe(200);
      return res.json();
    };

    it('gives them on a plan with it (Growth), over MCP and REST', async () => {
      withAnalytics();
      const growth = {
        ...listed,
        readiness: { score: expect.any(Number), missing: ['gtin'], unknown: [] },
        merchant_center_issues: { disapproved: 0, demoted: 1, not_impacted: 0 },
        ai_visits_30d: 12,
        orders_30d: 2,
        revenue_30d: 240,
        revenue_currency: 'USD',
      };
      const page = (await listCatalogProductsFor(auth, { brandId: 'brand-1' }))!;
      expect(page.products).toEqual([expect.objectContaining(growth)]);
      expect((await rest()).products).toEqual([expect.objectContaining(growth)]);
    });

    it('gives them as null without it (Starter), the products still listed, and reads neither', async () => {
      withAnalytics();
      planIncludes.mockResolvedValue(false);
      const starter = {
        ...listed,
        readiness: null,
        merchant_center_issues: null,
        ai_visits_30d: null,
        orders_30d: null,
        revenue_30d: null,
        revenue_currency: null,
      };
      const page = (await listCatalogProductsFor(auth, { brandId: 'brand-1' }))!;
      expect(page).toMatchObject({ total: 1, next_offset: null });
      expect(page.products).toEqual([expect.objectContaining(starter)]);
      const body = await rest();
      expect(body).toMatchObject({ total: 1, next_offset: null });
      expect(body.products).toEqual([expect.objectContaining(starter)]);
      expect(planIncludes).toHaveBeenCalledWith('org-1', 'shopping_analytics');
      expect(filters.some(([table]) => table === 'catalog_item_issues')).toBe(false);
      expect(rpcArgs).toEqual([]);
    });

    it("checks the plan only for the key's own brand", async () => {
      brandAllowed.mockResolvedValue(false);
      expect(await listCatalogProductsFor(auth, { brandId: 'brand-2' })).toBeNull();
      expect(planIncludes).not.toHaveBeenCalled();
    });
  });

  it('finds a search as written: its regex characters, % and _ stay themselves', async () => {
    tables.catalog_products = [{ id: 'p1' }];
    read.readCatalogProducts.mockResolvedValue([product('p1')]);
    await listCatalogProductsFor(auth, { brandId: 'brand-1', search: ' Boots (50%_off)* ' });
    expect(filters).toContainEqual(['catalog_products', 'title', 'Boots \\(50%_off\\)\\*']);
  });

  it('reads every variant and issue past a 1,000-row page, 100 ids a request', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `p${i}`);
    tables.catalog_products = ids.map((id) => ({ id }));
    tables.catalog_sources = merchantCenter();
    // Ten variants each: the first hundred products' come to 1,000 rows.
    tables.catalog_variants = ids.flatMap((id) =>
      Array.from({ length: 10 }, (_, j) => ({ product_id: id, external_id: `${id}-v${j}` })),
    );
    tables.catalog_item_issues = [
      // 1,100 issues on one offer: past one page.
      ...Array.from({ length: 1100 }, (_, i) => ({
        external_id: 'p0-v0',
        severity: 'disapproved',
        code: `issue-${i}`,
        attribute: null,
      })),
      { external_id: 'p149-v9', severity: 'not_impacted', code: 'gtin_hint', attribute: 'gtin' },
    ];
    read.readCatalogProducts.mockResolvedValue(ids.map((id) => product(id)));

    const page = (await listCatalogProductsFor(auth, { brandId: 'brand-1', limit: 150 }))!;
    const issues = new Map(page.products.map((p) => [p.id, p.merchant_center_issues]));
    expect(issues.get('p0')).toEqual({ disapproved: 1100, demoted: 0, not_impacted: 0 });
    expect(issues.get('p1')).toEqual({ disapproved: 0, demoted: 0, not_impacted: 0 });
    expect(issues.get('p149')).toEqual({ disapproved: 0, demoted: 0, not_impacted: 1 });
    const idLists = filters.filter(([, , v]) => Array.isArray(v)).map(([, , v]) => v as unknown[]);
    expect(Math.max(...idLists.map((list) => list.length))).toBe(100);
    expectBrandScoped('brand-1');
  });

  it('gives no Merchant Center issues without an account whose last sync went through', async () => {
    tables.catalog_products = [{ id: 'p1' }];
    read.readCatalogProducts.mockResolvedValue([product('p1')]);
    tables.catalog_sources = [];
    let page = (await listCatalogProductsFor(auth, { brandId: 'brand-1' }))!;
    expect(page.products[0].merchant_center_issues).toBeNull();
    expect(page.next_offset).toBeNull();

    tables.catalog_sources = merchantCenter('auth_failed');
    page = (await listCatalogProductsFor(auth, { brandId: 'brand-1' }))!;
    expect(page.products[0].merchant_center_issues).toBeNull();
    expect(filters.some(([table]) => table === 'catalog_item_issues')).toBe(false);
  });

  it('answers an empty page past the end, which PostgREST refuses once it counts', async () => {
    counts.catalog_products = 3;
    expect(await listCatalogProductsFor(auth, { brandId: 'brand-1', offset: 10 })).toEqual({
      total: 3,
      products: [],
      next_offset: null,
    });
    // At the end itself PostgREST answers no rows.
    expect(await listCatalogProductsFor(auth, { brandId: 'brand-1', offset: 3 })).toEqual({
      total: 3,
      products: [],
      next_offset: null,
    });
    expect(read.readCatalogProducts).not.toHaveBeenCalled();
  });

  it("answers null for another organization's brand, without reading it", async () => {
    brandAllowed.mockResolvedValue(false);
    expect(await listCatalogProductsFor(auth, { brandId: 'brand-2' })).toBeNull();
    expect(filters).toEqual([]);
    expect(read.readCatalogProducts).not.toHaveBeenCalled();
  });
});
