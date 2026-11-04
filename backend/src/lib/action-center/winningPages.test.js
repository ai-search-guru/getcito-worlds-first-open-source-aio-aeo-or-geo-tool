import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Why the brand's winning pages win (learning C4): which pages win, where
 * their checks come from (an audit, else a free read within the day's
 * reads), what sets them apart from the brand's other audited pages, and the
 * runs that find nothing to compare.
 */

let tables;
let writes;
let todayReads;

/** A table as the service role reads it: `eq` and `in` keep the rows that match. */
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const where = [];
      let head = false;
      const chain = {
        select: (_cols, opts) => ((head = opts?.head ?? false), chain),
        eq: (column, value) => (where.push((row) => row[column] === value), chain),
        neq: () => chain,
        in: (column, values) => (where.push((row) => values.includes(row[column])), chain),
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        upsert: async (row) => (writes.push(row), { error: null }),
        then: (resolve) =>
          resolve(
            head
              ? { count: todayReads, error: null }
              : {
                  data: (tables[table] ?? []).filter((row) => where.every((keep) => keep(row))),
                  error: null,
                },
          ),
      };
      return chain;
    },
  },
}));
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const { analyzeWinningPages, pagesMissing, winningPatterns } = await import('./winningPages.js');
const { ReadLaterError } = await import('./competitorPages.js');

const NOW = new Date('2026-10-29T03:00:00Z');
const BRAND = 'brand-1';

/** Enough words that what was read is a page, not a wall. */
const PROSE = `<p>${'A kettle boils water quickly and safely for tea. '.repeat(14)}</p>`;
const FAQ_PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'FAQPage',
  mainEntity: [{ '@type': 'Question' }, { '@type': 'Question' }],
})}</script></head><body><h1>Kettles</h1><h2>Which kettle?</h2>${PROSE}
<table><thead><tr><th>Kettle</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table></body></html>`;
const notFound = () =>
  Object.assign(new Error('The page answered 404'), { code: 'http_error', status: 404 });

/** An audit of a page, with the checks it found. */
function audit(id, url, checks, completedAt = '2026-10-20T00:00:00Z') {
  tables.site_audits.push({
    id,
    brand_id: BRAND,
    url,
    final_url: null,
    status: 'completed',
    completed_at: completedAt,
  });
  for (const [signal_key, status] of Object.entries(checks)) {
    tables.audit_signal_results.push({ audit_id: id, signal_key, status });
  }
}

const WINNING = { 'faq-schema': 'pass', tables: 'pass', 'author-byline': 'pass', lists: 'pass' };
const PLAIN = { 'faq-schema': 'fail', tables: 'fail', 'author-byline': 'fail', lists: 'pass' };

const g14 = { targetEntity: 'pages', targets: [{ id: '/kettles', label: '/kettles' }] };

beforeEach(() => {
  writes = [];
  todayReads = 0;
  tables = {
    brand_domains: [
      { brand_id: BRAND, domain: 'shop.acme.com', is_primary: false },
      { brand_id: BRAND, domain: 'acme.com', is_primary: true },
    ],
    site_audits: [],
    audit_signal_results: [],
    cited_page_features: [],
    prompt_results: [],
    prompts: [],
  };
});

describe('winningPatterns', () => {
  it('keeps the checks most winners pass and most other pages don’t, the widest gap first', () => {
    const patterns = winningPatterns(
      [{ checks: WINNING }, { checks: { ...WINNING, tables: 'fail' } }],
      [
        { checks: PLAIN },
        { checks: { ...PLAIN, tables: 'pass' } },
        { checks: { ...PLAIN, 'faq-schema': 'na' } },
      ],
    );
    // A tie keeps Site Audit's order of the checks.
    expect(patterns).toEqual([
      // 'na' decides nothing: two of the others are counted.
      {
        key: 'faq-schema',
        label: expect.any(String),
        winners: 2,
        ofWinners: 2,
        others: 0,
        ofOthers: 2,
      },
      {
        key: 'author-byline',
        label: expect.any(String),
        winners: 2,
        ofWinners: 2,
        others: 0,
        ofOthers: 3,
      },
      {
        key: 'tables',
        label: expect.any(String),
        winners: 1,
        ofWinners: 2,
        others: 1,
        ofOthers: 3,
      },
    ]);
    // Lists: every page has them, so they don't set the winners apart.
    expect(patterns.map((p) => p.key)).not.toContain('lists');
  });

  it('names nothing where the other pages do as well', () => {
    expect(
      winningPatterns([{ checks: WINNING }], [{ checks: WINNING }, { checks: WINNING }]),
    ).toEqual([]);
  });
});

describe('pagesMissing', () => {
  it('lists the other pages missing the most of the patterns, and none missing none', () => {
    const patterns = [{ key: 'faq-schema' }, { key: 'tables' }];
    expect(
      pagesMissing(
        [
          { url: 'https://acme.com/b', checks: { 'faq-schema': 'fail', tables: 'pass' } },
          { url: 'https://acme.com/a', checks: { 'faq-schema': 'fail', tables: 'fail' } },
          { url: 'https://acme.com/c', checks: { 'faq-schema': 'pass', tables: 'pass' } },
        ],
        patterns,
        1,
      ),
    ).toEqual([{ url: 'https://acme.com/a', missing: ['faq-schema', 'tables'] }]);
  });
});

describe('analyzeWinningPages', () => {
  it('compares a G14 landing page’s audit with the brand’s other audited pages, reading nothing', async () => {
    audit('a-win', 'https://acme.com/kettles/', WINNING);
    audit('a-1', 'https://acme.com/tea', PLAIN);
    audit('a-2', 'https://acme.com/cups', PLAIN);
    audit('a-3', 'https://www.acme.com/about', { ...PLAIN, 'author-byline': 'pass' });
    // Another site's page, though audited for the brand, isn't one of its pages.
    audit('a-x', 'https://rival.com/kettles', PLAIN);
    const read = vi.fn();

    const result = await analyzeWinningPages({ brandId: BRAND, payload: g14, now: NOW, read });
    expect(read).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(result).toMatchObject({
      // The Analytics path, on the brand's primary domain.
      winningPages: [
        {
          url: 'https://acme.com/kettles',
          source: 'audit',
          words: null,
          passes: ['lists', 'tables', 'faq-schema', 'author-byline'],
        },
      ],
      others: 3,
      unreadable: 0,
      reason: null,
    });
    expect(
      result.patterns.map((p) => [p.key, p.winners, p.ofWinners, p.others, p.ofOthers]),
    ).toEqual([
      ['tables', 1, 1, 0, 3],
      ['faq-schema', 1, 1, 0, 3],
      ['author-byline', 1, 1, 1, 3],
    ]);
    expect(result.missingPages).toEqual([
      { url: 'https://acme.com/cups', missing: ['tables', 'faq-schema', 'author-byline'] },
      { url: 'https://acme.com/tea', missing: ['tables', 'faq-schema', 'author-byline'] },
      { url: 'https://www.acme.com/about', missing: ['tables', 'faq-schema'] },
    ]);
  });

  it('reads a winning page without an audit, as a page AI cites, within the day’s reads', async () => {
    audit('a-1', 'https://acme.com/tea', PLAIN);
    audit('a-2', 'https://acme.com/cups', PLAIN);
    audit('a-3', 'https://acme.com/about', PLAIN);
    const read = vi.fn(async (url) => {
      if (url.endsWith('/robots.txt')) throw notFound();
      return { url, html: FAQ_PAGE };
    });

    const result = await analyzeWinningPages({ brandId: BRAND, payload: g14, now: NOW, read });
    expect(read).toHaveBeenCalledWith('https://acme.com/kettles', expect.anything());
    expect(writes).toEqual([
      expect.objectContaining({
        brand_id: BRAND,
        page_key: 'acme.com/kettles',
        own: true,
        features: expect.objectContaining({ checks: expect.any(Object) }),
      }),
    ]);
    expect(result.winningPages[0]).toMatchObject({ source: 'read', words: expect.any(Number) });
    expect(result.patterns.map((p) => p.key)).toContain('faq-schema');
  });

  it("waits for the next night when the day's reads can't cover a winning page", async () => {
    audit('a-1', 'https://acme.com/tea', PLAIN);
    audit('a-2', 'https://acme.com/cups', PLAIN);
    audit('a-3', 'https://acme.com/about', PLAIN);
    todayReads = 12;
    const err = await analyzeWinningPages({
      brandId: BRAND,
      payload: g14,
      now: NOW,
      read: vi.fn(),
    }).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ReadLaterError);
    expect(err.output).toBeNull();
    expect(err.retryDays).toBe(0);
  });

  it("takes G10's winners from the brand's pages its prompts' answers cite, the most cited first", async () => {
    tables.prompt_results = [
      {
        brand_id: BRAND,
        prompt_id: 'p1',
        mention_count: 1,
        citations: [{ url: 'https://acme.com/guide' }, { url: 'https://rival.com/x' }],
      },
      {
        brand_id: BRAND,
        prompt_id: 'p1',
        mention_count: 1,
        citations: [{ url: 'https://acme.com/guide' }, { url: 'https://acme.com/faq' }],
      },
    ];
    audit('a-guide', 'https://acme.com/guide', WINNING);
    audit('a-faq', 'https://acme.com/faq', WINNING);
    audit('a-1', 'https://acme.com/tea', PLAIN);
    audit('a-2', 'https://acme.com/cups', PLAIN);
    audit('a-3', 'https://acme.com/about', PLAIN);

    const result = await analyzeWinningPages({
      brandId: BRAND,
      payload: { targetEntity: 'prompts', targets: [{ id: 'p1', label: 'best kettle' }] },
      now: NOW,
      read: vi.fn(),
    });
    expect(result.winningPages.map((p) => p.url)).toEqual([
      'https://acme.com/guide',
      'https://acme.com/faq',
    ]);
    expect(result.others).toBe(3);
    expect(result.patterns.map((p) => p.key)).toEqual(['tables', 'faq-schema', 'author-byline']);
  });

  it('leaves the task to a person, with why, when there is nothing to compare', async () => {
    const run = (payload) =>
      analyzeWinningPages({ brandId: BRAND, payload, now: NOW, read: vi.fn() }).then(
        () => null,
        (e) => e,
      );
    // No page of the brand's cited for the prompts.
    tables.prompt_results = [
      {
        brand_id: BRAND,
        prompt_id: 'p1',
        mention_count: 0,
        citations: [{ url: 'https://rival.com/x' }],
      },
    ];
    let err = await run({ targetEntity: 'prompts', targets: [{ id: 'p1' }] });
    expect(err.output).toMatchObject({ reason: 'no_winner', patterns: [] });
    expect(err.retryDays).toBe(7);

    // Two other pages audited: too few to say what sets the winner apart.
    audit('a-1', 'https://acme.com/tea', PLAIN);
    audit('a-2', 'https://acme.com/cups', PLAIN);
    err = await run(g14);
    expect(err.output).toMatchObject({ reason: 'too_few_audited', others: 2 });
  });
});
