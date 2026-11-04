import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the pages AI answers cite have (learning C1): which prompts and pages
 * are read, what Site Audit's checks find on them, what the brand's page
 * lacks, the daily cap on reads, robots.txt, and the runs that find nothing.
 */

let tables;
let writes;
let queries;
let todayReads;
let upsertError;

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const op = { table, head: false, filters: [] };
      queries.push(op);
      const chain = {
        select: (_cols, opts) => ((op.head = opts?.head ?? false), chain),
        eq: (column, value) => (op.filters.push(['eq', column, value]), chain),
        neq: () => chain,
        in: (column, value) => (op.filters.push(['in', column, value]), chain),
        gte: (column, value) => (op.filters.push(['gte', column, value]), chain),
        order: () => chain,
        limit: () => chain,
        upsert: async (row) => (writes.push(row), { error: upsertError }),
        then: (resolve) =>
          resolve(
            op.head
              ? { count: todayReads, error: null }
              : { data: tables[table] ?? [], error: null },
          ),
      };
      return chain;
    },
  },
}));
const warn = vi.fn();
vi.mock('../logger.js', () => ({ logger: { warn: (...a) => warn(...a), error: vi.fn() } }));

const {
  FEATURE_CHECKS,
  ReadLaterError,
  analyzeCompetitorPages,
  citedPages,
  featureGaps,
  pageFeatures,
  robotsDisallow,
  scopePromptIds,
  storedFeatures,
} = await import('./competitorPages.js');
const pure = await import('./pageFeatures.js');

const NOW = new Date('2026-10-28T03:00:00Z');

/** Enough words that what was read is a page, not a wall. */
const PROSE = `<p>${'A kettle boils water quickly and safely for tea. '.repeat(14)}</p>`;
const FAQ_PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'FAQPage',
  mainEntity: [{ '@type': 'Question' }, { '@type': 'Question' }],
})}</script></head><body><h1>Best kettles</h1><h2>Which kettle?</h2>${PROSE}
<table><thead><tr><th>Kettle</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table></body></html>`;
const PLAIN_PAGE = `<html><body><h1>Kettles</h1>${PROSE}</body></html>`;
const WALL_PAGE = '<html><body><p>We use cookies. Accept to continue.</p></body></html>';

/** A page that isn't there, as safe-fetch says it. */
const notFound = () =>
  Object.assign(new Error('The page answered 404'), { code: 'http_error', status: 404 });

const isRobots = (url) => url.endsWith('/robots.txt');

beforeEach(() => {
  writes = [];
  queries = [];
  todayReads = 0;
  upsertError = null;
  warn.mockClear();
  tables = {
    prompt_results: [
      {
        mention_count: 0,
        citations: [
          { url: 'https://rival.com/kettles' },
          { url: 'https://rival.com/kettles' },
          { url: 'https://blog.example/best' },
          { url: 'https://acme.com/kettles' },
        ],
      },
      {
        mention_count: 2,
        citations: [{ url: 'https://rival.com/kettles' }, { url: 'https://news.example/x' }],
      },
    ],
    brand_domains: [{ domain: 'acme.com' }],
    competitors: [{ domain: 'www.rival.com' }],
    cited_page_features: [],
    prompts: [],
  };
});

describe('page checks', () => {
  // pageFeatures.js (tested there) reads no database, so the brief and
  // Improve load it without Supabase; they stay importable from here.
  it('are the ones pageFeatures.js gives', () => {
    expect(FEATURE_CHECKS).toBe(pure.FEATURE_CHECKS);
    expect(featureGaps).toBe(pure.featureGaps);
    expect(pageFeatures).toBe(pure.pageFeatures);
  });
});

describe('citedPages', () => {
  it("takes the competitors' pages first, then pages cited where the brand isn't named, and the brand's own", () => {
    const { competitors, yours } = citedPages(tables.prompt_results, {
      ownDomains: ['acme.com'],
      competitorDomains: ['www.rival.com'],
    });
    // A page cited twice in one answer counts once; news.example was cited
    // in an answer that names the brand, so it isn't a page it loses to.
    expect(competitors.map((page) => [page.url, page.count])).toEqual([
      ['https://rival.com/kettles', 2],
      ['https://blog.example/best', 1],
    ]);
    expect(yours).toMatchObject({ url: 'https://acme.com/kettles', count: 1 });
  });

  it('reads at most a few pages an action', () => {
    expect(
      citedPages(tables.prompt_results, {
        ownDomains: [],
        competitorDomains: ['rival.com'],
        perAction: 1,
      }).competitors,
    ).toHaveLength(1);
  });
});

describe('robotsDisallow', () => {
  it('keeps out of a site whose robots.txt shuts out this reader or every crawler', () => {
    expect(robotsDisallow('User-agent: *\nDisallow: /')).toBe(true);
    expect(robotsDisallow('User-agent: GetCitoBot\nDisallow: /')).toBe(true);
    // Its own group wins over everyone's.
    expect(robotsDisallow('User-agent: *\nDisallow: /\n\nUser-agent: GetCitoBot\nAllow: /')).toBe(
      false,
    );
    expect(robotsDisallow('User-agent: *\nDisallow: /\nAllow: /')).toBe(false);
  });

  it('reads a site that shuts out others, a path, or nothing', () => {
    expect(robotsDisallow('User-agent: GPTBot\nDisallow: /')).toBe(false);
    expect(robotsDisallow('User-agent: *\nDisallow: /private/')).toBe(false);
    expect(robotsDisallow('')).toBe(false);
  });
});

describe('scopePromptIds', () => {
  const promptQuery = () => queries.find((q) => q.table === 'prompts');

  it('takes the prompts the action names', async () => {
    expect(await scopePromptIds('b1', { promptIds: ['p1', 'p2'] })).toEqual(['p1', 'p2']);
    expect(promptQuery()).toBeUndefined();
  });

  it("takes a topic action's prompts from its topics", async () => {
    tables.prompts = [{ id: 'p3' }, { id: 'p4' }];
    // As C04 and C09 send it: topic targets, no prompts.
    const payload = {
      targetEntity: 'topics',
      targetCount: 2,
      targets: [{ id: 't1', label: 'Kettles' }],
      targetIds: ['t1', 't2'],
      topicName: 'Kettles',
    };
    expect(await scopePromptIds('b1', payload)).toEqual(['p3', 'p4']);
    expect(promptQuery().filters).toContainEqual(['in', 'topic_id', ['t1', 't2']]);
    expect(promptQuery().filters).toContainEqual(['eq', 'prompt_sets.brand_id', 'b1']);
  });

  it("takes the brand's tracked prompts for an action about competitors or sources", async () => {
    tables.prompts = [{ id: 'p5' }];
    for (const targetEntity of ['competitors', 'sources']) {
      queries = [];
      const payload = { targetEntity, targetCount: 1, targets: [{ id: 'x', label: 'Rival' }] };
      expect(await scopePromptIds('b1', payload)).toEqual(['p5']);
      expect(promptQuery().filters).toEqual(
        expect.arrayContaining([
          ['eq', 'prompt_sets.brand_id', 'b1'],
          ['eq', 'is_active', true],
        ]),
      );
    }
  });
});

describe('analyzeCompetitorPages', () => {
  const payload = { promptIds: ['p1'] };
  const read = vi.fn(async (url) => {
    if (isRobots(url)) throw notFound();
    return { url, html: url.startsWith('https://acme.com') ? PLAIN_PAGE : FAQ_PAGE };
  });
  const pagesRead = (reader = read) =>
    reader.mock.calls.map(([url]) => url).filter((url) => !isRobots(url));
  const run = (over = {}) =>
    analyzeCompetitorPages({ brandId: 'b1', payload, now: NOW, read, ...over });
  /** What a run that throws threw. */
  const thrown = (promise) =>
    promise.then(
      () => null,
      (err) => err,
    );

  beforeEach(() => {
    read.mockClear();
  });

  it("reads the cited pages, keeps their features only, and says what the brand's page lacks", async () => {
    const result = await run();

    expect(pagesRead()).toEqual([
      'https://rival.com/kettles',
      'https://blog.example/best',
      'https://acme.com/kettles',
    ]);
    expect(writes.map((row) => [row.page_key, row.own])).toEqual([
      ['rival.com/kettles', false],
      ['blog.example/best', false],
      ['acme.com/kettles', true],
    ]);
    // Features, never the page's text.
    expect(JSON.stringify(writes)).not.toContain('Which kettle?');
    expect(result.competitorPages.map((page) => page.url)).toEqual([
      'https://rival.com/kettles',
      'https://blog.example/best',
    ]);
    expect(result.competitorPages[0].passes).toContain('faq-schema');
    expect(result.yourPage.passes).not.toContain('faq-schema');
    expect(result.gaps.map((gap) => gap.key)).toEqual(expect.arrayContaining(['faq-schema']));
    expect(result).toMatchObject({ yourPageStatus: 'read', compared: true, unreadable: 0 });
    expect(result).not.toHaveProperty('capped');
  });

  it("reads the brand's tracked prompts' answers for an action naming none (C01)", async () => {
    tables.prompts = [{ id: 'p7' }, { id: 'p8' }];
    const c01 = {
      targetEntity: 'competitors',
      targetCount: 1,
      targets: [{ id: 'rival', label: 'Rival' }],
      competitorNames: ['Rival'],
    };

    const result = await run({ payload: c01 });

    const answers = queries.find((q) => q.table === 'prompt_results');
    expect(answers.filters).toContainEqual(['in', 'prompt_id', ['p7', 'p8']]);
    expect(result.competitorPages).toHaveLength(2);
  });

  it("reads a topic action's prompts' answers", async () => {
    tables.prompts = [{ id: 'p9' }];
    const result = await run({
      payload: { targetEntity: 'topics', targets: [{ id: 't1', label: 'Kettles' }] },
    });
    expect(queries.find((q) => q.table === 'prompt_results').filters).toContainEqual([
      'in',
      'prompt_id',
      ['p9'],
    ]);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it('reuses a page read lately rather than reading it again', async () => {
    tables.cited_page_features = [
      {
        page_key: 'rival.com/kettles',
        read_at: '2026-10-20T00:00:00Z',
        features: { words: 900, checks: { 'faq-schema': 'pass' } },
      },
    ];
    const result = await run();
    expect(pagesRead()).not.toContain('https://rival.com/kettles');
    expect(result.competitorPages[0]).toMatchObject({ words: 900, passes: ['faq-schema'] });
  });

  it("reads all of an action's pages the same night or none, and waits for the next", async () => {
    // Three pages to read, two reads left: none is read.
    todayReads = 10;
    const err = await thrown(run());
    expect(err).toBeInstanceOf(ReadLaterError);
    expect(err).toMatchObject({ retryLater: true, output: null, retryDays: 0 });
    expect(read).not.toHaveBeenCalled();
    expect(writes).toEqual([]);

    // Three left: all three.
    todayReads = 9;
    const result = await run();
    expect(pagesRead()).toHaveLength(3);
    expect(result.yourPageStatus).toBe('read');

    // A page read lately needs no read of the day's.
    read.mockClear();
    tables.cited_page_features = [
      {
        page_key: 'acme.com/kettles',
        read_at: '2026-10-27T00:00:00Z',
        features: { words: 400, checks: {} },
      },
    ];
    todayReads = 10;
    await expect(run()).resolves.toMatchObject({ yourPageStatus: 'read' });
    expect(pagesRead()).toHaveLength(2);
  });

  it("keeps a page it couldn't read, so it counts and isn't read again while fresh", async () => {
    const reader = vi.fn(async (url) => {
      if (isRobots(url)) throw notFound();
      if (url === 'https://blog.example/best') throw new Error('blocked');
      return { url, html: url.startsWith('https://acme.com') ? PLAIN_PAGE : FAQ_PAGE };
    });
    const result = await run({ read: reader });

    expect(writes.find((row) => row.page_key === 'blog.example/best').features).toEqual({
      unreadable: true,
    });
    expect(result).toMatchObject({ unreadable: 1, compared: false, gaps: [] });

    // Read as unreadable on the next run, and not read again.
    reader.mockClear();
    tables.cited_page_features = writes.map((row) => ({ ...row }));
    writes = [];
    const again = await run({ read: reader });
    expect(pagesRead(reader)).toEqual([]);
    expect(again).toMatchObject({ unreadable: 1, competitorPages: [expect.any(Object)] });
  });

  it("says the brand's page couldn't be read rather than that it wasn't cited", async () => {
    const reader = vi.fn(async (url) => {
      if (isRobots(url)) throw notFound();
      return { url, html: url.startsWith('https://acme.com') ? WALL_PAGE : FAQ_PAGE };
    });
    const result = await run({ read: reader });
    expect(result).toMatchObject({ yourPage: null, yourPageStatus: 'unreadable', unreadable: 1 });
    expect(writes.find((row) => row.own).features).toEqual({ unreadable: true });

    tables.prompt_results[0].citations = tables.prompt_results[0].citations.filter(
      (cite) => !cite.url.startsWith('https://acme.com'),
    );
    writes = [];
    expect(await run()).toMatchObject({ yourPage: null, yourPageStatus: 'not_cited' });
  });

  it("doesn't read a site whose robots.txt keeps it out", async () => {
    const reader = vi.fn(async (url) => {
      if (url === 'https://blog.example/robots.txt') {
        return { url, html: 'User-agent: *\nDisallow: /' };
      }
      if (isRobots(url)) throw notFound();
      return { url, html: FAQ_PAGE };
    });
    const result = await run({ read: reader });
    expect(pagesRead(reader)).not.toContain('https://blog.example/best');
    expect(writes.find((row) => row.page_key === 'blog.example/best').features).toEqual({
      unreadable: true,
      disallowed: true,
    });
    expect(result.unreadable).toBe(1);
  });

  it("stays out of a site whose robots.txt can't be read, and reads one with none", async () => {
    const reader = vi.fn(async (url) => {
      if (url === 'https://blog.example/robots.txt') {
        throw Object.assign(new Error('The page answered 503'), {
          code: 'http_error',
          status: 503,
        });
      }
      if (url === 'https://rival.com/robots.txt')
        return { url, html: '<!doctype html><p>Home</p>' };
      if (isRobots(url)) throw notFound();
      return { url, html: FAQ_PAGE };
    });
    await run({ read: reader });
    expect(pagesRead(reader)).toEqual(['https://rival.com/kettles', 'https://acme.com/kettles']);
  });

  it("logs a read it couldn't keep without calling the page unreadable", async () => {
    upsertError = { message: 'write failed' };
    const result = await run();
    expect(result).toMatchObject({ unreadable: 0, compared: true });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('leaves the task to a person, with why, when there is nothing to compare', async () => {
    const failing = vi.fn(async () => {
      throw new Error('blocked');
    });
    const unreadable = await thrown(run({ read: failing }));
    expect(unreadable).toBeInstanceOf(ReadLaterError);
    expect(unreadable.retryDays).toBe(7);
    expect(unreadable.output).toMatchObject({
      competitorPages: [],
      gaps: [],
      unreadable: 3,
      yourPageStatus: 'unreadable',
      reason: 'unreadable',
    });

    tables.prompt_results = [];
    const none = await thrown(run());
    expect(none).toMatchObject({ retryDays: 7, output: { reason: 'none_cited' } });

    // An action naming no prompts, for a brand tracking none.
    const noPrompts = await thrown(run({ payload: { targetEntity: 'competitors', targets: [] } }));
    expect(noPrompts).toMatchObject({ retryDays: 7, output: { reason: 'no_prompts' } });
  });
});

/** What the checks found on pages read lately, for Improve (learning C2). */
describe('storedFeatures', () => {
  it('reads the pages read lately by key, leaving out one that could not be read', async () => {
    tables.cited_page_features = [
      { page_key: 'rival.com/kettles', own: false, features: { checks: { tables: 'pass' } } },
      { page_key: 'blog.example/best', own: false, features: { unreadable: true } },
    ];
    const stored = await storedFeatures(
      'b1',
      ['https://www.rival.com/kettles/', 'https://blog.example/best'],
      NOW,
    );
    expect([...stored.entries()]).toEqual([
      ['rival.com/kettles', { own: false, checks: { tables: 'pass' } }],
    ]);
    // The brand's own reads only, from the last two freshDays (28 days).
    const read = queries.find((q) => q.table === 'cited_page_features');
    expect(read.filters).toContainEqual(['eq', 'brand_id', 'b1']);
    expect(read.filters).toContainEqual([
      'in',
      'page_key',
      ['rival.com/kettles', 'blog.example/best'],
    ]);
    expect(read.filters).toContainEqual(['gte', 'read_at', '2026-09-30T03:00:00.000Z']);
    expect(await storedFeatures('b1', [])).toEqual(new Map());
  });
});
