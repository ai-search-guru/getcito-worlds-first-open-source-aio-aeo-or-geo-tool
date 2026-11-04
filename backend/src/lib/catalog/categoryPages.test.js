import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { fakeDb } from './__fixtures__/fakeDb.js';
import {
  CategoryPageError,
  categoryPages,
  categorySlug,
  leafName,
  matchCategoryPages,
  matchOf,
  setCategoryPage,
  wordsOf,
} from './categoryPages.js';

/** Each catalog category's page on the brand's site (shopping path, 00350). */

const page = (url, title = null, extra = {}) => ({ url, title, h1: null, ...extra });

// The editor's page types read a shop's category pages by the same cases
// (frontend/src/lib/content/pageTypes.test.ts, detectPageType).
const { cases: CATEGORY_PATHS } = JSON.parse(
  readFileSync(
    new URL(
      '../../../../frontend/src/lib/content/__fixtures__/category-paths.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

describe('categorySlug', () => {
  it.each(CATEGORY_PATHS)("reads $url as the editor's page types do: $slug", ({ url, slug }) => {
    expect(categorySlug(url)).toBe(slug);
  });

  it("isn't a category word alone, or what isn't an address", () => {
    expect(categorySlug('https://shop.example/collections')).toBeNull();
    expect(categorySlug('not a url')).toBeNull();
  });

  it("reads an address with a broken escape as it is, and doesn't fail on it", () => {
    expect(categorySlug('https://shop.example/collections/100%-cotton')).toBe('100%-cotton');
    expect(categorySlug('https://shop.example/collections/caf%E9')).toBe('caf%e9');
    expect(categorySlug('https://shop.example/collections/%C3%A7anta')).toBe('çanta');
    expect(
      matchOf('100% Cotton', page('https://shop.example/collections/100%-cotton', '100% cotton')),
    ).toBe('address');
  });
});

describe('names and words', () => {
  it("takes a category's own name and its words, plurals as one", () => {
    expect(leafName('Shoes > Hiking Boots')).toBe('Hiking Boots');
    expect(leafName('Apparel › Jackets / Rain Jackets')).toBe('Rain Jackets');
    expect(wordsOf('Hiking Boots & the Socks')).toEqual(['hiking', 'boot', 'sock']);
    expect(wordsOf('Glasses, Boxes and Dress')).toEqual(['glass', 'box', 'dress']);
  });

  it('reads Turkish and German letters as a slug spells them', () => {
    expect(wordsOf('Kadın Ayakkabı')).toEqual(['kadin', 'ayakkabi']);
    expect(wordsOf('İç Giyim')).toEqual(['ic', 'giyim']);
    expect(wordsOf('Große Größen')).toEqual(['grosse', 'grossen']);
    expect(
      matchOf('Kadın > Kadın Ayakkabı', page('https://s.example/collections/kadin-ayakkabi')),
    ).toBe('address');
    expect(matchOf('Wanderschuhe', page('https://s.example/kategorie/wanderschuhe'))).toBe(
      'address',
    );
    expect(matchOf('Botas de montaña', page('https://s.example/categoria/botas-de-montana'))).toBe(
      'address',
    );
  });
});

describe('matchOf', () => {
  it('matches by address first, then title, then most of the words', () => {
    expect(
      matchOf('Shoes > Hiking Boots', page('https://s.example/collections/hiking-boots')),
    ).toBe('address');
    expect(
      matchOf('Hiking Boots', page('https://s.example/collections/hb-01', 'Hiking boots | Acme')),
    ).toBe('title');
    expect(
      matchOf('Waterproof Hiking Boots', page('https://s.example/collections/hiking-boot-range')),
    ).toBe('words');
    expect(matchOf('Rain Jackets', page('https://s.example/collections/hiking-boots'))).toBeNull();
    expect(matchOf('Hiking Boots', page('https://s.example/blog/hiking-boots'))).toBeNull();
  });

  it("matches none of a review's pages that only look like the category's", () => {
    for (const url of [
      'https://s.example/collections/best-hiking-boots',
      'https://s.example/collections/hiking-boots-size-guide',
      'https://s.example/collections/hiking-boots-vs-trail-runners',
      'https://s.example/blog/category/hiking-boots',
      'https://s.example/collections/summer-sale',
    ]) {
      expect(matchOf('Hiking Boots', page(url, 'Summer sale: hiking boots')), url).toBeNull();
    }
    expect(matchOf('Hiking Boots', page('https://s.example/product-category/hiking-boots'))).toBe(
      'address',
    );
  });

  it('matches a one-word name by its address only', () => {
    expect(matchOf('Shoes', page('https://s.example/collections/shoes'))).toBe('address');
    expect(matchOf('Shoes', page('https://s.example/collections/running-shoes'))).toBeNull();
    expect(matchOf('Glasses', page('https://s.example/c/wine-glasses', 'Wine glasses'))).toBeNull();
    expect(
      matchOf('Men > Shoes', page('https://s.example/c/footwear', "Women's shoes")),
    ).toBeNull();
  });

  it("lets the parent's words stand beside the name in the address", () => {
    expect(matchOf('Men > Shoes', page('https://s.example/collections/mens-shoes'))).toBe(
      'address',
    );
    expect(matchOf('Men > Shoes', page('https://s.example/c/shoes-men'))).toBe('address');
    expect(matchOf('Men > Shoes', page('https://s.example/collections/womens-shoes'))).toBeNull();
    expect(matchOf('Shoes', page('https://s.example/collections/mens-shoes'))).toBeNull();
  });
});

describe('matchCategoryPages', () => {
  it('picks the best page for each category, the most cited on a tie, or none', () => {
    const pages = [
      page('https://s.example/collections/boots-sale', 'Hiking boots sale', { ai_citations: 1 }),
      page('https://s.example/collections/hiking-boots', 'Boots', { ai_citations: 0 }),
      page('https://s.example/c/socks', 'Wool socks', { ai_citations: 1 }),
      page('https://s.example/shop/socks', 'Socks', { ai_citations: 5 }),
    ];
    expect(matchCategoryPages(['Hiking Boots', 'Socks', 'Tents'], pages)).toEqual([
      {
        category: 'Hiking Boots',
        page: { url: 'https://s.example/collections/hiking-boots', title: 'Boots' },
        how: 'address',
      },
      {
        category: 'Socks',
        page: { url: 'https://s.example/shop/socks', title: 'Socks' },
        how: 'address',
      },
      { category: 'Tents', page: null, how: null },
    ]);
  });

  it('breaks a tie on citations by visits, then keeps the page listed first', () => {
    const pages = [
      page('https://s.example/c/tents', 'Tents', { ai_citations: 2, ga_sessions: 10 }),
      page('https://s.example/shop/tents', 'Tents', { ai_citations: 2, ga_sessions: 40 }),
      page('https://s.example/catalog/tents', 'Tents', { ai_citations: 2, ga_sessions: 40 }),
    ];
    expect(matchCategoryPages(['Tents'], pages)[0].page.url).toBe('https://s.example/shop/tents');
  });

  it('gives a page to the category whose parent it names, the others take their next or none', () => {
    const pages = [
      page('https://s.example/collections/shoes', "Women's shoes", { ai_citations: 9 }),
      page('https://s.example/collections/mens-shoes', 'Shoes for him'),
      page('https://s.example/collections/hiking-boots', 'Hiking boots'),
    ];
    const matched = matchCategoryPages(
      [
        'Men > Shoes',
        'Women > Shoes',
        'Kids > Shoes',
        'Men > Hiking Boots',
        'Women > Hiking Boots',
      ],
      pages,
    );
    expect(matched.map((m) => [m.category, m.page?.url ?? null])).toEqual([
      ['Men > Shoes', 'https://s.example/collections/mens-shoes'],
      ['Women > Shoes', 'https://s.example/collections/shoes'],
      // The shoes page names another parent: Kids has none.
      ['Kids > Shoes', null],
      // A page naming neither parent: both keep it.
      ['Men > Hiking Boots', 'https://s.example/collections/hiking-boots'],
      ['Women > Hiking Boots', 'https://s.example/collections/hiking-boots'],
    ]);
  });

  it("counts a /category/ page only on a host that sells, without WooCommerce's, untitled as an archive", () => {
    const blog = [
      page('https://s.example/category/hiking-boots', 'Hiking boots'),
      page('https://shop.s.example/products/summit-boot', 'Summit boot'),
    ];
    expect(matchCategoryPages(['Hiking Boots'], blog)[0].page).toBeNull();

    const woo = [
      page('https://s.example/category/hiking-boots', 'Hiking boots'),
      page('https://s.example/product/summit-boot', 'Summit boot'),
      page('https://s.example/product-category/boots', 'Boots'),
    ];
    expect(matchCategoryPages(['Hiking Boots'], woo)[0].page).toBeNull();

    const archive = [
      page('https://s.example/category/hiking-boots', 'Hiking Boots Archives - Acme'),
      page('https://s.example/p/summit-boot', 'Summit boot'),
    ];
    expect(matchCategoryPages(['Hiking Boots'], archive)[0].page).toBeNull();

    const shop = [
      page('https://www.s.example/kategori/kadin-ayakkabi', 'Kadın Ayakkabı'),
      page('https://s.example/urun/yuruyus-botu', 'Yürüyüş botu'),
    ];
    expect(matchCategoryPages(['Kadın Ayakkabı'], shop)[0]).toMatchObject({
      page: { url: 'https://www.s.example/kategori/kadin-ayakkabi' },
      how: 'address',
    });
  });

  it('matches a large catalog to a full site quickly', () => {
    // The worst case: every name and every page hold "boots", so no page is left out unread.
    const word = (i) => `w${i.toString(36)}x`;
    const categories = Array.from(
      { length: 1000 },
      (_, i) => `Dept ${i % 12} > ${word(i)} Waterproof Boots`,
    );
    // Each page's address counts its reads.
    let reads = 0;
    const pages = Array.from({ length: 500 }, (_, i) => {
      const url = `https://s.example/collections/${word(i * 2)}-boots`;
      return Object.defineProperty(
        page(null, `${word(i * 2)} boots`, { ai_citations: i % 5 }),
        'url',
        {
          get: () => {
            reads += 1;
            return url;
          },
        },
      );
    });
    const started = Date.now();
    const matched = matchCategoryPages(categories, pages);
    // Each address is read a few times, not once for each category (500,000 reads, seconds).
    expect(reads).toBeLessThan(10_000);
    // Loose, for a busy machine: the read count above bounds the work.
    expect(Date.now() - started).toBeLessThan(5000);
    expect(matched).toHaveLength(1000);
    expect(matched[2]).toMatchObject({
      how: 'words',
      page: { url: 'https://s.example/collections/w2x-boots' },
    });
    expect(matched[1].page).toBeNull();
  });

  it('matches long names, long addresses and long titles in time near their length', () => {
    // 1,000 names as long as a catalog keeps (750), mostly spaces.
    const categories = Array.from(
      { length: 1000 },
      (_, i) => `Boots${' '.repeat(700)}> trail boot ${i}`,
    );
    // 500 pages whose last segment has hundreds of words, each sharing "boot".
    const long = Array.from({ length: 400 }, (_, i) => `boot${i % 7 ? '' : 's'}`).join('-');
    const pages = Array.from({ length: 500 }, (_, i) =>
      page(`https://s.example/collections/${long}-${i}`, `${'Trail boot '.repeat(2_000)}${i}`),
    );
    const started = Date.now();
    const matched = matchCategoryPages(categories, pages);
    expect(matched).toHaveLength(1000);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('categoryPages', () => {
  it("lists the brand's categories with their counts and pages, a person's decision first", async () => {
    const fake = fakeDb();
    fake.rows('site_pages').push(
      {
        id: '1',
        brand_id: 'b1',
        url: 'https://s.example/collections/hiking-boots',
        title: 'Hiking boots',
      },
      {
        id: '2',
        brand_id: 'b1',
        url: 'https://s.example/collections/rain-jackets',
        title: 'Rain',
      },
      { id: '3', brand_id: 'b2', url: 'https://other.example/collections/tents', title: 'Tents' },
    );
    fake
      .rows('catalog_category_pages')
      .push(
        { brand_id: 'b1', category: 'Rain Jackets', url: 'https://s.example/jackets/rain' },
        { brand_id: 'b1', category: 'Socks', url: null },
      );
    const rpc = vi.fn(async () => ({
      data: [
        { category: 'Socks', products: 2, in_stock: 2 },
        { category: 'Shoes > Hiking Boots', products: 24, in_stock: 18 },
        { category: 'Rain Jackets', products: 16, in_stock: 12 },
        { category: 'Tents', products: 16, in_stock: 3 },
      ],
      error: null,
    }));
    const categories = await categoryPages('b1', { db: { ...fake.db, rpc } });
    expect(rpc).toHaveBeenCalledWith('catalog_category_counts', { p_brand_id: 'b1' });
    expect(categories).toEqual([
      {
        name: 'Shoes > Hiking Boots',
        products: 24,
        inStock: 18,
        page: { url: 'https://s.example/collections/hiking-boots', title: 'Hiking boots' },
        how: 'address',
      },
      {
        name: 'Rain Jackets',
        products: 16,
        inStock: 12,
        page: { url: 'https://s.example/jackets/rain', title: null },
        how: 'manual',
      },
      // Another brand's page is never matched.
      { name: 'Tents', products: 16, inStock: 3, page: null, how: null },
      // A person said it has none.
      { name: 'Socks', products: 2, inStock: 2, page: null, how: 'manual' },
    ]);
  });

  it("doesn't read the site's pages when no category is left to match", async () => {
    const fake = fakeDb();
    const from = vi.fn(fake.db.from);
    fake.rows('catalog_category_pages').push({ brand_id: 'b1', category: 'Socks', url: null });
    let data = [];
    const rpc = vi.fn(async () => ({ data, error: null }));
    expect(await categoryPages('b1', { db: { from, rpc } })).toEqual([]);
    data = [{ category: 'Socks', products: 2, in_stock: 1 }];
    expect(await categoryPages('b1', { db: { from, rpc } })).toEqual([
      { name: 'Socks', products: 2, inStock: 1, page: null, how: 'manual' },
    ]);
    expect(from.mock.calls.map(([table]) => table)).not.toContain('site_pages');
  });
});

describe('setCategoryPage', () => {
  const setup = () => {
    const fake = fakeDb();
    fake.rows('brand_domains').push({ id: 'd1', brand_id: 'b1', domain: 'https://www.s.example/' });
    fake.rows('catalog_categories').push({ id: 'c1', brand_id: 'b1', name: 'Socks' });
    return fake;
  };

  it("keeps a page on the brand's site, none, or goes back to the match", async () => {
    const fake = setup();
    const set = (url) =>
      setCategoryPage({ brandId: 'b1', category: 'Socks', url, userId: 'u1' }, { db: fake.db });
    await set('https://shop.s.example/c/socks');
    expect(fake.rows('catalog_category_pages')).toEqual([
      expect.objectContaining({
        brand_id: 'b1',
        category: 'Socks',
        url: 'https://shop.s.example/c/socks',
        set_by: 'u1',
      }),
    ]);
    await set(null);
    expect(fake.rows('catalog_category_pages')).toEqual([
      expect.objectContaining({ category: 'Socks', url: null }),
    ]);
    await set(undefined);
    expect(fake.rows('catalog_category_pages')).toEqual([]);
  });

  it("refuses a page off the brand's site, or one that isn't an address", async () => {
    const fake = setup();
    const set = (url) =>
      setCategoryPage({ brandId: 'b1', category: 'Socks', url, userId: 'u1' }, { db: fake.db });
    await expect(set('https://elsewhere.example/c/socks')).rejects.toMatchObject({
      code: 'off_site',
    });
    await expect(set('socks')).rejects.toBeInstanceOf(CategoryPageError);
    await expect(set('ftp://s.example/socks')).rejects.toMatchObject({ code: 'invalid' });
    await expect(set('https://me:secret@www.s.example/c/socks')).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(set(`https://www.s.example/c/${'a'.repeat(2048)}`)).rejects.toMatchObject({
      code: 'invalid',
    });
    expect(fake.rows('catalog_category_pages')).toEqual([]);
  });

  it("refuses a category the brand's catalog doesn't have, but lets its decision go", async () => {
    const fake = setup();
    fake.rows('catalog_categories').push({ id: 'c2', brand_id: 'b2', name: 'Tents' });
    fake.rows('catalog_category_pages').push({ brand_id: 'b1', category: 'Tents', url: null });
    const set = (url) =>
      setCategoryPage({ brandId: 'b1', category: 'Tents', url, userId: 'u1' }, { db: fake.db });
    for (const url of ['https://www.s.example/c/tents', null]) {
      await expect(set(url)).rejects.toMatchObject({ code: 'not_found', status: 404 });
    }
    // A decision left from a category gone from the catalog can still be taken back.
    await set(undefined);
    expect(fake.rows('catalog_category_pages')).toEqual([]);
  });

  it('takes the sites its products link to for a brand with no domain stored', async () => {
    const fake = fakeDb();
    fake.rows('catalog_categories').push({ id: 'c1', brand_id: 'b1', name: 'Socks' });
    fake
      .rows('catalog_products')
      .push(
        { id: 'p1', brand_id: 'b1', url: 'https://www.shop.example/products/wool-sock' },
        { id: 'p2', brand_id: 'b1', url: null },
        { id: 'p3', brand_id: 'b2', url: 'https://other.example/products/tent' },
      );
    const set = (url) =>
      setCategoryPage({ brandId: 'b1', category: 'Socks', url, userId: 'u1' }, { db: fake.db });
    await set('https://shop.example/collections/socks');
    expect(fake.rows('catalog_category_pages')).toEqual([
      expect.objectContaining({ url: 'https://shop.example/collections/socks' }),
    ]);
    await expect(set('https://other.example/collections/socks')).rejects.toMatchObject({
      code: 'off_site',
    });
  });
});

describe('catalog_category_counts (00350)', () => {
  it("counts a variant in stock as the editor's feed match reads it (feedMatch.ts, feedStock)", () => {
    const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
    const words = (list) => [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const sql = read('supabase/migrations/00350_catalog_category_pages.sql');
    const web = read('frontend/src/lib/content/feedMatch.ts');
    const inStock = words(web.match(/return \[([^\]]*)\]\.includes\(a\)/)[1]);
    expect(inStock).toContain('limited_availability');
    expect(words(sql.match(/'_', 'g'\)\)\s+in \(([^)]*)\)/)[1])).toEqual(inStock);
    // Read as the web reads it: lowercased, spaces and hyphens as "_".
    expect(web).toMatch(/toLowerCase\(\)\.replace\(\/\[\\s-\]\+\/g, '_'\)/);
    expect(sql).toMatch(/lower\(regexp_replace\(v\.availability, '\[\\s-\]\+', '_', 'g'\)\)/);
  });
});
