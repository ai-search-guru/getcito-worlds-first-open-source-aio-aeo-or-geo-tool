import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The monthly content opportunity quota (CONTENT-001) in planGuard.js:
// claiming slots, the counters and the period they belong to.

const rpc = vi.fn();
const tables = {};
vi.mock('../config/supabase.js', () => ({
  default: {
    rpc: (...a) => rpc(...a),
    from: (table) => tables[table](),
  },
}));

const {
  claimOpportunitySlots,
  getContentUsage,
  getOpportunityQuotaStatus,
  getOpportunityRequestAllowance,
} = await import('./planGuard.js');

/** A query builder that resolves to `result` however it is chained. */
function chain(result) {
  const b = {
    select: () => b,
    eq: () => b,
    gte: () => b,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  return b;
}

function org(plan, endsAt = '2026-11-12T00:00:00.000Z') {
  tables.organizations = () =>
    chain({
      data: {
        plan,
        subscription_status: 'active',
        subscription_ends_at: endsAt,
        plan_overrides: null,
      },
    });
}

function used(opportunities, briefs = 0) {
  tables.opportunity_usage = () => chain({ count: opportunities });
  tables.brief_usage = () => chain({ count: briefs });
}

beforeEach(() => {
  process.env.IS_CLOUD = 'true';
  rpc.mockReset();
});

afterEach(() => {
  delete process.env.IS_CLOUD;
});

describe('getOpportunityQuotaStatus', () => {
  it('counts against 10 on Starter and 50 on Growth', async () => {
    org('starter');
    used(4);
    expect(await getOpportunityQuotaStatus('o1')).toEqual({ used: 4, limit: 10, remaining: 6 });
    org('growth');
    used(43);
    expect(await getOpportunityQuotaStatus('o1')).toEqual({ used: 43, limit: 50, remaining: 7 });
  });

  it('never reports negative remaining', async () => {
    org('starter');
    used(12);
    expect((await getOpportunityQuotaStatus('o1')).remaining).toBe(0);
  });

  it('is unlimited when self-hosted', async () => {
    delete process.env.IS_CLOUD;
    expect(await getOpportunityQuotaStatus('o1')).toEqual({ used: 0, limit: -1, remaining: -1 });
  });
});

describe('claimOpportunitySlots', () => {
  it('claims through the atomic function, from the start of the billing period', async () => {
    org('starter');
    rpc.mockResolvedValue({ data: ['u1', { claim_opportunity_usage: 'u2' }], error: null });
    expect(await claimOpportunitySlots('o1', 3)).toEqual({ unlimited: false, ids: ['u1', 'u2'] });
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('claim_opportunity_usage');
    expect(args).toMatchObject({ p_organization_id: 'o1', p_limit: 10, p_count: 3 });
    // Anchored to the billing day (the 12th), not the 1st of the month.
    expect(new Date(args.p_since).getUTCDate()).toBe(12);
  });

  it('claims nothing when unlimited', async () => {
    delete process.env.IS_CLOUD;
    expect(await claimOpportunitySlots('o1', 3)).toEqual({ unlimited: true, ids: [] });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('getContentUsage', () => {
  it('reports both counters and the period they renew with', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
    try {
      org('growth');
      used(32, 5);
      expect(await getContentUsage('o1')).toEqual({
        plan: 'growth',
        planName: expect.any(String),
        periodStart: '2026-10-12T00:00:00.000Z',
        periodEnd: '2026-11-12T00:00:00.000Z',
        opportunities: { used: 32, limit: 50, remaining: 18, perRequest: 5 },
        briefs: { used: 5, limit: 50, remaining: 45 },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getOpportunityRequestAllowance', () => {
  it('caps a "+ New" request at 3 on Starter and 5 on Growth', async () => {
    org('starter');
    used(0);
    expect(await getOpportunityRequestAllowance('o1')).toMatchObject({ perRequest: 3, max: 3 });
    org('growth');
    used(0);
    expect(await getOpportunityRequestAllowance('o1')).toMatchObject({ perRequest: 5, max: 5 });
  });

  it('never asks for more than is left of the month', async () => {
    org('growth');
    used(48);
    expect(await getOpportunityRequestAllowance('o1')).toMatchObject({ remaining: 2, max: 2 });
    used(50);
    expect(await getOpportunityRequestAllowance('o1')).toMatchObject({ remaining: 0, max: 0 });
  });

  it('is the per-request cap alone when the month is unlimited', async () => {
    delete process.env.IS_CLOUD;
    expect(await getOpportunityRequestAllowance('o1')).toMatchObject({ remaining: -1, max: 5 });
  });
});
