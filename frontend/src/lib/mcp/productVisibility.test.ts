// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';
import type { ShoppingShelf } from '@/lib/actions/shopping';
import type { ProductRow } from '@/lib/shopping/products';
import type { ShelfRow } from '@/lib/shopping/shelf';

/**
 * Product Visibility over MCP (B6b): the Shelf with "Why not you?", the
 * Readiness checklist and a product's "What AI says", read by the page's own
 * loaders with the service role, for a brand of the key's organization on a
 * plan with Product Visibility.
 */

const brandAllowed = vi.hoisted(() => vi.fn());
// The plan check and its answer are the other shopping reads' own.
vi.mock('@/lib/mcp/data', async (importOriginal) => {
  const data = await importOriginal<typeof import('@/lib/mcp/data')>();
  return {
    brandAllowed,
    planIncludes: data.planIncludes,
    NOT_IN_PLAN: data.NOT_IN_PLAN,
    SHOPPING_NOT_IN_PLAN: data.SHOPPING_NOT_IN_PLAN,
  };
});

// The organization's plan row, and a catalog product, as the service role reads them.
const tables = vi.hoisted(() => ({
  organizations: [] as Record<string, unknown>[],
  catalog_products: [] as Record<string, unknown>[],
}));
const supabaseAdmin = vi.hoisted(() => ({
  from: (table: 'organizations' | 'catalog_products') => {
    const where: [string, unknown][] = [];
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        where.push([column, value]);
        return chain;
      },
      maybeSingle: async () => ({
        data: tables[table].find((row) => where.every(([c, v]) => row[c] === v)) ?? null,
        error: null,
      }),
    };
    return chain;
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin }));

// The page's loaders; each records the client its dbClient() answers.
const { dbClient } =
  await vi.importActual<typeof import('@/lib/supabase/scoped')>('@/lib/supabase/scoped');
const clients: unknown[] = [];
const loader = <T>(answer: () => T) =>
  vi.fn(async () => {
    clients.push(await dbClient());
    return answer();
  });
const shopping = vi.hoisted(() => ({
  getShoppingShelf: vi.fn(),
  getShoppingProducts: vi.fn(),
  getProductAiSays: vi.fn(),
  getResellerPriceAlerts: vi.fn(),
  getShoppingAmazonShareDropAlert: vi.fn(),
  getShoppingFilterOptions: vi.fn(),
  getShoppingOwnChannels: vi.fn(),
  getShoppingSearchAppearance: vi.fn(),
}));
vi.mock('@/lib/actions/shopping', () => shopping);
const getBrandMarketCountries = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/shoppingMarket', () => ({ getBrandMarketCountries }));
const getOpenAiIndexRead = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/shoppingOpenaiIndex', () => ({ getOpenAiIndexRead }));
const readCatalogSources = vi.hoisted(() => vi.fn());
vi.mock('@/lib/shopping/catalogRead', () => ({ readCatalogSources }));

const { getProductAiSaysFor, getShoppingReadinessFor, getShoppingShelfFor } =
  await import('./productVisibility');
const { NOT_IN_PLAN, planIncludes, SHOPPING_NOT_IN_PLAN } = await import('./data');

const BRAND = '11111111-1111-1111-1111-111111111111';
const PRODUCT = '22222222-2222-2222-2222-222222222222';
const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const row = (over: Partial<ShelfRow>): ShelfRow => ({
  key: 'k',
  promptId: 'q1',
  promptText: 'best trail running shoes',
  platform: 'chatgpt-shopping',
  at: '2026-10-28T08:00:00Z',
  cards: [
    {
      rank: 1,
      title: 'Speedgoat 6',
      price: 155,
      currency: 'USD',
      rating: 4.6,
      reviews: 812,
      image: 'https://img.example/s6.jpg',
      merchant: 'hoka.com',
      own: false,
      via: null,
      productId: null,
    },
  ],
  ownRank: null,
  weekShelves: 3,
  weekOwnShelves: 0,
  ...over,
});

const product = (
  id: string,
  title: string,
  readiness = 80,
  kind = 'Trail running shoes',
): ProductRow => ({
  product: {
    id,
    title,
    url: `https://shop.example/${id}`,
    productType: kind,
    brand: 'Acme',
    description: null,
    image: null,
    category: `Apparel > ${kind}`,
    price: 120,
    currency: 'USD',
    inStock: true,
    hasGtin: true,
  },
  shelves: 0,
  winRate: null,
  avgRank: null,
  aiVisits: 0,
  orders: 0,
  revenue: null,
  currency: null,
  readiness,
  missing: readiness < 100 ? ['gtin'] : [],
  wrongPrice: null,
});

const shelf = (rows: ShelfRow[], catalogProducts: number | null = 2): ShoppingShelf => ({
  rows,
  stats: {
    slots: 12,
    ownSlots: 3,
    products: 2,
    fromCatalog: true,
    channels: [{ platform: 'google-aimode', ownSlots: 3 }],
  },
  catalogProducts,
});

beforeEach(() => {
  clients.length = 0;
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  brandAllowed.mockReset().mockResolvedValue(true);
  tables.organizations = [
    { id: 'org-1', plan: 'growth', subscription_status: 'active', plan_overrides: null },
  ];
  tables.catalog_products = [{ id: PRODUCT, brand_id: BRAND, title: 'Ridge Trail 2' }];
  getBrandMarketCountries.mockReset().mockResolvedValue(['US-CA', 'DE']);
  shopping.getShoppingShelf.mockReset();
  // No catalog, unless a test gives one.
  shopping.getShoppingProducts.mockReset().mockResolvedValue(null);
  shopping.getProductAiSays.mockReset();
  shopping.getResellerPriceAlerts.mockReset();
  shopping.getShoppingAmazonShareDropAlert.mockReset();
  shopping.getShoppingFilterOptions.mockReset();
  shopping.getShoppingOwnChannels.mockReset();
  shopping.getShoppingSearchAppearance.mockReset();
  getOpenAiIndexRead.mockReset();
  readCatalogSources.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('who may read it', () => {
  it("answers nothing for another organization's brand, and reads nothing", async () => {
    brandAllowed.mockResolvedValue(false);
    expect(await getShoppingShelfFor(auth, { brandId: BRAND })).toBeNull();
    expect(await getShoppingReadinessFor(auth, { brandId: BRAND })).toBeNull();
    expect(await getProductAiSaysFor(auth, { brandId: BRAND, productId: PRODUCT })).toBeNull();
    expect(shopping.getShoppingShelf).not.toHaveBeenCalled();
    expect(shopping.getProductAiSays).not.toHaveBeenCalled();
  });

  it('needs a plan with Product Visibility, as the page’s tabs do', async () => {
    tables.organizations[0].plan = 'starter';
    expect(await getShoppingShelfFor(auth, { brandId: BRAND })).toBe(NOT_IN_PLAN);
    expect(await getShoppingReadinessFor(auth, { brandId: BRAND })).toBe(NOT_IN_PLAN);
    expect(await getProductAiSaysFor(auth, { brandId: BRAND, productId: PRODUCT })).toBe(
      NOT_IN_PLAN,
    );
    expect(shopping.getShoppingShelf).not.toHaveBeenCalled();
    // The same check as the other shopping reads (list_shopping_cards,
    // get_product_visibility), so a client gets one answer: plan_limit.
    expect(await planIncludes('org-1', 'shopping_analytics')).toBe(false);
    expect(SHOPPING_NOT_IN_PLAN.error).toBe('plan_limit');
  });

  it('reads on for a trial that ended, as the read-only page does, and on a self-hosted one', async () => {
    shopping.getShoppingShelf.mockImplementation(loader(() => shelf([])));
    tables.organizations[0] = {
      ...tables.organizations[0],
      plan: 'growth',
      subscription_status: 'canceled',
    };
    expect(await getShoppingShelfFor(auth, { brandId: BRAND })).toMatchObject({ total: 0 });
    // Its own plan, ended, without Product Visibility stays locked.
    tables.organizations[0].plan = 'starter';
    expect(await getShoppingShelfFor(auth, { brandId: BRAND })).toBe(NOT_IN_PLAN);
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await getShoppingShelfFor(auth, { brandId: BRAND })).toMatchObject({ total: 0 });
  });
});

describe('get_shopping_shelf', () => {
  it("reads the page's shelves with the service role, on the brand's market", async () => {
    shopping.getShoppingShelf.mockImplementation(
      loader(() => shelf([row({ ownRank: 2, weekOwnShelves: 2 })])),
    );
    const page = await getShoppingShelfFor(auth, { brandId: BRAND, platform: 'chatgpt-shopping' });
    expect(clients).toEqual([supabaseAdmin]);
    expect(shopping.getShoppingShelf).toHaveBeenCalledWith(BRAND, {
      datePreset: '30d',
      platforms: ['chatgpt-shopping'],
      // A US state among the brand's countries opens the US market.
      chatgptMarket: 'us',
    });
    expect(page).toMatchObject({
      period: '30d',
      market: 'us',
      stats: {
        slots: 12,
        own_slots: 3,
        products: 2,
        from_catalog: true,
        channels: [{ platform: 'google-aimode', own_slots: 3 }],
      },
      catalog_products: 2,
      total: 1,
      next_offset: null,
    });
    expect(page !== NOT_IN_PLAN && page && 'shelves' in page && page.shelves[0]).toEqual({
      prompt_id: 'q1',
      prompt: 'best trail running shoes',
      platform: 'chatgpt-shopping',
      read_at: '2026-10-28T08:00:00Z',
      own_rank: 2,
      week_shelves: 3,
      week_own_shelves: 2,
      products: [
        {
          rank: 1,
          title: 'Speedgoat 6',
          price: 155,
          currency: 'USD',
          rating: 4.6,
          reviews: 812,
          merchant: 'hoka.com',
          own: false,
          via: null,
          product_id: null,
        },
      ],
      products_total: 1,
      why_not_you: null,
    });
    // The products for "Why not you?" are read beside the shelves, as the page does.
    expect(shopping.getShoppingProducts).toHaveBeenCalledWith(BRAND, {
      datePreset: '30d',
      platforms: ['chatgpt-shopping'],
      chatgptMarket: 'us',
    });
  });

  it('reads the products beside the shelves, and waits for them only when a shelf lacks the brand', async () => {
    let shelfDone: (value: ShoppingShelf) => void = () => {};
    shopping.getShoppingShelf.mockReturnValue(
      new Promise<ShoppingShelf>((resolve) => (shelfDone = resolve)),
    );
    shopping.getShoppingProducts.mockRejectedValue(new Error('timeout'));
    const read = getShoppingShelfFor(auth, { brandId: BRAND });
    await vi.waitFor(() => expect(shopping.getShoppingProducts).toHaveBeenCalled());
    // Every shelf has the brand: a failed products read is none of its business.
    shelfDone(shelf([row({ ownRank: 1 })]));
    expect(await read).toMatchObject({ total: 1 });
    // A shelf without it needs them: their read's failure is the call's.
    shopping.getShoppingShelf.mockResolvedValue(shelf([row({})]));
    await expect(getShoppingShelfFor(auth, { brandId: BRAND })).rejects.toThrow('timeout');
  });

  it("gives a shelf's first 10 products, and pages 10 shelves at a time, 50 at most", async () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({ ...row({}).cards[0], rank: i + 1 }));
    shopping.getShoppingShelf.mockResolvedValue(
      shelf(
        Array.from({ length: 60 }, (_, i) =>
          row({ key: `k${i}`, promptId: `q${i}`, ownRank: 1, cards }),
        ),
      ),
    );
    const page = await getShoppingShelfFor(auth, { brandId: BRAND });
    if (!page || page === NOT_IN_PLAN || !('shelves' in page)) throw new Error('no shelves');
    expect(page).toMatchObject({ total: 60, next_offset: 10 });
    expect(page.shelves).toHaveLength(10);
    expect(page.shelves[0].products.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(page.shelves[0].products_total).toBe(12);
    const most = await getShoppingShelfFor(auth, { brandId: BRAND, limit: 500 });
    expect(most !== NOT_IN_PLAN && most && 'shelves' in most && most.shelves).toHaveLength(50);
  });

  it('says which of its products a shelf it isn’t on asks for most', async () => {
    shopping.getShoppingShelf.mockResolvedValue(shelf([row({})]));
    shopping.getShoppingProducts.mockResolvedValue({
      total: 2,
      // The readier tee isn't what the question asks for.
      rows: [
        product('p-tee', 'Logo Tee', 100, 'T-shirts'),
        product('p-ridge', 'Ridge Trail 2 Running Shoes', 70),
      ],
    });
    const page = await getShoppingShelfFor(auth, { brandId: BRAND, market: 'europe' });
    expect(getBrandMarketCountries).not.toHaveBeenCalled();
    expect(shopping.getShoppingProducts).toHaveBeenCalledWith(BRAND, {
      datePreset: '30d',
      platforms: undefined,
      chatgptMarket: 'europe',
    });
    expect(
      page !== NOT_IN_PLAN && page && 'shelves' in page && page.shelves[0].why_not_you,
    ).toEqual({
      product_id: 'p-ridge',
      title: 'Ridge Trail 2 Running Shoes',
      url: 'https://shop.example/p-ridge',
      price: 120,
      currency: 'USD',
      readiness: { score: 70, missing: ['gtin'] },
    });
  });

  it('pages the shelves, keeps those it isn’t on when asked, and reads no market it can’t tell', async () => {
    getBrandMarketCountries.mockResolvedValue(['BR']);
    shopping.getShoppingShelf.mockResolvedValue(
      shelf(
        [
          row({ key: 'a', promptId: 'a' }),
          row({ key: 'b', promptId: 'b' }),
          row({ key: 'c', promptId: 'c', ownRank: 1 }),
        ],
        null,
      ),
    );
    const first = await getShoppingShelfFor(auth, { brandId: BRAND, limit: 2, period: '7d' });
    expect(first).toMatchObject({ market: null, period: '7d', total: 3, next_offset: 2 });
    expect(shopping.getShoppingShelf).toHaveBeenCalledWith(BRAND, {
      datePreset: '7d',
      platforms: undefined,
      chatgptMarket: undefined,
    });
    // No catalog: no "Why not you?" to give.
    expect(
      first !== NOT_IN_PLAN && first && 'shelves' in first && first.shelves[0].why_not_you,
    ).toBeNull();
    const absent = await getShoppingShelfFor(auth, { brandId: BRAND, absentOnly: true, offset: 1 });
    expect(absent).toMatchObject({ total: 2, next_offset: null });
    expect(
      absent !== NOT_IN_PLAN &&
        absent &&
        'shelves' in absent &&
        absent.shelves.map((s) => s.prompt_id),
    ).toEqual(['b']);
  });
});

describe('get_shopping_readiness', () => {
  const source = { id: 's1', kind: 'shopify', format: 'shopify', products: 2 };

  beforeEach(() => {
    readCatalogSources.mockResolvedValue([source]);
    shopping.getShoppingProducts.mockResolvedValue({
      total: 2,
      rows: [product('p1', 'Ridge Trail 2'), product('p2', 'Logo Tee', 100)],
    });
    getOpenAiIndexRead.mockResolvedValue({ directFeed: false, ownCards: 4 });
    shopping.getResellerPriceAlerts.mockResolvedValue([{ product: 'Ridge Trail 2' }]);
    shopping.getShoppingAmazonShareDropAlert.mockResolvedValue(null);
    shopping.getShoppingFilterOptions.mockResolvedValue({
      platforms: ['chatgpt-shopping', 'google-aimode'],
      regions: [],
    });
    shopping.getShoppingOwnChannels.mockImplementation(loader(() => ['google-aimode']));
    shopping.getShoppingSearchAppearance.mockResolvedValue({ state: 'not_connected', pages: [] });
    // The API offers Merchant Center (its internal config, read with the cron secret).
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true, config: { googleMerchantCenter: true } })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("neither lists nor scores Merchant Center where the API doesn't offer it, or can't say", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true, config: { googleMerchantCenter: false } })),
    );
    let read = await getShoppingReadinessFor(auth, { brandId: BRAND });
    if (!read || read === NOT_IN_PLAN || !('checks' in read)) throw new Error('no readiness');
    expect(read.checks.map((c) => c.key)).not.toContain('merchantCenter');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    read = await getShoppingReadinessFor(auth, { brandId: BRAND });
    if (!read || read === NOT_IN_PLAN || !('checks' in read)) throw new Error('no readiness');
    expect(read.checks.map((c) => c.key)).not.toContain('merchantCenter');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/integrations-config'),
      expect.objectContaining({ headers: { Authorization: 'Bearer cron-secret' } }),
    );
  });

  it('checks the catalog as the Readiness tab does, in its words, with where each fix starts', async () => {
    const read = await getShoppingReadinessFor(auth, { brandId: BRAND });
    expect(clients).toEqual([supabaseAdmin]);
    expect(readCatalogSources).toHaveBeenCalledWith(supabaseAdmin, BRAND);
    expect(getOpenAiIndexRead).toHaveBeenCalledWith(BRAND, '30d');
    if (!read || read === NOT_IN_PLAN || !('checks' in read)) throw new Error('no readiness');
    expect(read.market).toBe('us');
    expect(read.unread).toEqual([]);
    expect(typeof read.score).toBe('number');
    const check = (key: string) => read.checks.find((c) => c.key === key);
    expect(check('catalog')).toEqual({
      key: 'catalog',
      state: 'pass',
      title: 'Catalog connected',
      detail: '2 products from your feed, file or store.',
      fix: null,
    });
    expect(check('merchantCenter')).toMatchObject({ state: 'warn', fix: 'settings' });
    // Google's shopping results, from the brand's Search Console (00377).
    expect(shopping.getShoppingSearchAppearance).toHaveBeenCalledWith(BRAND);
    expect(check('googleShopping')).toEqual({
      key: 'googleShopping',
      state: 'unknown',
      title: 'Google shows your products in shopping results (Search Console)',
      detail:
        'Connect Search Console to see whether Google shows your products in its shopping results.',
      fix: 'settings',
    });
    expect(check('openAiIndex')).toMatchObject({
      state: 'warn',
      title: "Catalog in OpenAI's product index",
    });
    expect(check('resellerCheaper')).toMatchObject({
      state: 'fail',
      title: 'Reseller cheaper than you · 1 product',
    });
    expect(check('amazonShare')).toBeUndefined();
    expect(read.channels).toEqual([
      { platform: 'chatgpt-shopping', state: 'notShowing' },
      { platform: 'google-aio', state: 'notTracked' },
      { platform: 'google-aimode', state: 'showing' },
      { platform: 'gemini-web', state: 'notTracked' },
      { platform: 'copilot-web', state: 'notTracked' },
    ]);
    // The channels from one row each, not the shelves' every card.
    expect(shopping.getShoppingOwnChannels).toHaveBeenCalledWith(BRAND, {
      datePreset: '30d',
      chatgptMarket: 'us',
    });
    expect(shopping.getShoppingShelf).not.toHaveBeenCalled();
  });

  it("says so when the channels can't be read, and keeps the checklist", async () => {
    shopping.getShoppingOwnChannels.mockRejectedValue(new Error('timeout'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = await getShoppingReadinessFor(auth, { brandId: BRAND });
    if (!read || read === NOT_IN_PLAN || !('checks' in read)) throw new Error('no readiness');
    expect(read.channels).toBeNull();
    expect(read.unread).toEqual(['channels']);
    expect(typeof read.score).toBe('number');
  });

  it('writes a wrong price as a price', async () => {
    shopping.getShoppingProducts.mockResolvedValue({
      total: 1,
      rows: [
        {
          ...product('p1', 'Ridge Trail 2'),
          wrongPrice: { seen: 99, currency: 'USD', platform: 'chatgpt-shopping' },
        },
      ],
    });
    const read = await getShoppingReadinessFor(auth, { brandId: BRAND });
    if (!read || read === NOT_IN_PLAN || !('checks' in read)) throw new Error('no readiness');
    expect(read.checks.find((c) => c.key === 'wrongPrice')).toMatchObject({
      state: 'fail',
      detail: 'AI shows $99 for Ridge Trail 2, your price is $120.',
      fix: 'products',
    });
  });

  it("checks Europe without OpenAI's index, and gives no score when the products can't be read", async () => {
    shopping.getShoppingProducts.mockRejectedValue(new Error('timeout'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = await getShoppingReadinessFor(auth, { brandId: BRAND, market: 'europe' });
    if (!read || read === NOT_IN_PLAN || !('checks' in read)) throw new Error('no readiness');
    expect(getOpenAiIndexRead).not.toHaveBeenCalled();
    expect(read.market).toBe('europe');
    expect(read.score).toBeNull();
    expect(read.unread).toEqual(['products']);
    expect(read.checks.map((c) => c.key)).not.toContain('openAiIndex');
    expect(read.checks.find((c) => c.key === 'merchantCenter')).toMatchObject({ state: 'fail' });
  });

  it("checks a brand with no market as the US's, without reading OpenAI's index for it", async () => {
    getBrandMarketCountries.mockResolvedValue(['BR']);
    const read = await getShoppingReadinessFor(auth, { brandId: BRAND });
    if (!read || read === NOT_IN_PLAN || !('checks' in read)) throw new Error('no readiness');
    expect(read.market).toBe('us');
    expect(getOpenAiIndexRead).not.toHaveBeenCalled();
    expect(read.checks.map((c) => c.key)).not.toContain('openAiIndex');
    expect(read.checks.map((c) => c.key)).toContain('verifiedSeller');
  });
});

describe('get_product_ai_says', () => {
  it("quotes what AI said about the brand's product, as its page does", async () => {
    shopping.getProductAiSays.mockImplementation(
      loader(() => ({
        answers: 3,
        quotes: [
          {
            text: 'The Ridge Trail 2 grips well on wet rock.',
            platform: 'chatgpt-shopping',
            at: '2026-10-27T10:00:00Z',
            promptText: 'best trail running shoes',
          },
        ],
        sources: [
          { url: 'https://runrepeat.com/ridge', domain: 'runrepeat.com', title: null, answers: 2 },
        ],
      })),
    );
    const says = await getProductAiSaysFor(auth, {
      brandId: BRAND,
      productId: PRODUCT,
      period: '90d',
    });
    expect(clients).toEqual([supabaseAdmin]);
    expect(shopping.getProductAiSays).toHaveBeenCalledWith(BRAND, PRODUCT, { datePreset: '90d' });
    expect(says).toEqual({
      product_id: PRODUCT,
      title: 'Ridge Trail 2',
      period: '90d',
      answers: 3,
      quotes: [
        {
          text: 'The Ridge Trail 2 grips well on wet rock.',
          platform: 'chatgpt-shopping',
          at: '2026-10-27T10:00:00Z',
          prompt: 'best trail running shoes',
        },
      ],
      sources: [
        { url: 'https://runrepeat.com/ridge', domain: 'runrepeat.com', title: null, answers: 2 },
      ],
    });
  });

  it("answers nothing for a product that isn't the brand's", async () => {
    tables.catalog_products = [{ id: PRODUCT, brand_id: 'another-brand', title: 'Ridge Trail 2' }];
    expect(await getProductAiSaysFor(auth, { brandId: BRAND, productId: PRODUCT })).toBeNull();
    expect(shopping.getProductAiSays).not.toHaveBeenCalled();
  });
});
