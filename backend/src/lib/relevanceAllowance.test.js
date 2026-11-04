import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The suggestion-relevance allowance (VIS-011) in planGuard.js: 0.1% of the
// plan price a month, reserved atomically before a refresh rates and settled
// to what it cost after.

const rpc = vi.fn();
const tables = {};
let updates = [];
vi.mock('../config/supabase.js', () => ({
  default: {
    rpc: (...a) => rpc(...a),
    from: (table) => tables[table](),
  },
}));

const { reserveRelevanceAllowance, settleRelevanceUsage } = await import('./planGuard.js');

/** A query builder that resolves to `result` however it is chained. */
function chain(result) {
  const b = {
    select: () => b,
    eq: () => b,
    update: (row) => {
      updates.push(row);
      return b;
    },
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  return b;
}

function org(plan) {
  tables.organizations = () =>
    chain({
      data: {
        plan,
        subscription_status: 'active',
        subscription_ends_at: '2026-11-12T00:00:00.000Z',
        plan_overrides: null,
      },
    });
}

beforeEach(() => {
  process.env.IS_CLOUD = 'true';
  rpc.mockReset();
  updates = [];
  // Inside the subscription period that renews on the 12th.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
});

afterEach(() => {
  delete process.env.IS_CLOUD;
  vi.useRealTimers();
});

describe('reserveRelevanceAllowance', () => {
  it('reserves the cost against 0.1% of the plan price for the period', async () => {
    org('starter');
    rpc.mockResolvedValue({ data: 'r1', error: null });

    const reservation = await reserveRelevanceAllowance('o1', {
      brandId: 'b1',
      modelId: 'google/gemini-3-flash-preview',
      costUsd: 0.0047,
    });

    expect(reservation).toEqual({ unlimited: false, id: 'r1' });
    expect(rpc).toHaveBeenCalledWith('reserve_suggestion_relevance', {
      p_organization_id: 'o1',
      p_brand_id: 'b1',
      p_model: 'google/gemini-3-flash-preview',
      p_since: '2026-10-12T00:00:00.000Z',
      p_budget: 0.049,
      p_cost: 0.0047,
    });
  });

  it('gives no id when what is left can’t cover it', async () => {
    org('growth');
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await reserveRelevanceAllowance('o1', { costUsd: 1 })).toEqual({
      unlimited: false,
      id: null,
    });
  });

  it('reserves nothing when self-hosted', async () => {
    delete process.env.IS_CLOUD;
    expect(await reserveRelevanceAllowance('o1', { costUsd: 1 })).toEqual({
      unlimited: true,
      id: null,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws when the reservation fails, so the caller can skip rating', async () => {
    org('starter');
    rpc.mockResolvedValue({ data: null, error: { message: 'lock timeout' } });
    await expect(reserveRelevanceAllowance('o1', { costUsd: 0.001 })).rejects.toThrow(
      'lock timeout',
    );
  });
});

describe('settleRelevanceUsage', () => {
  it('lowers the row to what the attempts cost, with the call’s tokens', async () => {
    tables.suggestion_relevance_usage = () => chain({ error: null });
    await settleRelevanceUsage('r1', {
      attempts: 1,
      costUsd: 0.0016,
      usage: { inputTokens: 5000, outputTokens: 2400 },
    });
    expect(updates).toEqual([
      { attempts: 1, cost_usd: 0.0016, input_tokens: 5000, output_tokens: 2400 },
    ]);
  });

  it('throws when the update fails, leaving the worst case charged', async () => {
    tables.suggestion_relevance_usage = () => chain({ error: { message: 'denied' } });
    await expect(settleRelevanceUsage('r1', { attempts: 3, costUsd: 0.0047 })).rejects.toThrow(
      'denied',
    );
  });
});
