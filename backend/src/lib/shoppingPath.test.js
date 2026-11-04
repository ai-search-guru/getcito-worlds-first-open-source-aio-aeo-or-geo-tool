import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { fakeDb } from './catalog/__fixtures__/fakeDb.js';
import { logger } from './logger.js';
import {
  LEFT_OUT,
  MAX_ISSUES,
  MAX_PATH_BYTES,
  MAX_PRODUCTS,
  NoShoppingPath,
  PRODUCTS_FOR,
  TITLE_CHARS,
  buildShoppingPath,
  fitted,
  offerOf,
  pickCategories,
  pickProducts,
  readShoppingPath,
  refuses,
  shoppingPathSchema,
  storedSize,
  topicScore,
  topicWords,
} from './shoppingPath.js';

/** A draft's shopping path (shopping path, 00351). */

const BRIEF = {
  goal: 'Help hikers pick a waterproof boot',
  keywords: ['waterproof hiking boots', 'gore-tex'],
  outline: [{ heading: 'How to choose: fit and weight' }],
};

/** A path as a build leaves it, with the person's choices. */
const stored = (choices = {}) => ({
  version: 1,
  builtAt: '2026-10-26T09:00:00.000Z',
  pageType: 'buying_guide',
  categories: [],
  products: [],
  leftOut: [],
  locked: [],
  removed: [],
  added: [],
  ...choices,
});

describe('topicWords', () => {
  it("weighs the title's words most, then the keywords, then the goal and headings", () => {
    const topic = topicWords({ title: 'How to choose waterproof hiking boots', brief: BRIEF });
    expect(topic.get('waterproof')).toBe(3);
    expect(topic.get('gore')).toBe(2);
    expect(topic.get('fit')).toBe(1);
    expect(topicScore(topic, 'Waterproof Boot, Gore-Tex')).toBe(3 + 3 + 2 + 2);
  });

  it("leaves out the words that say what kind of page it is, a list's size and its year", () => {
    const topic = topicWords({
      title: 'Top 10 best waterproof hiking boots of 2026: a buying guide and review',
      brief: { keywords: ['boots vs shoes for the trail'], outline: [{ heading: 'How to buy' }] },
    });
    expect([...topic.keys()].sort()).toEqual(['boot', 'hiking', 'shoe', 'trail', 'waterproof']);
    // "Top" alone and "pick" are products in some shops.
    expect([
      ...topicWords({ title: 'Best summer tops and guitar picks', brief: null }).keys(),
    ]).toEqual(['summer', 'top', 'guitar', 'pick']);
    expect(topicWords({ title: 'How to choose the best: a guide', brief: null }).size).toBe(0);
  });

  it('folds the letters Unicode keeps whole, as category pages do', () => {
    const topic = topicWords({ title: 'En iyi kadın botları nasıl seçilir', brief: null });
    expect([...topic.keys()]).toEqual(['kadin', 'botlari']);
  });
});

describe('pickCategories', () => {
  const topic = topicWords({ title: 'How to choose waterproof hiking boots', brief: null });
  const category = (name, inStock, url = `https://s.example/c/${name}`, title = null) => ({
    name,
    products: 10,
    inStock,
    page: url ? { url, title } : null,
  });

  it('links the best category with a page and stock, and a second only close to it', () => {
    expect(
      pickCategories(
        [
          category('Shoes > Hiking Boots', 18),
          category('Boots', 4),
          category('Rain Jackets', 12),
          category('Hiking Socks', 0),
          category('Hiking Poles', 9, null),
        ],
        topic,
      ),
    ).toEqual([
      {
        name: 'Shoes > Hiking Boots',
        url: 'https://s.example/c/Shoes > Hiking Boots',
        title: null,
      },
      { name: 'Boots', url: 'https://s.example/c/Boots', title: null },
    ]);
    expect(pickCategories([category('Rain Jackets', 12)], topic)).toEqual([]);
  });

  it("takes a second one at half the first's score, not below", () => {
    // "Hiking Boots": (3 + 3) × 2 = 12; "Boot Laces": 3 × 2 = 6; "Laces" titled "Boot laces": 3.
    const names = (categories) => pickCategories(categories, topic, 3).map((c) => c.name);
    expect(
      names([
        category('Hiking Boots', 5),
        category('Boot Laces', 5),
        category('Laces', 5, 'https://s.example/c/laces', 'Boot laces'),
      ]),
    ).toEqual(['Hiking Boots', 'Boot Laces']);
  });
});

describe('offerOf', () => {
  const variant = (availability, extra = {}) => ({
    external_id: 'v',
    url: null,
    price: 100,
    sale_price: null,
    currency: 'USD',
    availability,
    issues: [],
    ...extra,
  });
  const product = (variants, url = 'https://s.example/p/boot') => ({
    id: 'p1',
    title: 'Boot',
    url,
    image: null,
    variants,
  });

  it('offers the cheapest variant in stock that Merchant Center accepts, with its issues', () => {
    const { offer } = offerOf(
      product([
        variant('in_stock', { price: 189 }),
        variant('in_stock', {
          price: 149,
          sale_price: 129,
          issues: [{ code: 'missing_gtin', severity: 'demoted', attribute: 'gtin' }],
        }),
        variant('in_stock', {
          price: 99,
          issues: [{ code: 'price_mismatch', severity: 'disapproved', attribute: 'price' }],
        }),
        variant('out_of_stock', { price: 50 }),
      ]),
    );
    expect(offer).toMatchObject({
      price: 149,
      salePrice: 129,
      currency: 'USD',
      issues: [{ code: 'missing_gtin', attribute: 'gtin' }],
    });
  });

  it("says why a product can't be offered", () => {
    expect(offerOf(product([variant('out_of_stock')]))).toEqual({ reason: 'sold_out' });
    expect(
      offerOf(product([variant('in_stock', { issues: [{ code: 'x', severity: 'disapproved' }] })])),
    ).toEqual({ reason: 'refused' });
    expect(offerOf(product([variant('in_stock')], null))).toEqual({ reason: 'no_link' });
  });

  it('reads limited availability and every spelling of in stock as in stock, spelled one way', () => {
    for (const availability of ['limited_availability', 'Limited Availability']) {
      expect(offerOf(product([variant(availability)])).offer.availability).toBe(
        'limited_availability',
      );
    }
    for (const availability of ['IN_STOCK', 'in stock', 'instock', 'available']) {
      expect(offerOf(product([variant(availability)])).offer).toBeTruthy();
    }
    expect(offerOf(product([variant('preorder')]))).toEqual({ reason: 'sold_out' });
  });

  it('orders the variants by their sale price where they have one', () => {
    const { offer } = offerOf(
      product([
        variant('in_stock', { external_id: 'a', price: 80 }),
        variant('in_stock', { external_id: 'b', price: 100, sale_price: 60 }),
      ]),
    );
    expect(offer).toMatchObject({ price: 100, salePrice: 60 });
  });

  it("links a variant's page when the product has none, and offers a variant with no price", () => {
    const { offer } = offerOf(
      product(
        [variant('in_stock', { price: null, url: 'https://s.example/p/boot?variant=42' })],
        null,
      ),
    );
    expect(offer).toMatchObject({
      url: 'https://s.example/p/boot?variant=42',
      price: null,
      salePrice: null,
    });
  });

  it('counts a disapproval only in the free listings, or in none named: an ad refusal is an issue', () => {
    const disapproved = (reporting_context) => ({
      code: 'policy',
      severity: 'disapproved',
      attribute: null,
      reporting_context,
    });
    expect(refuses(disapproved('FREE_LISTINGS'))).toBe(true);
    expect(refuses(disapproved(null))).toBe(true);
    expect(refuses(disapproved(''))).toBe(true);
    expect(refuses(disapproved('SHOPPING_ADS'))).toBe(false);
    expect(refuses({ ...disapproved(null), severity: 'demoted' })).toBe(false);
    const { offer } = offerOf(
      product([variant('in_stock', { issues: [disapproved('SHOPPING_ADS')] })]),
    );
    expect(offer.issues).toEqual([{ code: 'policy', attribute: null }]);
    expect(
      offerOf(product([variant('in_stock', { issues: [disapproved('FREE_LISTINGS')] })])),
    ).toEqual({ reason: 'refused' });
  });

  it("keeps a title and a product's issues within the path's caps", () => {
    const issues = Array.from({ length: 30 }, (_, i) => ({
      code: `code_${i}`,
      severity: 'demoted',
      attribute: null,
    }));
    const { offer } = offerOf({
      ...product([variant('in_stock', { issues })]),
      title: 'B'.repeat(900),
    });
    expect(offer.issues).toHaveLength(MAX_ISSUES);
    expect(offer.title).toHaveLength(TITLE_CHARS);
  });
});

describe('pickProducts', () => {
  const item = (id, score, reason = null) => ({
    product: { id, title: `Product ${id}` },
    score,
    result: reason ? { reason } : { offer: { id, title: `Product ${id}` } },
  });

  it('takes the best offers up to the page type, and keeps the best left out with why', () => {
    const { products, leftOut } = pickProducts(
      [item('a', 9), item('b', 8, 'sold_out'), item('c', 7), item('d', 6), item('e', 0)],
      { max: 2 },
    );
    expect(products.map((p) => p.id)).toEqual(['a', 'c']);
    expect(leftOut).toEqual([{ id: 'b', title: 'Product b', reason: 'sold_out' }]);
  });

  it("keeps the person's locked and added products, in the page's count, and never a removed one", () => {
    const items = [item('a', 9), item('b', 8), item('c', 0), item('d', 1)];
    const choices = { locked: ['d'], removed: ['a'], added: ['c'] };
    const ids = (max) =>
      pickProducts(items, { max, ...choices })
        .products.map((p) => p.id)
        .sort();
    expect(ids(2)).toEqual(['c', 'd']);
    expect(ids(3)).toEqual(['b', 'c', 'd']);
    // More kept than the page takes: all of them stay.
    expect(ids(1)).toEqual(['c', 'd']);
  });

  it("says why each of the person's products is left out, beside the best of the others", () => {
    const kept = ['k1', 'k2', 'k3', 'k4'];
    const { leftOut } = pickProducts(
      [
        ...kept.map((id) => item(id, 0, id === 'k4' ? 'gone' : 'sold_out')),
        ...['x1', 'x2', 'x3', 'x4'].map((id) => item(id, 5, 'refused')),
      ],
      { max: 3, locked: kept },
    );
    expect(leftOut.map((l) => l.id)).toEqual(['k1', 'k2', 'k3', 'k4', 'x1', 'x2', 'x3']);
    expect(leftOut.filter((l) => l.id.startsWith('x'))).toHaveLength(LEFT_OUT);
    expect(leftOut.find((l) => l.id === 'k4').reason).toBe('gone');
  });

  it('links MAX_PRODUCTS at most, however many the person keeps', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `k${i}`);
    const { products } = pickProducts(
      ids.map((id) => item(id, 0)),
      { max: 5, locked: ids.slice(0, 40), added: ids.slice(40) },
    );
    expect(products).toHaveLength(MAX_PRODUCTS);
  });
});

describe('readShoppingPath', () => {
  it("reads a stored path, and one that isn't a path as none, logged", () => {
    expect(readShoppingPath(null)).toBeNull();
    expect(readShoppingPath(stored({ locked: ['p1'] }))).toMatchObject({ locked: ['p1'] });
    logger.warn.mockClear();
    for (const broken of [
      { locked: ['p1'] },
      stored({ locked: 'p1' }),
      stored({ products: [null] }),
      stored({ categories: {} }),
      stored({ removed: Array.from({ length: 201 }, (_, i) => `r${i}`) }),
      'a path',
    ]) {
      expect(readShoppingPath(broken, { draftId: 'd1' })).toBeNull();
    }
    expect(logger.warn).toHaveBeenCalledTimes(6);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ draftId: 'd1' });
  });
});

describe('fitted', () => {
  it("measures a value as the column's jsonb text does", () => {
    expect(storedSize({ a: [1, 'x'], b: null, c: { d: 'é' } })).toBe(
      Buffer.byteLength('{"a": [1, "x"], "b": null, "c": {"d": "é"}}'),
    );
  });

  it('brings the largest path under 64 KB: fewer issues first, then fewer products', () => {
    const long = (n) => `https://s.example/${'x'.repeat(n)}`;
    const product = (i) => ({
      id: `p${i}`,
      title: 'T'.repeat(TITLE_CHARS),
      url: long(2000),
      price: 10,
      salePrice: null,
      currency: 'USD',
      availability: 'in_stock',
      image: long(2000),
      issues: Array.from({ length: MAX_ISSUES }, (_, j) => ({
        code: `c${j}`.padEnd(150, 'c'),
        attribute: 'a'.repeat(150),
      })),
      score: 1,
    });
    const big = stored({ products: Array.from({ length: MAX_PRODUCTS }, (_, i) => product(i)) });
    expect(storedSize(big)).toBeGreaterThan(65536);
    const out = fitted(big);
    expect(storedSize(out)).toBeLessThanOrEqual(MAX_PATH_BYTES);
    expect(out.products[0].issues).toEqual([]);
    expect(out.products.length).toBeLessThan(MAX_PRODUCTS);
    expect(out.products[0].id).toBe('p0');
    expect(shoppingPathSchema.safeParse(out).success).toBe(true);
    // A path under the cap is left as it is.
    const small = stored({ products: [product(1)] });
    expect(fitted(small)).toBe(small);
  });
});

describe('buildShoppingPath', () => {
  const NOW = new Date('2026-10-27T12:00:00Z');

  /**
   * A shop: draft d1 (a buying guide for waterproof hiking boots) of brand
   * b1, its category "Shoes > Hiking Boots" with a page, and products.
   * `add` puts more products in the catalog.
   */
  function setup({
    siteType = 'ecommerce',
    pageType = 'buying_guide',
    path = null,
    products = true,
    page = true,
    maxRows,
  } = {}) {
    const fake = fakeDb({ maxRows });
    fake.rows('content_drafts').push({
      id: 'd1',
      brand_id: 'b1',
      title: 'How to choose waterproof hiking boots',
      page_type: pageType,
      brief: BRIEF,
      shopping_path: path,
    });
    fake.rows('brands').push({ id: 'b1', site_type: siteType, shopping_mode_enabled: false });
    if (page) {
      fake.rows('site_pages').push({
        id: 's1',
        brand_id: 'b1',
        url: 'https://s.example/collections/hiking-boots',
        title: 'Hiking boots',
      });
    }
    fake
      .rows('catalog_categories')
      .push({ id: 'c1', brand_id: 'b1', name: 'Shoes > Hiking Boots' });
    const add = (
      id,
      title,
      {
        availability = 'in_stock',
        severity = null,
        inCategory = true,
        brand = 'b1',
        removed = false,
        variants = 1,
        price = 100,
        type = inCategory ? 'Shoes > Hiking Boots' : 'Other',
      } = {},
    ) => {
      fake.rows('catalog_products').push({
        id,
        brand_id: brand,
        title,
        url: `https://s.example/products/${id}`,
        product_type: type,
        description: null,
        removed_at: removed ? '2026-10-20T00:00:00Z' : null,
      });
      if (inCategory) {
        fake
          .rows('catalog_product_categories')
          .push({ brand_id: brand, product_id: id, category_id: 'c1' });
      }
      for (let n = 0; n < variants; n += 1) {
        fake.rows('catalog_variants').push({
          id: `v-${id}-${String(n).padStart(4, '0')}`,
          product_id: id,
          external_id: `${id}-${n}`,
          url: null,
          price,
          sale_price: null,
          currency: 'USD',
          // Only a product's last variant is in stock, when it is.
          availability: n === variants - 1 ? availability : 'out_of_stock',
          removed_at: null,
        });
      }
      if (severity) {
        fake.rows('catalog_item_issues').push({
          id: `i-${id}`,
          brand_id: brand,
          external_id: `${id}-${variants - 1}`,
          code: severity === 'demoted' ? 'missing_gtin' : 'price_mismatch',
          severity,
          attribute: severity === 'demoted' ? 'gtin' : 'price',
          reporting_context: null,
        });
      }
    };
    if (products) {
      add('p1', 'Summit Waterproof Hiking Boot');
      add('p2', 'Trail Mid Waterproof Boot', { severity: 'demoted' });
      add('p3', 'Canyon Low Waterproof Hiker', { availability: 'out_of_stock' });
      add('p4', 'Ridge Waterproof Hiking Boot', { severity: 'disapproved' });
      add('p5', 'Wool Hiking Sock', { inCategory: false });
    }
    const rpc = vi.fn(async () => ({
      data: [
        { category: 'Shoes > Hiking Boots', products: 4, in_stock: 3 },
        { category: 'Socks', products: 1, in_stock: 1 },
      ],
      error: null,
    }));
    const db = { ...fake.db, rpc };
    const build = () => buildShoppingPath({ draftId: 'd1', brandId: 'b1' }, { db, now: NOW });
    return { fake, db, rpc, add, build, draft: () => fake.rows('content_drafts')[0] };
  }

  it('picks the category page and the products in stock Merchant Center accepts, and saves them', async () => {
    const { fake, build } = setup();
    const path = await build();
    expect(path).toMatchObject({
      version: 1,
      builtAt: '2026-10-27T12:00:00.000Z',
      pageType: 'buying_guide',
      categories: [
        {
          name: 'Shoes > Hiking Boots',
          url: 'https://s.example/collections/hiking-boots',
          title: 'Hiking boots',
        },
      ],
      locked: [],
      removed: [],
      added: [],
    });
    expect(path.products.map((p) => p.id)).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect(path.products.map((p) => p.id)).not.toContain('p3');
    expect(path.products.map((p) => p.id)).not.toContain('p4');
    expect(path.products.find((p) => p.id === 'p2').issues).toEqual([
      { code: 'missing_gtin', attribute: 'gtin' },
    ]);
    expect(path.leftOut).toEqual(
      expect.arrayContaining([
        { id: 'p3', title: 'Canyon Low Waterproof Hiker', reason: 'sold_out' },
        { id: 'p4', title: 'Ridge Waterproof Hiking Boot', reason: 'refused' },
      ]),
    );
    expect(fake.rows('content_drafts')[0].shopping_path).toEqual(path);
    expect(shoppingPathSchema.parse(path)).toEqual(path);
  });

  it("gives a product of the picked category one more point: it is offered, another brand's isn't", async () => {
    const { add, build } = setup();
    add('p6', 'Model X', { type: 'Misc' });
    add('p7', 'Garden Hose', { inCategory: false });
    const path = await build();
    const ids = path.products.map((p) => p.id);
    expect(ids).toContain('p6');
    expect(path.products.find((p) => p.id === 'p6').score).toBe(1);
    expect(ids).not.toContain('p7');
  });

  const COUNTS = [
    ['best_of', 8],
    ['buying_guide', 5],
    ['comparison', 4],
    ['alternatives', 4],
    ['guide', 4],
    ['blog_post', 3],
  ];

  it('takes a path on these page types only', () => {
    expect(Object.keys(PRODUCTS_FOR).sort()).toEqual(COUNTS.map(([type]) => type).sort());
  });

  it.each(COUNTS)('links as many products as a %s takes (%i)', async (pageType, count) => {
    const { add, build } = setup({ pageType, products: false });
    for (let i = 0; i < 12; i += 1) add(`p${String(i).padStart(2, '0')}`, 'Waterproof Boot');
    expect((await build()).products).toHaveLength(count);
  });

  it("keeps the person's choices when it builds again", async () => {
    const { build } = setup({ path: stored({ locked: ['p5'], removed: ['p1'] }) });
    const path = await build();
    const ids = path.products.map((p) => p.id);
    expect(ids).toContain('p5');
    expect(ids).not.toContain('p1');
    expect(path.locked).toEqual(['p5']);
    expect(path.removed).toEqual(['p1']);
  });

  it('keeps an added product past the best scored, and keeps it on every build after (a gift card among 60 boots)', async () => {
    const { add, build, draft } = setup({ products: false });
    for (let i = 0; i < 60; i += 1) {
      add(`b${String(i).padStart(2, '0')}`, `Waterproof Hiking Boot ${i}`);
    }
    add('gift', 'Gift card', { inCategory: false });
    // The person adds it in the Brief tab: saved as the path's own.
    draft().shopping_path = stored({ added: ['gift'] });
    for (let n = 0; n < 2; n += 1) {
      const path = await build();
      expect(path.products.map((p) => p.id)).toContain('gift');
      expect(path.products).toHaveLength(PRODUCTS_FOR.buying_guide);
      expect(path.added).toEqual(['gift']);
    }
  });

  it('says why a locked product is left out: sold out since, or gone from the catalog', async () => {
    const { add, build } = setup({
      path: stored({
        locked: ['p3', 'p8', 'p9', 'x1'],
        products: [
          {
            id: 'p9',
            title: 'Old Boot',
            url: 'https://s.example/products/p9',
            price: 1,
            salePrice: null,
            currency: 'USD',
            availability: 'in_stock',
            image: null,
            issues: [],
            score: 3,
          },
        ],
      }),
    });
    add('p8', 'Retired Waterproof Boot', { removed: true });
    // Another brand's product, its id written in by hand: never read.
    add('x1', 'Their Boot', { brand: 'b2', inCategory: false });
    // p9 was deleted from the catalog: no row at all.
    const path = await build();
    expect(path.locked).toEqual(['p3', 'p8', 'p9', 'x1']);
    expect(path.leftOut).toEqual(
      expect.arrayContaining([
        { id: 'p3', title: 'Canyon Low Waterproof Hiker', reason: 'sold_out' },
        { id: 'p8', title: 'Retired Waterproof Boot', reason: 'gone' },
        { id: 'p9', title: 'Old Boot', reason: 'gone' },
        { id: 'x1', title: null, reason: 'gone' },
      ]),
    );
    for (const id of ['p3', 'p8', 'p9', 'x1']) {
      expect(path.products.map((p) => p.id)).not.toContain(id);
    }
    expect(shoppingPathSchema.safeParse(path).success).toBe(true);
  });

  it("reads past PostgREST's 1000 rows: the links, the products, the variants and the issues", async () => {
    const { add, build, fake } = setup({ products: false, maxRows: 1000 });
    for (let i = 0; i < 1500; i += 1) {
      add(`q${String(i).padStart(4, '0')}`, `Plain Item ${i}`, { variants: 0, type: 'Misc' });
    }
    // Past the first 1000 links and products, and its stock past its first 1000 variants.
    add('q9000', 'Summit Waterproof Hiking Boot', { variants: 1200, price: 89 });
    // Past its first 1000 issues, a refusal in the free listings.
    add('q9001', 'Ridge Waterproof Hiking Boot');
    for (let i = 0; i < 1001; i += 1) {
      fake.rows('catalog_item_issues').push({
        id: `j-${String(i).padStart(4, '0')}`,
        brand_id: 'b1',
        external_id: 'q9001-0',
        code: i === 1000 ? 'policy' : `note_${i}`,
        severity: i === 1000 ? 'disapproved' : 'not_impacted',
        attribute: null,
        reporting_context: i === 1000 ? 'FREE_LISTINGS' : null,
      });
    }
    const path = await build();
    expect(path.products.map((p) => [p.id, p.price])).toEqual([['q9000', 89]]);
    expect(path.leftOut[0]).toEqual({
      id: 'q9001',
      title: 'Ridge Waterproof Hiking Boot',
      reason: 'refused',
    });
  });

  it("reads past PostgREST's 1000 rows for a brand with no category page, too", async () => {
    const { add, build } = setup({ products: false, page: false, maxRows: 1000 });
    for (let i = 0; i < 1500; i += 1) {
      add(`q${String(i).padStart(4, '0')}`, `Plain Item ${i}`, { variants: 0 });
    }
    add('q9000', 'Summit Waterproof Hiking Boot');
    const path = await build();
    expect(path.categories).toEqual([]);
    expect(path.products.map((p) => p.id)).toEqual(['q9000']);
  });

  it("refuses to write over a person's change, or another build, made while it built", async () => {
    // A person's save (its savedAt) while the build reads the catalog.
    const saved = setup({ path: stored({ locked: ['p5'] }) });
    saved.rpc.mockImplementationOnce(async () => {
      saved.draft().shopping_path = stored({
        locked: ['p5'],
        removed: ['p2'],
        savedAt: '2026-10-27T11:59:59.000Z',
      });
      return { data: [], error: null };
    });
    await expect(saved.build()).rejects.toMatchObject({ status: 409, code: 'changed' });
    expect(saved.draft().shopping_path.removed).toEqual(['p2']);

    // Another build, from another tab.
    const other = setup();
    other.rpc.mockImplementationOnce(async () => {
      other.draft().shopping_path = stored({ builtAt: '2026-10-27T11:59:59.000Z' });
      return { data: [], error: null };
    });
    await expect(other.build()).rejects.toMatchObject({ status: 409, code: 'changed' });

    // Unchanged since it was read, a path the person saved builds over.
    const ok = setup({ path: stored({ savedAt: '2026-10-27T11:00:00.000Z', locked: ['p5'] }) });
    expect((await ok.build()).locked).toEqual(['p5']);
  });

  it("builds over a stored path that isn't one, as if there were none", async () => {
    logger.warn.mockClear();
    const { build, draft } = setup({ path: { locked: 'p1', products: [null] } });
    const path = await build();
    expect(path.locked).toEqual([]);
    expect(draft().shopping_path).toEqual(path);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("has none for a brand that isn't a shop, a page type that takes none, no catalog, or no match", async () => {
    await expect(setup({ siteType: 'b2b' }).build()).rejects.toMatchObject({
      reason: 'not_a_shop',
    });
    await expect(setup({ pageType: 'product_page' }).build()).rejects.toBeInstanceOf(
      NoShoppingPath,
    );
    await expect(setup({ pageType: 'constructor' }).build()).rejects.toMatchObject({
      reason: 'page_type',
    });
    await expect(setup({ products: false }).build()).rejects.toMatchObject({
      reason: 'no_catalog',
    });
    const unrelated = setup({ products: false, page: false });
    unrelated.add('g1', 'Garden Hose', { inCategory: false });
    await expect(unrelated.build()).rejects.toMatchObject({ reason: 'no_match' });
    expect(unrelated.draft().shopping_path).toBeNull();
    await expect(
      buildShoppingPath({ draftId: 'd1', brandId: 'b2' }, { db: setup().db }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
