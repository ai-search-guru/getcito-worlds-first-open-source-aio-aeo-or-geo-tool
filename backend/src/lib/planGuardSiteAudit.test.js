import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Site Audit quota counts audits still running as well as completed
 * ones (completed audits are charged when they finish), and a bulk start is
 * checked for every page it asks for at once. The auto-audit runs still to
 * come keep their share out of the user's pool (SA-006).
 */

let used;
let autoUsed;
let running;
let autoRunning;
let runningQuery;
let settings;
let recordedDays;

function query(table) {
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (col, val) => {
      filters.push(['eq', col, val]);
      return builder;
    },
    gte: (col, val) => {
      filters.push(['gte', col, val]);
      return builder;
    },
    single: () => builder,
    maybeSingle: () => builder,
    then: (resolve) => {
      if (table === 'organizations') {
        return resolve({ data: { plan: 'starter', subscription_status: 'active' }, error: null });
      }
      if (table === 'site_audit_usage') {
        const auto = filters.some(([, col, val]) => col === 'source' && val === 'auto');
        return resolve({ count: auto ? autoUsed : used, error: null });
      }
      if (table === 'site_audits') {
        if (filters.some(([, col, val]) => col === 'source' && val === 'auto')) {
          return resolve({ count: autoRunning, error: null });
        }
        runningQuery = filters;
        return resolve({ count: running, error: null });
      }
      if (table === 'site_audit_settings') return resolve({ data: settings, error: null });
      if (table === 'site_audit_auto_runs') {
        return resolve({ data: recordedDays.map((d) => ({ run_day: d })), error: null });
      }
      return resolve({ data: null, error: null });
    },
  };
  return builder;
}

// The 10th of a calendar month: day 1 ran, day 7's run is due.
const now = new Date('2026-10-10T06:00:00Z');
const OFF = { auto_audit: false, email_after_run: false };

let quota;

beforeEach(async () => {
  vi.resetModules();
  process.env.IS_CLOUD = 'true';
  used = 0;
  autoUsed = 0;
  running = 0;
  autoRunning = 0;
  settings = null;
  recordedDays = [];
  vi.doMock('../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));
  quota = await import('./planGuard.js');
});

afterEach(() => {
  delete process.env.IS_CLOUD;
  vi.doUnmock('../config/supabase.js');
});

describe('Site Audit quota', () => {
  it("takes running audits out of what's left", async () => {
    settings = OFF;
    used = 90;
    running = 4;
    expect(await quota.getSiteAuditQuotaStatus('org-1', { now })).toMatchObject({
      used: 90,
      running: 4,
      limit: 100,
      remaining: 6,
      auto: { enabled: false, reserved: 0 },
    });
    // Running audits of the org's brands, started in the last two hours.
    expect(runningQuery).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'running'],
        ['eq', 'brands.organization_id', 'org-1'],
        ['gte', 'created_at', expect.any(String)],
      ]),
    );
  });

  it('starts a bulk run only when every page fits', async () => {
    settings = OFF;
    used = 90;
    running = 4;
    await expect(quota.enforceSiteAuditQuota('org-1', 6, { now })).resolves.toMatchObject({
      remaining: 6,
    });
    await expect(quota.enforceSiteAuditQuota('org-1', 7, { now })).rejects.toThrow(
      'These 7 audits need more than the 6 left this month on the Starter plan. Select up to 6.',
    );
  });

  it('refuses one more audit when completed and running ones fill the quota', async () => {
    settings = OFF;
    used = 97;
    running = 3;
    await expect(quota.enforceSiteAuditQuota('org-1', 1, { now })).rejects.toMatchObject({
      statusCode: 429,
      message: expect.stringContaining('(100/100, 3 still running)'),
    });

    used = 100;
    running = 0;
    await expect(quota.enforceSiteAuditQuota('org-1', 1, { now })).rejects.toThrow(
      'Monthly Site Audit limit reached (100/100) on the Starter plan.',
    );
  });

  it("keeps the auto-audit runs still to come out of the user's pool", async () => {
    // Auto-audit on by default: 5 a run; day 1 ran, days 7–28 are to come.
    recordedDays = [1];
    used = 30;
    autoUsed = 5;
    running = 3;
    autoRunning = 2;
    expect(await quota.getSiteAuditQuotaStatus('org-1', { now })).toMatchObject({
      used: 30,
      running: 3,
      limit: 100,
      remaining: 47,
      auto: {
        enabled: true,
        setting: null,
        perRun: 5,
        reserved: 20,
        used: 5,
        // Of the running audits, the runs' own (SA-019's card).
        running: 2,
        due: { day: 7 },
        nextRun: { day: 7, at: now.toISOString() },
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-11-01T00:00:00.000Z',
        runs: [
          { day: 1, at: '2026-10-01T00:00:00.000Z', done: true },
          { day: 7, at: '2026-10-07T00:00:00.000Z', done: false },
          { day: 14, at: '2026-10-14T00:00:00.000Z', done: false },
          { day: 21, at: '2026-10-21T00:00:00.000Z', done: false },
          { day: 28, at: '2026-10-28T00:00:00.000Z', done: false },
        ],
      },
    });

    // The user can't take the runs' slots; a run can.
    await expect(quota.enforceSiteAuditQuota('org-1', 48, { now })).rejects.toThrow(
      'These 48 audits need more than the 47 left this month on the Starter plan (20 more are kept for auto-audits). Select up to 47.',
    );
    await expect(
      quota.enforceSiteAuditQuota('org-1', 5, { source: 'auto', now }),
    ).resolves.toMatchObject({ remaining: 67 });

    // Day 7 recorded: its unused slots are back in the user's pool.
    recordedDays = [1, 7];
    expect(await quota.getSiteAuditQuotaStatus('org-1', { now })).toMatchObject({
      remaining: 52,
      auto: { reserved: 15, due: null, nextRun: { day: 14 } },
    });
  });

  it('says which share is left when the user has used theirs', async () => {
    recordedDays = [1];
    used = 80;
    await expect(quota.enforceSiteAuditQuota('org-1', 1, { now })).rejects.toThrow(
      "You've used your 80 Site Audits this month on the Starter plan. 20 auto audits are still scheduled. Turn off auto-audit in Site Audit settings to use them now, or upgrade.",
    );
    // Turned off, the whole quota is the user's.
    settings = OFF;
    await expect(quota.enforceSiteAuditQuota('org-1', 20, { now })).resolves.toMatchObject({
      remaining: 20,
    });
  });

  it('never limits a self-hosted install, where auto-audit starts off', async () => {
    delete process.env.IS_CLOUD;
    used = 1000;
    running = 50;
    await expect(quota.enforceSiteAuditQuota('org-1', 50, { now })).resolves.toMatchObject({
      remaining: -1,
    });
    expect(await quota.getSiteAuditQuotaStatus('org-1', { now })).toMatchObject({
      used: 0,
      running: 0,
      limit: -1,
      remaining: -1,
      auto: { enabled: false, perRun: 25, reserved: 0, due: null },
    });

    // Turned on, it runs 25 pages a run and keeps nothing back.
    settings = { auto_audit: true, email_after_run: true };
    expect(await quota.getSiteAuditQuotaStatus('org-1', { now })).toMatchObject({
      remaining: -1,
      auto: { enabled: true, emailAfterRun: true, reserved: 0, due: { day: 7 } },
    });
  });
});
