import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Read-only once the plan has ended (2026-10-27): the reads that cost
 * nothing take `readOnly`, and an organization without an active plan then
 * reads as the plan it was on with every allowance 0 and `noPlan: true`, so
 * what it stored still comes back instead of a 402. Without `readOnly`, as
 * on every write, it is still refused. requireFeature does the same for a
 * route given `readOnly`, against the features of the plan it was on.
 */

let org;
let counts;
let settings;
let improveRows;
let reads;

function query(table) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => builder,
    maybeSingle: () => builder,
    then: (resolve) => {
      reads.push(table);
      if (table === 'organizations') return resolve({ data: org, error: null });
      if (table === 'profiles') return resolve({ data: { organization_id: 'o1' }, error: null });
      if (table === 'site_audit_settings') return resolve({ data: settings, error: null });
      if (table === 'site_audit_auto_runs') return resolve({ data: [], error: null });
      if (table === 'prompt_improve_usage') return resolve({ data: improveRows, error: null });
      return resolve({ count: counts[table] ?? 0, data: null, error: null });
    },
  };
  return builder;
}

const ended = { plan: 'growth', subscription_status: 'canceled', plan_overrides: null };
const active = {
  plan: 'growth',
  subscription_status: 'active',
  plan_overrides: null,
  subscription_ends_at: '2026-11-20T09:00:00Z',
};

let guard;

beforeEach(async () => {
  vi.resetModules();
  process.env.IS_CLOUD = 'true';
  org = ended;
  counts = { volume_usage: 3, brief_usage: 4, opportunity_usage: 2, site_audit_usage: 7 };
  settings = { auto_audit: true, email_after_run: true };
  improveRows = [{ cost_usd: '0.4', feature: 'improve' }];
  reads = [];
  vi.doMock('../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  guard = await import('./planGuard.js');
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.IS_CLOUD;
  vi.doUnmock('../config/supabase.js');
});

describe('a read without an active plan', () => {
  it('reads the volume quota as nothing left, with what was used', async () => {
    expect(await guard.getVolumeQuotaStatus('u1', { readOnly: true })).toEqual({
      used: 3,
      limit: 0,
      remaining: 0,
      noPlan: true,
    });
  });

  it('reads the content counts as nothing left, under the plan it was on', async () => {
    const usage = await guard.getContentUsage('o1', { readOnly: true });
    expect(usage).toMatchObject({
      plan: 'growth',
      planName: 'Growth',
      noPlan: true,
      opportunities: { used: 2, limit: 0, remaining: 0, perRequest: 0, noPlan: true },
      briefs: { used: 4, limit: 0, remaining: 0, noPlan: true },
    });
    // Without a subscription, the calendar month.
    expect(usage.periodStart.slice(0, 10)).toBe('2026-10-01');
    expect(await guard.getBriefQuotaStatus('o1', { readOnly: true })).toEqual({
      used: 4,
      limit: 0,
      remaining: 0,
      noPlan: true,
    });
  });

  it('reads Site Audit as a limit of 0 with auto-audit off, keeping the settings', async () => {
    const quota = await guard.getSiteAuditQuotaStatus('o1', { readOnly: true });
    expect(quota).toMatchObject({ used: 7, limit: 0, remaining: 0, noPlan: true });
    // The org's own choice and e-mail stay; no run is due or kept back.
    expect(quota.auto).toMatchObject({
      enabled: false,
      setting: true,
      emailAfterRun: true,
      perRun: 0,
      reserved: 0,
      nextRun: null,
      due: null,
    });
  });

  it("reads Improve's budget as spent", async () => {
    expect(await guard.getImproveQuotaStatus('o1', 'm1', { readOnly: true })).toMatchObject({
      unlimited: false,
      budgetUsd: 0,
      remainingUsd: 0,
      generationsLeft: 0,
      percentLeft: 0,
      trial: false,
      noPlan: true,
    });
  });

  it('reads the AI-bot caps as 0', async () => {
    expect(await guard.getBotCaps('o1', { readOnly: true })).toEqual({
      cap: 0,
      rawCap: 0,
      noPlan: true,
    });
  });

  it('reads an unlimited plan that ended as 0, not unlimited', async () => {
    org = {
      plan: 'enterprise',
      subscription_status: 'canceled',
      plan_overrides: { maxSiteAudits: 900 },
    };
    expect(await guard.getBriefQuotaStatus('o1', { readOnly: true })).toMatchObject({
      limit: 0,
      remaining: 0,
    });
    expect(await guard.getSiteAuditQuotaStatus('o1', { readOnly: true })).toMatchObject({
      limit: 0,
      noPlan: true,
    });
  });

  it('reads a limit an override set as text as 0 too', async () => {
    org = {
      plan: 'enterprise',
      subscription_status: 'canceled',
      plan_overrides: { maxSiteAudits: '1000', maxBriefGenerations: '50' },
    };
    expect(await guard.getSiteAuditQuotaStatus('o1', { readOnly: true })).toMatchObject({
      limit: 0,
      remaining: 0,
    });
    expect(await guard.getBriefQuotaStatus('o1', { readOnly: true })).toMatchObject({
      limit: 0,
      remaining: 0,
    });
  });

  it('is refused without the organization’s row, readOnly or not', async () => {
    org = null;
    const refused = { name: 'PlanLimitError', statusCode: 402 };
    await expect(guard.getBriefQuotaStatus('o1', { readOnly: true })).rejects.toMatchObject(
      refused,
    );
    await expect(guard.getSiteAuditQuotaStatus('o1', { readOnly: true })).rejects.toMatchObject(
      refused,
    );
    await expect(guard.getBotCaps('o1', { readOnly: true })).rejects.toMatchObject(refused);
  });

  it('is still refused without readOnly, as every write is', async () => {
    const refused = { name: 'PlanLimitError', statusCode: 402 };
    await expect(guard.getVolumeQuotaStatus('u1')).rejects.toMatchObject(refused);
    await expect(guard.getContentUsage('o1')).rejects.toMatchObject(refused);
    await expect(guard.getSiteAuditQuotaStatus('o1')).rejects.toMatchObject(refused);
    await expect(guard.getImproveQuotaStatus('o1', 'm1')).rejects.toMatchObject(refused);
    await expect(guard.getBotEventCap('o1')).rejects.toMatchObject(refused);
    await expect(guard.enforceBriefQuota('o1')).rejects.toMatchObject(refused);
  });
});

describe('a read on an active plan', () => {
  it('reads the same with or without readOnly, and has no noPlan', async () => {
    org = active;
    settings = { auto_audit: null, email_after_run: false };
    const pairs = [
      [
        () => guard.getVolumeQuotaStatus('u1'),
        () => guard.getVolumeQuotaStatus('u1', { readOnly: true }),
      ],
      [() => guard.getContentUsage('o1'), () => guard.getContentUsage('o1', { readOnly: true })],
      [
        () => guard.getSiteAuditQuotaStatus('o1'),
        () => guard.getSiteAuditQuotaStatus('o1', { readOnly: true }),
      ],
      [
        () => guard.getImproveQuotaStatus('o1', 'm1'),
        () => guard.getImproveQuotaStatus('o1', 'm1', { readOnly: true }),
      ],
    ];
    for (const [plain, readOnly] of pairs) {
      const answer = await plain();
      expect(await readOnly()).toEqual(answer);
      expect(answer).not.toHaveProperty('noPlan');
    }
    expect(await guard.getBotCaps('o1', { readOnly: true })).toEqual({
      cap: 2_000_000,
      rawCap: 20_000_000,
    });
    expect((await guard.getContentUsage('o1')).briefs).toEqual({
      used: 4,
      limit: 50,
      remaining: 46,
    });
  });
});

describe('self-hosted', () => {
  it('reads unlimited without looking at the organization', async () => {
    process.env.IS_CLOUD = 'false';
    expect(await guard.getBriefQuotaStatus('o1', { readOnly: true })).toEqual({
      used: 0,
      limit: -1,
      remaining: -1,
    });
    expect(await guard.getBotCaps('o1', { readOnly: true })).toEqual({ cap: -1, rawCap: -1 });
    expect(reads).not.toContain('organizations');
  });
});

describe('requireFeature', () => {
  async function call(method, feature, options) {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    const next = vi.fn();
    await guard.requireFeature(feature, options)({ method, user: { id: 'u1' } }, res, next);
    return { res, next };
  }

  it("lets a readOnly route through on the plan it was on, so what's kept comes back", async () => {
    for (const feature of ['prompt_improve', 'prompt_volumes', 'content_optimization']) {
      const { res, next } = await call('GET', feature, { readOnly: true });
      expect(next, feature).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('refuses a route not given readOnly with 402, a GET too: never by its method', async () => {
    for (const method of ['GET', 'HEAD', 'POST', 'DELETE']) {
      const { res, next } = await call(method, 'prompt_improve');
      expect(next, method).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
    }
  });

  it('still refuses a feature that plan never had', async () => {
    const { res, next } = await call('GET', 'sso_saml', { readOnly: true });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('refuses a readOnly route without the organization’s row', async () => {
    org = null;
    const { res, next } = await call('GET', 'prompt_improve', { readOnly: true });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
  });

  it('is unchanged on an active plan', async () => {
    org = active;
    expect((await call('GET', 'prompt_improve')).next).toHaveBeenCalledOnce();
    expect((await call('GET', 'prompt_improve', { readOnly: true })).next).toHaveBeenCalledOnce();
    expect((await call('POST', 'prompt_improve')).next).toHaveBeenCalledOnce();
    expect((await call('GET', 'sso_saml')).res.status).toHaveBeenCalledWith(403);
  });
});
