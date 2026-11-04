import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for SA-006: GET/PUT /api/audits/settings (the org's
 * auto-audit switch and e-mail, the brand's exclude patterns and pinned
 * pages) and GET /api/audits/auto-runs/latest (the in-app notice).
 */

let tables;
let writes;
let quota;
const readSiteTrust = vi.fn();
const isOrgActive = vi.fn();
const getSiteAuditQuotaStatus = vi.fn(async () => quota);
const getOrgIdForUser = vi.fn(async () => 'org-1');
const assertAllBrands = vi.fn(async () => ({ orgId: 'org-1' }));
let server;
let baseUrl;

function query(table) {
  const filters = {};
  let write = null;
  let head = false;
  const builder = {
    select: (_cols, opts) => {
      head = opts?.head ?? false;
      return builder;
    },
    eq: (col, val) => {
      filters[col] = val;
      return builder;
    },
    in: (col, vals) => {
      filters[col] = vals;
      return builder;
    },
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => {
      builder.one = true;
      return builder;
    },
    maybeSingle: () => {
      builder.one = true;
      return builder;
    },
    upsert: (rows, opts) => {
      write = { op: 'upsert', rows, opts };
      return builder;
    },
    then: (resolve) => {
      if (write) {
        writes.push({ table, ...write });
        return resolve({ data: null, error: null });
      }
      const matches = (row) =>
        Object.entries(filters).every(([col, val]) =>
          Array.isArray(val) ? val.includes(row[col]) : row[col] === val,
        );
      const rows = (tables[table] ?? []).filter(matches);
      if (head) return resolve({ count: rows.length, error: null });
      return resolve({ data: builder.one ? (rows[0] ?? null) : rows, error: null });
    },
  };
  return builder;
}

async function startApp() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));
  vi.doMock('../lib/access.js', () => ({
    assertBrandAccess: async () => ({ orgId: 'org-1' }),
    assertAllBrands,
  }));
  vi.doMock('../lib/planGuard.js', () => ({
    requireFeature: () => (req, res, next) => next(),
    enforceSiteAuditQuota: vi.fn(),
    getSiteAuditQuotaStatus,
    getOrgIdForUser,
    PlanLimitError: class PlanLimitError extends Error {},
  }));
  vi.doMock('../lib/audit/context.js', () => ({ buildAuditContext: vi.fn() }));
  vi.doMock('../lib/audit/engine.js', () => ({ runSignals: vi.fn() }));
  vi.doMock('../lib/audit/llmSignals.js', () => ({ evaluateLlmSignals: vi.fn() }));
  vi.doMock('../lib/audit/externalSignals.js', () => ({ evaluateBrandEntity: vi.fn() }));
  vi.doMock('../lib/audit/recommendations.js', () => ({
    brandFactsFor: vi.fn(),
    generateRecommendations: vi.fn(),
  }));
  vi.doMock('../lib/siteTrust.js', () => ({ readSiteTrust }));
  vi.doMock('../lib/activeSubscriptions.js', () => ({ isOrgActive }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { default: logger, logger };
  });

  const { default: router } = await import('./audits.js');
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

const brandId = '33333333-3333-3333-3333-333333333333';
const otherBrand = '44444444-4444-4444-4444-444444444444';

beforeEach(async () => {
  writes = [];
  getSiteAuditQuotaStatus.mockClear();
  assertAllBrands.mockReset().mockResolvedValue({ orgId: 'org-1' });
  isOrgActive.mockReset().mockResolvedValue(true);
  readSiteTrust.mockReset().mockResolvedValue({
    checks: { about: { ok: true, url: 'https://acme.com/about' } },
    score: 1,
    complete: false,
    checkedAt: '2026-10-23T12:00:00.000Z',
  });
  quota = {
    used: 10,
    running: 0,
    limit: 100,
    remaining: 70,
    auto: { enabled: true, setting: null, emailAfterRun: false, perRun: 5 },
  };
  tables = {
    profiles: [{ id: 'u1', role: 'admin' }],
    site_audit_brand_settings: [{ brand_id: brandId, exclude_patterns: ['/careers/*'] }],
    site_audit_page_prefs: [
      {
        brand_id: brandId,
        page_key: 'acme.com/about',
        url: 'https://acme.com/about',
        state: 'pinned',
      },
      {
        brand_id: brandId,
        page_key: 'acme.com/old',
        url: 'https://acme.com/old',
        state: 'excluded',
      },
    ],
    site_audit_auto_runs: [],
    site_audits: [],
    audit_signal_results: [],
  };
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const mod of [
    '../config/supabase.js',
    '../lib/access.js',
    '../lib/planGuard.js',
    '../lib/audit/context.js',
    '../lib/audit/engine.js',
    '../lib/audit/llmSignals.js',
    '../lib/audit/externalSignals.js',
    '../lib/audit/recommendations.js',
    '../lib/logger.js',
  ]) {
    vi.doUnmock(mod);
  }
});

const put = (body) =>
  fetch(`${baseUrl}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/audits/settings', () => {
  it("returns the org's auto-audit and the brand's patterns and pinned pages", async () => {
    const res = await fetch(`${baseUrl}/settings?brandId=${brandId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).settings).toEqual({
      autoAudit: { enabled: true, setting: null, perRun: 5, limit: 100 },
      emailAfterRun: false,
      excludePatterns: ['/careers/*'],
      pinned: [{ key: 'acme.com/about', url: 'https://acme.com/about' }],
    });
  });

  it('reads what is kept once the plan has ended: auto-audit off at a limit of 0', async () => {
    // As plan-guard answers a read without an active plan (readOnly).
    quota = {
      used: 10,
      running: 0,
      limit: 0,
      remaining: 0,
      noPlan: true,
      auto: { enabled: false, setting: true, emailAfterRun: true, perRun: 0 },
    };
    const res = await fetch(`${baseUrl}/settings?brandId=${brandId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).settings).toEqual({
      autoAudit: { enabled: false, setting: true, perRun: 0, limit: 0 },
      emailAfterRun: true,
      excludePatterns: ['/careers/*'],
      pinned: [{ key: 'acme.com/about', url: 'https://acme.com/about' }],
    });
    expect(getSiteAuditQuotaStatus).toHaveBeenCalledWith('org-1', { readOnly: true });
  });
});

describe('GET /api/audits/quota', () => {
  it('reads the quota as a read, so a plan that ended answers 200, not 402', async () => {
    quota = { used: 3, running: 0, limit: 0, remaining: 0, noPlan: true };
    const res = await fetch(`${baseUrl}/quota`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, quota });
    expect(getSiteAuditQuotaStatus).toHaveBeenCalledWith('org-1', { readOnly: true });
  });

  it('reads nothing without an organization', async () => {
    getOrgIdForUser.mockResolvedValueOnce(null);
    const res = await fetch(`${baseUrl}/quota`);
    expect(res.status).toBe(400);
    expect(getSiteAuditQuotaStatus).not.toHaveBeenCalled();
  });
});

describe('PUT /api/audits/settings', () => {
  it('saves the switch and e-mail for the org, and the patterns for the brand', async () => {
    const res = await put({
      brandId,
      autoAudit: false,
      emailAfterRun: true,
      excludePatterns: ['/Legal/*', ' /tag/ ', '/legal/*'],
    });
    expect(res.status).toBe(200);
    expect(writes).toEqual([
      expect.objectContaining({
        table: 'site_audit_settings',
        rows: expect.objectContaining({
          organization_id: 'org-1',
          auto_audit: false,
          email_after_run: true,
          updated_by: 'u1',
        }),
        opts: { onConflict: 'organization_id' },
      }),
      expect.objectContaining({
        table: 'site_audit_brand_settings',
        rows: expect.objectContaining({
          brand_id: brandId,
          exclude_patterns: ['/legal/*', '/tag'],
        }),
        opts: { onConflict: 'brand_id' },
      }),
    ]);
  });

  it('writes only what it was sent, and null puts the plan default back', async () => {
    await put({ brandId, autoAudit: null });
    expect(writes).toHaveLength(1);
    expect(writes[0].rows).toEqual({
      organization_id: 'org-1',
      auto_audit: null,
      updated_by: 'u1',
      updated_at: expect.any(String),
    });
  });

  it('refuses a pattern that is not a path, and a member who is not an admin or manager', async () => {
    let res = await put({ brandId, excludePatterns: ['legal/*'] });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe(
      '"legal/*" isn\'t a page path. Start it with /, as in /legal/*.',
    );

    tables.profiles = [{ id: 'u1', role: 'viewer' }];
    res = await put({ brandId, autoAudit: false });
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });

  it("keeps the organization's switch and e-mail to people with All brands; their brand's patterns are anyone's with the brand", async () => {
    const refusal = Object.assign(new Error("You don't have access to this brand"), {
      status: 403,
      code: 'no_brand_access',
    });
    assertAllBrands.mockRejectedValue(refusal);

    for (const change of [{ autoAudit: false }, { emailAfterRun: true }]) {
      const res = await put({ brandId, ...change, excludePatterns: ['/legal/*'] });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        success: false,
        message: "You don't have access to this brand",
        code: 'no_brand_access',
      });
    }
    expect(writes).toEqual([]);

    const res = await put({ brandId, excludePatterns: ['/legal/*'] });
    expect(res.status).toBe(200);
    expect(writes).toEqual([expect.objectContaining({ table: 'site_audit_brand_settings' })]);
  });
});

describe('GET /api/audits/auto-runs/latest', () => {
  const run = (id, auditIds, startedAt, status = 'completed') => ({
    id,
    organization_id: 'org-1',
    run_day: 7,
    status,
    audit_ids: auditIds,
    started_at: startedAt,
    finished_at: status === 'completed' ? startedAt : null,
  });

  it("sums up the latest run that audited this brand's pages", async () => {
    // Newest first, as the route asks: the newest run audited the other brand only.
    tables.site_audit_auto_runs = [
      run('r3', ['b1'], '2026-10-14T06:00:00Z'),
      run('r2', ['a1', 'a2', 'a3', 'b2'], '2026-10-07T06:00:00Z'),
    ];
    tables.site_audits = [
      { id: 'a1', brand_id: brandId, status: 'completed' },
      { id: 'a2', brand_id: brandId, status: 'completed' },
      { id: 'a3', brand_id: brandId, status: 'running' },
      { id: 'b1', brand_id: otherBrand, status: 'completed' },
      { id: 'b2', brand_id: otherBrand, status: 'completed' },
    ];
    tables.audit_signal_results = [
      { audit_id: 'a1', status: 'fail' },
      { audit_id: 'a2', status: 'fail' },
      { audit_id: 'b2', status: 'fail' },
    ];

    const res = await fetch(`${baseUrl}/auto-runs/latest?brandId=${brandId}`);
    expect((await res.json()).run).toEqual({
      id: 'r2',
      day: 7,
      status: 'completed',
      startedAt: '2026-10-07T06:00:00Z',
      finishedAt: '2026-10-07T06:00:00Z',
      pages: 3,
      completed: 2,
      running: 1,
      criticalIssues: 2,
    });
  });

  it('is null when no recent run audited the brand', async () => {
    const res = await fetch(`${baseUrl}/auto-runs/latest?brandId=${brandId}`);
    expect((await res.json()).run).toBeNull();
  });
});

describe('GET /api/audits/site-trust', () => {
  it("answers with the brand's site trust, and reads it again when asked", async () => {
    let res = await fetch(`${baseUrl}/site-trust?brandId=${brandId}`);
    expect(res.status).toBe(200);
    // complete: whether the site answered all of it; false, the card says it checks again soon.
    await expect(res.json()).resolves.toEqual({
      success: true,
      checks: { about: { ok: true, url: 'https://acme.com/about' } },
      score: 1,
      complete: false,
      checkedAt: '2026-10-23T12:00:00.000Z',
    });
    expect(readSiteTrust).toHaveBeenLastCalledWith(brandId, { refresh: false, keptOnly: false });
    res = await fetch(`${baseUrl}/site-trust?brandId=${brandId}&refresh=1`);
    expect(readSiteTrust).toHaveBeenLastCalledWith(brandId, { refresh: true, keptOnly: false });
    expect(isOrgActive).toHaveBeenCalledWith('org-1');
  });

  it('answers only the kept read once the plan has ended, and 402 when none is kept', async () => {
    isOrgActive.mockResolvedValue(false);
    let res = await fetch(`${baseUrl}/site-trust?brandId=${brandId}&refresh=1`);
    expect(res.status).toBe(200);
    expect(readSiteTrust).toHaveBeenLastCalledWith(brandId, { refresh: true, keptOnly: true });

    readSiteTrust.mockResolvedValueOnce(null);
    res = await fetch(`${baseUrl}/site-trust?brandId=${brandId}`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: 'plan_limit',
      code: 'subscription_inactive',
    });
  });

  it('wants a brand id', async () => {
    const res = await fetch(`${baseUrl}/site-trust?brandId=nope`);
    expect(res.status).toBe(400);
    expect(readSiteTrust).not.toHaveBeenCalled();
  });
});
