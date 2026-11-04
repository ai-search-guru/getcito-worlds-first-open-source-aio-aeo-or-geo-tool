import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Does Google show the brand's products in its shopping results (00377)?
 * The sync reads the property's appearance types, then each shopping one's
 * pages by day filtered to it, and keeps them; a read the filter wasn't
 * applied to is dropped rather than kept as every page shown.
 */

const state = vi.hoisted(() => ({
  brand: null,
  calls: [],
  types: [],
  pages: {},
  upserts: [],
  deletes: [],
  updates: [],
}));

vi.mock('./composio.js', () => ({
  isComposioConfigured: () => true,
  queryGscSearchAnalytics: async (_entity, args) => {
    state.calls.push(args);
    if (args.dimensions[0] === 'searchAppearance') return state.types;
    const filter = args.dimension_filter_groups?.[0]?.filters?.[0];
    if (filter?.dimension === 'searchAppearance') return state.pages[filter.expression] ?? [];
    return [];
  },
}));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// The brand uses the Account's Google sign-in (00470).
vi.mock('./brandIntegrations.js', () => ({
  connectedBrands: async () => [
    {
      brandId: state.brand.id,
      organizationId: 'o1',
      entityId: 'org_o1',
      composioAccountId: 'ca_1',
      connected: true,
    },
  ],
  composioTarget: (c) => ({ entityId: c.entityId, accountId: c.composioAccountId }),
}));
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      let update = null;
      let deleting = false;
      const where = [];
      const chain = {
        select: () => chain,
        eq: (column, value) => (where.push([column, value]), chain),
        not: () => chain,
        in: () => chain,
        lt: (column, value) => (where.push([column, `< ${value}`]), chain),
        delete: () => ((deleting = true), chain),
        upsert: async (rows) => (state.upserts.push([table, rows]), { error: null }),
        update: (fields) => ((update = fields), chain),
        then: (resolve) => {
          if (update) {
            state.updates.push(update);
            Object.assign(state.brand, update);
            return resolve({ error: null });
          }
          if (deleting) {
            state.deletes.push([table, where]);
            return resolve({ error: null });
          }
          if (table === 'brands') return resolve({ data: [{ ...state.brand }], error: null });
          return resolve({ error: null });
        },
      };
      return chain;
    },
  },
}));
vi.mock('./activeSubscriptions.js', () => ({ activeOrgFilter: async () => () => true }));

const { mapShoppingRows, runGscSync, shoppingAppearance } = await import('./gscSync.js');

const row = (page, date, impressions) => ({
  keys: [page, date],
  clicks: 1,
  impressions,
  ctr: 0.1,
  position: 3,
});

beforeEach(() => {
  state.brand = {
    id: 'b1',
    organization_id: 'o1',
    gsc_property: 'sc-domain:acme.com',
    gsc_pages_backfilled_property: 'sc-domain:acme.com',
    gsc_pages_backfill_from: null,
    gsc_shopping_property: null,
  };
  state.calls = [];
  state.types = [];
  state.pages = {};
  state.upserts = [];
  state.deletes = [];
  state.updates = [];
});

const shoppingRows = () =>
  state.upserts.filter(([table]) => table === 'gsc_shopping_page_stats').flatMap(([, r]) => r);

describe('shoppingAppearance', () => {
  it('names the shopping types however the API spells them, and nothing else', () => {
    expect(shoppingAppearance('MERCHANT_LISTINGS')).toBe('merchant_listings');
    expect(shoppingAppearance('Merchant listings')).toBe('merchant_listings');
    expect(shoppingAppearance('PRODUCT_SNIPPETS')).toBe('product_snippets');
    expect(shoppingAppearance('REVIEW_SNIPPET')).toBeNull();
    expect(shoppingAppearance(undefined)).toBeNull();
  });

  it('maps a type’s rows to the table’s', () => {
    expect(
      mapShoppingRows('b1', 'product_snippets', [row('https://acme.com/a', '2026-10-01', 9)]),
    ).toEqual([
      {
        brand_id: 'b1',
        page: 'https://acme.com/a',
        date: '2026-10-01',
        clicks: 1,
        impressions: 9,
        ctr: 0.1,
        position: 3,
        appearance: 'product_snippets',
      },
    ]);
  });
});

describe('the shopping sync', () => {
  it("reads the property's types, then each shopping one's pages filtered to it", async () => {
    state.types = [
      { keys: ['MERCHANT_LISTINGS'], impressions: 30 },
      { keys: ['PRODUCT_SNIPPETS'], impressions: 5 },
      { keys: ['FAQ_RICH_RESULT'], impressions: 400 },
    ];
    state.pages = {
      MERCHANT_LISTINGS: [row('https://acme.com/kettle', '2026-10-01', 30)],
      PRODUCT_SNIPPETS: [row('https://acme.com/mug', '2026-10-02', 5)],
    };
    await runGscSync({ brandId: 'b1' });

    const appearances = state.calls.filter((c) => c.dimensions[0] === 'searchAppearance');
    expect(appearances).toHaveLength(1);
    // Counted by page, as the page rows are: by property, a result showing
    // several of the shop's products counts once.
    expect(appearances[0].aggregation_type).toBe('byPage');
    const filtered = state.calls
      .map((c) => c.dimension_filter_groups?.[0]?.filters?.[0]?.expression)
      .filter(Boolean);
    expect(filtered).toEqual(['MERCHANT_LISTINGS', 'PRODUCT_SNIPPETS']);
    expect(shoppingRows().map((r) => [r.page, r.appearance])).toEqual([
      ['https://acme.com/kettle', 'merchant_listings'],
      ['https://acme.com/mug', 'product_snippets'],
    ]);
    expect(state.brand).toMatchObject({
      gsc_shopping_property: 'sc-domain:acme.com',
      gsc_shopping_synced_at: expect.any(String),
    });
  });

  it('drops a read the filter was not applied to, and leaves the brand unread, not showing none', async () => {
    state.brand.gsc_shopping_synced_at = '2026-10-20T00:00:00.000Z';
    state.types = [
      { keys: ['MERCHANT_LISTINGS'], impressions: 3 },
      { keys: ['PRODUCT_SNIPPETS'], impressions: 5 },
    ];
    // Every page of the property, as an unfiltered read would give.
    state.pages = {
      MERCHANT_LISTINGS: [
        row('https://acme.com/a', '2026-10-01', 900),
        row('https://acme.com/b', '2026-10-01', 400),
      ],
      PRODUCT_SNIPPETS: [row('https://acme.com/mug', '2026-10-02', 5)],
    };
    await runGscSync({ brandId: 'b1' });
    expect(shoppingRows().map((r) => [r.page, r.appearance])).toEqual([
      ['https://acme.com/mug', 'product_snippets'],
    ]);
    expect(state.brand.gsc_shopping_synced_at).toBeNull();
  });

  it("drops another property's rows first, and marks a property with none shown as read", async () => {
    state.brand.gsc_shopping_property = 'sc-domain:old.com';
    await runGscSync({ brandId: 'b1' });
    expect(state.deletes).toContainEqual(['gsc_shopping_page_stats', [['brand_id', 'b1']]]);
    expect(shoppingRows()).toEqual([]);
    expect(state.brand.gsc_shopping_property).toBe('sc-domain:acme.com');
  });

  it('prunes rows older than 90 days on the daily run', async () => {
    state.brand.gsc_shopping_property = 'sc-domain:acme.com';
    await runGscSync();
    expect(state.deletes.some(([table]) => table === 'gsc_shopping_page_stats')).toBe(true);
  });
});
