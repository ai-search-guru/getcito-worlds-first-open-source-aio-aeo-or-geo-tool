import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for GET /api/audits/pages: the brand's audits read in
 * full (past PostgREST's 1000-row page), grouped into one row per page,
 * paged, and the open issues counted for the rows returned.
 */

let audits;
let signals;
let domains;
let signalQueries;
let inserted;
let updated;
let enforce;
let pagesFetched;
let auditsModule;
let server;
let baseUrl;

// A query builder that answers from the arrays above.
function query(table) {
  const filters = { eq: {}, in: {} };
  let range = null;
  let insertRows = null;
  let one = false;
  const builder = {
    insert: (rows) => {
      insertRows = Array.isArray(rows) ? rows : [rows];
      return builder;
    },
    select: () => builder,
    single: () => {
      one = true;
      return builder;
    },
    order: () => builder,
    update: (values) => {
      updated.push({ table, values });
      return builder;
    },
    eq: (col, val) => {
      filters.eq[col] = val;
      return builder;
    },
    in: (col, vals) => {
      filters.in[col] = vals;
      return builder;
    },
    lt: () => builder,
    gte: () => builder,
    range: (from, to) => {
      range = [from, to];
      return builder;
    },
    then: (resolve) => {
      let data = [];
      if (insertRows) {
        const rows = insertRows.map((r, i) => ({ id: `new-${inserted.length + i}`, ...r }));
        inserted.push(...rows);
        return resolve({ data: one ? rows[0] : rows, error: null });
      }
      if (table === 'site_audits' && filters.in.id) {
        data = audits.filter((a) => filters.in.id.includes(a.id));
      } else if (table === 'site_audits') {
        data = audits.filter(
          (a) =>
            a.brand_id === filters.eq.brand_id &&
            (!filters.eq.status || a.status === filters.eq.status) &&
            (!filters.in.page_key || filters.in.page_key.includes(a.page_key)),
        );
        if (range) data = data.slice(range[0], range[1] + 1);
      } else if (table === 'brand_domains') {
        data = domains;
      } else if (table === 'audit_signal_results') {
        signalQueries.push(filters.in.audit_id);
        data = signals.filter(
          (s) =>
            filters.in.audit_id.includes(s.audit_id) &&
            filters.in.status.includes(s.status) &&
            (!filters.in.category || filters.in.category.includes(s.category)),
        );
      }
      return resolve({ data, error: null });
    },
  };
  return builder;
}

async function startApp() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));
  vi.doMock('../lib/access.js', () => ({ assertBrandAccess: async () => ({ orgId: 'org-1' }) }));
  vi.doMock('../lib/planGuard.js', () => ({
    requireFeature: () => (req, res, next) => next(),
    enforceSiteAuditQuota: (...args) => enforce(...args),
    getSiteAuditQuotaStatus: vi.fn(),
    getOrgIdForUser: vi.fn(),
    PlanLimitError: class PlanLimitError extends Error {},
  }));
  // An audit job that never gets its page, so the queue's limit can be seen;
  // a /fail page fails at once, and a /ready page is read.
  vi.doMock('../lib/audit/context.js', async (importOriginal) => ({
    ...(await importOriginal()),
    buildAuditContext: (url) => {
      pagesFetched.push(url);
      if (url.includes('/fail')) return Promise.reject(new Error('blocked'));
      if (url.includes('/ready')) return Promise.resolve({ url });
      return new Promise(() => {});
    },
  }));
  vi.doMock('../lib/audit/engine.js', () => ({ runSignals: vi.fn() }));
  vi.doMock('../lib/audit/llmSignals.js', () => ({ evaluateLlmSignals: vi.fn() }));
  vi.doMock('../lib/audit/externalSignals.js', () => ({ evaluateBrandEntity: vi.fn() }));
  vi.doMock('../lib/audit/recommendations.js', () => ({
    brandFactsFor: vi.fn(),
    generateRecommendations: vi.fn(),
  }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { default: logger, logger };
  });

  auditsModule = await import('./audits.js');
  const router = auditsModule.default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/audits', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/audits`;
}

const audit = (id, url, day, score, status = 'completed') => ({
  id,
  brand_id: 'b1',
  url,
  final_url: status === 'completed' ? url : null,
  status,
  total_score: score,
  created_at: `2026-10-${String(day).padStart(2, '0')}T09:00:00Z`,
});

beforeEach(async () => {
  signalQueries = [];
  inserted = [];
  updated = [];
  pagesFetched = [];
  enforce = vi.fn(async () => ({ remaining: 10 }));
  domains = [{ domain: 'https://www.Acme.com/', is_primary: true }];
  audits = [
    audit('p2', 'https://acme.com/pricing', 14, '0.63'),
    audit('x1', 'https://other.com/', 13, '0.8'),
    audit('p1', 'https://acme.com/pricing/', 1, '0.58'),
    audit('f1', 'https://acme.com/broken', 1, null, 'failed'),
  ];
  signals = [
    { audit_id: 'p2', status: 'fail' },
    { audit_id: 'p2', status: 'warn' },
    { audit_id: 'p1', status: 'fail' },
  ];
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  vi.doUnmock('../config/supabase.js');
});

describe('GET /api/audits/pages', () => {
  it('returns one row per page with its issues, the total and the primary host', async () => {
    const res = await fetch(`${baseUrl}/pages?brandId=b1`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.primaryHost).toBe('acme.com');
    expect(body.pages.map((p) => [p.path, p.status, p.issues])).toEqual([
      ['/pricing', 'improving', 2],
      ['/', 'good', 0],
      ['/broken', 'failed', null],
    ]);
    expect(body.pages[0]).toMatchObject({ auditId: 'p2', score: 0.63, previousScore: 0.58 });
    // Top-level pages have no template (SA-007).
    expect(body.pages.map((p) => p.template)).toEqual([null, null, null]);
    // Issues are counted for the latest completed audit of each row only.
    expect(signalQueries).toEqual([['p2', 'x1']]);
  });

  it("names a primary-domain page's template", async () => {
    audits.push(audit('n1', 'https://acme.com/blog/milk-drinks', 20, '0.5'));
    audits.push(audit('n2', 'https://other.com/blog/x', 20, '0.5'));
    const body = await (await fetch(`${baseUrl}/pages?brandId=b1`)).json();
    const byPath = Object.fromEntries(body.pages.map((p) => [`${p.host}${p.path}`, p.template]));
    expect(byPath['acme.com/blog/milk-drinks']).toBe('/blog/*');
    expect(byPath['other.com/blog/x']).toBeNull();
  });

  it('pages over pages, not audits', async () => {
    const res = await fetch(`${baseUrl}/pages?brandId=b1&limit=1&offset=1`);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.pages.map((p) => p.host)).toEqual(['other.com']);
  });

  it('reads past the first 1000 audits', async () => {
    audits = Array.from({ length: 1200 }, (_, i) =>
      audit(`a${i}`, `https://acme.com/p${i % 600}`, 1, '0.5'),
    );
    const body = await (await fetch(`${baseUrl}/pages?brandId=b1&limit=1`)).json();
    expect(body.total).toBe(600);
    expect(body.pages[0].runCount).toBe(2);
  });

  it('counts issues in chunks that stay under the 1000-row page', async () => {
    audits = Array.from({ length: 45 }, (_, i) =>
      audit(`a${i}`, `https://acme.com/p${i}`, 1, '0.5'),
    );
    await fetch(`${baseUrl}/pages?brandId=b1&limit=45`);
    expect(signalQueries.map((ids) => ids.length)).toEqual([20, 20, 5]);
  });

  it('needs a brand', async () => {
    const res = await fetch(`${baseUrl}/pages`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/audits/bulk', () => {
  const post = (body) =>
    fetch(`${baseUrl}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const brandId = '33333333-3333-3333-3333-333333333333';

  it('checks the quota for every page at once, then starts them, repeat spellings once', async () => {
    const res = await post({
      brandId,
      urls: ['https://acme.com/pricing', 'https://www.acme.com/pricing/', 'https://acme.com/blog'],
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(enforce).toHaveBeenCalledWith('org-1', 2);
    expect(inserted.map((r) => [r.url, r.status, r.brand_id])).toEqual([
      ['https://acme.com/pricing', 'running', brandId],
      ['https://acme.com/blog', 'running', brandId],
    ]);
    expect(body.audits.map((a) => a.status)).toEqual(['running', 'running']);
  });

  it('starts none when the quota refuses them', async () => {
    const { PlanLimitError } = await import('../lib/planGuard.js');
    enforce = vi.fn(async () => {
      throw Object.assign(new PlanLimitError('These 2 audits need more than the 1 left'), {
        statusCode: 429,
      });
    });
    const res = await post({ brandId, urls: ['https://acme.com/a', 'https://acme.com/b'] });

    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('quota_exceeded');
    expect(inserted).toEqual([]);
  });

  it('runs a few at a time and keeps the rest waiting', async () => {
    const urls = Array.from({ length: 5 }, (_, i) => `https://acme.com/p${i}`);
    await post({ brandId, urls });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // All five are running rows; three fetch their page, two wait.
    expect(inserted).toHaveLength(5);
    expect(pagesFetched).toEqual(urls.slice(0, 3));
  });

  it('refuses a request without URLs, with too many, or with something that is not a URL', async () => {
    expect((await post({ brandId, urls: [] })).status).toBe(400);
    expect(
      (await post({ brandId, urls: Array.from({ length: 51 }, (_, i) => `https://a.com/${i}`) }))
        .status,
    ).toBe(400);
    expect((await post({ brandId, urls: ['not a url'] })).status).toBe(400);
    expect((await post({ urls: ['https://acme.com/'] })).status).toBe(400);
    expect(inserted).toEqual([]);
  });
});

describe('POST /api/audits', () => {
  it("stores whether the audit is partial, with the page's last AI verdicts on hand", async () => {
    const { runSignals } = await import('../lib/audit/engine.js');
    const { evaluateLlmSignals } = await import('../lib/audit/llmSignals.js');
    const { evaluateBrandEntity } = await import('../lib/audit/externalSignals.js');
    const { generateRecommendations } = await import('../lib/audit/recommendations.js');
    runSignals.mockResolvedValue([{ key: 'https', status: 'pass', score: 1, evidence: {} }]);
    evaluateLlmSignals.mockResolvedValue({
      results: [
        {
          key: 'direct-answer',
          status: 'na',
          score: null,
          evidence: { error: 'LLM evaluation unavailable' },
        },
      ],
      partial: true,
    });
    evaluateBrandEntity.mockResolvedValue({ key: 'brand-entity', status: 'na', score: null });
    generateRecommendations.mockResolvedValue([]);

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId: 'b1', url: 'https://acme.com/ready' }),
    });
    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(updated.some((u) => u.values.status === 'completed')).toBe(true);
    });

    expect(updated.find((u) => u.values.status === 'completed').values).toMatchObject({
      partial: true,
      total_score: 1,
    });
    expect(evaluateLlmSignals.mock.calls[0][1].lastVerdicts).toBeTypeOf('function');
  });
});

describe('startAutoAudits', () => {
  const brandId = '33333333-3333-3333-3333-333333333333';

  it("checks the whole quota as a run's, marks the audits auto and runs them in their own pool", async () => {
    const urls = ['https://acme.com/a', 'https://acme.com/b', 'https://acme.com/c'];
    const { auditIds } = await auditsModule.startAutoAudits(brandId, urls, 'org-1');

    expect(enforce).toHaveBeenCalledWith('org-1', 3, { source: 'auto' });
    expect(auditIds).toEqual(['new-0', 'new-1', 'new-2']);
    expect(inserted.map((r) => [r.url, r.source])).toEqual([
      ['https://acme.com/a', 'auto'],
      ['https://acme.com/b', 'auto'],
      ['https://acme.com/c', 'auto'],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Two at a time, and a user's bulk audit doesn't wait behind them.
    expect(pagesFetched).toEqual(urls.slice(0, 2));
    await fetch(`${baseUrl}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId, urls: ['https://acme.com/mine'] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pagesFetched).toEqual([...urls.slice(0, 2), 'https://acme.com/mine']);
    // A user's audit row keeps the column default.
    expect(inserted.at(-1).source).toBeUndefined();
  });

  it('resolves done once every audit has finished', async () => {
    const { done } = await auditsModule.startAutoAudits(
      brandId,
      ['https://acme.com/fail-1', 'https://acme.com/fail-2', 'https://acme.com/fail-3'],
      'org-1',
    );
    await expect(done).resolves.toBeDefined();
    expect(pagesFetched).toHaveLength(3);
  });
});

describe('GET /api/audits/overview', () => {
  it("adds up the primary domain's latest audits: score, change, categories and gaps", async () => {
    audits[0].category_scores = { authority: { score: 0.4 }, eeat: { score: 0.3 } };
    signals = [
      { audit_id: 'p2', status: 'fail', category: 'authority', signal_key: 'author-byline' },
      { audit_id: 'p2', status: 'warn', category: 'eeat', signal_key: 'press-mentions' },
      { audit_id: 'p2', status: 'fail', category: 'structure', signal_key: 'h1-quality' },
      // The older audit of the page doesn't count.
      { audit_id: 'p1', status: 'fail', category: 'eeat', signal_key: 'quotations' },
    ];
    const res = await fetch(`${baseUrl}/overview?brandId=b1`);
    const { overview } = await res.json();

    expect(res.status).toBe(200);
    expect(overview).toMatchObject({
      primaryHost: 'acme.com',
      // acme.com/pricing; other.com/ is another site; /broken never completed.
      pages: 1,
      otherPages: 1,
      siteScore: 0.63,
      siteScoreChange: 5,
      authority: 0.4,
      eeat: 0.3,
    });
    expect(overview.gaps.map((g) => [g.key, g.pages])).toEqual([
      ['author-byline', 1],
      ['press-mentions', 1],
    ]);
  });

  it('needs a brand', async () => {
    expect((await fetch(`${baseUrl}/overview`)).status).toBe(400);
  });
});
