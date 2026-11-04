import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Shelf's reads (ECOM-006): the cards with their questions, the catalog's count, and AI orders. */

const BRAND = '33333333-3333-3333-3333-333333333333';

let tables: Record<string, Record<string, unknown>[]>;
let catalogCount: number | null;
const reads: {
  table: string;
  eq: Record<string, unknown>;
  gte?: [string, string];
  in?: Record<string, unknown[]>;
  limit?: number;
}[] = [];

function query(table: string) {
  const state: {
    table: string;
    eq: Record<string, unknown>;
    gte?: [string, string];
    range?: [number, number];
    head?: boolean;
    in?: Record<string, unknown[]>;
    limit?: number;
  } = {
    table,
    eq: {},
  };
  const q = {
    select: (_columns: string, opts?: { head?: boolean }) => ((state.head = opts?.head), q),
    eq: (column: string, value: unknown) => ((state.eq[column] = value), q),
    is: () => q,
    in: (column: string, values: unknown[]) => ((state.in = { ...state.in, [column]: values }), q),
    limit: (count: number) => ((state.limit = count), q),
    lte: () => q,
    or: () => q,
    gte: (column: string, value: string) => ((state.gte = [column, value]), q),
    order: () => q,
    range: (from: number, to: number) => ((state.range = [from, to]), q),
    then: (resolve: (value: unknown) => void) => {
      reads.push({
        table: state.table,
        eq: state.eq,
        gte: state.gte,
        ...(state.in ? { in: state.in } : {}),
        ...(state.limit === undefined ? {} : { limit: state.limit }),
      });
      if (state.head) return resolve({ data: null, count: catalogCount, error: null });
      const rows = (tables[table] ?? []).filter(
        (row) =>
          Object.entries(state.eq).every(([k, v]) => !(k in row) || row[k] === v) &&
          Object.entries(state.in ?? {}).every(([k, vs]) => vs.includes(row[k])),
      );
      const [from, to] = state.range ?? [0, (state.limit ?? 1000) - 1];
      resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: query })),
}));

const { getShoppingAiOrders, getShoppingOwnChannels, getShoppingShelf } =
  await import('./shopping');

beforeEach(() => {
  tables = {};
  catalogCount = null;
  reads.length = 0;
  vi.useFakeTimers({ now: new Date('2026-10-27T12:00:00Z'), toFake: ['Date'] });
});

describe('getShoppingShelf', () => {
  it("reads the cards with their questions, and counts the catalog's products", async () => {
    catalogCount = 320;
    tables.prompt_result_shopping_cards = [
      {
        prompt_result_id: 'r1',
        position: 0,
        created_at: '2026-10-27T08:00:00Z',
        platform: 'chatgpt-shopping',
        product_title: 'Trail Runner X',
        price_amount: 129,
        price_currency: 'USD',
        image_url: null,
        merchant_domain: 'northwind.example',
        rating: 4.6,
        review_count: 86,
        matched_brand_role: 'own',
        merchant_kind: 'own',
        marketplace: null,
        catalog_product_id: 'cp1',
        prompt_results: { prompt: { id: 'p1', text: 'best trail shoes' } },
      },
    ];
    const shelf = await getShoppingShelf(BRAND, { datePreset: '30d' });
    expect(shelf.catalogProducts).toBe(320);
    expect(shelf.rows.map((row) => [row.promptText, row.ownRank])).toEqual([
      ['best trail shoes', 1],
    ]);
    expect(shelf.stats).toMatchObject({ slots: 1, ownSlots: 1, products: 1, fromCatalog: true });
  });

  it('reads no catalog as none', async () => {
    catalogCount = 0;
    expect((await getShoppingShelf(BRAND, { datePreset: '7d' })).catalogProducts).toBeNull();
  });
});

describe('getShoppingOwnChannels', () => {
  it("names the channels with the brand's own products, one row read a channel", async () => {
    const card = (platform: string, role: string) => ({
      id: `${platform}-${role}`,
      platform,
      matched_brand_role: role,
    });
    tables.prompt_result_shopping_cards = [
      card('chatgpt-shopping', 'own'),
      card('chatgpt-shopping', 'own'),
      card('google-aio', 'competitor'),
      card('gemini-web', 'own'),
    ];
    expect(await getShoppingOwnChannels(BRAND, { datePreset: '30d' })).toEqual([
      'chatgpt-shopping',
      'gemini-web',
    ]);
    expect(reads).toHaveLength(5);
    for (const read of reads) {
      expect(read).toMatchObject({
        table: 'prompt_result_shopping_cards',
        eq: { brand_id: BRAND, matched_brand_role: 'own' },
        limit: 1,
      });
    }
    expect(reads.map((read) => read.in?.platform)).toEqual([
      ['chatgpt-shopping'],
      ['google-aio'],
      ['google-aimode'],
      ['gemini-web'],
      ['copilot-web'],
    ]);
  });

  it('reads every channel whatever the platform filter, and no brand that isn’t an id', async () => {
    tables.prompt_result_shopping_cards = [
      { id: 'c1', platform: 'google-aimode', matched_brand_role: 'own' },
    ];
    expect(
      await getShoppingOwnChannels(BRAND, { datePreset: '7d', platforms: ['chatgpt-shopping'] }),
    ).toEqual(['google-aimode']);
    await expect(getShoppingOwnChannels('nope', { datePreset: '7d' })).rejects.toThrow('invalid');
  });
});

describe('getShoppingAiOrders', () => {
  it("counts the last 30 days' orders against the 30 before, in the main currency, by AI source", async () => {
    tables.ai_traffic_events = [
      {
        value: 100,
        currency: 'USD',
        first_source: 'chatgpt.com',
        occurred_at: '2026-10-20T00:00:00Z',
      },
      {
        value: 50,
        currency: 'USD',
        first_source: 'chatgpt.com',
        occurred_at: '2026-10-10T00:00:00Z',
      },
      {
        value: 80,
        currency: 'EUR',
        first_source: 'copilot.microsoft.com',
        occurred_at: '2026-10-05T00:00:00Z',
      },
      {
        value: null,
        currency: null,
        first_source: 'perplexity.ai',
        occurred_at: '2026-10-01T00:00:00Z',
      },
      // The 30 days before.
      {
        value: 60,
        currency: 'USD',
        first_source: 'chatgpt.com',
        occurred_at: '2026-09-20T00:00:00Z',
      },
      {
        value: 40,
        currency: 'EUR',
        first_source: 'chatgpt.com',
        occurred_at: '2026-09-15T00:00:00Z',
      },
    ];
    const orders = await getShoppingAiOrders(BRAND);
    expect(orders).toEqual({
      orders: 4,
      previousOrders: 2,
      revenue: { value: 150, currency: 'USD' },
      previousRevenue: 60,
      channels: [
        { source: 'chatgpt.com', orders: 2 },
        { source: 'copilot.microsoft.com', orders: 1 },
        { source: 'perplexity.ai', orders: 1 },
      ],
    });
    expect(reads.at(-1)).toMatchObject({
      table: 'ai_traffic_events',
      eq: { brand_id: BRAND, kind: 'conversion', goal: 'order' },
      gte: ['occurred_at', '2026-08-28T12:00:00.000Z'],
    });
  });

  it('has no revenue when no order carries a value', async () => {
    tables.ai_traffic_events = [
      {
        value: null,
        currency: null,
        first_source: 'chatgpt.com',
        occurred_at: '2026-10-20T00:00:00Z',
      },
    ];
    expect(await getShoppingAiOrders(BRAND)).toMatchObject({
      orders: 1,
      revenue: null,
      previousRevenue: null,
    });
  });
});
