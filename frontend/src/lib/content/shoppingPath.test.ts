import { describe, expect, it } from 'vitest';
import {
  MAX_REMOVED,
  leftOutReason,
  placementOf,
  shoppingPathFits,
  shoppingPathSchema,
  withAdded,
  withLocked,
  withRemoved,
  type ShoppingPath,
  bestInStock,
  priceAmount,
} from './shoppingPath';

/** A draft's shopping path as the Brief tab holds it (shopping path, 00351). */

const product = (id: string) => ({
  id,
  title: `Boot ${id}`,
  url: `https://s.example/p/${id}`,
  price: 129,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 5,
});

const PATH: ShoppingPath = {
  version: 1,
  builtAt: '2026-10-27T12:00:00.000Z',
  pageType: 'buying_guide',
  categories: [{ name: 'Hiking Boots', url: 'https://s.example/c/hiking-boots', title: null }],
  products: [product('a'), product('b')],
  leftOut: [{ id: 'c', title: 'Boot c', reason: 'sold_out' }],
  locked: ['a'],
  removed: [],
  added: ['b'],
};

describe('shoppingPathFits', () => {
  it('fits the page types that link products, on an online shop only', () => {
    expect(shoppingPathFits('ecommerce', 'buying_guide')).toBe(true);
    expect(shoppingPathFits('ecommerce', 'blog_post')).toBe(true);
    expect(shoppingPathFits('ecommerce', 'product_page')).toBe(false);
    expect(shoppingPathFits('ecommerce', null)).toBe(false);
    expect(shoppingPathFits('b2b', 'buying_guide')).toBe(false);
  });
});

describe('placementOf', () => {
  it("names a product's place by page type", () => {
    expect(placementOf('best_of', 0)).toEqual({ key: 'pick', n: 1 });
    expect(placementOf('comparison', 2)).toEqual({ key: 'compared', n: 3 });
    expect(placementOf('blog_post', 1)).toEqual({ key: 'linked', n: 2 });
  });
});

describe('changes', () => {
  it('removes a product for good, locks and unlocks one, and adds one', () => {
    const removed = withRemoved(PATH, 'a');
    expect(removed.products.map((p) => p.id)).toEqual(['b']);
    expect(removed.locked).toEqual([]);
    expect(removed.removed).toEqual(['a']);

    expect(withLocked(PATH, 'b', true).locked).toEqual(['a', 'b']);
    expect(withLocked(PATH, 'a', false).locked).toEqual([]);

    const added = withAdded(removed, 'a');
    expect(added.added).toEqual(['b', 'a']);
    expect(added.removed).toEqual([]);
  });

  it("keeps to the API's caps: past them, the oldest removal is forgotten", () => {
    const full = { ...PATH, removed: Array.from({ length: MAX_REMOVED }, (_, i) => `r${i}`) };
    const removed = withRemoved(full, 'a').removed;
    expect(removed).toHaveLength(MAX_REMOVED);
    expect(removed[0]).toBe('r1');
    expect(removed.at(-1)).toBe('a');
  });
});

describe('shoppingPathSchema', () => {
  it("reads the API's path, and refuses another shape", () => {
    expect(shoppingPathSchema.safeParse(PATH).success).toBe(true);
    expect(shoppingPathSchema.safeParse({ ...PATH, version: 2 }).success).toBe(false);
  });

  it('keeps the time of the last change, which a save and a build write over', () => {
    const saved = { ...PATH, savedAt: '2026-10-27T13:00:00.000Z' };
    expect(shoppingPathSchema.parse(saved).savedAt).toBe('2026-10-27T13:00:00.000Z');
    expect(shoppingPathSchema.parse(PATH).savedAt).toBeUndefined();
  });

  it('reads a product gone from the catalog, with no title, and a reason added since', () => {
    const leftOut = [
      { id: 'x', title: null, reason: 'gone' },
      { id: 'y', title: 'Boot y', reason: 'recalled' },
    ];
    expect(shoppingPathSchema.parse({ ...PATH, leftOut }).leftOut).toEqual(leftOut);
    expect(leftOutReason('gone')).toBe('gone');
    expect(leftOutReason('recalled')).toBe('other');
  });

  it("refuses a path past the API's caps", () => {
    const products = Array.from({ length: 41 }, (_, i) => product(`p${i}`));
    expect(shoppingPathSchema.safeParse({ ...PATH, products }).success).toBe(false);
    const issues = Array.from({ length: 21 }, (_, i) => ({ code: `c${i}`, attribute: null }));
    expect(
      shoppingPathSchema.safeParse({ ...PATH, products: [{ ...product('a'), issues }] }).success,
    ).toBe(false);
    const leftOut = Array.from({ length: 11 }, (_, i) => ({
      id: `l${i}`,
      title: null,
      reason: 'gone',
    }));
    expect(shoppingPathSchema.safeParse({ ...PATH, leftOut }).success).toBe(false);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`);
    expect(shoppingPathSchema.safeParse({ ...PATH, locked: ids(41) }).success).toBe(false);
    expect(shoppingPathSchema.safeParse({ ...PATH, added: ids(41) }).success).toBe(false);
    expect(shoppingPathSchema.safeParse({ ...PATH, removed: ids(200) }).success).toBe(true);
    expect(shoppingPathSchema.safeParse({ ...PATH, removed: ids(201) }).success).toBe(false);
    const long = { ...product('a'), title: 'x'.repeat(201) };
    expect(shoppingPathSchema.safeParse({ ...PATH, products: [long] }).success).toBe(false);
  });

  it('reads stock as the API spells it, and only http(s) links', () => {
    const read = shoppingPathSchema.parse({
      ...PATH,
      categories: [{ name: 'Boots', url: 'javascript:alert(1)', title: null }],
      products: [
        { ...product('a'), availability: 'Limited Availability', image: 'data:image/png;base64,x' },
        { ...product('b'), url: '/p/b', availability: 'IN-STOCK', image: 'http://s.example/b.jpg' },
      ],
    });
    expect(read.categories[0].url).toBeNull();
    expect(read.products.map((p) => [p.url, p.availability, p.image])).toEqual([
      ['https://s.example/p/a', 'limited_availability', null],
      [null, 'in_stock', 'http://s.example/b.jpg'],
    ]);
  });
});

describe('priceAmount', () => {
  it('takes the sale price under the price, the sale price alone, and reads 0 as none', () => {
    expect(priceAmount({ price: 199, salePrice: 149 })).toBe(149);
    expect(priceAmount({ price: 199, salePrice: 249 })).toBe(199);
    expect(priceAmount({ price: null, salePrice: 149 })).toBe(149);
    expect(priceAmount({ price: 0, salePrice: 0 })).toBeNull();
  });
});

describe('bestInStock', () => {
  const variant = (price: number | null, availability: string | null, sale_price = null) => ({
    price,
    sale_price,
    availability,
  });

  it('prefers in stock to low stock, as the agent’s grid does (#1607)', () => {
    const inStock = variant(199, 'in stock');
    expect(bestInStock([variant(149, 'limited availability'), inStock])).toBe(inStock);
  });

  it('takes the lowest price at the best stock, one with no price last, none when none is in stock', () => {
    const cheap = variant(120, 'In Stock');
    expect(bestInStock([variant(null, 'in_stock'), variant(180, 'in stock'), cheap])).toBe(cheap);
    expect(bestInStock([variant(10, 'preorder'), variant(12, null)])).toBeNull();
  });
});
