import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Optimize content › Page URL (Content Editor CE-003): only the brand's own
 * pages are read, and a page that can't be read says why.
 */

// Seeded brands' ids aren't RFC 4122 versions; the route must still take them.
const BRAND = '33333333-3333-3333-3333-333333333333';
let org;
let fetched;
let fetchResult;
let draftRow;
// Each table's filters, as asked: [method, ...args].
let calls;

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (name) => {
      const result =
        name === 'brands'
          ? {
              data: { id: BRAND, organization_id: 'o1', name: 'Northwind', site_type: 'b2c' },
              error: null,
            }
          : name === 'profiles'
            ? // The caller, with All brands (lib/access.js reads it once).
              { data: { organization_id: org, role: 'manager', brand_scope: 'all' }, error: null }
            : name === 'content_drafts'
              ? { data: draftRow, error: null }
              : name === 'brand_facts'
                ? { data: [{ quote: 'Bluesign certified' }], error: null }
                : {
                    data: [
                      { domain: 'https://www.Northwind.example/' },
                      { domain: 'northwind.shop' },
                    ],
                    error: null,
                  };
      const asked = (calls ??= {})[name] ?? (calls[name] = []);
      const chain = {
        select: () => chain,
        eq: (...args) => (asked.push(['eq', ...args]), chain),
        is: (...args) => (asked.push(['is', ...args]), chain),
        order: (...args) => (asked.push(['order', ...args]), chain),
        limit: (...args) => (asked.push(['limit', ...args]), chain),
        single: async () => result,
        maybeSingle: async () => result,
        then: (resolve) => resolve(result),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/planGuard.js', async (importOriginal) => ({
  PlanLimitError: (await importOriginal()).PlanLimitError,
  getOrgIdForUser: async () => org,
}));
const readSourceClasses = vi.fn();
const logError = vi.fn();
const readDraftClaims = vi.fn();
vi.mock('../lib/contentQualityClaims.js', () => ({
  readDraftClaims: (...args) => readDraftClaims(...args),
}));
const readPage = vi.fn();
vi.mock('../lib/contentQualityPage.js', () => ({
  readPage: (...args) => readPage(...args),
}));
vi.mock('../lib/contentSourceClass.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readSourceClasses: (...args) => readSourceClasses(...args),
}));
vi.mock('../lib/safeFetch.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchPage: async (url) => {
      fetched.push(url);
      if (fetchResult instanceof Error) throw fetchResult;
      return fetchResult;
    },
  };
});

const checkLinks = vi.fn();
vi.mock('../lib/linkCheck.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkLinks: (...args) => checkLinks(...args),
}));

const { default: router } = await import('./contentPages.js');
const { PageFetchError } = await import('../lib/safeFetch.js');
const { PlanLimitError } = await import('../lib/planGuard.js');

let server;
let baseUrl;

beforeEach(async () => {
  org = 'o1';
  draftRow = {
    brand_id: BRAND,
    body_html:
      '<p><a href="https://a.example/">a</a> <a href="https://a.example/#x">again</a> <a href="/pricing">ours</a></p>',
  };
  checkLinks.mockReset().mockResolvedValue({
    reads: new Map([['https://a.example/', { status: 'ok', httpStatus: 200, date: null }]]),
    skipped: ['/pricing'],
  });
  fetched = [];
  fetchResult = {
    url: 'https://northwind.example/pricing',
    status: 200,
    html: '<main><h1>Pricing</h1><p>Plans</p></main>',
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: logError };
    next();
  });
  app.use('/api/content-pages', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content-pages`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const importPage = (url, brandId = BRAND) =>
  fetch(`${baseUrl}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brandId, url }),
  });

describe('POST /api/content-pages/import', () => {
  it('reads a page of the brand’s, a bare host as https, and returns its content', async () => {
    const res = await importPage('blog.northwind.example/pricing');
    expect(res.status).toBe(200);
    expect(fetched).toEqual(['https://blog.northwind.example/pricing']);
    await expect(res.json()).resolves.toEqual({
      url: 'https://northwind.example/pricing',
      title: 'Pricing',
      html: '<h1>Pricing</h1><p>Plans</p>',
    });
  });

  it('reads no page off the brand’s site', async () => {
    for (const url of [
      'https://competitor.example/pricing',
      'https://northwind.example.evil.com/',
    ]) {
      const res = await importPage(url);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'off_site' });
    }
    expect(fetched).toEqual([]);
  });

  it('refuses a page that redirects off the site', async () => {
    fetchResult = { url: 'https://elsewhere.example/', status: 200, html: '<p>x</p>' };
    const res = await importPage('https://northwind.shop/old');
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ code: 'off_site' });
  });

  it('says why a page couldn’t be read', async () => {
    fetchResult = new PageFetchError('http_error', 'The page answered 404', { status: 404 });
    let res = await importPage('https://northwind.example/gone');
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ code: 'http_error', status: 404 });

    fetchResult = new PageFetchError('timeout', 'slow');
    res = await importPage('https://northwind.example/slow');
    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toMatchObject({ code: 'timeout' });
  });

  it('refuses another organization’s brand, and an id that isn’t one', async () => {
    org = 'o2';
    let res = await importPage('https://northwind.example/pricing');
    expect(res.status).toBe(403);
    res = await importPage('https://northwind.example/pricing', 'nope');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid' });
    expect(fetched).toEqual([]);
  });
});

const DRAFT = '2f1d1c52-0f7a-4c1e-9b8a-5d6e7f8a9b0c';
const checkDraftLinks = (body) =>
  fetch(`${baseUrl}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/content-pages/links', () => {
  it("reads the saved draft's links, never the request's, and answers with each one's read", async () => {
    const res = await checkDraftLinks({ draftId: DRAFT, urls: ['https://evil.example/'] });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      links: [{ href: 'https://a.example/', status: 'ok', httpStatus: 200, date: null }],
      skipped: ['/pricing'],
    });
    expect(checkLinks).toHaveBeenCalledWith(
      ['https://a.example/', 'https://a.example/#x', '/pricing'],
      expect.objectContaining({ reserve: expect.any(Function) }),
    );
  });

  it('refuses another organization’s draft, one that isn’t there, and an id that isn’t one', async () => {
    org = 'o2';
    let res = await checkDraftLinks({ draftId: DRAFT });
    expect(res.status).toBe(403);
    org = 'o1';
    draftRow = null;
    res = await checkDraftLinks({ draftId: DRAFT });
    expect(res.status).toBe(404);
    res = await checkDraftLinks({ draftId: 'nope' });
    expect(res.status).toBe(400);
    expect(checkLinks).not.toHaveBeenCalled();
  });
});

describe('POST /api/content-pages/source-classes (Quality CE-046)', () => {
  const DRAFT = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29';
  const ask = (body) =>
    fetch(`${baseUrl}/source-classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  beforeEach(() => {
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    draftRow = {
      brand_id: BRAND,
      body_html:
        '<p><a href="https://www.coffee-blog.example/best">a</a> ' +
        '<a href="https://coffee-blog.example/about">b</a> <a href="/ours">c</a></p>',
    };
    readSourceClasses.mockReset().mockResolvedValue({
      classes: [{ site: 'coffee-blog.example', kind: 'weak' }],
      limited: false,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reads only sites the draft links, by their address alone', async () => {
    const res = await ask({ draftId: DRAFT, sites: ['Coffee-Blog.example', 'elsewhere.example'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      classes: [{ site: 'coffee-blog.example', kind: 'weak' }],
      limited: false,
    });
    expect(readSourceClasses).toHaveBeenCalledWith({
      orgId: 'o1',
      draftId: DRAFT,
      sites: ['coffee-blog.example'],
    });
  });

  it('asks about no site whose every link the person kept', async () => {
    draftRow = {
      ...draftRow,
      kept_sources: ['https://www.coffee-blog.example/best', 'https://coffee-blog.example/about'],
    };
    await ask({ draftId: DRAFT, sites: ['coffee-blog.example'] });
    expect(readSourceClasses).toHaveBeenCalledWith(expect.objectContaining({ sites: [] }));
    // One link still not kept: asked about.
    draftRow = { ...draftRow, kept_sources: ['https://www.coffee-blog.example/best'] };
    await ask({ draftId: DRAFT, sites: ['coffee-blog.example'] });
    expect(readSourceClasses).toHaveBeenLastCalledWith(
      expect.objectContaining({ sites: ['coffee-blog.example'] }),
    );
  });

  it('is off before Quality’s phase 2, and says when the AI budget is spent', async () => {
    vi.stubEnv('CONTENT_QUALITY_PHASE', '1');
    expect((await ask({ draftId: DRAFT, sites: ['coffee-blog.example'] })).status).toBe(404);
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    readSourceClasses.mockRejectedValueOnce(new PlanLimitError('used up', 429));
    const res = await ask({ draftId: DRAFT, sites: ['coffee-blog.example'] });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('ai_budget');
  });

  it('says there is no plan, not a spent budget, once the plan has ended', async () => {
    readSourceClasses.mockRejectedValueOnce(new PlanLimitError('No plan', 402));
    const res = await ask({ draftId: DRAFT, sites: ['coffee-blog.example'] });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'No plan', code: 'no_subscription' });
  });

  it('refuses another workspace’s draft and a malformed ask', async () => {
    org = 'o2';
    expect((await ask({ draftId: DRAFT, sites: ['coffee-blog.example'] })).status).toBe(403);
    expect((await ask({ draftId: 'nope', sites: ['a.example'] })).status).toBe(400);
    expect((await ask({ draftId: DRAFT, sites: [] })).status).toBe(400);
    expect(readSourceClasses).not.toHaveBeenCalled();
  });
});

describe('POST /api/content-pages/claims (Quality CE-045)', () => {
  const DRAFT = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29';
  const ask = (body) =>
    fetch(`${baseUrl}/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  beforeEach(() => {
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    draftRow = {
      brand_id: BRAND,
      body_html: '<p>Ledgerly is the fastest app for teams like yours.</p>',
    };
    readDraftClaims.mockReset().mockResolvedValue({
      paragraphs: [
        {
          text: 'Ledgerly is the fastest app for teams like yours.',
          claims: [{ text: 'the fastest app', kind: 'superlative' }],
        },
      ],
      pending: 0,
      limited: false,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads the draft's own paragraphs as saved, leaving the one being written", async () => {
    const res = await ask({ draftId: DRAFT, skip: 'Ledgerly is the fastest' });
    expect(res.status).toBe(200);
    expect((await res.json()).paragraphs[0].claims).toEqual([
      { text: 'the fastest app', kind: 'superlative' },
    ]);
    expect(readDraftClaims).toHaveBeenCalledWith({
      orgId: 'o1',
      draftId: DRAFT,
      html: draftRow.body_html,
      skip: 'Ledgerly is the fastest',
    });
  });

  it('is off before Quality’s phase 2, and says when the AI budget is spent', async () => {
    vi.stubEnv('CONTENT_QUALITY_PHASE', '1');
    expect((await ask({ draftId: DRAFT })).status).toBe(404);
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    readDraftClaims.mockRejectedValueOnce(new PlanLimitError('used up', 429));
    const res = await ask({ draftId: DRAFT });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('ai_budget');
  });

  it('says there is no plan, not a spent budget, once the plan has ended', async () => {
    readDraftClaims.mockRejectedValueOnce(new PlanLimitError('No plan', 402));
    const res = await ask({ draftId: DRAFT });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'No plan', code: 'no_subscription' });
  });

  it('refuses another workspace’s draft and a malformed ask', async () => {
    org = 'o2';
    expect((await ask({ draftId: DRAFT })).status).toBe(403);
    expect((await ask({ draftId: 'nope' })).status).toBe(400);
    expect((await ask({ draftId: DRAFT, skip: 'x'.repeat(20001) })).status).toBe(400);
    expect(readDraftClaims).not.toHaveBeenCalled();
  });

  it('logs a failure without the request the provider sent: the page’s paragraphs', async () => {
    logError.mockClear();
    readDraftClaims.mockRejectedValueOnce(
      Object.assign(new Error('Bad Request'), {
        name: 'AI_APICallError',
        requestBodyValues: { prompt: 'Paragraphs:\n[1] the page’s own words' },
      }),
    );
    expect((await ask({ draftId: DRAFT })).status).toBe(500);
    expect(logError).toHaveBeenCalledWith(
      { err: expect.objectContaining({ name: 'AI_APICallError', message: 'Bad Request' }) },
      'content claims error',
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain('own words');
  });
});

describe('POST /api/content-pages/page-read (Quality CE-049)', () => {
  const DRAFT = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29';
  const ask = (body) =>
    fetch(`${baseUrl}/page-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  beforeEach(() => {
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    draftRow = {
      brand_id: BRAND,
      body_html: '<p>Our pack is waterproof.</p>',
      page_type: 'product_page',
    };
    readPage.mockReset().mockResolvedValue({
      spots: [],
      proofs: [{ claim: 'waterproof', block: 'Our pack is waterproof.', kind: 'certification' }],
      regulated: null,
      pending: false,
      limited: false,
      paused: false,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reads the page as saved, with its page type, the business type and the brand’s approved claims', async () => {
    calls = {};
    const res = await ask({ draftId: DRAFT });
    expect(res.status).toBe(200);
    expect((await res.json()).proofs[0].kind).toBe('certification');
    expect(readPage).toHaveBeenCalledWith({
      orgId: 'o1',
      draftId: DRAFT,
      html: draftRow.body_html,
      siteType: 'b2c',
      pageType: 'product_page',
      brandName: 'Northwind',
      facts: ['Bluesign certified'],
    });
    // The brand's approved claims still on its site, in one order.
    expect(calls.brand_facts).toEqual([
      ['eq', 'brand_id', BRAND],
      ['eq', 'kind', 'claim'],
      ['eq', 'status', 'approved'],
      ['is', 'gone_at', null],
      ['order', 'first_seen_at'],
      ['order', 'id'],
      ['limit', 10],
    ]);
  });

  it('is off before phase 2, and refuses a malformed ask or another workspace’s draft', async () => {
    vi.stubEnv('CONTENT_QUALITY_PHASE', '1');
    expect((await ask({ draftId: DRAFT })).status).toBe(404);
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    expect((await ask({ draftId: 'nope' })).status).toBe(400);
    org = 'o2';
    expect((await ask({ draftId: DRAFT })).status).toBe(403);
    draftRow = null;
    org = 'o1';
    expect((await ask({ draftId: DRAFT })).status).toBe(404);
    expect(readPage).not.toHaveBeenCalled();
  });

  it('logs a failure without the request the provider sent', async () => {
    logError.mockClear();
    readPage.mockRejectedValueOnce(
      Object.assign(new Error('Bad Request'), {
        name: 'AI_APICallError',
        requestBodyValues: { prompt: 'Page: [1] the page’s own words' },
      }),
    );
    expect((await ask({ draftId: DRAFT })).status).toBe(500);
    expect(JSON.stringify(logError.mock.calls)).not.toContain('own words');
  });
});
