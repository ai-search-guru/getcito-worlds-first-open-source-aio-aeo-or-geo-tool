import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));
const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('./logger.js', () => ({ logger }));

import { linkAllowList, linkTargetsPrompt } from './contentLinks.js';
import { knownNumbers, placeholderNumbers, withNamedNumbers } from './contentSources.js';
import {
  linkShoppingPath,
  shoppingGiven,
  shoppingPathFor,
  shoppingPrompt,
  shoppingTargets,
  stockWords,
  withShopping,
} from './shoppingLinks.js';

/** The Content Agent's side of a draft's shopping path (shopping path, part 4). */

const product = (id, title, extra = {}) => ({
  id,
  title,
  url: `https://shop.example/products/${id}?utm_source=feed`,
  price: 189,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 9,
  ...extra,
});

const PATH = {
  version: 1,
  builtAt: '2026-10-27T10:00:00.000Z',
  pageType: 'buying_guide',
  categories: [
    {
      name: 'Shoes > Hiking Boots',
      url: 'https://shop.example/collections/hiking-boots',
      title: null,
    },
  ],
  products: [
    product('p1', 'Summit GTX Boot'),
    product('p2', 'Trail Mid', {
      price: 149,
      salePrice: 129,
      availability: 'limited_availability',
    }),
  ],
  leftOut: [],
  locked: [],
  removed: [],
  added: [],
};

beforeEach(() => {
  logger.warn.mockReset();
});

describe('shoppingTargets', () => {
  it('names the category page by its own name and each product by its title, tracking dropped', () => {
    expect(shoppingTargets(PATH)).toEqual([
      {
        url: 'https://shop.example/collections/hiking-boots',
        title: 'Hiking Boots',
        kind: 'category',
      },
      { url: 'https://shop.example/products/p1', title: 'Summit GTX Boot', kind: 'product' },
      { url: 'https://shop.example/products/p2', title: 'Trail Mid', kind: 'product' },
    ]);
    expect(shoppingTargets(null)).toEqual([]);
  });

  it('links https pages only, each name and address once', () => {
    const path = {
      ...PATH,
      products: [
        product('p1', 'Summit GTX Boot'),
        product('p2', 'Summit  GTX Boot'),
        product('p3', 'Trail Mid', { url: 'http://shop.example/products/p3' }),
        product('p4', 'Other name', { url: 'https://shop.example/products/p1' }),
        product('p5', 'Ridge Low'),
      ],
    };
    expect(shoppingTargets(path).map((t) => t.title)).toEqual([
      'Hiking Boots',
      'Summit GTX Boot',
      'Ridge Low',
    ]);
  });

  it("offers as many products as the page type links, the person's own all kept", () => {
    const many = Array.from({ length: 12 }, (_, i) => product(`p${i}`, `Boot ${i}`));
    const titles = (path) => shoppingTargets(path).filter((t) => t.kind === 'product');
    // A buying guide links 5.
    expect(titles({ ...PATH, products: many })).toHaveLength(5);
    // Six locked: all six, and no other.
    const locked = many.slice(0, 6).map((p) => p.id);
    expect(titles({ ...PATH, products: many, locked }).map((t) => t.title)).toEqual(
      many.slice(0, 6).map((p) => p.title),
    );
    // Two added: counted in the five.
    expect(titles({ ...PATH, products: many, added: ['p10', 'p11'] }).map((t) => t.title)).toEqual([
      'Boot 0',
      'Boot 1',
      'Boot 2',
      'Boot 10',
      'Boot 11',
    ]);
    // A page type the table doesn't have: 40 at most.
    expect(titles({ ...PATH, pageType: null, products: many })).toHaveLength(12);
  });
});

describe('stockWords', () => {
  it('says only the stock the catalog reads, and nothing for one it cannot', () => {
    expect(stockWords('in_stock')).toBe('in stock');
    expect(stockWords('In Stock')).toBe('in stock');
    expect(stockWords('limited_availability')).toBe('low stock');
    expect(stockWords('out_of_stock')).toBe('out of stock');
    expect(stockWords('OUT OF STOCK')).toBe('out of stock');
    expect(stockWords('preorder')).toBe('available to pre-order');
    expect(stockWords('backorder')).toBe('on backorder');
    expect(stockWords('discontinued')).toBeNull();
    expect(stockWords('constructor')).toBeNull();
    expect(stockWords(null)).toBeNull();
  });
});

describe('shoppingPrompt', () => {
  it("tells a new page's writer the category and the products with the catalog's price and stock only", () => {
    const prompt = shoppingPrompt(PATH);
    expect(prompt).toContain('Category page: Hiking Boots.');
    expect(prompt).toContain('- Summit GTX Boot: 189.00 USD, in stock');
    expect(prompt).toContain('- Trail Mid: 129.00 USD, low stock');
    expect(prompt).toContain("Never write a price, size, weight or other spec that isn't");
    expect(prompt).toContain('a price as given');
    expect(shoppingPrompt({ categories: [], products: [] })).toBe('');
  });

  it('tells the price as the card shows it: a sale price only under the price, never 0', () => {
    const prompt = shoppingPrompt({
      ...PATH,
      products: [
        product('p1', 'Summit GTX Boot', { salePrice: 149 }),
        product('p2', 'Trail Mid', { salePrice: 0 }),
        product('p3', 'Ridge Low', { salePrice: 249 }),
        product('p4', 'Canyon Sandal', { price: 0, salePrice: null }),
      ],
    });
    expect(prompt).toContain('- Summit GTX Boot: 149.00 USD');
    expect(prompt).toContain('- Trail Mid: 189.00 USD');
    expect(prompt).toContain('- Ridge Low: 189.00 USD');
    expect(prompt).not.toContain('0.00 USD');
  });

  it('never says a product out of stock or on pre-order is in stock, nor any stock it cannot read', () => {
    const prompt = shoppingPrompt({
      ...PATH,
      products: [
        product('p1', 'Summit GTX Boot', { availability: 'out_of_stock' }),
        product('p2', 'Trail Mid', { availability: 'preorder' }),
        product('p3', 'Ridge Low', { availability: 'discontinued' }),
        product('p4', 'Canyon Sandal', { price: null, availability: '' }),
      ],
    });
    expect(prompt).toContain('- Summit GTX Boot: 189.00 USD, out of stock');
    expect(prompt).toContain('- Trail Mid: 189.00 USD, available to pre-order');
    expect(prompt).toContain('- Ridge Low: 189.00 USD\n');
    expect(prompt).toContain('- Canyon Sandal\n');
    expect(prompt).not.toMatch(/in stock/);
  });
});

describe('shoppingGiven and the number guard', () => {
  const guard = (path, text) => {
    const given = shoppingGiven(path);
    return placeholderNumbers(text, withNamedNumbers(knownNumbers(given.prices), given.names));
  };

  it("keeps the catalog's price written with a sign, a code or none, and only it", () => {
    for (const text of [
      'It costs $189.',
      'It costs $189.00.',
      'It costs 189 USD.',
      'It costs US$189.',
      'It costs $129, down from [figure, source].',
    ]) {
      expect(guard(PATH, text)).toBe(text);
    }
    expect(guard(PATH, 'It costs $199.')).toBe('It costs [figure, source].');
    // A sign the currency doesn't take is a claim of its own.
    expect(guard(PATH, 'It costs €189.')).toBe('It costs [figure, source].');
  });

  it('reads a price written with thousands, as Turkish writes it', () => {
    const path = {
      ...PATH,
      products: [product('p1', 'Kışlık Bot', { price: 1299, currency: 'TRY' })],
    };
    for (const text of ['Fiyatı ₺1.299.', 'Fiyatı ₺1.299,00.', 'Fiyatı 1.299 TL.']) {
      expect(guard(path, text)).toBe(text);
    }
    expect(guard(path, 'Fiyatı ₺1.399.')).toBe('Fiyatı [figure, source].');
  });

  it("knows a product's own number only where its name is written", () => {
    const path = { ...PATH, products: [product('p1', "Men's Trail 450")] };
    expect(guard(path, 'The Men’s  Trail 450 is light.')).toBe('The Men’s  Trail 450 is light.');
    expect(guard(path, 'It weighs 450 g.')).toBe('It weighs [figure, source] g.');
    // Not inside a longer number.
    expect(guard(path, "The Men's Trail 4500 is new.")).toBe(
      "The Men's Trail [figure, source] is new.",
    );
  });

  it('gives the names the people guard reads: the categories whole, the products', () => {
    expect(shoppingGiven(PATH).names).toEqual([
      'Shoes > Hiking Boots',
      'Summit GTX Boot',
      'Trail Mid',
    ]);
    expect(shoppingGiven(null)).toEqual({ prices: '', names: [] });
  });
});

describe('linkShoppingPath', () => {
  it('links a long paragraph, mostly spaces, in time near its length', () => {
    const html = `<p>${'word   '.repeat(40_000)} the Trail Mid.</p><p>${' '.repeat(200_000)}hiking boots</p>`;
    const started = Date.now();
    const { linked } = linkShoppingPath(html, PATH);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(linked).toEqual({ category: 1, product: 1 });
  });

  it('links each name the first time a paragraph or a list item names it, never a heading', () => {
    const html =
      '<h1>Hiking boots</h1><p>Good hiking boots keep you dry. More hiking boots below.</p>' +
      '<h2>Summit GTX Boot</h2><ul><li><p>The Summit GTX Boot is light &amp; dry.</p></li></ul>' +
      '<p>See the <a href="https://x.example">Trail Mid</a> and the Trail Mid again.</p>';
    const { html: out, linked } = linkShoppingPath(html, PATH);
    expect(linked).toEqual({ category: 1, product: 2 });
    expect(out).toContain('<h1>Hiking boots</h1>');
    expect(out).toContain(
      '<p>Good <a href="https://shop.example/collections/hiking-boots">hiking boots</a> keep you dry. More hiking boots below.</p>',
    );
    expect(out).toContain('<h2>Summit GTX Boot</h2>');
    expect(out).toContain(
      'The <a href="https://shop.example/products/p1">Summit GTX Boot</a> is light &amp; dry.',
    );
    // Not inside a link already there: the next time it's named.
    expect(out).toContain(
      '<a href="https://x.example">Trail Mid</a> and the <a href="https://shop.example/products/p2">Trail Mid</a> again.',
    );
  });

  it("takes a category's singular, and leaves a product's own words to the product", () => {
    const path = {
      ...PATH,
      products: [product('p3', 'Hiking Boots Care Kit')],
    };
    const { html, linked } = linkShoppingPath(
      '<p>The Hiking Boots Care Kit cleans any hiking boot.</p>',
      path,
    );
    expect(linked).toEqual({ category: 1, product: 1 });
    expect(html).toBe(
      '<p>The <a href="https://shop.example/products/p3">Hiking Boots Care Kit</a> cleans any <a href="https://shop.example/collections/hiking-boots">hiking boot</a>.</p>',
    );
  });

  it('links a whole name only: never the start of a longer word', () => {
    const { html, linked } = linkShoppingPath(
      '<p>A Trail Midsole and hiking bootstraps. Then the Trail Mid.</p>',
      PATH,
    );
    expect(linked).toEqual({ category: 0, product: 1 });
    expect(html).toBe(
      '<p>A Trail Midsole and hiking bootstraps. Then the <a href="https://shop.example/products/p2">Trail Mid</a>.</p>',
    );
  });

  it("reads a product's name as written: a common word in lower case isn't the product", () => {
    const path = { ...PATH, categories: [], products: [product('p9', 'Pro')] };
    const { html } = linkShoppingPath('<p>Here is a pro tip.</p><p>The Pro is light.</p>', path);
    expect(html).toBe(
      '<p>Here is a pro tip.</p><p>The <a href="https://shop.example/products/p9">Pro</a> is light.</p>',
    );
  });

  it("reads a name's apostrophes and spaces any way", () => {
    const path = { ...PATH, categories: [], products: [product('p9', "Men's Trail Boot")] };
    const { html } = linkShoppingPath('<p>The Men’s  Trail Boot is light.</p>', path);
    expect(html).toBe(
      '<p>The <a href="https://shop.example/products/p9">Men’s  Trail Boot</a> is light.</p>',
    );
  });

  it("reads a category in any case, Turkish's dotted and dotless i too", () => {
    const path = {
      ...PATH,
      categories: [
        { name: 'Giyim > İç Giyim', url: 'https://shop.example/kategori/ic-giyim', title: null },
        { name: 'Kadın Ayakkabı', url: 'https://shop.example/kategori/kadin', title: null },
      ],
      products: [],
    };
    const { html, linked } = linkShoppingPath(
      '<p>Rahat iç giyim seçin.</p><p>KADIN AYAKKABI modelleri.</p>',
      path,
    );
    expect(linked).toEqual({ category: 2, product: 0 });
    expect(html).toBe(
      '<p>Rahat <a href="https://shop.example/kategori/ic-giyim">iç giyim</a> seçin.</p>' +
        '<p><a href="https://shop.example/kategori/kadin">KADIN AYAKKABI</a> modelleri.</p>',
    );
  });

  it("takes a plural's singular as English writes it: glasses, glass", () => {
    const path = {
      ...PATH,
      categories: [
        { name: 'Reading Glasses', url: 'https://shop.example/c/reading-glasses', title: null },
      ],
      products: [],
    };
    expect(linkShoppingPath('<p>Pick a reading glass.</p>', path).html).toBe(
      '<p>Pick a <a href="https://shop.example/c/reading-glasses">reading glass</a>.</p>',
    );
    expect(linkShoppingPath('<p>Pick reading glasse frames.</p>', path).linked.category).toBe(0);
  });

  it('leaves a page with no path, or no names, as it is', () => {
    expect(linkShoppingPath('<p>Boots.</p>', null)).toEqual({
      html: '<p>Boots.</p>',
      linked: { category: 0, product: 0 },
    });
    expect(linkShoppingPath('<p>Nothing here.</p>', PATH).linked).toEqual({
      category: 0,
      product: 0,
    });
  });
});

describe('the shopping path as link targets', () => {
  it('comes first in the prompt whatever the rules, and its pages may be linked', () => {
    const targets = withShopping(
      { own: [{ url: 'https://shop.example/about', title: 'About' }], sources: [] },
      PATH,
    );
    const prompt = linkTargetsPrompt(targets, new Set());
    expect(prompt).toContain('The shopping path');
    expect(prompt).toContain('- Summit GTX Boot — https://shop.example/products/p1');
    expect(prompt).not.toContain('About');
    const allow = linkAllowList(targets);
    expect(allow.get('shop.example/products/p1')).toBe('https://shop.example/products/p1');
    expect(allow.get('shop.example/collections/hiking-boots')).toBeDefined();
  });
});

describe('shoppingPathFor', () => {
  /** A database whose reads answer each table's rows, or its error; `asked` lists them. */
  const fakeDb = (tables) => {
    const asked = [];
    const db = {
      asked,
      from: (table) => {
        asked.push(table);
        const answer = tables[table];
        const chain = {};
        for (const name of ['select', 'eq', 'in', 'is', 'order', 'range', 'limit']) {
          chain[name] = () => chain;
        }
        chain.then = (resolve, reject) =>
          Promise.resolve(
            answer instanceof Error
              ? { data: null, error: answer }
              : { data: answer ?? [], error: null },
          ).then(resolve, reject);
        return chain;
      },
    };
    return db;
  };
  const draft = (path) => ({ id: 'd1', brand_id: 'b1', shopping_path: path });

  it('leaves out a name longer than the build keeps', async () => {
    const db = fakeDb({
      brand_domains: [{ domain: 'shop.example' }],
      catalog_variants: [],
    });
    const path = {
      ...PATH,
      categories: [{ ...PATH.categories[0], name: `Shoes > ${'Boot '.repeat(10_000)}` }],
      products: [product('p1', 'Summit GTX Boot'), product('p2', 'Trail '.repeat(10_000))],
    };
    const read = await shoppingPathFor(draft(path), { db });
    expect(read.categories).toEqual([]);
    expect(read.products.map((p) => p.id)).toEqual(['p1']);
  });

  it('reads a broken path as none, logged, without reading the catalog', async () => {
    const db = fakeDb({});
    for (const broken of [
      { ...PATH, categories: { name: 'Boots' } },
      { ...PATH, products: [null] },
      'not a path',
    ]) {
      expect(await shoppingPathFor(draft(broken), { db })).toBeNull();
    }
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(await shoppingPathFor(draft(null), { db })).toBeNull();
    expect(db.asked).toEqual([]);
  });

  it("keeps the pages on the brand's own site over https only", async () => {
    const path = {
      ...PATH,
      categories: [
        ...PATH.categories,
        { name: 'Sale', url: 'https://evil.example/collections/sale', title: null },
      ],
      products: [
        product('p1', 'Summit GTX Boot'),
        product('p2', 'Trail Mid', { url: 'http://shop.example/products/p2' }),
        product('p3', 'Ridge Low', { url: 'https://eu.shop.example/products/p3' }),
        product('p4', 'Canyon Sandal', { url: 'https://shop.example.evil.example/p4' }),
      ],
    };
    const db = fakeDb({
      brand_domains: [{ domain: 'shop.example' }],
      catalog_variants: [
        { id: 'v1', product_id: 'p1', availability: 'in stock' },
        { id: 'v3', product_id: 'p3', availability: 'in_stock' },
      ],
    });
    const read = await shoppingPathFor(draft(path), { db });
    expect(read.categories.map((c) => c.name)).toEqual(['Shoes > Hiking Boots']);
    expect(read.products.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(logger.warn).toHaveBeenCalledWith(
      { draftId: 'd1', off: 3 },
      expect.stringContaining('off the brand'),
    );
  });

  it('with no domain stored, takes the site its catalog links to', async () => {
    const db = fakeDb({
      brand_domains: [],
      catalog_products: [{ url: 'https://shop.example/products/x' }],
      catalog_variants: [
        { id: 'v1', product_id: 'p1', availability: 'in stock', price: 189, currency: 'USD' },
        { id: 'v2', product_id: 'p2', availability: 'in stock', price: 189, currency: 'USD' },
      ],
    });
    const read = await shoppingPathFor(draft(PATH), { db });
    expect(read.products.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(db.asked).toContain('catalog_products');
  });

  it("links nothing when the brand's site can't be read", async () => {
    const db = fakeDb({ brand_domains: new Error('down') });
    expect(await shoppingPathFor(draft(PATH), { db })).toBeNull();
  });

  it("tells the stock the catalog has now: its live variants' best, none when none reads", async () => {
    const path = {
      ...PATH,
      products: [
        product('p1', 'Summit GTX Boot'),
        product('p2', 'Trail Mid'),
        product('p3', 'Ridge Low'),
        product('p4', 'Canyon Sandal'),
      ],
    };
    const db = fakeDb({
      brand_domains: [{ domain: 'shop.example' }],
      catalog_variants: [
        // Sold out since the path was built.
        { id: 'v1', product_id: 'p1', availability: 'out of stock', price: 189, currency: 'USD' },
        // One size low, another sold out: low stock, at the low one's price.
        { id: 'v2', product_id: 'p2', availability: 'OUT_OF_STOCK', price: 149, currency: 'USD' },
        {
          id: 'v3',
          product_id: 'p2',
          availability: 'limited availability',
          price: 199,
          currency: 'USD',
        },
        // A spelling it can't read.
        { id: 'v4', product_id: 'p3', availability: 'ask us', price: 189, currency: 'USD' },
      ],
    });
    const read = await shoppingPathFor(draft(path), { db });
    expect(read.products.map((p) => [p.id, p.availability])).toEqual([
      ['p1', 'out_of_stock'],
      ['p2', 'limited_availability'],
      ['p3', ''],
      ['p4', ''],
    ]);
    const prompt = shoppingPrompt(read);
    expect(prompt).toContain('- Summit GTX Boot: 189.00 USD, out of stock');
    expect(prompt).toContain('- Trail Mid: 199.00 USD, low stock');
    expect(prompt).toContain('- Ridge Low: 189.00 USD\n');
    // Gone from the catalog: nothing is said of its price or stock.
    expect(prompt).toContain('- Canyon Sandal\n');
  });

  it("tells the price the catalog has now, not the path's, from the variant whose stock it tells", async () => {
    const db = fakeDb({
      brand_domains: [{ domain: 'shop.example' }],
      catalog_variants: [
        // Its sale ended since the pick, and its price rose.
        { id: 'v1', product_id: 'p1', availability: 'in stock', price: 209, currency: 'USD' },
        // In stock at two prices: the lower one.
        { id: 'v2', product_id: 'p2', availability: 'in stock', price: 179, currency: 'USD' },
        {
          id: 'v3',
          product_id: 'p2',
          availability: 'in stock',
          price: 199,
          sale_price: 159,
          currency: 'USD',
        },
      ],
    });
    const path = {
      ...PATH,
      products: [product('p1', 'Summit GTX Boot', { salePrice: 149 }), product('p2', 'Trail Mid')],
    };
    const read = await shoppingPathFor(draft(path), { db });
    const prompt = shoppingPrompt(read);
    expect(prompt).toContain('- Summit GTX Boot: 209.00 USD, in stock');
    expect(prompt).toContain('- Trail Mid: 159.00 USD, in stock');
    const { prices } = shoppingGiven(read);
    expect(prices).toContain('$209');
    expect(prices).not.toContain('149');
  });

  it("keeps the path's stock when the catalog can't be read", async () => {
    const db = fakeDb({
      brand_domains: [{ domain: 'shop.example' }],
      catalog_variants: new Error('down'),
    });
    const read = await shoppingPathFor(draft(PATH), { db });
    expect(read.products.map((p) => p.availability)).toEqual(['in_stock', 'limited_availability']);
    expect(read.products.map((p) => [p.price, p.salePrice])).toEqual([
      [189, null],
      [149, 129],
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'd1' }),
      expect.stringContaining('reading stock failed'),
    );
  });
});
