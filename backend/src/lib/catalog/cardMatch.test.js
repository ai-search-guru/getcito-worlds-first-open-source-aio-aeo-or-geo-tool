import { setImmediate } from 'timers';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from '../logger.js';
import {
  COMMON_WORD_MIN,
  COMMON_WORD_SHARE,
  MATCH_SLICE,
  MAX_CARD_TITLE_WORDS,
  REMATCH_DAYS,
  TITLE_MATCH,
  catalogIndex,
  catalogIndexCache,
  gtinKey,
  matchBrandLater,
  matchBrandShoppingCards,
  matchCard,
  matchCards,
  pathKey,
  sweepShoppingCardMatches,
  titleWords,
} from './cardMatch.js';

/** The catalog product behind an AI shopping card (product visibility, part 2, 00360). */

/**
 * The tables the matcher reads, with the PostgREST calls it makes: eq, is,
 * gte, order and range, max_rows (`maxRows`, as PostgREST's 1000) and rpc.
 * A select's `alias:raw->>key` reads that key out of the row's raw payload,
 * which isn't returned itself then.
 */
function fakeDb({ maxRows = Infinity } = {}) {
  const tables = new Map();
  const rows = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const from = (table) => {
    const filters = [];
    const fromRaw = [];
    let range = null;
    let one = false;
    const run = () => {
      const found = rows(table)
        .filter((row) => filters.every((keep) => keep(row)))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const [start, end] = range ?? [0, found.length];
      const data = found
        .slice(start, end + 1)
        .slice(0, maxRows)
        .map((row) => {
          if (!fromRaw.length) return row;
          const { raw, ...rest } = row;
          for (const [alias, key] of fromRaw) rest[alias] = raw?.[key] ?? null;
          return rest;
        });
      return { data: one ? (data[0] ?? null) : data, error: null };
    };
    const q = {
      select: (columns = '*') => {
        for (const column of columns.split(',')) {
          const read = /^\s*(\w+):raw->>(\w+)\s*$/.exec(column);
          if (read) fromRaw.push([read[1], read[2]]);
        }
        return q;
      },
      eq: (column, value) => (filters.push((row) => row[column] === value), q),
      is: (column, value) => (filters.push((row) => (row[column] ?? null) === value), q),
      gte: (column, value) => (filters.push((row) => row[column] >= value), q),
      order: () => q,
      range: (start, end) => ((range = [start, end]), q),
      maybeSingle: () => ((one = true), q),
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  };
  return { db: { from, rpc: async () => ({ data: 0, error: null }) }, rows };
}

const BRAND = 'brand-1';
const NOW = new Date('2026-10-27T09:00:00Z');

const products = [
  {
    id: 'p-shoe',
    title: 'Northwind Trail Runner X',
    url: 'https://northwind.example/products/trail-runner-x',
  },
  {
    id: 'p-pack',
    title: 'Northwind Ridge 30L Backpack',
    url: 'https://northwind.example/products/ridge-30',
  },
  { id: 'p-pack40', title: 'Northwind Ridge 40L Backpack', url: null },
  { id: 'p-jacket', title: 'StormShell Jacket', url: null },
];
const variants = [
  { product_id: 'p-shoe', url: null, gtin: '0012345678905', marketplace_item_id: 'b0c123abcd' },
  {
    product_id: 'p-jacket',
    url: 'https://northwind.example/products/stormshell?color=blue',
    gtin: null,
    marketplace_item_id: null,
  },
  // A variant of a product the catalog removed isn't read.
  { product_id: 'p-gone', url: null, gtin: '999999999999', marketplace_item_id: null },
];
const index = catalogIndex({ products, variants }, { brandName: 'Northwind' });

describe('titleWords and the keys', () => {
  it('reads a title as words, accents and folded letters alike, without filler', () => {
    expect([...titleWords('Çanta for the Straße — Sırt 30L')]).toEqual([
      'canta',
      'strasse',
      'sirt',
      '30l',
    ]);
  });

  it('reads a GTIN without its padding, and a page without its query', () => {
    expect(gtinKey('0012345678905')).toBe('12345678905');
    expect(gtinKey('12345678905')).toBe('12345678905');
    expect(gtinKey('12-34')).toBeNull();
    expect(pathKey('https://WWW.Shop.example/Products/A/?utm_source=x')).toBe(
      'shop.example/products/a',
    );
    expect(pathKey('mailto:a@b.c')).toBeNull();
  });

  it('reads a link with a long run of slashes in time near its length', () => {
    const started = Date.now();
    expect(pathKey(`https://shop.example/${'/'.repeat(100_000)}a//`)).toBe(
      `shop.example/${'/'.repeat(100_000)}a`,
    );
    expect(pathKey(`https://shop.example/a${'/'.repeat(100_000)}`)).toBe('shop.example/a');
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('matchCard', () => {
  it('matches by the listing it links, then a GTIN, then the page', () => {
    expect(matchCard({ listing_id: 'B0C123ABCD', product_title: 'Something else' }, index)).toEqual(
      {
        productId: 'p-shoe',
        match: 'listing',
      },
    );
    expect(matchCard({ product_title: 'x', raw: { gtin: '12345678905' } }, index)).toEqual({
      productId: 'p-shoe',
      match: 'gtin',
    });
    expect(
      matchCard(
        {
          merchant_url: 'https://www.northwind.example/products/ridge-30/?srsltid=abc',
          product_title: 'x',
        },
        index,
      ),
    ).toEqual({ productId: 'p-pack', match: 'url' });
    // A variant's page, with its own query.
    expect(
      matchCard(
        { merchant_url: 'https://northwind.example/products/stormshell?color=blue' },
        index,
      ),
    ).toEqual({ productId: 'p-jacket', match: 'url' });
  });

  it("matches by title when one product's words are clearly the closest, the brand's name aside", () => {
    expect(matchCard({ product_title: 'Trail Runner X by Northwind' }, index)).toEqual({
      productId: 'p-shoe',
      match: 'title',
    });
    expect(matchCard({ product_title: 'StormShell Jacket — Men' }, index)).toEqual({
      productId: 'p-jacket',
      match: 'title',
    });
  });

  it('matches neither of two lookalikes, nor a title too far from any', () => {
    // "Ridge Backpack" is as close to the 30L as to the 40L.
    expect(matchCard({ product_title: 'Northwind Ridge Backpack' }, index)).toBeNull();
    expect(matchCard({ product_title: 'Ridge 30L Backpack' }, index)).toEqual({
      productId: 'p-pack',
      match: 'title',
    });
    expect(matchCard({ product_title: 'Summit Daypack 30 W' }, index)).toBeNull();
    expect(matchCard({ product_title: '' }, index)).toBeNull();
    expect(TITLE_MATCH).toBeGreaterThan(0.5);
  });

  it('matches by no key two products share', () => {
    const shared = catalogIndex({
      products: [
        { id: 'a', title: 'Alpha', url: null },
        { id: 'b', title: 'Beta', url: null },
      ],
      variants: [
        { product_id: 'a', url: null, gtin: '12345678', marketplace_item_id: null },
        { product_id: 'b', url: null, gtin: '012345678', marketplace_item_id: null },
      ],
    });
    expect(matchCard({ raw: { ean: '12345678' }, product_title: 'Gamma' }, shared)).toBeNull();
  });

  describe('in a big catalog', () => {
    // 1,200 backpacks: "backpack" is in each title, "hiking" and "city" in
    // 600 each, more than COMMON_WORD_SHARE of them and COMMON_WORD_MIN.
    const big = Array.from({ length: 1200 }, (_, i) => ({
      id: `b${i}`,
      title: `${i % 2 ? 'Hiking' : 'City'} Backpack Model${i}`,
      url: null,
    }));
    const pack = (id, title) => ({ id, title, url: null });

    it('compares only the products sharing a word few titles have, and scores the common words too', () => {
      const bigIndex = catalogIndex({ products: big, variants: [] });
      expect(1200 * COMMON_WORD_SHARE).toBeLessThan(600);
      expect(COMMON_WORD_MIN).toBeLessThan(600);
      expect([...bigIndex.common].sort()).toEqual(['backpack', 'city', 'hiking']);
      // Found by "model7"; "hiking" and "backpack" count in its score (1.0).
      expect(matchCard({ product_title: 'Hiking Backpack Model7' }, bigIndex)).toEqual({
        productId: 'b7',
        match: 'title',
      });
      // A title of common words only is still found, by its rarest one.
      const withPlain = catalogIndex({
        products: [...big, pack('plain', 'City Hiking Backpack')],
        variants: [],
      });
      expect(matchCard({ product_title: 'City Hiking Backpack' }, withPlain)).toEqual({
        productId: 'plain',
        match: 'title',
      });
    });

    it('matches no product that one not compared could be as close to', () => {
      // "Hiking Backpack Grey" scores 0.67 with "Grey Hiking Strap", found
      // by "grey", and as much with each "Hiking Backpack Model…", which no
      // word few titles have finds. Compared, they would tie.
      const bigIndex = catalogIndex({
        products: [...big, pack('strap', 'Grey Hiking Strap')],
        variants: [],
      });
      expect(matchCard({ product_title: 'Hiking Backpack Grey' }, bigIndex)).toBeNull();
      // Its own title is far enough from them: 1.0 against 0.4 at most.
      expect(matchCard({ product_title: 'Grey Hiking Strap' }, bigIndex)).toEqual({
        productId: 'strap',
        match: 'title',
      });
    });

    it(`reads a long card title's first ${MAX_CARD_TITLE_WORDS} words, in time near its length`, () => {
      // 5,000 products, each found by its own number; a card title of 20,000
      // numbers would otherwise compare each product with each of its words.
      const numbered = catalogIndex({
        products: Array.from({ length: 5000 }, (_, i) => pack(`n${i}`, `Daypack ${i}`)),
        variants: [],
      });
      const long = Array.from({ length: 20_000 }, (_, i) => String(i)).join(' ');
      const started = Date.now();
      expect(matchCard({ product_title: long }, numbered)).toBeNull();
      expect(Date.now() - started).toBeLessThan(500);
      expect(matchCard({ product_title: 'Daypack 7' }, numbered)).toEqual({
        productId: 'n7',
        match: 'title',
      });
    });
  });
});

describe('matchCards', () => {
  it(`matches cards ${MATCH_SLICE} at a time, letting the event loop run between`, async () => {
    const cards = Array.from({ length: MATCH_SLICE * 2 + 1 }, () => ({
      listing_id: 'B0C123ABCD',
    }));
    let ticks = 0;
    let done = false;
    const tick = () => {
      ticks += 1;
      if (!done) setImmediate(tick);
    };
    setImmediate(tick);
    const found = await matchCards(cards, index);
    done = true;
    expect(found).toHaveLength(cards.length);
    expect(found.every((match) => match?.productId === 'p-shoe')).toBe(true);
    // A breath after each full slice.
    expect(ticks).toBe(2);
  });
});

describe('catalogIndexCache', () => {
  function setup() {
    const sizes = { a: 3, b: 2, c: 2, d: 9 };
    const load = vi.fn(async (brandId) => ({ size: sizes[brandId] }));
    let clock = 0;
    const cache = catalogIndexCache({ maxProducts: 5, ttlMs: 100, load, now: () => clock });
    return { cache, load, tick: (ms) => (clock += ms) };
  }
  const loads = (load) => load.mock.calls.map(([brandId]) => brandId);

  it('keeps the brands up to a number of products, dropping the one read least recently first', async () => {
    const { cache, load } = setup();
    await cache.get('a');
    await cache.get('b');
    // Reading a keeps it: b is now the least recently read.
    await cache.get('a');
    await cache.get('c');
    expect(cache.brands()).toEqual(['a', 'c']);
    await cache.get('a');
    await cache.get('b');
    expect(loads(load)).toEqual(['a', 'b', 'c', 'b']);
    // One brand over the limit is kept alone.
    await cache.get('d');
    expect(cache.brands()).toEqual(['d']);
  });

  it('reads a brand again after its time, or after a failed read, or once dropped', async () => {
    const { cache, load, tick } = setup();
    await cache.get('a');
    tick(100);
    await cache.get('a');
    load.mockRejectedValueOnce(new Error('down'));
    tick(100);
    await expect(cache.get('a')).rejects.toThrow('down');
    expect(cache.brands()).toEqual([]);
    await cache.get('a');
    cache.drop('a');
    await cache.get('a');
    expect(loads(load)).toEqual(['a', 'a', 'a', 'a', 'a']);
  });
});

describe('matchBrandShoppingCards', () => {
  function setup({ maxRows } = {}) {
    const fake = fakeDb({ maxRows });
    const rpc = vi.fn(async (_name, { p_matches }) => ({ data: p_matches.length, error: null }));
    fake.db.rpc = rpc;
    fake.rows('brands').push({ id: BRAND, name: 'Northwind' });
    for (const p of products)
      fake.rows('catalog_products').push({ ...p, brand_id: BRAND, removed_at: null });
    for (const [i, v] of variants.slice(0, 2).entries()) {
      fake.rows('catalog_variants').push({ id: `v${i}`, ...v, brand_id: BRAND, removed_at: null });
    }
    return { fake, rpc };
  }
  const card = (id, over) => ({
    id,
    brand_id: BRAND,
    matched_brand_role: 'own',
    created_at: '2026-10-20T00:00:00Z',
    product_title: null,
    merchant_url: null,
    listing_id: null,
    catalog_product_id: null,
    catalog_match: null,
    ...over,
  });

  it("writes only the matches that changed, of the brand's own recent cards", async () => {
    const { fake, rpc } = setup();
    fake.rows('prompt_result_shopping_cards').push(
      card('c1', { listing_id: 'B0C123ABCD' }),
      // Already matched as it is: not written.
      card('c2', {
        product_title: 'StormShell Jacket',
        catalog_product_id: 'p-jacket',
        catalog_match: 'title',
      }),
      // Its product left the catalog's titles: cleared.
      card('c3', {
        product_title: 'Unknown Thing',
        catalog_product_id: 'p-old',
        catalog_match: 'title',
      }),
      card('c4', { product_title: 'Trail Runner X', matched_brand_role: 'competitor' }),
      card('c5', { listing_id: 'B0C123ABCD', created_at: '2026-01-01T00:00:00Z' }),
      card('c6', { listing_id: 'B0C123ABCD', brand_id: 'brand-2' }),
    );
    const result = await matchBrandShoppingCards(BRAND, { db: fake.db, now: NOW });
    expect(result).toEqual({ cards: 3, matched: 2, changed: 2 });
    expect(rpc).toHaveBeenCalledWith('set_shopping_card_matches', {
      p_brand_id: BRAND,
      p_matches: [
        { id: 'c1', product_id: 'p-shoe', match: 'listing' },
        { id: 'c3', product_id: null, match: null },
      ],
    });
    expect(REMATCH_DAYS).toBe(90);
  });

  it("reads past PostgREST's 1000-row cap, and writes in batches", async () => {
    const { fake, rpc } = setup({ maxRows: 1000 });
    fake
      .rows('prompt_result_shopping_cards')
      .push(
        ...Array.from({ length: 1200 }, (_, i) =>
          card(`c${String(i).padStart(4, '0')}`, { listing_id: 'B0C123ABCD' }),
        ),
      );
    const result = await matchBrandShoppingCards(BRAND, { db: fake.db, now: NOW });
    expect(result.cards).toBe(1200);
    expect(rpc.mock.calls.map(([, args]) => args.p_matches.length)).toEqual([500, 500, 200]);
  });

  it('reads a GTIN under each key the cards are written with', async () => {
    const { fake, rpc } = setup();
    fake
      .rows('prompt_result_shopping_cards')
      .push(
        card('c1', { raw: { ean: '0012345678905' } }),
        card('c2', { raw: { upc: 12345678905 } }),
        card('c3', { raw: { gtin13: '0012345678905', title: 'x' } }),
        card('c4', { raw: { gtin: '999' } }),
      );
    const result = await matchBrandShoppingCards(BRAND, { db: fake.db, now: NOW });
    expect(result).toEqual({ cards: 4, matched: 3, changed: 3 });
    expect(rpc.mock.calls[0][1].p_matches).toEqual([
      { id: 'c1', product_id: 'p-shoe', match: 'gtin' },
      { id: 'c2', product_id: 'p-shoe', match: 'gtin' },
      { id: 'c3', product_id: 'p-shoe', match: 'gtin' },
    ]);
  });
});

describe('matchBrandLater', () => {
  it('matches a brand once more after the match running, not once per sync', async () => {
    const runs = [];
    let finish;
    const match = vi.fn(
      (brandId) =>
        new Promise((resolve) => {
          runs.push(brandId);
          finish = resolve;
        }),
    );
    const first = matchBrandLater('b1', { match });
    // Two syncs while the first match runs: one more match after it.
    const second = matchBrandLater('b1', { match });
    matchBrandLater('b1', { match });
    expect(second).toBe(first);
    expect(runs).toEqual(['b1']);
    finish();
    await vi.waitFor(() => expect(runs).toEqual(['b1', 'b1']));
    finish();
    await first;
    expect(match).toHaveBeenCalledTimes(2);
    // Done: the next sync matches again.
    const next = matchBrandLater('b1', { match });
    expect(next).not.toBe(first);
    finish();
    await next;
    expect(match).toHaveBeenCalledTimes(3);
  });

  it('logs a failed match and never throws', async () => {
    logger.error.mockClear();
    const match = vi.fn(async () => {
      throw new Error('catalog_products read: down');
    });
    await expect(matchBrandLater('b2', { match })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { err: { name: 'Error', message: 'catalog_products read: down' }, brandId: 'b2' },
      '[card-match] match after sync failed',
    );
    // A brand whose match failed is matched again on its next sync.
    await matchBrandLater('b2', { match });
    expect(match).toHaveBeenCalledTimes(2);
  });
});

describe('sweepShoppingCardMatches', () => {
  it('matches each brand whose catalog synced in the last day once, and goes on past a failure', async () => {
    const fake = fakeDb();
    fake.db.rpc = vi.fn(async () => ({ data: 0, error: null }));
    fake
      .rows('catalog_sources')
      .push(
        { id: 's1', brand_id: 'b1', last_status: 'ok', last_synced_at: '2026-10-27T03:00:00Z' },
        { id: 's2', brand_id: 'b1', last_status: 'ok', last_synced_at: '2026-10-27T04:00:00Z' },
        { id: 's3', brand_id: 'b2', last_status: 'ok', last_synced_at: '2026-10-26T20:00:00Z' },
        { id: 's4', brand_id: 'b3', last_status: 'failed', last_synced_at: '2026-10-27T05:00:00Z' },
        { id: 's5', brand_id: 'b4', last_status: 'ok', last_synced_at: '2026-10-20T05:00:00Z' },
      );
    const brandsRead = [];
    const from = fake.db.from;
    fake.db.from = (table) => {
      const q = from(table);
      if (table !== 'brands') return q;
      const eq = q.eq;
      q.eq = (column, value) => {
        brandsRead.push(value);
        if (value === 'b2') throw new Error('down');
        return eq(column, value);
      };
      return q;
    };
    expect(await sweepShoppingCardMatches({ db: fake.db, now: NOW })).toEqual({
      brands: 2,
      changed: 0,
    });
    expect(brandsRead).toEqual(['b1', 'b2']);
    expect(logger.error).toHaveBeenCalledWith(
      { err: { name: 'Error', message: 'down' }, brandId: 'b2' },
      '[card-match] brand failed',
    );
  });
});
