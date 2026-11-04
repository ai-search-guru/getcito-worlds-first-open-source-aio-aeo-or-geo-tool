import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const isBrandActive = vi.hoisted(() => vi.fn(async () => true));
vi.mock('./activeSubscriptions.js', () => ({ isBrandActive }));

import { fakeDb } from './catalog/__fixtures__/fakeDb.js';
import { logger } from './logger.js';
import { htmlBlockElement } from './shoppingBlocks.js';
import {
  DRAFT_BATCH,
  LIVE_PAGES_DEADLINE_MS,
  MAX_DRAFTS,
  MAX_HREF_CHARS,
  MAX_LIVE_PAGES,
  MAX_NEW_ACTIONS,
  MIN_WORDS,
  checkShoppingDraft,
  checkShoppingLinks,
  linkCheck,
  linksPath,
  livePage,
  pageHrefs,
  pageWords,
  productStates,
  queueShoppingCheck,
} from './shoppingCheck.js';

/** Whether a page's shopping links still sell (shopping path, part 7, 00352). */

const BRAND = 'brand-1';
const NOW = new Date('2026-10-27T09:00:00Z');

const product = (id, extra = {}) => ({
  id,
  title: `Boot ${id}`,
  url: `https://shop.example/products/${id}`,
  price: 189,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 1,
  ...extra,
});

/** A path as a build leaves it (00351). */
const path = (
  products,
  categories = [{ name: 'Boots', url: 'https://shop.example/c/boots', title: 'Boots' }],
) => ({
  version: 1,
  builtAt: '2026-10-26T09:00:00.000Z',
  pageType: 'buying_guide',
  categories,
  products,
  leftOut: [],
  locked: [],
  removed: [],
  added: [],
});

/** A catalog with each product's variants: [availability, external id]. */
function catalog(fake, products) {
  for (const [id, variants, removed = null] of products) {
    fake.rows('catalog_products').push({
      id,
      brand_id: BRAND,
      title: `Boot ${id}`,
      removed_at: removed,
    });
    for (const [availability, externalId] of variants) {
      fake.rows('catalog_variants').push({
        id: `v-${externalId}`,
        brand_id: BRAND,
        product_id: id,
        external_id: externalId,
        availability,
        removed_at: null,
      });
    }
  }
}

const link = (id) =>
  `<a href="https://shop.example/products/${id}?utm_source=guide">Boot ${id}</a>`;

/** A live page as the brand's site serves it: words around its links. */
const livePageHtml = (links) =>
  `<html><head><script>var words = "${'x '.repeat(50)}";</script></head><body><nav>Home Shop</nav><article><h1>How to choose winter boots</h1><p>${'Warm boots keep feet dry on snow and ice. '.repeat(4)}</p><p>${links}</p></article></body></html>`;

describe('pageHrefs', () => {
  it("reads every link, the HTML blocks' too, and a live page's relative ones against it", () => {
    const html = `<p>${link('p1')} <a href="/products/p2">two</a> <a href="mailto:a@b.c">mail</a></p>${htmlBlockElement(
      '<div><a href="https://shop.example/products/p3">three</a></div>',
    )}`;
    expect(pageHrefs(html)).toEqual([
      'https://shop.example/products/p1?utm_source=guide',
      'mailto:a@b.c',
      'https://shop.example/products/p3',
    ]);
    expect(pageHrefs(html, 'https://shop.example/blog/boots')).toContain(
      'https://shop.example/products/p2',
    );
  });

  it('skips a link longer than a page address can be, and checks a page of them quickly', () => {
    const at = (href) => `<a href="${href}">x</a>`;
    const longest = `https://shop.example/products/${'a'.repeat(MAX_HREF_CHARS - 30)}`;
    const slashes = `https://shop.example${'/'.repeat(100_000)}x`;
    const html = `<p>${at(longest)}${at(`${longest}a`)}${at(slashes)}${link('p1')}</p>`;
    expect(pageHrefs(html)).toEqual([longest, 'https://shop.example/products/p1?utm_source=guide']);
    const started = Date.now();
    linkCheck(pageHrefs(html), path([product('p1')]), {
      states: new Map([['p1', 'ok']]),
      pages: new Map(),
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('reads no link from nothing, or from a block that is no HTML', () => {
    expect(pageHrefs(null)).toEqual([]);
    expect(pageHrefs('<div data-html-block="!!!"></div>')).toEqual([]);
  });
});

describe('pageWords', () => {
  it("counts a page's words, not its scripts' or styles'", () => {
    expect(pageWords('<p>Hello, wide world</p><script>one two three</script>')).toBe(3);
    expect(pageWords(livePageHtml(''))).toBeGreaterThanOrEqual(MIN_WORDS);
    expect(pageWords('<html><body><div id="root"></div></body></html>')).toBe(0);
    expect(pageWords(null)).toBe(0);
  });
});

describe('linksPath', () => {
  it('is whether a check found a category page or a product of the path', () => {
    const none = { categoriesLinked: 0, productsLinked: 0, bad: [] };
    expect(linksPath(none)).toBe(false);
    expect(linksPath({ ...none, categoriesLinked: 1 })).toBe(true);
    expect(linksPath({ ...none, productsLinked: 1 })).toBe(true);
    expect(linksPath({ ...none, bad: [{ id: 'p2', title: '', state: 'gone' }] })).toBe(true);
  });
});

describe('productStates', () => {
  it('reads each product as sold out, refused, gone or fine, by its variants in stock', async () => {
    const fake = fakeDb();
    catalog(fake, [
      [
        'p-ok',
        [
          ['in stock', 'o1'],
          ['out_of_stock', 'o2'],
        ],
      ],
      ['p-limited', [['Limited-Availability', 'l1']]],
      [
        'p-sold',
        [
          ['out_of_stock', 's1'],
          ['preorder', 's2'],
        ],
      ],
      ['p-refused', [['in_stock', 'r1']]],
      ['p-ads', [['in_stock', 'a1']]],
      ['p-removed', [['in_stock', 'x1']], '2026-10-26T00:00:00Z'],
    ]);
    fake.rows('catalog_item_issues').push(
      {
        id: 'i1',
        brand_id: BRAND,
        external_id: 'r1',
        severity: 'disapproved',
        reporting_context: 'FREE_LISTINGS',
      },
      // A disapproval for ads leaves the product in the free listings.
      {
        id: 'i2',
        brand_id: BRAND,
        external_id: 'a1',
        severity: 'disapproved',
        reporting_context: 'SHOPPING_ADS',
      },
      // Another brand's issue for the same offer id isn't this one's.
      {
        id: 'i3',
        brand_id: 'brand-2',
        external_id: 'o1',
        severity: 'disapproved',
        reporting_context: '',
      },
    );
    const { states } = await productStates(fake.db, BRAND, [
      'p-ok',
      'p-limited',
      'p-sold',
      'p-refused',
      'p-ads',
      'p-removed',
      'p-unknown',
    ]);
    expect(Object.fromEntries(states)).toEqual({
      'p-ok': 'ok',
      'p-limited': 'ok',
      'p-sold': 'sold_out',
      'p-refused': 'refused',
      'p-ads': 'ok',
      'p-removed': 'gone',
      'p-unknown': 'gone',
    });
  });

  it("reads past PostgREST's 1000-row cap", async () => {
    const fake = fakeDb({ maxRows: 1000 });
    catalog(fake, [
      [
        'p1',
        Array.from({ length: 1200 }, (_, i) => ['out_of_stock', `x${String(i).padStart(4, '0')}`]),
      ],
    ]);
    // The one variant in stock sorts after the first 1000.
    fake.rows('catalog_variants').push({
      id: 'v-zzzz',
      brand_id: BRAND,
      product_id: 'p1',
      external_id: 'zzzz',
      availability: 'in_stock',
      removed_at: null,
    });
    expect((await productStates(fake.db, BRAND, ['p1'])).states.get('p1')).toBe('ok');
  });

  it("reads each product's title in the catalog, a removed one's too", async () => {
    const fake = fakeDb();
    catalog(fake, [
      ['p1', [['in_stock', 'a']]],
      ['p-removed', [['in_stock', 'x']], '2026-10-26T00:00:00Z'],
    ]);
    const { titles } = await productStates(fake.db, BRAND, ['p1', 'p-removed', 'p-unknown']);
    expect(Object.fromEntries(titles)).toEqual({ p1: 'Boot p1', 'p-removed': 'Boot p-removed' });
  });
});

describe('linkCheck', () => {
  it("counts the path's linked category pages and products, and the linked ones that don't sell", () => {
    const states = new Map([
      ['p1', 'ok'],
      ['p2', 'sold_out'],
      ['p3', 'refused'],
    ]);
    const check = linkCheck(
      [
        'https://www.shop.example/c/boots/',
        'https://shop.example/products/p1',
        'https://shop.example/products/p2?utm_campaign=x',
        'https://shop.example/products/p2',
      ],
      path([product('p1'), product('p2'), product('p3'), product('p4')]),
      { states, pages: new Map() },
    );
    // Of the four, p1 and p4 sell (p4 isn't read: gone); p1 is linked and sells.
    expect(check).toEqual({
      categories: 1,
      categoriesLinked: 1,
      products: 1,
      productsLinked: 1,
      bad: [{ id: 'p2', title: 'Boot p2', state: 'sold_out' }],
      swaps: [],
    });
  });

  it("names the path's products that sell and the page doesn't link, to swap in", () => {
    const check = linkCheck(
      ['https://shop.example/products/p1', 'https://shop.example/products/p2'],
      path([product('p1'), product('p2'), product('p3'), product('p4'), product('p5')]),
      {
        states: new Map([
          ['p1', 'ok'],
          ['p2', 'sold_out'],
          ['p3', 'ok'],
          ['p4', 'refused'],
          ['p5', 'ok'],
        ]),
        pages: new Map(),
      },
    );
    expect(check.swaps).toEqual([
      { id: 'p3', title: 'Boot p3' },
      { id: 'p5', title: 'Boot p5' },
    ]);
  });

  it('counts a removed or left-out product the page still links, only when it no longer sells', () => {
    const removedPath = {
      ...path([product('p1')]),
      removed: ['r-sold', 'r-ok'],
      leftOut: [{ id: 'l-gone', title: 'Old Boot', reason: 'gone' }],
    };
    const check = linkCheck(
      [
        'https://shop.example/products/p1',
        'https://shop.example/products/r-sold',
        'https://shop.example/products/r-ok',
        'https://shop.example/products/l-gone',
      ],
      removedPath,
      {
        states: new Map([
          ['p1', 'ok'],
          ['r-sold', 'sold_out'],
          ['r-ok', 'ok'],
          ['l-gone', 'gone'],
        ]),
        pages: new Map([
          ['r-sold', 'https://shop.example/products/r-sold'],
          ['r-ok', 'https://shop.example/products/r-ok'],
          ['l-gone', 'https://shop.example/products/l-gone'],
        ]),
      },
    );
    expect(check.productsLinked).toBe(1);
    expect(check.bad).toEqual([
      { id: 'r-sold', title: '', state: 'sold_out' },
      { id: 'l-gone', title: 'Old Boot', state: 'gone' },
    ]);
  });

  it("names a removed product by its catalog title, the path's own first", () => {
    const removedPath = {
      ...path([product('p1')]),
      removed: ['r-sold', 'l-gone'],
      leftOut: [{ id: 'l-gone', title: 'Old Boot', reason: 'gone' }],
    };
    const check = linkCheck(
      ['https://shop.example/products/r-sold', 'https://shop.example/products/l-gone'],
      removedPath,
      {
        states: new Map([
          ['r-sold', 'sold_out'],
          ['l-gone', 'gone'],
        ]),
        pages: new Map([
          ['r-sold', 'https://shop.example/products/r-sold'],
          ['l-gone', 'https://shop.example/products/l-gone'],
        ]),
        titles: new Map([
          ['r-sold', 'Storm Boot'],
          ['l-gone', 'Old Boot (catalog)'],
        ]),
      },
    );
    expect(check.bad).toEqual([
      { id: 'r-sold', title: 'Storm Boot', state: 'sold_out' },
      { id: 'l-gone', title: 'Old Boot', state: 'gone' },
    ]);
  });
});

describe('livePage', () => {
  it("is a published page's CMS address, or an optimized page's own, and nothing before", () => {
    const published = {
      status: 'published',
      method: 'create',
      published_url: 'https://shop.example/blog/a',
    };
    expect(livePage(published)).toBe('https://shop.example/blog/a');
    expect(livePage({ ...published, status: 'ready' })).toBeNull();
    expect(
      livePage({
        status: 'published',
        method: 'optimize',
        published_url: null,
        source_url: 'https://shop.example/b',
      }),
    ).toBe('https://shop.example/b');
    expect(
      livePage({
        status: 'published',
        method: 'create',
        published_url: null,
        source_url: 'https://x.example',
      }),
    ).toBeNull();
  });
});

describe('checkShoppingLinks', () => {
  function setup({ maxRows } = {}) {
    const fake = fakeDb({ maxRows });
    catalog(fake, [
      ['p1', [['in_stock', 'a']]],
      ['p2', [['out_of_stock', 'b']]],
    ]);
    fake.rows('brand_domains').push({ brand_id: BRAND, domain: 'shop.example', is_primary: true });
    return fake;
  }
  const draft = (id, extra = {}) => ({
    id,
    brand_id: BRAND,
    status: 'draft',
    method: 'create',
    source_url: null,
    published_url: null,
    archived_at: null,
    body_html: `<p><a href="https://shop.example/c/boots">Boots</a> ${link('p1')} ${link('p2')}</p>`,
    shopping_path: path([product('p1'), product('p2')]),
    ...extra,
  });

  it("keeps each draft's check, read from its live page when published, else from the draft", async () => {
    const fake = setup();
    fake
      .rows('content_drafts')
      .push(
        draft('d1'),
        draft('d2', { status: 'published', published_url: 'https://shop.example/blog/boots' }),
        draft('d3', { shopping_path: null }),
        draft('d4', { archived_at: '2026-10-20T00:00:00Z' }),
        draft('d5', { brand_id: 'brand-2' }),
      );
    // The live page was fixed in the CMS: it links only p1.
    const readPage = vi.fn().mockResolvedValue({
      url: 'https://shop.example/blog/boots',
      status: 200,
      html: livePageHtml('<a href="/products/p1">one</a>'),
    });
    const result = await checkShoppingLinks(BRAND, { db: fake.db, now: NOW, readPage });
    expect(result).toEqual({
      drafts: 2,
      live: 1,
      attention: 1,
      dropped: 0,
      opened: 0,
      closed: 0,
    });
    expect(readPage).toHaveBeenCalledOnce();
    expect(readPage.mock.calls[0][0]).toBe('https://shop.example/blog/boots');
    const rows = Object.fromEntries(
      fake.rows('content_shopping_checks').map((r) => [r.draft_id, r]),
    );
    expect(Object.keys(rows).sort()).toEqual(['d1', 'd2']);
    expect(rows.d1).toMatchObject({
      brand_id: BRAND,
      read_from: 'draft',
      page_url: null,
      categories: 1,
      categories_linked: 1,
      // p2 sold out: one of the two sells, and the page links it.
      products: 1,
      products_linked: 1,
      bad: [{ id: 'p2', title: 'Boot p2', state: 'sold_out' }],
      checked_at: NOW.toISOString(),
    });
    expect(rows.d2).toMatchObject({
      read_from: 'page',
      page_url: 'https://shop.example/blog/boots',
      categories_linked: 0,
      products_linked: 1,
      bad: [],
    });
  });

  it("reads a draft's relative links against the brand's site", async () => {
    const fake = setup();
    fake.rows('content_drafts').push(draft('d1', { body_html: '<a href="/products/p2">two</a>' }));
    await checkShoppingLinks(BRAND, { db: fake.db, now: NOW });
    expect(fake.rows('content_shopping_checks')[0].bad).toEqual([
      { id: 'p2', title: 'Boot p2', state: 'sold_out' },
    ]);
  });

  it("reads a live page it can't reach, or one that answers an error, from its draft", async () => {
    const fake = setup();
    fake
      .rows('content_drafts')
      .push(
        draft('d1', { status: 'published', published_url: 'https://shop.example/a' }),
        draft('d2', { status: 'published', published_url: 'https://shop.example/b' }),
      );
    const readPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ url: 'https://shop.example/b', status: 404, html: '' });
    await checkShoppingLinks(BRAND, { db: fake.db, now: NOW, readPage });
    expect(fake.rows('content_shopping_checks').map((r) => [r.read_from, r.bad.length])).toEqual([
      ['draft', 1],
      ['draft', 1],
    ]);
  });

  it("reads a live page with too few words, or off the brand's site, from its draft", async () => {
    const fake = setup();
    fake
      .rows('content_drafts')
      .push(
        draft('d1', { status: 'published', published_url: 'https://shop.example/a' }),
        draft('d2', { status: 'published', published_url: 'https://shop.example/b' }),
        draft('d3', { status: 'published', published_url: 'https://elsewhere.example/c' }),
      );
    const readPage = vi
      .fn()
      // Too short to be the page, though it links p1.
      .mockResolvedValueOnce({
        url: 'https://shop.example/a',
        status: 200,
        html: '<html><body><a href="/products/p1">Boot</a><script>render()</script></body></html>',
      })
      // Redirected off the brand's site.
      .mockResolvedValueOnce({
        url: 'https://parked.example/b',
        status: 200,
        html: livePageHtml(link('p1')),
      });
    const result = await checkShoppingLinks(BRAND, { db: fake.db, now: NOW, readPage });
    // d3 is off the brand's site: never fetched.
    expect(readPage.mock.calls.map(([url]) => url)).toEqual([
      'https://shop.example/a',
      'https://shop.example/b',
    ]);
    expect(result.live).toBe(2);
    expect(fake.rows('content_shopping_checks').map((r) => [r.read_from, r.bad.length])).toEqual([
      ['draft', 1],
      ['draft', 1],
      ['draft', 1],
    ]);
  });

  it('reads from its draft a live page that links none of the path while the draft does', async () => {
    const fake = setup();
    fake.rows('content_drafts').push(
      draft('d1', { status: 'published', published_url: 'https://shop.example/a' }),
      draft('d2', {
        status: 'published',
        published_url: 'https://shop.example/b',
        body_html: '<p>No links yet.</p>',
      }),
    );
    // Words enough, but none of the path's links: a page served to bots, say.
    const readPage = vi.fn(async (url) => ({
      url,
      status: 200,
      html: livePageHtml('<a href="/about">About us</a>'),
    }));
    await checkShoppingLinks(BRAND, { db: fake.db, now: NOW, readPage });
    const rows = Object.fromEntries(
      fake.rows('content_shopping_checks').map((r) => [r.draft_id, r]),
    );
    // d1's draft links p2, sold out: the page isn't taken as fixed.
    expect(rows.d1).toMatchObject({ read_from: 'draft', page_url: null });
    expect(rows.d1.bad).toHaveLength(1);
    // d2's draft links none either: the live page is read as it is.
    expect(rows.d2).toMatchObject({
      read_from: 'page',
      page_url: 'https://shop.example/b',
      bad: [],
    });
  });

  it("reads no live page when the brand's site can't be read", async () => {
    const fake = setup();
    fake
      .rows('content_drafts')
      .push(draft('d1', { status: 'published', published_url: 'https://shop.example/a' }));
    const from = fake.db.from;
    const db = {
      from: (table) =>
        table === 'brand_domains'
          ? {
              select: () => ({
                eq: () => ({
                  eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                  then: (resolve) => resolve({ data: null, error: { message: 'down' } }),
                }),
              }),
            }
          : from(table),
    };
    const readPage = vi.fn();
    await checkShoppingLinks(BRAND, { db, now: NOW, readPage });
    expect(readPage).not.toHaveBeenCalled();
    expect(fake.rows('content_shopping_checks')[0].read_from).toBe('draft');
  });

  it('reads at most its live pages a run; the rest from their drafts', async () => {
    const fake = setup();
    fake
      .rows('content_drafts')
      .push(
        ...Array.from({ length: 3 }, (_, i) =>
          draft(`d${i}`, { status: 'published', published_url: `https://shop.example/${i}` }),
        ),
      );
    const readPage = vi.fn(async (url) => ({ url, status: 200, html: livePageHtml(link('p1')) }));
    const result = await checkShoppingLinks(BRAND, {
      db: fake.db,
      now: NOW,
      readPage,
      livePages: 2,
    });
    expect(readPage).toHaveBeenCalledTimes(2);
    expect(result.live).toBe(2);
    expect(fake.rows('content_shopping_checks').map((r) => r.read_from)).toEqual([
      'page',
      'page',
      'draft',
    ]);
    expect(MAX_LIVE_PAGES).toBeGreaterThan(2);
  });

  it('stops reading live pages at its deadline; the rest from their drafts', async () => {
    const fake = setup();
    fake
      .rows('content_drafts')
      .push(
        ...Array.from({ length: 3 }, (_, i) =>
          draft(`d${i}`, { status: 'published', published_url: `https://shop.example/${i}` }),
        ),
      );
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const readPage = vi.fn(async (url) => {
        // The first page takes the whole deadline.
        vi.setSystemTime(Date.now() + LIVE_PAGES_DEADLINE_MS);
        return { url, status: 200, html: livePageHtml(link('p1')) };
      });
      const result = await checkShoppingLinks(BRAND, { db: fake.db, now: NOW, readPage });
      expect(readPage).toHaveBeenCalledOnce();
      expect(result.live).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    expect(fake.rows('content_shopping_checks').map((r) => r.read_from)).toEqual([
      'page',
      'draft',
      'draft',
    ]);
  });

  it('drops no row when it stops at its most drafts: the others may still have a path', async () => {
    const fake = setup();
    fake
      .rows('content_drafts')
      .push(
        ...Array.from({ length: MAX_DRAFTS }, (_, i) => draft(`d${String(i).padStart(4, '0')}`)),
      );
    // A draft past the cap, and its row from an earlier run.
    fake.rows('content_drafts').push(draft('d9999'));
    fake.rows('content_shopping_checks').push({ draft_id: 'd9999', brand_id: BRAND });
    const result = await checkShoppingLinks(BRAND, { db: fake.db, now: NOW });
    expect(result).toMatchObject({ drafts: MAX_DRAFTS, dropped: 0 });
    expect(fake.rows('content_shopping_checks').map((r) => r.draft_id)).toContain('d9999');
  });

  it('drops the rows of drafts that lost their path or were archived, and keeps the others', async () => {
    const fake = setup();
    fake.rows('content_drafts').push(draft('d1'), draft('d2'));
    await checkShoppingLinks(BRAND, { db: fake.db, now: NOW });
    expect(fake.rows('content_shopping_checks')).toHaveLength(2);
    fake.rows('content_drafts').find((d) => d.id === 'd2').shopping_path = null;
    fake.rows('content_shopping_checks').push({ draft_id: 'other', brand_id: 'brand-2' });
    const result = await checkShoppingLinks(BRAND, { db: fake.db, now: NOW });
    expect(result.dropped).toBe(1);
    expect(
      fake
        .rows('content_shopping_checks')
        .map((r) => r.draft_id)
        .sort(),
    ).toEqual(['d1', 'other']);
  });

  it('reads the drafts a batch at a time, every one of them', async () => {
    const fake = setup({ maxRows: 1000 });
    fake
      .rows('content_drafts')
      .push(
        ...Array.from({ length: DRAFT_BATCH + 3 }, (_, i) =>
          draft(`d${String(i).padStart(3, '0')}`),
        ),
      );
    const result = await checkShoppingLinks(BRAND, { db: fake.db, now: NOW });
    expect(result.drafts).toBe(DRAFT_BATCH + 3);
    expect(fake.rows('content_shopping_checks')).toHaveLength(DRAFT_BATCH + 3);
  });

  it('opens an Action Center action for a live page linking a product that no longer sells, and closes it once fixed', async () => {
    const fake = setup();
    fake.rows('content_drafts').push(
      draft('d1', {
        title: 'Best boots',
        status: 'published',
        published_url: 'https://shop.example/blog/boots',
      }),
    );
    const live = (html) => vi.fn(async (url) => ({ url, status: 200, html: livePageHtml(html) }));
    const first = await checkShoppingLinks(BRAND, {
      db: fake.db,
      now: NOW,
      readPage: live(`${link('p1')} ${link('p2')}`),
    });
    expect(first).toMatchObject({ opened: 1, closed: 0 });
    const [action] = fake.rows('actions');
    expect(action).toMatchObject({
      kind: 'shopping_links',
      dedup_key: 'shopping_links:d1',
      status: 'new',
      payload: {
        title: 'Best boots',
        pageUrl: 'https://shop.example/blog/boots',
        products: [{ id: 'p2', title: 'Boot p2', state: 'sold_out' }],
      },
    });

    const fixed = await checkShoppingLinks(BRAND, {
      db: fake.db,
      now: NOW,
      readPage: live(link('p1')),
    });
    expect(fixed).toMatchObject({ opened: 0, closed: 1 });
    expect(action.status).toBe('completed');
  });

  it('keeps an action open while the page links its products, though a rebuilt path dropped them', async () => {
    const fake = setup();
    catalog(fake, [['p3', [['in_stock', 'c']]]]);
    for (const row of fake.rows('catalog_products')) {
      row.url = `https://shop.example/products/${row.id}`;
    }
    fake.rows('content_drafts').push(
      draft('d1', {
        status: 'published',
        published_url: 'https://shop.example/blog/boots',
      }),
    );
    const live = (html) => vi.fn(async (url) => ({ url, status: 200, html: livePageHtml(html) }));
    const page = `${link('p1')} ${link('p2')}`;
    await checkShoppingLinks(BRAND, { db: fake.db, now: NOW, readPage: live(page) });
    const [action] = fake.rows('actions');
    expect(action.payload.productIds).toEqual(['p2']);

    // A rebuild keeps the products in stock: sold-out p2 drops out of the path.
    fake.rows('content_drafts')[0].shopping_path = path([product('p1'), product('p3')]);
    const synced = await checkShoppingLinks(BRAND, { db: fake.db, now: NOW, readPage: live(page) });
    expect(synced).toMatchObject({ attention: 1, closed: 0 });
    expect(action.status).toBe('new');
    expect(fake.rows('content_shopping_checks')[0].bad).toEqual([
      { id: 'p2', title: 'Boot p2', state: 'sold_out' },
    ]);
    const now = await checkShoppingDraft(BRAND, 'd1', {
      db: fake.db,
      now: NOW,
      readPage: live(page),
    });
    expect(now).toMatchObject({ action: 'kept' });
    expect(action.status).toBe('new');

    const fixed = await checkShoppingDraft(BRAND, 'd1', {
      db: fake.db,
      now: NOW,
      readPage: live(link('p1')),
    });
    expect(fixed).toMatchObject({ bad: [], action: 'closed' });
    expect(action.status).toBe('completed');
  });

  it(`opens none from a draft, and at most ${MAX_NEW_ACTIONS} a run`, async () => {
    const fake = setup();
    fake
      .rows('content_drafts')
      .push(
        draft('d-draft'),
        ...Array.from({ length: MAX_NEW_ACTIONS + 2 }, (_, i) =>
          draft(`d${i}`, { status: 'published', published_url: `https://shop.example/${i}` }),
        ),
      );
    const readPage = vi.fn(async (url) => ({ url, status: 200, html: livePageHtml(link('p2')) }));
    const result = await checkShoppingLinks(BRAND, { db: fake.db, now: NOW, readPage });
    expect(result).toMatchObject({ attention: MAX_NEW_ACTIONS + 3, opened: MAX_NEW_ACTIONS });
    expect(fake.rows('actions')).toHaveLength(MAX_NEW_ACTIONS);
    expect(fake.rows('actions').some((a) => a.payload.draftId === 'd-draft')).toBe(false);
  });

  it("logs an action it can't open and keeps the check", async () => {
    const fake = setup();
    fake
      .rows('content_drafts')
      .push(draft('d1', { status: 'published', published_url: 'https://shop.example/a' }));
    const db = {
      from: (table) => {
        if (table === 'actions') throw new Error('actions unavailable');
        return fake.db.from(table);
      },
    };
    const readPage = vi.fn(async (url) => ({ url, status: 200, html: livePageHtml(link('p2')) }));
    const result = await checkShoppingLinks(BRAND, { db, now: NOW, readPage });
    expect(result).toMatchObject({ drafts: 1, attention: 1, opened: 0 });
    expect(fake.rows('content_shopping_checks')).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'd1' }),
      '[shopping-check] Action Center action not synced',
    );
  });

  it("reads a path it can't read as none, and logs it", async () => {
    const fake = setup();
    fake
      .rows('content_drafts')
      .push(draft('d1', { shopping_path: { version: 1, products: [null] } }));
    const result = await checkShoppingLinks(BRAND, { db: fake.db, now: NOW });
    expect(result.drafts).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  describe('checkShoppingDraft (Check now on its task)', () => {
    const live = (html) => vi.fn(async (url) => ({ url, status: 200, html: livePageHtml(html) }));

    it('checks one draft as the sync does, keeps its row, and closes its action once fixed', async () => {
      const fake = setup();
      fake
        .rows('content_drafts')
        .push(
          draft('d1', { status: 'published', published_url: 'https://shop.example/blog/boots' }),
          draft('d2'),
        );
      await checkShoppingLinks(BRAND, {
        db: fake.db,
        now: NOW,
        readPage: live(`${link('p1')} ${link('p2')}`),
      });
      expect(fake.rows('actions')).toHaveLength(1);
      const later = new Date('2026-10-28T09:00:00Z');
      const readPage = live(link('p1'));
      const found = await checkShoppingDraft(BRAND, 'd1', { db: fake.db, now: later, readPage });
      expect(found).toEqual({
        readFrom: 'page',
        pageUrl: 'https://shop.example/blog/boots',
        bad: [],
        action: 'closed',
      });
      expect(readPage).toHaveBeenCalledOnce();
      expect(fake.rows('actions')[0].status).toBe('completed');
      const rows = Object.fromEntries(
        fake.rows('content_shopping_checks').map((r) => [r.draft_id, r]),
      );
      expect(rows.d1).toMatchObject({
        read_from: 'page',
        bad: [],
        checked_at: later.toISOString(),
      });
      // The brand's other rows are left as they were: none is stale.
      expect(rows.d2.checked_at).toBe(NOW.toISOString());
    });

    it('reads a page that is no page from its draft, and touches no action', async () => {
      const fake = setup();
      fake
        .rows('content_drafts')
        .push(draft('d1', { status: 'published', published_url: 'https://shop.example/a' }));
      const readPage = vi.fn(async (url) => ({ url, status: 200, html: '<div id="root"></div>' }));
      const found = await checkShoppingDraft(BRAND, 'd1', { db: fake.db, now: NOW, readPage });
      expect(found).toEqual({
        readFrom: 'draft',
        pageUrl: null,
        bad: [{ id: 'p2', title: 'Boot p2', state: 'sold_out' }],
        action: null,
      });
      expect(fake.rows('actions')).toHaveLength(0);
    });

    it("has nothing to check for an archived draft, one without a path, or another brand's", async () => {
      const fake = setup();
      fake
        .rows('content_drafts')
        .push(
          draft('d-archived', { archived_at: '2026-10-20T00:00:00Z' }),
          draft('d-none', { shopping_path: null }),
          draft('d-other', { brand_id: 'brand-2' }),
        );
      for (const id of ['d-archived', 'd-none', 'd-other', 'd-missing']) {
        expect(await checkShoppingDraft(BRAND, id, { db: fake.db, now: NOW })).toBeNull();
      }
      expect(fake.rows('content_shopping_checks')).toEqual([]);
    });

    it("throws an action it can't sync, for the person who asked", async () => {
      const fake = setup();
      fake
        .rows('content_drafts')
        .push(draft('d1', { status: 'published', published_url: 'https://shop.example/a' }));
      const db = {
        from: (table) => {
          if (table === 'actions') throw new Error('actions unavailable');
          return fake.db.from(table);
        },
      };
      await expect(
        checkShoppingDraft(BRAND, 'd1', { db, now: NOW, readPage: live(link('p2')) }),
      ).rejects.toThrow('actions unavailable');
      // The check itself is kept.
      expect(fake.rows('content_shopping_checks')).toHaveLength(1);
    });
  });
});

describe('queueShoppingCheck', () => {
  it("checks no brand whose workspace's plan ended (#1608)", async () => {
    const fake = fakeDb();
    fake.rows('content_drafts').push({
      id: 'd1',
      brand_id: 'lapsed',
      status: 'draft',
      archived_at: null,
      body_html: '',
      shopping_path: path([product('p1')]),
    });
    isBrandActive.mockImplementation(async (brandId) => brandId !== 'lapsed');
    await queueShoppingCheck('lapsed', { db: fake.db });
    expect(isBrandActive).toHaveBeenCalledWith('lapsed');
    expect(fake.rows('content_shopping_checks')).toEqual([]);
    expect(fake.writes).toEqual([]);
    isBrandActive.mockImplementation(async () => true);
  });

  it('checks the brands one at a time, a brand queued twice once, and logs a failure', async () => {
    const fake = fakeDb();
    const broken = {
      from: () => {
        throw new Error('down');
      },
    };
    queueShoppingCheck('brand-a', { db: fake.db });
    // Queued twice while brand-a is checked: checked once.
    queueShoppingCheck('brand-b', { db: broken });
    await queueShoppingCheck('brand-b', { db: broken });
    expect(logger.error).toHaveBeenCalledWith(
      { err: { name: 'Error', message: 'down' }, brandId: 'brand-b' },
      '[shopping-check] check failed',
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
