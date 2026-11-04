import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cited pages' length (CE-030): a benchmark read when the brief is
 * rebuilt, only from addresses AI answers cited for the brand.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';

let urlRows;
let citedIds;
let failRead;
const asked = [];

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, filters: [] };
      asked.push(call);
      const chain = {
        select: () => chain,
        in: (col, v) => (call.filters.push(['in', col, v]), chain),
        eq: (col, v) => (call.filters.push(['eq', col, v]), chain),
        limit: async () => {
          const id = call.filters.find(([, col]) => col === 'url_id')?.[2];
          return { data: citedIds.includes(id) ? [{ url_id: id }] : [], error: null };
        },
        then: (resolve) => {
          if (failRead) return resolve({ data: null, error: new Error('down') });
          const urls = call.filters.find(([, col]) => col === 'url')[2];
          return resolve({ data: urlRows.filter((r) => urls.includes(r.url)), error: null });
        },
      };
      return chain;
    },
  },
}));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
const fetchPage = vi.fn();
vi.mock('./safeFetch.js', () => ({ fetchPage: (...args) => fetchPage(...args) }));

const { CITED_LENGTH_PAGES, citedFeatures, citedPagesLength } =
  await import('./contentCitedLength.js');

const url = (n) => `https://site${n}.example/a`;
const page = (n) => ({ url: url(n), kind: 'blog' });
const lookups = () => asked.filter((c) => c.table === 'citation_urls');

beforeEach(() => {
  urlRows = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, url: url(i + 1) }));
  citedIds = urlRows.map((r) => r.id);
  failRead = false;
  asked.length = 0;
  fetchPage.mockReset();
});

describe('citedPagesLength', () => {
  it('takes the middle of the cited pages read, rounded to a hundred', async () => {
    const lengths = { [url(1)]: 4210, [url(2)]: 4400, [url(3)]: 3000 };
    const read = vi.fn(async (address) => lengths[address]);
    expect(
      await citedPagesLength({ brandId: BRAND, pages: [page(1), page(2), page(3)] }, { read }),
    ).toEqual({ characters: 4200, pages: 3 });
    // Each address checked against the brand's own citations.
    const checks = asked.filter((c) => c.table === 'prompt_result_citations');
    expect(checks).toHaveLength(3);
    expect(checks[0].filters).toContainEqual(['eq', 'brand_id', BRAND]);
  });

  it('isn’t pulled up by one very long page, an encyclopedia’s', async () => {
    const lengths = { [url(1)]: 4000, [url(2)]: 104_100, [url(3)]: 4400, [url(4)]: 3800 };
    const read = vi.fn(async (address) => lengths[address]);
    expect(
      await citedPagesLength({ brandId: BRAND, pages: [1, 2, 3, 4].map(page) }, { read }),
    ).toEqual({ characters: 4200, pages: 4 });
  });

  it('reads only addresses AI answers cited for the brand, never one a request names alone', async () => {
    citedIds = [2, 3];
    const read = vi.fn(async () => 5000);
    const result = await citedPagesLength(
      {
        brandId: BRAND,
        pages: [page(1), page(2), { url: 'http://169.254.169.254/', kind: 'x' }, page(3)],
      },
      { read },
    );
    expect(read.mock.calls.map(([address]) => address)).toEqual([url(2), url(3)]);
    expect(result).toEqual({ characters: 5000, pages: 2 });
  });

  it('leaves out the draft’s own page, however its address was cited', async () => {
    const cited = 'https://www.site1.example/a/?utm_source=chatgpt.com';
    urlRows.push({ id: 9, url: cited });
    citedIds.push(9);
    const read = vi.fn(async () => 2000);
    await citedPagesLength(
      { brandId: BRAND, pages: [{ url: cited }, page(2)], ownUrl: url(1) },
      { read },
    );
    expect(read.mock.calls.map(([address]) => address)).toEqual([url(2)]);
  });

  it('reads one page cited under two addresses once, at the first', async () => {
    const variant = 'https://www.site2.example/a/?utm_source=chatgpt.com';
    urlRows.push({ id: 9, url: variant });
    citedIds.push(9);
    const read = vi.fn(async () => 3000);
    const result = await citedPagesLength(
      { brandId: BRAND, pages: [page(2), { url: variant }, page(3)] },
      { read },
    );
    expect(read.mock.calls.map(([address]) => address)).toEqual([url(2), url(3)]);
    expect(result).toEqual({ characters: 3000, pages: 2 });
  });

  it('reads at most a few, in the Sources order, and stops looking once it has them', async () => {
    const read = vi.fn(async () => 2000);
    await citedPagesLength(
      { brandId: BRAND, pages: urlRows.map((r) => ({ url: r.url })) },
      { read },
    );
    expect(read.mock.calls.map(([address]) => address)).toEqual(
      [1, 2, 3, 4, 5].map(url).slice(0, CITED_LENGTH_PAGES),
    );
    expect(lookups()).toHaveLength(1);
    expect(lookups()[0].filters[0][2]).toHaveLength(CITED_LENGTH_PAGES);

    // The first few weren't cited for the brand: it looks further.
    citedIds = [6, 7];
    asked.length = 0;
    read.mockClear();
    await citedPagesLength(
      { brandId: BRAND, pages: urlRows.map((r) => ({ url: r.url })) },
      { read },
    );
    expect(read.mock.calls.map(([address]) => address)).toEqual([url(6), url(7)]);
    expect(lookups()).toHaveLength(2);
  });

  it('counts a page’s main text as the Rules tab counts length; one that can’t be read is none', async () => {
    const words = 'Espresso needs a fine, even grind and fresh beans. '.repeat(20);
    fetchPage.mockImplementation(async (address) => {
      if (address === url(3)) throw Object.assign(new Error('HTTP 404'), { code: 'http_error' });
      return {
        url: address,
        status: 200,
        html: `<html><body><main><h1>Guide</h1><p>${words}</p></main></body></html>`,
      };
    });
    const result = await citedPagesLength({ brandId: BRAND, pages: [1, 2, 3].map(page) });
    expect(fetchPage).toHaveBeenCalledWith(url(1), { timeoutMs: 8000, signal: null });
    // Their main text, about 1,000 characters; the page that answered 404 isn't counted.
    expect(result).toMatchObject({ characters: 1000, pages: 2 });
    // What Site Audit's checks find on the same two pages (learning C2): both have an H1.
    expect(result.features.pages).toBe(2);
    expect(result.features.checks.every((check) => check.pages >= 1)).toBe(true);
  });

  it('makes up no number: null when fewer than two could be read, or only walls were', async () => {
    expect(await citedPagesLength({ brandId: BRAND, pages: [] })).toBeNull();
    const one = vi.fn(async (address) => (address === url(1) ? 104_100 : null));
    expect(
      await citedPagesLength({ brandId: BRAND, pages: [page(1), page(2)] }, { read: one }),
    ).toBeNull();
    const walls = vi.fn(async (address) => (address === url(1) ? 120 : null));
    expect(
      await citedPagesLength({ brandId: BRAND, pages: [page(1), page(2)] }, { read: walls }),
    ).toBeNull();
    const broken = vi.fn(async () => {
      throw new Error('timeout');
    });
    expect(
      await citedPagesLength({ brandId: BRAND, pages: [page(1)] }, { read: broken }),
    ).toBeNull();
  });

  it('settles on nothing at once when the run is stopped, its reads ended', async () => {
    const controller = new AbortController();
    const signals = [];
    const read = vi.fn(
      (address, signal) =>
        new Promise((_, reject) => {
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const result = citedPagesLength(
      { brandId: BRAND, pages: [page(1), page(2)], signal: controller.signal },
      { read },
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(result).resolves.toBeNull();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('never fails the brief: a read of the citations that fails is no benchmark', async () => {
    failRead = true;
    const read = vi.fn(async () => 4000);
    expect(await citedPagesLength({ brandId: BRAND, pages: [page(1)] }, { read })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

/** What the cited pages have (learning C2), from the reads the length takes. */
describe('citedFeatures', () => {
  const read = (...passing) => ({
    length: 3000,
    features: { words: 500, checks: Object.fromEntries(passing.map((key) => [key, 'pass'])) },
  });

  it('names the checks at least half the pages read pass, the most passed first', () => {
    expect(
      citedFeatures([read('faq-schema', 'tables'), read('faq-schema'), read('lists')]),
    ).toEqual({
      pages: 3,
      checks: [{ key: 'faq-schema', label: expect.any(String), pages: 2 }],
    });
  });

  it('says nothing from fewer than two pages with features', () => {
    expect(citedFeatures([read('faq-schema'), { length: 3000, features: null }])).toBeNull();
  });

  it('keeps the length when a reader gives only numbers', async () => {
    const lengths = { [url(1)]: 4000, [url(2)]: 4400 };
    const result = await citedPagesLength(
      { brandId: BRAND, pages: [page(1), page(2)] },
      { read: async (address) => lengths[address] },
    );
    expect(result).toEqual({ characters: 4200, pages: 2 });
  });
});
