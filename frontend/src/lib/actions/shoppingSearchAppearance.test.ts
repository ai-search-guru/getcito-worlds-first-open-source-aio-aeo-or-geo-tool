import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The brand's pages Google showed in its shopping results, from its own
 * Search Console property (00377), for Product Visibility's Readiness; or
 * why it can't say.
 */

const BRAND = '5b0c3b8e-8a5f-4a41-9d0e-1f2a3b4c5d6e';

let brandRow: { gsc_property: string | null; gsc_shopping_synced_at: string | null } | null;
let statRows: { page: string }[];
let statFilters: [string, unknown][];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          if (table === 'gsc_shopping_page_stats') statFilters.push([column, value]);
          return builder;
        },
        gte: (column: string, value: unknown) => {
          statFilters.push([column, value]);
          return builder;
        },
        gt: (column: string, value: unknown) => {
          statFilters.push([column, value]);
          return builder;
        },
        order: () => builder,
        range: async (from: number, to: number) => ({
          data: statRows.slice(from, to + 1),
          error: null,
        }),
        maybeSingle: async () => ({ data: brandRow, error: null }),
      };
      return builder;
    },
  }),
}));

const { getShoppingSearchAppearance } = await import('./shopping');

beforeEach(() => {
  brandRow = { gsc_property: 'sc-domain:shop.example', gsc_shopping_synced_at: '2026-10-28' };
  statRows = [];
  statFilters = [];
});

describe('getShoppingSearchAppearance', () => {
  it('reads the pages shown over the last 28 days, once each by page key', async () => {
    statRows = [
      { page: 'https://www.shop.example/products/a/' },
      { page: 'https://shop.example/products/a?variant=2' },
      { page: 'https://shop.example/products/b' },
    ];
    expect(await getShoppingSearchAppearance(BRAND)).toEqual({
      state: 'read',
      pages: ['shop.example/products/a', 'shop.example/products/b'],
    });
    expect(statFilters).toEqual([
      ['brand_id', BRAND],
      ['date', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)],
      ['impressions', 0],
    ]);
  });

  it('says when Search Console is not mapped, or not read yet', async () => {
    brandRow = { gsc_property: null, gsc_shopping_synced_at: null };
    expect(await getShoppingSearchAppearance(BRAND)).toEqual({ state: 'not_connected', pages: [] });
    brandRow = { gsc_property: 'sc-domain:shop.example', gsc_shopping_synced_at: null };
    expect(await getShoppingSearchAppearance(BRAND)).toEqual({ state: 'not_synced', pages: [] });
  });
});
