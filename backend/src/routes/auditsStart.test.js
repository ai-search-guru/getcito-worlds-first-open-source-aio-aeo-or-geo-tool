import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * One running audit per page (00431): a start of a page with an audit
 * running gets that audit back with no new credit, whatever the spelling or
 * the timing; a page audited in the last minutes asks first; Audit again
 * (force) starts a new one.
 */

let audits;
let enforce;
let fetched;
let server;
let baseUrl;
let auditsModule;
let nextId;

const BRAND = '33333333-3333-3333-3333-333333333333';
const NOW = Date.now();
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

/** site_audits with 00431's index: one running audit per brand and page. */
function insertAudit(row) {
  const clash = audits.some(
    (a) => a.status === 'running' && a.brand_id === row.brand_id && a.page_key === row.page_key,
  );
  if (clash) return { code: '23505', message: 'duplicate key value' };
  audits.push({ id: `new-${(nextId += 1)}`, created_at: new Date().toISOString(), ...row });
  return null;
}

function query(table) {
  const filters = [];
  let op = 'select';
  let values = null;
  let one = false;
  const builder = {
    select: () => builder,
    insert: (rows) => {
      op = 'insert';
      values = rows;
      return builder;
    },
    update: (v) => {
      op = 'update';
      values = v;
      return builder;
    },
    eq: (col, val) => (filters.push((r) => r[col] === val), builder),
    in: (col, vals) => (filters.push((r) => vals.includes(r[col])), builder),
    lt: (col, val) => (filters.push((r) => r[col] < val), builder),
    gte: (col, val) => (filters.push((r) => r[col] >= val), builder),
    order: () => builder,
    limit: () => builder,
    single: () => ((one = true), builder),
    maybeSingle: () => ((one = true), builder),
    then: (resolve, reject) => {
      // A start is never answered in the same tick: two requests interleave.
      return Promise.resolve()
        .then(() => {
          const match = (r) => filters.every((f) => f(r));
          if (table !== 'site_audits') return { data: one ? null : [], error: null };
          if (op === 'insert') {
            const rows = Array.isArray(values) ? values : [values];
            // A multi-row insert is all or nothing, as in Postgres.
            const before = audits.length;
            for (const row of rows) {
              const error = insertAudit(row);
              if (error) {
                audits.length = before;
                return { data: null, error };
              }
            }
            const created = audits.slice(before);
            return { data: one ? created[0] : created, error: null };
          }
          if (op === 'update') {
            for (const r of audits.filter(match)) Object.assign(r, values);
            return { data: null, error: null };
          }
          const rows = audits.filter(match);
          return { data: one ? (rows[0] ?? null) : rows, error: null };
        })
        .then(resolve, reject);
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
  // An audit job that never gets its page: each start stays running, and
  // each job (each audit that can use a credit) reads its page once.
  vi.doMock('../lib/audit/context.js', async (importOriginal) => ({
    ...(await importOriginal()),
    buildAuditContext: (url) => {
      fetched.push(url);
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
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/audits', auditsModule.default);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/audits`;
}

beforeEach(async () => {
  audits = [];
  fetched = [];
  nextId = 0;
  enforce = vi.fn(async () => ({ remaining: 10 }));
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  vi.doUnmock('../config/supabase.js');
  vi.doUnmock('../lib/audit/context.js');
});

const post = (body, path = '') =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brandId: BRAND, ...body }),
  });

/** The audits started: each one's job reads its page, and is charged when it completes. */
async function jobsStarted() {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return fetched.length;
}

describe('POST /api/audits: one running audit per page', () => {
  it('starts one audit and uses one credit for two requests at once', async () => {
    const [a, b] = await Promise.all([
      post({ url: 'https://acme.com/pricing' }),
      post({ url: 'https://acme.com/pricing' }),
    ]);
    const [first, second] = [await a.json(), await b.json()];

    expect([a.status, b.status]).toEqual([202, 202]);
    expect(first.audit.id).toBe(second.audit.id);
    expect(audits).toHaveLength(1);
    expect(await jobsStarted()).toBe(1);
  });

  it('reads /pricing, /pricing/ and ?utm= as one page: one audit, one credit', async () => {
    const ids = [];
    for (const url of [
      'https://acme.com/pricing',
      'https://www.acme.com/pricing/',
      'https://acme.com/pricing?utm_source=newsletter',
    ]) {
      const res = await post({ url });
      expect(res.status).toBe(202);
      ids.push((await res.json()).audit.id);
    }

    expect(new Set(ids).size).toBe(1);
    expect(audits.map((a) => a.page_key)).toEqual(['acme.com/pricing']);
    expect(await jobsStarted()).toBe(1);
  });

  it('asks first about a page audited in the last minutes, and starts nothing', async () => {
    audits.push({
      id: 'done-1',
      brand_id: BRAND,
      url: 'https://acme.com/pricing',
      page_key: 'acme.com/pricing',
      status: 'completed',
      created_at: minutesAgo(5),
      completed_at: minutesAgo(4),
    });
    const res = await post({ url: 'https://acme.com/pricing/' });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      error: 'recently_audited',
      recent: { auditId: 'done-1', finishedAt: minutesAgo(4) },
    });
    expect(audits).toHaveLength(1);
    expect(enforce).not.toHaveBeenCalled();
  });

  it('starts a new audit when asked to audit again, or once the minutes have passed', async () => {
    audits.push({
      id: 'done-1',
      brand_id: BRAND,
      url: 'https://acme.com/pricing',
      page_key: 'acme.com/pricing',
      status: 'completed',
      created_at: minutesAgo(5),
      completed_at: minutesAgo(4),
    });
    const again = await post({ url: 'https://acme.com/pricing', force: true });
    expect(again.status).toBe(202);
    expect(audits).toHaveLength(2);

    audits = [{ ...audits[0], completed_at: minutesAgo(11) }];
    expect((await post({ url: 'https://acme.com/pricing' })).status).toBe(202);
  });

  it('frees a page whose run was cut short by a restart', async () => {
    audits.push({
      id: 'stuck',
      brand_id: BRAND,
      url: 'https://acme.com/pricing',
      page_key: 'acme.com/pricing',
      status: 'running',
      created_at: minutesAgo(3 * 60),
    });
    const res = await post({ url: 'https://acme.com/pricing' });

    expect(res.status).toBe(202);
    expect((await res.json()).audit.id).not.toBe('stuck');
    expect(audits.find((a) => a.id === 'stuck').status).toBe('failed');
  });
});

describe('POST /api/audits/bulk: one running audit per page', () => {
  it('starts only the pages with no audit running or just finished, and says which', async () => {
    audits.push(
      {
        id: 'running-1',
        brand_id: BRAND,
        url: 'https://acme.com/a',
        page_key: 'acme.com/a',
        status: 'running',
        created_at: minutesAgo(1),
      },
      {
        id: 'done-1',
        brand_id: BRAND,
        url: 'https://acme.com/b',
        page_key: 'acme.com/b',
        status: 'completed',
        created_at: minutesAgo(3),
        completed_at: minutesAgo(2),
      },
    );
    const res = await post(
      { urls: ['https://acme.com/a/', 'https://acme.com/b', 'https://acme.com/c'] },
      '/bulk',
    );
    const body = await res.json();

    expect(res.status).toBe(202);
    // The quota counts the one page started.
    expect(enforce).toHaveBeenCalledWith('org-1', 1);
    expect(body.audits.map((a) => a.url)).toEqual(['https://acme.com/c', 'https://acme.com/a']);
    expect(body.recent).toEqual([
      { url: 'https://acme.com/b', auditId: 'done-1', finishedAt: minutesAgo(2) },
    ]);

    const again = await post({ urls: ['https://acme.com/b'], force: true }, '/bulk');
    expect((await again.json()).audits.map((a) => a.url)).toEqual(['https://acme.com/b']);
  });

  it('checks no quota when every page is already running', async () => {
    audits.push({
      id: 'running-1',
      brand_id: BRAND,
      url: 'https://acme.com/a',
      page_key: 'acme.com/a',
      status: 'running',
      created_at: minutesAgo(1),
    });
    const res = await post({ urls: ['https://acme.com/a'] }, '/bulk');

    expect(res.status).toBe(202);
    expect(enforce).not.toHaveBeenCalled();
    expect((await res.json()).audits.map((a) => a.id)).toEqual(['running-1']);
  });
});

describe('startAutoAudits', () => {
  it('leaves out a page with an audit running, with no credit for it', async () => {
    audits.push({
      id: 'running-1',
      brand_id: BRAND,
      url: 'https://acme.com/a',
      page_key: 'acme.com/a',
      status: 'running',
      created_at: minutesAgo(1),
    });
    const { auditIds } = await auditsModule.startAutoAudits(
      BRAND,
      ['https://acme.com/a', 'https://acme.com/b'],
      'org-1',
    );

    expect(enforce).toHaveBeenCalledWith('org-1', 1, { source: 'auto' });
    expect(auditIds).toHaveLength(1);
    expect(audits.find((a) => a.id === auditIds[0]).url).toBe('https://acme.com/b');
  });
});
