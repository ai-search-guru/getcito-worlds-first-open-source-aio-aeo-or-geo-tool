import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: {} }));

import {
  MAX_CANDIDATES,
  MIN_PRODUCTS,
  catalogCandidates,
  getCatalogSuggestionCandidates,
  roundPrice,
} from './catalogSuggestions.js';

/** Shopping questions from the brand's catalog (ECOM-003). */

describe('roundPrice', () => {
  it('rounds a price up to one a shopper would name', () => {
    expect([8, 38, 119, 140, 151, 1240, 9000].map(roundPrice)).toEqual([
      10, 40, 150, 150, 200, 1500, 10000,
    ]);
    expect(roundPrice(0)).toBeNull();
    expect(roundPrice(null)).toBeNull();
  });
});

describe('catalogCandidates', () => {
  it("offers the database's categories in its order, with a band where they share a currency", () => {
    expect(
      catalogCandidates([
        {
          category: 'Bags > Hiking backpacks',
          products: 4,
          // PostgREST sends numeric as a number, or as a string when told to.
          price_low: '60.00',
          price_high: 180,
          price_p75: 140,
          currency: 'USD',
        },
        // Two currencies, or none priced: no band.
        {
          category: 'Gift cards',
          products: 2,
          price_low: null,
          price_high: null,
          price_p75: null,
          currency: null,
        },
        {
          category: 'Socks',
          products: 2,
          price_low: null,
          price_high: null,
          price_p75: null,
          currency: 'USD',
        },
      ]),
    ).toEqual([
      {
        category: 'Bags > Hiking backpacks',
        products: 4,
        priceLow: 60,
        priceHigh: 180,
        priceUnder: 150,
        currency: 'USD',
      },
      {
        category: 'Gift cards',
        products: 2,
        priceLow: null,
        priceHigh: null,
        priceUnder: null,
        currency: null,
      },
      {
        category: 'Socks',
        products: 2,
        priceLow: null,
        priceHigh: null,
        priceUnder: null,
        currency: null,
      },
    ]);
  });

  it(`offers ${MAX_CANDIDATES} categories at most`, () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      category: `Cat ${i}`,
      products: 2,
      price_low: null,
      price_high: null,
      price_p75: null,
      currency: null,
    }));
    expect(catalogCandidates(rows)).toHaveLength(MAX_CANDIDATES);
  });
});

describe('getCatalogSuggestionCandidates', () => {
  it('asks the database for the categories offered only, not the whole catalog', async () => {
    const from = vi.fn();
    const rpc = vi.fn(async () => ({
      data: [
        {
          category: 'Boots',
          products: 2,
          price_low: 99,
          price_high: 129,
          price_p75: 129,
          currency: 'USD',
        },
      ],
      error: null,
    }));
    expect(await getCatalogSuggestionCandidates('brand-1', { db: { from, rpc } })).toEqual([
      {
        category: 'Boots',
        products: 2,
        priceLow: 99,
        priceHigh: 129,
        priceUnder: 150,
        currency: 'USD',
      },
    ]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('catalog_suggestion_categories', {
      p_brand_id: 'brand-1',
      p_limit: MAX_CANDIDATES,
      p_min_products: MIN_PRODUCTS,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('returns nothing for a brand without a catalog, or when it cannot be read', async () => {
    const empty = { rpc: async () => ({ data: [], error: null }) };
    expect(await getCatalogSuggestionCandidates('brand-1', { db: empty })).toEqual([]);
    const missing = {
      rpc: async () => ({ data: null, error: { message: 'Could not find the function' } }),
    };
    expect(await getCatalogSuggestionCandidates('brand-1', { db: missing })).toEqual([]);
    const down = {
      rpc: () => {
        throw new Error('down');
      },
    };
    expect(await getCatalogSuggestionCandidates('brand-1', { db: down })).toEqual([]);
  });
});

describe('catalog_suggestion_categories (00371)', () => {
  const sql = readFileSync(
    new URL(
      '../../../supabase/migrations/00371_catalog_suggestion_categories.sql',
      import.meta.url,
    ),
    'utf8',
  );

  it('prices a live product by its lowest live variant, sale price first, for the service role', () => {
    // The brand's live products, as catalog_products_brand_live_idx (00278) reads them.
    expect(sql).toMatch(
      /join public\.catalog_products p\s+on p\.id = pc\.product_id and p\.brand_id = p_brand_id and p\.removed_at is null/,
    );
    // Its live variants, as catalog_variants_brand_live_idx (00281) reads them.
    expect(sql).toMatch(/where v\.brand_id = p_brand_id\s+and v\.removed_at is null/);
    expect(sql).toMatch(/order by v\.product_id, coalesce\(v\.sale_price, v\.price\), v\.id/);
    // The "under" price: three quarters of the products at or under it.
    expect(sql).toMatch(/percentile_disc\(0\.75\) within group \(order by pr\.amount\)/);
    expect(sql).toMatch(
      /revoke all on function public\.catalog_suggestion_categories\(uuid, integer, integer\)\s+from public, anon, authenticated;/,
    );
  });
});
