import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { FEED_URL, catalog, catalogRows, feedXml } = await import('./catalog.js');
const { CATALOG, CATEGORY_DECISIONS } = await import('./siteWorld.js');
const { PRODUCTS } = await import('./brewline.js');
const { parseFeed } = await import('../feeds/index.js');
const { syncCatalog } = await import('../catalog/sync.js');
const { sourceKey } = await import('../catalog/sources.js');
const { matchCategoryPages } = await import('../catalog/categoryPages.js');
const { fakeDb } = await import('../catalog/__fixtures__/fakeDb.js');

/**
 * The demo brand's catalog (demo-site): Brewline's product feed, read by
 * the feed parser and kept as the catalog sync keeps it, with the products
 * the demo's AI answers show as cards among them.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-28T12:00:00Z');
const rows = catalogRows({ brandId: BRAND_ID, now: NOW });
const live = rows.products.filter((p) => !p.removed_at);

describe('catalogRows', () => {
  it('is a lean shop: about two dozen products, their variants and categories', () => {
    expect(live).toHaveLength(CATALOG.length);
    expect(rows.variants.length).toBeGreaterThanOrEqual(35);
    expect(rows.categories.map((c) => c.name).sort()).toEqual([
      'Brewing Equipment',
      'Coffee > Whole Bean > Blends',
      'Coffee > Whole Bean > Decaf',
      'Coffee > Whole Bean > Espresso',
      'Coffee > Whole Bean > Single Origin',
      'Gifts',
      'Subscriptions',
    ]);
    expect(rows.productCategories).toHaveLength(rows.products.length);
    for (const row of [...rows.products, ...rows.variants]) {
      expect(row.url).toMatch(/^https:\/\/brewline\.example\//);
    }
  });

  it('writes what the catalog sync writes for the same feed', async () => {
    const fake = fakeDb();
    const source = sourceKey(rows.source.id);
    await syncCatalog(BRAND_ID, source, parseFeed(feedXml(CATALOG), 'google_xml').items, {
      db: fake.db,
      now: NOW,
    });
    const columns = (row) => {
      const { id: _i, product_id: _p, first_seen_at: _f, updated_at: _u, ...rest } = row;
      return rest;
    };
    const byId = (list) => [...list].sort((a, b) => a.external_id.localeCompare(b.external_id));
    expect(byId(live).map(columns)).toEqual(byId(fake.rows('catalog_products')).map(columns));
    const own = rows.variants.filter((v) => !v.removed_at);
    expect(byId(own).map(columns)).toEqual(byId(fake.rows('catalog_variants')).map(columns));
    // No images: nothing for the demo to load from outside.
    expect(fake.rows('catalog_images')).toEqual([]);
  });

  it("has the AI answers' product cards: same page, title and price", () => {
    for (const card of PRODUCTS.filter((p) => p.owner === 'brand')) {
      const url = `https://brewline.example${card.path}`;
      const variant = rows.variants.find((v) => v.url === url);
      expect(variant, card.title).toBeTruthy();
      expect(variant.price).toBe(card.price);
      expect(variant.title.startsWith(card.title.replace(/, Whole Bean.*$/, ''))).toBe(true);
    }
  });

  it('keeps a removed seasonal product, an out-of-stock size and a sale', () => {
    const removed = rows.products.filter((p) => p.removed_at);
    expect(removed.map((p) => p.title)).toEqual(['Brewline Holiday Blend, Whole Bean 12 oz']);
    expect(rows.variants.some((v) => v.availability === 'out_of_stock')).toBe(true);
    expect(rows.variants.some((v) => v.sale_price !== null)).toBe(true);
  });

  it('reads from a feed URL source whose last read was this morning', () => {
    expect(rows.source).toMatchObject({
      kind: 'feed_url',
      format: 'google_xml',
      url: FEED_URL,
      last_status: 'ok',
      last_synced_at: '2026-10-28T04:10:00.000Z',
    });
    expect(rows.source.last_counts.products.unchanged).toBe(live.length);
    expect(new Set(rows.products.map((p) => p.source))).toEqual(
      new Set([sourceKey(rows.source.id)]),
    );
  });

  it('matches most categories to their collection page, and the rest by hand', () => {
    const pages = ['single-origin', 'blends', 'espresso', 'decaf'].map((slug) => ({
      url: `https://brewline.example/collections/${slug}`,
      title: null,
    }));
    const matched = matchCategoryPages(
      rows.categories.map((c) => c.name),
      pages,
    ).filter((m) => m.page);
    expect(matched).toHaveLength(4);
    expect(rows.categoryPages.map((d) => d.category)).toEqual(
      CATEGORY_DECISIONS.map((d) => d.category),
    );
    for (const decision of rows.categoryPages) expect(decision.set_by).toBeNull();
  });
});

describe('catalog.build', () => {
  it('writes only its own tables, the source first, the variants after their products', async () => {
    const writes = [];
    const db = {
      from: (table) => ({
        upsert: async () => {
          writes.push(table);
          return { error: null };
        },
      }),
    };
    await catalog.build({ brandId: BRAND_ID, now: NOW, db });
    expect([...writes].sort()).toEqual([...catalog.tables].sort());
    expect(writes[0]).toBe('catalog_sources');
    expect(writes.indexOf('catalog_products')).toBeLessThan(writes.indexOf('catalog_variants'));
    expect(writes.indexOf('catalog_categories')).toBeLessThan(
      writes.indexOf('catalog_product_categories'),
    );
  });
});
