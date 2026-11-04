import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Who may change Content Opportunities (2026-10-29): any member records an
 * opportunity's progress; dismissing one, bringing a dismissed one back, any
 * bulk change and deleting are for admins and managers, as the database's
 * rules on content_opportunities. A refused call writes nothing.
 */

const assertOpportunityAccess = vi.fn();
const assertOpportunitiesAccess = vi.fn();
let rows;
let writes;
let server;
let baseUrl;

/** A query on `table`: every filter returns it, and it reads as the table's rows. */
function query(table) {
  const answer = () => ({ data: rows[table] ?? null, error: null });
  const chain = new Proxy(
    {},
    {
      get: (_t, op) => {
        if (op === 'then')
          return (resolve, reject) => Promise.resolve(answer()).then(resolve, reject);
        if (op === 'maybeSingle' || op === 'single') return async () => answer();
        if (op === 'update' || op === 'delete') {
          return (values) => {
            writes.push({ table, op, values });
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
}

async function startApp() {
  vi.resetModules();
  // As the other content route tests: the jobs and workers aren't loaded.
  vi.doMock('../lib/planGuard.js', () => ({
    PlanLimitError: class PlanLimitError extends Error {},
    requireFeature: () => (req, res, next) => next(),
    enforceBriefQuota: vi.fn(),
    getBriefQuotaStatus: vi.fn(),
    getContentUsage: vi.fn(),
    getOpportunityRequestAllowance: vi.fn(),
    getOrgIdForUser: vi.fn(),
  }));
  vi.doMock('../lib/jobManager.js', () => ({ createJob: vi.fn(), getJob: vi.fn() }));
  vi.doMock('../lib/jobRunner.js', () => ({ runContentJob: vi.fn() }));
  // The real role check, on the profile below; the organization checks pass.
  vi.doMock('../lib/access.js', async (importOriginal) => ({
    ...(await importOriginal()),
    assertOpportunityAccess,
    assertOpportunitiesAccess,
  }));
  vi.doMock('../config/supabase.js', () => ({ default: { from: (table) => query(table) } }));
  vi.doMock('../lib/promptClusters.js', () => ({ loadClusters: vi.fn() }));
  vi.doMock('../lib/action-center/fromOpportunity.js', () => ({
    OPPORTUNITY_ACTION_KIND: 'content_opportunity',
    sendToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });

  const { default: router } = await import('./content.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/content', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content`;
}

const send = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const OPPORTUNITY = {
  id: 'o1',
  brand_id: 'b1',
  prompt_id: null,
  title: 'Pricing comparison',
  description: 'Compare the plans.',
  type: 'comparison',
  impact: 'high',
  opportunity_score: '0.8',
  source_data: {},
  brief: null,
  status: 'new',
  updated_at: '2026-10-27T08:00:00Z',
};

/** The caller is `role`; the opportunity has `status` now. */
function given(role, status = 'new') {
  rows.profiles = { role };
  assertOpportunityAccess.mockResolvedValue({ ...OPPORTUNITY, status });
  rows.content_opportunities = { ...OPPORTUNITY, status };
}

const changed = () => writes.filter((w) => w.table === 'content_opportunities');

beforeEach(async () => {
  vi.clearAllMocks();
  rows = { competitors: [] };
  writes = [];
  assertOpportunitiesAccess.mockResolvedValue([{ id: 'o1', brand_id: 'b1' }]);
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('PATCH /api/content/:id/status', () => {
  it("records an analyst's progress", async () => {
    given('analyst');
    const res = await send('PATCH', '/o1/status', { status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(changed()).toHaveLength(1);
  });

  it('refuses an analyst a dismissal, without a write', async () => {
    given('analyst');
    const res = await send('PATCH', '/o1/status', { status: 'dismissed', reason: 'not_relevant' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      details: 'Only admins and managers can dismiss an opportunity or bring one back.',
    });
    expect(changed()).toEqual([]);
  });

  it('refuses an agency partner bringing a dismissed one back', async () => {
    given('agency_partner', 'dismissed');
    const res = await send('PATCH', '/o1/status', { status: 'new' });
    expect(res.status).toBe(403);
    expect(changed()).toEqual([]);
  });

  it('lets a manager dismiss one', async () => {
    given('manager');
    const res = await send('PATCH', '/o1/status', { status: 'dismissed' });
    expect(res.status).toBe(200);
    expect(changed()[0].values).toMatchObject({ status: 'dismissed' });
  });
});

describe('POST /api/content/bulk/status and /bulk/delete', () => {
  it('refuses an analyst a bulk change, even to done', async () => {
    given('analyst');
    const res = await send('POST', '/bulk/status', { ids: ['o1'], status: 'done' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      details: 'Only admins and managers can change opportunities in bulk.',
    });
    expect(changed()).toEqual([]);
  });

  it('refuses an analyst deleting, without a write', async () => {
    given('analyst');
    const res = await send('POST', '/bulk/delete', { ids: ['o1'] });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      details: 'Only admins and managers can delete opportunities.',
    });
    expect(changed()).toEqual([]);
  });

  it('lets an admin change and delete in bulk', async () => {
    given('admin');
    rows.content_opportunities = [{ id: 'o1' }];
    expect((await send('POST', '/bulk/status', { ids: ['o1'], status: 'done' })).status).toBe(200);
    expect((await send('POST', '/bulk/delete', { ids: ['o1'] })).status).toBe(200);
    expect(changed().map((w) => w.op)).toEqual(['update', 'delete']);
  });

  it('says another organization’s opportunities aren’t in the workspace before the role', async () => {
    given('analyst');
    assertOpportunitiesAccess.mockRejectedValue(
      Object.assign(new Error("This brand isn't in your workspace"), { status: 403 }),
    );
    const res = await send('POST', '/bulk/delete', { ids: ['o1'] });
    expect(await res.json()).toMatchObject({ details: "This brand isn't in your workspace" });
  });
});
