import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { parseCsvFeed, parseGoogleFeedXml } from '../feeds/index.js';
import { fakeDb } from './__fixtures__/fakeDb.js';
import { catalogRecords, groupTitle, keptWithin, syncCatalog } from './sync.js';

const BRAND = 'brand-1';
const feed = () =>
  parseGoogleFeedXml(
    readFileSync(new URL('../feeds/__fixtures__/google-feed.xml', import.meta.url), 'utf8'),
  ).items;

let fake;
beforeEach(() => {
  fake = fakeDb();
});

describe('groupTitle', () => {
  it("takes the words an item group's titles start with, without the separator", () => {
    expect(
      groupTitle([
        'Trailrunner Hiking Boot - Red',
        'Trailrunner Hiking Boot - Blue',
        'Trailrunner Hiking Boot - Green',
      ]),
    ).toBe('Trailrunner Hiking Boot');
    expect(groupTitle(['Sock'])).toBe('Sock');
    // Too little in common: the first title.
    expect(groupTitle(['A red boot for hiking', 'A blue sock'])).toBe('A red boot for hiking');
  });
});

describe('catalogRecords', () => {
  it('makes one product per item group and a variant per item', () => {
    const { products, variants } = catalogRecords(feed());
    expect(products.map((p) => [p.external_id, p.title])).toEqual([
      ['TR-100', 'Trailrunner Hiking Boot'],
      ['SOCK-1', 'Merino Hiking Sock'],
    ]);
    expect(variants.map((v) => [v.product_external_id, v.external_id])).toEqual([
      ['TR-100', 'TR-100-RED'],
      ['TR-100', 'TR-100-BLUE'],
      ['TR-100', 'TR-100-GREEN'],
      ['SOCK-1', 'SOCK-1'],
    ]);
    expect(variants[0]).toMatchObject({
      price: 129,
      sale_price: 99,
      currency: 'USD',
      availability: 'in_stock',
      attributes: { color: 'Red', size: '42', material: 'Leather' },
      images: [
        'https://shop.example/img/tr-red.jpg',
        'https://shop.example/img/tr-red-2.jpg',
        'https://shop.example/img/tr-red-3.jpg',
      ],
    });
  });
});

describe('syncCatalog', () => {
  it('writes products, variants, images and categories', async () => {
    const counts = await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    expect(counts).toEqual({
      products: { added: 2, changed: 0, removed: 0, unchanged: 0 },
      variants: { added: 4, changed: 0, removed: 0, unchanged: 0 },
    });
    const products = fake.rows('catalog_products');
    const boot = products.find((p) => p.external_id === 'TR-100');
    expect(boot).toMatchObject({
      brand_id: BRAND,
      source: 'feed',
      title: 'Trailrunner Hiking Boot',
    });
    const red = fake.rows('catalog_variants').find((v) => v.external_id === 'TR-100-RED');
    expect(red.product_id).toBe(boot.id);
    const images = fake.rows('catalog_images').filter((i) => i.variant_id === red.id);
    expect(images.map((i) => [i.position, i.url])).toEqual([
      [0, 'https://shop.example/img/tr-red.jpg'],
      [1, 'https://shop.example/img/tr-red-2.jpg'],
      [2, 'https://shop.example/img/tr-red-3.jpg'],
    ]);
    expect(fake.rows('catalog_categories').map((c) => c.name)).toEqual(['Shoes > Hiking Boots']);
    expect(fake.rows('catalog_product_categories')).toEqual([
      expect.objectContaining({ product_id: boot.id }),
    ]);
  });

  it('writes nothing when the same feed comes again', async () => {
    await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    fake.writes.length = 0;
    const counts = await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    expect(fake.writes).toEqual([]);
    expect(counts.products).toEqual({ added: 0, changed: 0, removed: 0, unchanged: 2 });
    expect(counts.variants).toEqual({ added: 0, changed: 0, removed: 0, unchanged: 4 });
  });

  it('marks a product gone from the feed as removed, and live again when it comes back', async () => {
    await syncCatalog(BRAND, 'feed', feed(), {
      db: fake.db,
      now: new Date('2026-10-20T00:00:00Z'),
    });
    const withoutSock = feed().filter((i) => i.id !== 'SOCK-1');
    const counts = await syncCatalog(BRAND, 'feed', withoutSock, {
      db: fake.db,
      now: new Date('2026-10-21T00:00:00Z'),
    });
    expect(counts.products.removed).toBe(1);
    expect(counts.variants.removed).toBe(1);
    const sock = fake.rows('catalog_products').find((p) => p.external_id === 'SOCK-1');
    expect(sock.removed_at).toBe('2026-10-21T00:00:00.000Z');
    // Nothing is deleted.
    expect(fake.rows('catalog_products')).toHaveLength(2);

    const back = await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    expect(back.products).toMatchObject({ changed: 1, unchanged: 1 });
    expect(sock.removed_at).toBeNull();
  });

  it("writes a changed price on its variant only, with its product's images again", async () => {
    await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    const items = feed();
    items[1] = { ...items[1], price: { amount: 119, currency: 'USD' } };
    const counts = await syncCatalog(BRAND, 'feed', items, { db: fake.db });
    expect(counts.variants).toMatchObject({ changed: 1, unchanged: 3 });
    expect(counts.products).toMatchObject({ unchanged: 2 });
    expect(fake.rows('catalog_variants').find((v) => v.external_id === 'TR-100-BLUE').price).toBe(
      119,
    );
    // The boot's images were written again, once each.
    const bootImages = fake.rows('catalog_images').filter((i) => i.url.includes('/tr-'));
    expect(bootImages).toHaveLength(5);
  });

  it('keeps sources and brands apart', async () => {
    await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    const counts = await syncCatalog(BRAND, 'csv', [], { db: fake.db });
    expect(counts.products.removed).toBe(0);
    const other = await syncCatalog('brand-2', 'feed', feed(), { db: fake.db });
    expect(other.products.added).toBe(2);
  });

  it('links one product to multiple catalog categories without persisting parser-only fields', async () => {
    const [item] = feed();
    const multiCategoryItem = {
      ...item,
      itemGroupId: 'MULTI-1',
      id: 'MULTI-1-42',
      productType: 'Accessories',
      productTypes: ['Accessories', 'Footwear > Boots'],
    };

    await syncCatalog(BRAND, 'multi_category', [multiCategoryItem], { db: fake.db });

    expect(
      fake
        .rows('catalog_categories')
        .map((row) => row.name)
        .sort(),
    ).toEqual(['Accessories', 'Footwear > Boots']);
    expect(fake.rows('catalog_product_categories')).toHaveLength(2);
    expect(fake.rows('catalog_products')[0]).toMatchObject({ product_type: 'Accessories' });
    expect(fake.rows('catalog_products')[0]).not.toHaveProperty('product_types');
  });

  it("leaves out an address that isn't http(s), and clips long values", async () => {
    const [item] = feed();
    await syncCatalog(
      BRAND,
      'feed',
      [
        {
          ...item,
          link: 'javascript:alert(1)',
          imageLink: 'ftp://x/y.jpg',
          title: 'x'.repeat(1200),
        },
      ],
      { db: fake.db },
    );
    const [product] = fake.rows('catalog_products');
    expect(product.url).toBeNull();
    expect(product.title).toHaveLength(1000);
    expect(fake.rows('catalog_images').map((i) => i.url)).not.toContain('ftp://x/y.jpg');
  });

  it('removes and rewrites many products with filters of at most 100 ids, so no request runs too long', async () => {
    const lines = ['id,item_group_id,title,link,price,availability,product_type'];
    for (let i = 0; i < 250; i++) {
      lines.push(
        `M-${i},M-${i},Mug ${i},https://s.example/m/${i},10.00 USD,in stock,Kitchen > Mugs`,
      );
    }
    const { items: many } = parseCsvFeed(lines.join('\n'));
    await syncCatalog(BRAND, 'feed', many, { db: fake.db, now: new Date('2026-10-20T00:00:00Z') });
    // Each .in() filter goes in the request's URL: count the ids per filter.
    const sizes = [];
    const db = {
      from: (table) => {
        const builder = fake.db.from(table);
        const watch = (b) =>
          new Proxy(b, {
            get(target, key) {
              const value = target[key];
              if (key === 'in') {
                return (column, values) => {
                  sizes.push(values.length);
                  return watch(value.call(target, column, values));
                };
              }
              if (typeof value !== 'function' || key === 'then') return value;
              return (...args) => {
                const out = value.apply(target, args);
                return out === target ? watch(target) : out;
              };
            },
          });
        return watch(builder);
      },
    };
    const counts = await syncCatalog(BRAND, 'feed', [], {
      db,
      now: new Date('2026-10-21T00:00:00Z'),
    });
    expect(counts.products.removed).toBe(250);
    expect(
      fake.rows('catalog_products').every((p) => p.removed_at === '2026-10-21T00:00:00.000Z'),
    ).toBe(true);
    expect(sizes.length).toBeGreaterThan(2);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
  });

  it('imports a 10,000-row CSV, and a second import writes nothing', async () => {
    const lines = ['id,item_group_id,title,link,price,availability,color,product_type'];
    for (let i = 0; i < 10_000; i++) {
      lines.push(
        `P-${i},G-${Math.floor(i / 4)},Item ${Math.floor(i / 4)} - ${i % 4},https://s.example/p/${i},${i}.99 USD,in stock,C${i % 4},Cat ${Math.floor(i / 4) % 10}`,
      );
    }
    const { items } = parseCsvFeed(lines.join('\n'));
    const first = await syncCatalog(BRAND, 'csv', items, { db: fake.db });
    expect(first.products.added).toBe(2_500);
    expect(first.variants.added).toBe(10_000);
    expect(fake.rows('catalog_categories')).toHaveLength(10);
    fake.writes.length = 0;
    await syncCatalog(BRAND, 'csv', items, { db: fake.db });
    expect(fake.writes).toEqual([]);
  });
});

describe('keptWithin', () => {
  const products = ['A', 'B', 'C', 'D'].map((external_id) => ({ external_id }));

  it('keeps the products live in the catalog first, then the new ones in order', () => {
    const kept = [
      { external_id: 'C', removed_at: null },
      { external_id: 'A', removed_at: '2026-10-01T00:00:00Z' },
    ];
    expect(keptWithin(products, kept, 2)).toEqual({
      products: [{ external_id: 'A' }, { external_id: 'C' }],
      overLimit: 2,
    });
    expect(keptWithin(products, kept, 0)).toEqual({ products: [], overLimit: 4 });
    expect(keptWithin(products, kept, Infinity)).toEqual({ products, overLimit: 0 });
  });
});

describe("syncCatalog within the plan's product cap (ECOM-019)", () => {
  it("writes the products there's room for, and none of the rest's variants", async () => {
    const counts = await syncCatalog(BRAND, 'feed', feed(), { db: fake.db, room: 1 });
    expect(counts).toEqual({
      products: { added: 1, changed: 0, removed: 0, unchanged: 0 },
      variants: { added: 3, changed: 0, removed: 0, unchanged: 0 },
      overLimit: 1,
    });
    expect(fake.rows('catalog_products').map((p) => p.external_id)).toEqual(['TR-100']);
    expect(fake.rows('catalog_variants').every((v) => v.external_id.startsWith('TR-100'))).toBe(
      true,
    );
  });

  it('keeps a tracked product tracked when the source lists another first', async () => {
    await syncCatalog(BRAND, 'feed', feed(), { db: fake.db, room: 1 });
    const counts = await syncCatalog(BRAND, 'feed', [...feed()].reverse(), {
      db: fake.db,
      room: 1,
    });
    expect(counts.overLimit).toBe(1);
    expect(counts.products).toMatchObject({ added: 0, removed: 0 });
    expect(fake.rows('catalog_products').map((p) => p.external_id)).toEqual(['TR-100']);
  });

  it('marks the products past a smaller cap removed, and brings them back with room', async () => {
    await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    const at = new Date('2026-10-28T00:00:00Z');
    const counts = await syncCatalog(BRAND, 'feed', feed(), { db: fake.db, now: at, room: 0 });
    expect(counts.overLimit).toBe(2);
    expect(counts.products.removed).toBe(2);
    expect(fake.rows('catalog_products').every((p) => p.removed_at === at.toISOString())).toBe(
      true,
    );
    const back = await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    expect(back.overLimit).toBeUndefined();
    expect(fake.rows('catalog_products').every((p) => p.removed_at === null)).toBe(true);
  });
});
