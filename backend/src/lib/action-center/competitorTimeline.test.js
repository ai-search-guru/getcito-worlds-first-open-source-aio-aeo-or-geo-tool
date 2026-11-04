import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A competitor's pages over time (learning C3): the pages first cited, read
 * from the citations once each, and the weekly re-read of those cited most,
 * within the brand's reads left, recording the ones whose words changed.
 */

let tables;
let inserts;
let upserts;
let rpcCalls;
let todayReads;
/** The values of each `in` filter, and the pages each read asked for. */
let inFilters;
let ranges;

/** A read's rows, past the cap a page at a time as PostgREST's `range` gives them. */
const paged = (rows, range) => (range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000));

/** A table as the service role reads it: `eq`, `neq` and `in` keep the rows that match. */
vi.mock('../../config/supabase.js', () => ({
  default: {
    rpc: (name, args) => {
      rpcCalls.push([name, args]);
      let range = null;
      const chain = {
        order: () => chain,
        range: (from, to) => ((range = [from, to]), ranges.push([`rpc:${name}`, from]), chain),
        then: (resolve) =>
          resolve({ data: paged(tables[`rpc:${name}`] ?? [], range), error: null }),
      };
      return chain;
    },
    from: (table) => {
      const where = [];
      let head = false;
      let range = null;
      const chain = {
        select: (_cols, opts) => ((head = opts?.head ?? false), chain),
        eq: (column, value) => {
          const [own, nested] = column.split('.');
          where.push((row) => (nested ? row[own]?.[nested] : row[own]) === value);
          return chain;
        },
        neq: (column, value) => (where.push((row) => row[column] !== value), chain),
        in: (column, values) => (
          inFilters.push([table, values.length]),
          where.push((row) => values.includes(row[column])),
          chain
        ),
        range: (from, to) => ((range = [from, to]), ranges.push([table, from]), chain),
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: async (rows) => (inserts.push([table, rows]), { error: null }),
        upsert: async (rows) => (upserts.push([table, rows]), { error: null }),
        then: (resolve) =>
          resolve(
            head
              ? { count: todayReads, error: null }
              : {
                  data: paged(
                    (tables[table] ?? []).filter((row) => where.every((keep) => keep(row))),
                    range,
                  ),
                  error: null,
                },
          ),
      };
      return chain;
    },
  },
}));
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const {
  citedCompetitorPages,
  pageChange,
  recordFirstCitations,
  recordPageChanges,
  sweepCompetitorTimeline,
} = await import('./competitorTimeline.js');
const { sketch, visibleText } = await import('./taskChecks.js');

const NOW = new Date('2026-10-29T03:00:00Z');
const BRAND = 'brand-1';

const paragraph = (word) =>
  `<p>${Array.from({ length: 60 }, (_, i) => `${word} kettle number ${i} boils water fast`).join(' ')}</p>`;
const PAGE_V1 = `<html><body><h1>Kettles</h1>${paragraph('steel')}</body></html>`;
// Rewritten, and an FAQ added: its words and its checks changed.
const PAGE_V2 = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'FAQPage',
  mainEntity: [{ '@type': 'Question' }],
})}</script></head><body><h1>Kettles</h1>${paragraph('glass')}<h2>FAQ</h2>${paragraph('copper')}</body></html>`;
const wordsOf = (html) => sketch(visibleText(html, undefined, { steady: true }));
const notFound = () =>
  Object.assign(new Error('The page answered 404'), { code: 'http_error', status: 404 });
const reader = (pages) =>
  vi.fn(async (url) => {
    if (url.endsWith('/robots.txt')) throw notFound();
    return { url, html: pages[url] ?? PAGE_V1 };
  });

const cited = (url, answers, firstAt = '2026-10-20T00:00:00Z', competitor = 'c1') => ({
  url,
  domain: new URL(url).hostname.replace(/^www\./, ''),
  competitor_id: competitor,
  first_at: firstAt,
  answers,
});

beforeEach(() => {
  inserts = [];
  upserts = [];
  rpcCalls = [];
  inFilters = [];
  ranges = [];
  todayReads = 0;
  tables = {
    competitors: [{ id: 'c1', brand_id: BRAND, domain: 'rival.com' }],
    competitor_timeline_scans: [],
    competitor_page_events: [],
    cited_page_features: [],
    'rpc:competitor_cited_urls': [],
  };
});

describe('citedCompetitorPages', () => {
  it('reads one page per key: its first citation the earliest, its answers summed', () => {
    expect(
      citedCompetitorPages([
        cited('https://rival.com/kettles?utm=x', 2, '2026-10-21T00:00:00Z'),
        cited('https://www.rival.com/kettles/', 3, '2026-10-18T00:00:00Z'),
        {
          url: 'not a url',
          domain: '',
          competitor_id: 'c1',
          first_at: '2026-10-01T00:00:00Z',
          answers: 9,
        },
      ]),
    ).toEqual([
      {
        key: 'rival.com/kettles',
        url: 'https://rival.com/kettles?utm=x',
        domain: 'rival.com',
        competitorId: 'c1',
        firstAt: '2026-10-18T00:00:00Z',
        answers: 5,
      },
    ]);
  });
});

describe('pageChange', () => {
  it('says nothing for a first read, or a page whose words barely moved', () => {
    expect(pageChange(undefined, wordsOf(PAGE_V1), {})).toBeNull();
    expect(pageChange({ sketch: wordsOf(PAGE_V1) }, wordsOf(PAGE_V1), {})).toBeNull();
  });

  it('says a rewritten page changed, and the checks it gained and lost', () => {
    const change = pageChange(
      { sketch: wordsOf(PAGE_V1), features: { checks: { lists: 'pass', 'faq-schema': 'fail' } } },
      wordsOf(PAGE_V2),
      { lists: 'fail', 'faq-schema': 'pass' },
    );
    expect(change).toMatchObject({
      gained: [{ key: 'faq-schema', label: expect.any(String) }],
      lost: [{ key: 'lists', label: expect.any(String) }],
    });
    expect(change.similarity).toBeLessThan(0.9);
  });
});

describe('recordFirstCitations', () => {
  it('reads a new competitor back 90 days, and records each page first cited once', async () => {
    tables['rpc:competitor_cited_urls'] = [
      cited('https://rival.com/kettles', 4, '2026-09-10T00:00:00Z'),
      cited('https://rival.com/old', 1, '2026-08-01T00:00:00Z'),
    ];
    tables.competitor_page_events = [
      { brand_id: BRAND, kind: 'first_cited', page_key: 'rival.com/old' },
    ];
    expect(await recordFirstCitations(BRAND, NOW)).toBe(1);
    expect(rpcCalls).toEqual([
      ['competitor_cited_urls', { p_brand_id: BRAND, p_since: '2026-07-31T03:00:00.000Z' }],
    ]);
    expect(inserts).toEqual([
      [
        'competitor_page_events',
        [
          {
            brand_id: BRAND,
            competitor_id: 'c1',
            page_key: 'rival.com/kettles',
            url: 'https://rival.com/kettles',
            domain: 'rival.com',
            kind: 'first_cited',
            at: '2026-09-10T00:00:00Z',
            detail: { answers: 4 },
          },
        ],
      ],
    ]);
    expect(upserts).toEqual([
      [
        'competitor_timeline_scans',
        [{ competitor_id: 'c1', brand_id: BRAND, scanned_at: NOW.toISOString() }],
      ],
    ]);
  });

  it("reads every page a brand cited past a read's row cap, and asks for the known ones in parts", async () => {
    tables['rpc:competitor_cited_urls'] = Array.from({ length: 2_500 }, (_, i) =>
      cited(`https://rival.com/page-${i}`, 1),
    );
    tables.competitor_page_events = [
      { brand_id: BRAND, kind: 'first_cited', page_key: 'rival.com/page-2400' },
    ];
    expect(await recordFirstCitations(BRAND, NOW)).toBe(2_499);
    expect(ranges.filter(([name]) => name === 'rpc:competitor_cited_urls')).toEqual([
      ['rpc:competitor_cited_urls', 0],
      ['rpc:competitor_cited_urls', 1000],
      ['rpc:competitor_cited_urls', 2000],
    ]);
    const keyReads = inFilters.filter(([table]) => table === 'competitor_page_events');
    expect(keyReads.length).toBeGreaterThan(1);
    expect(Math.max(...keyReads.map(([, n]) => n))).toBeLessThanOrEqual(30);
  });

  it('reads a competitor read before from a day before its last read', async () => {
    tables.competitor_timeline_scans = [
      { competitor_id: 'c1', brand_id: BRAND, scanned_at: '2026-10-28T03:00:00Z' },
    ];
    expect(await recordFirstCitations(BRAND, NOW)).toBe(0);
    expect(rpcCalls[0][1].p_since).toBe('2026-10-27T03:00:00.000Z');
    expect(inserts).toEqual([]);
  });
});

describe('recordPageChanges', () => {
  it('reads again the most cited pages whose last read is a week old, and records those that changed', async () => {
    tables['rpc:competitor_cited_urls'] = [
      cited('https://rival.com/kettles', 9),
      cited('https://rival.com/fresh', 7),
      cited('https://rival.com/new', 3),
    ];
    tables.cited_page_features = [
      {
        brand_id: BRAND,
        page_key: 'rival.com/kettles',
        read_at: '2026-10-20T00:00:00Z',
        features: { words: 600, checks: { 'faq-schema': 'fail' } },
        sketch: wordsOf(PAGE_V1),
      },
      // Read three days ago: not due.
      { brand_id: BRAND, page_key: 'rival.com/fresh', read_at: '2026-10-26T00:00:00Z' },
    ];
    const read = reader({ 'https://rival.com/kettles': PAGE_V2 });

    expect(await recordPageChanges(BRAND, { now: NOW, read })).toBe(1);
    const pagesRead = read.mock.calls
      .map(([url]) => url)
      .filter((url) => !url.endsWith('robots.txt'));
    expect(pagesRead).toEqual(['https://rival.com/kettles', 'https://rival.com/new']);
    // Each read keeps its sketch for the next one.
    const kept = upserts.filter(([table]) => table === 'cited_page_features').map(([, row]) => row);
    expect(kept.map((row) => [row.page_key, row.sketch?.v])).toEqual([
      ['rival.com/kettles', 2],
      ['rival.com/new', 2],
    ]);
    // The new page's first read is a baseline, not a change.
    expect(inserts).toEqual([
      [
        'competitor_page_events',
        [
          expect.objectContaining({
            competitor_id: 'c1',
            page_key: 'rival.com/kettles',
            kind: 'changed',
            at: NOW.toISOString(),
            // The JSON-LD it now has, among what Site Audit's checks found.
            detail: expect.objectContaining({
              gained: expect.arrayContaining([
                expect.objectContaining({ key: 'json-ld-presence' }),
              ]),
              lost: [],
            }),
          }),
        ],
      ],
    ]);
  });

  it("reads only as many as the brand's reads left today allow", async () => {
    tables['rpc:competitor_cited_urls'] = [
      cited('https://rival.com/a', 5),
      cited('https://rival.com/b', 4),
      cited('https://rival.com/c', 3),
    ];
    todayReads = 11;
    const read = reader({});
    await recordPageChanges(BRAND, { now: NOW, read });
    const pagesRead = read.mock.calls
      .map(([url]) => url)
      .filter((url) => !url.endsWith('robots.txt'));
    expect(pagesRead).toEqual(['https://rival.com/a']);
    todayReads = 12;
    read.mockClear();
    expect(await recordPageChanges(BRAND, { now: NOW, read })).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('sweepCompetitorTimeline', () => {
  it("goes over the brands with competitors on an active plan, and a brand's failure stops no other", async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    vi.stubEnv('IS_CLOUD', 'true');
    tables.competitors = [
      {
        id: 'c1',
        brand_id: BRAND,
        domain: 'rival.com',
        brands: { organization_id: 'o1', is_active: true, is_demo: false },
      },
      {
        id: 'c2',
        brand_id: 'brand-2',
        domain: 'other.com',
        brands: { organization_id: 'o2', is_active: true, is_demo: false },
      },
      {
        id: 'c3',
        brand_id: 'brand-3',
        domain: '',
        brands: { organization_id: 'o1', is_active: true, is_demo: false },
      },
    ];
    tables.organizations = [
      { id: 'o1', subscription_status: 'active' },
      { id: 'o2', subscription_status: 'canceled' },
    ];
    const outcome = await sweepCompetitorTimeline({ now: NOW, read: reader({}) });
    vi.unstubAllEnvs();
    expect(outcome).toMatchObject({ brands: 1, failed: 0 });
    expect(rpcCalls.map(([, args]) => args.p_brand_id)).toEqual([BRAND, BRAND]);
  });

  it('reaches a brand past the first thousand competitors read', async () => {
    tables.competitors = Array.from({ length: 1_200 }, (_, i) => ({
      id: `c${String(i).padStart(4, '0')}`,
      brand_id: i < 1_100 ? 'brand-busy' : BRAND,
      domain: 'rival.com',
      brands: { organization_id: 'o1', is_active: true, is_demo: false },
    }));
    // The busy brand was read last night; the other never was, so it goes first.
    tables.competitor_timeline_scans = Array.from({ length: 1_100 }, (_, i) => ({
      competitor_id: `c${String(i).padStart(4, '0')}`,
      brand_id: 'brand-busy',
      scanned_at: '2026-10-28T03:00:00Z',
    }));
    await sweepCompetitorTimeline({ now: NOW, read: reader({}), limit: 1 });
    expect(rpcCalls[0][1].p_brand_id).toBe(BRAND);
  });

  it("never reads a demo brand's competitor pages (00380)", async () => {
    tables.competitors = [
      {
        id: 'c1',
        brand_id: BRAND,
        domain: 'rival.com',
        brands: { organization_id: 'o1', is_active: true, is_demo: true },
      },
    ];
    const read = reader({});
    const outcome = await sweepCompetitorTimeline({ now: NOW, read });
    expect(outcome).toMatchObject({ brands: 0, firstCited: 0, changed: 0 });
    expect(rpcCalls).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
