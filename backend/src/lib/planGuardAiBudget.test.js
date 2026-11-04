import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A call's share of the workspace's AI budget is held before it runs
 * (reserve_ai_usage, 00243), so calls at once can't pass a nearly spent
 * budget; the hold becomes the call's real cost, or goes when nothing was
 * charged.
 */

let org;
let reserved;
let rpcCalls;
let ops;
// The org's recent calls this period, newest first (what a hold is sized on).
let recent;
// The `or` filters its reads ask for.
let ors;
// The `eq` filters its prompt_improve_usage reads ask for.
let filters;

function query(table) {
  const op = { table, kind: 'select', filters: [] };
  const builder = {
    select: () => builder,
    eq: (col, val) => {
      op.filters.push([col, val]);
      if (table === 'prompt_improve_usage') filters.push([col, val]);
      return builder;
    },
    gte: (col, val) => (op.filters.push([col, val]), builder),
    or: (val) => (ors.push(val), builder),
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => builder,
    single: () => builder,
    insert: (value) => (Object.assign(op, { kind: 'insert', value }), ops.push(op), builder),
    update: (value) => (Object.assign(op, { kind: 'update', value }), ops.push(op), builder),
    delete: () => (Object.assign(op, { kind: 'delete' }), ops.push(op), builder),
    then: (resolve) =>
      resolve(
        table === 'prompt_improve_usage' && op.kind === 'select'
          ? recent
          : { data: table === 'organizations' ? org : null, error: null },
      ),
  };
  return builder;
}

let guard;

beforeEach(async () => {
  vi.resetModules();
  process.env.IS_CLOUD = 'true';
  org = { plan: 'starter', subscription_status: 'active', subscription_ends_at: null };
  reserved = 'u1';
  recent = { data: [], error: null };
  rpcCalls = [];
  ops = [];
  ors = [];
  filters = [];
  vi.doMock('../config/supabase.js', () => ({
    default: {
      from: (t) => query(t),
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        return { data: reserved, error: null };
      },
    },
  }));
  vi.doMock('./logger.js', () => ({ logger: { error: vi.fn() } }));
  guard = await import('./planGuard.js');
});

afterEach(() => {
  delete process.env.IS_CLOUD;
  vi.doUnmock('../config/supabase.js');
  vi.doUnmock('./logger.js');
});

const usage = { inputTokens: 7000, outputTokens: 2000 };

describe('reserveAiBudget', () => {
  it('holds the org’s recent median cost when calls run above the model’s estimate', async () => {
    recent = {
      data: [0.05, 0.021, 0.02, 0.019, 0.004].map((cost_usd) => ({ cost_usd })),
      error: null,
    };
    await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
    });
    expect(rpcCalls[0].args.p_cost).toBe(0.02);
    // Never less than the model's typical cost, nor when the read fails.
    rpcCalls = [];
    recent = { data: [{ cost_usd: 0.001 }], error: null };
    await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
    });
    recent = { data: null, error: { message: 'timeout' } };
    await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
    });
    expect(rpcCalls.map((c) => c.args.p_cost)).toEqual([0.0095, 0.0095]);
  });

  it('holds what a small call asks, and sizes no other hold on small calls', async () => {
    await guard.reserveAiBudget('o1', {
      feature: 'quality',
      modelId: 'google/gemini-3-flash-preview',
      holdUsd: 0.002,
    });
    expect(rpcCalls[0].args).toMatchObject({ p_cost: 0.002, p_feature: 'quality' });
    expect(ors).toEqual([]);
    // The median a larger call holds leaves Quality's small checks out.
    await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
    });
    expect(ors).toEqual(['feature.is.null,feature.not.in.(quality,chat,agent,schedule,image)']);
  });

  it('leaves steps on a workspace’s own key out of the median a hold is sized on', async () => {
    await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
    });
    expect(filters).toContainEqual(['own_key', false]);
  });

  it('holds the estimate on the period’s budget, then turns it into the real cost', async () => {
    const budget = await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
      draftId: 'd1',
    });
    expect(rpcCalls).toEqual([
      {
        fn: 'reserve_ai_usage',
        args: expect.objectContaining({
          p_organization_id: 'o1',
          // Starter's $5, from the period's start.
          p_budget: 5,
          p_since: expect.any(String),
          p_cost: 0.0095,
          p_feature: 'content',
          p_model: 'google/gemini-3-flash-preview',
          p_prompt_id: null,
          p_action_id: null,
          p_content_draft_id: 'd1',
        }),
      },
    ]);

    await budget.charge({ inputTokens: 1000, outputTokens: 500 });
    // The first charge is the hold, at the call's real cost…
    expect(ops).toEqual([
      expect.objectContaining({
        table: 'prompt_improve_usage',
        kind: 'update',
        value: expect.objectContaining({ input_tokens: 1000, cost_usd: 0.002 }),
        filters: [['id', 'u1']],
      }),
    ]);
    // …a retry adds its own row, and nothing is left to release.
    await budget.charge(usage);
    await budget.release();
    expect(ops.map((op) => op.kind)).toEqual(['update', 'insert']);
    expect(ops[1].value).toMatchObject({
      organization_id: 'o1',
      feature: 'content',
      content_draft_id: 'd1',
      input_tokens: 7000,
    });
  });

  it('charges the web searches a call ran on top of its tokens', async () => {
    const budget = await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
      draftId: 'd1',
      holdUsd: 0.06,
    });
    // $0.002 of tokens and three searches at $0.01.
    await budget.charge({ inputTokens: 1000, outputTokens: 500 }, { searches: 3 });
    expect(ops[0].value.cost_usd).toBeCloseTo(0.032, 6);
  });

  it('lets the hold go when nothing was charged', async () => {
    const budget = await guard.reserveAiBudget('o1', {
      feature: 'improve',
      modelId: 'm',
      promptId: 'p1',
    });
    await budget.release();
    await budget.release();
    expect(ops).toEqual([expect.objectContaining({ kind: 'delete', filters: [['id', 'u1']] })]);
  });

  it('keeps the hold as the cost of a call a Stop aborted, which the provider still bills', async () => {
    const budget = await guard.reserveAiBudget('o1', { feature: 'content', modelId: 'm' });
    await budget.keep();
    await budget.release();
    // Neither changed nor let go: the hold's row is the call's cost.
    expect(ops).toEqual([]);
  });

  it('holds a call in the free trial on its $2, and says starting the plan gives more', async () => {
    org = { ...org, plan: 'growth', subscription_status: 'trialing' };
    await guard.reserveAiBudget('o1', { feature: 'improve', modelId: 'm', promptId: 'p1' });
    expect(rpcCalls[0].args.p_budget).toBe(2);

    reserved = null;
    await expect(
      guard.reserveAiBudget('o1', { feature: 'improve', modelId: 'm', promptId: 'p1' }),
    ).rejects.toMatchObject({
      statusCode: 429,
      message:
        "The free trial's AI usage is used up. Starting the plan gives its full monthly allowance.",
    });
  });

  it('refuses once the budget is spent, as the quota did', async () => {
    reserved = null;
    await expect(
      guard.reserveAiBudget('o1', { feature: 'improve', modelId: 'm', promptId: 'p1' }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(ops).toEqual([]);
  });

  it('holds nothing on an unlimited budget, and still writes each charge', async () => {
    delete process.env.IS_CLOUD;
    vi.resetModules();
    guard = await import('./planGuard.js');
    const budget = await guard.reserveAiBudget('o1', {
      feature: 'action_center',
      modelId: 'm',
      actionId: 'a1',
    });
    expect(rpcCalls).toEqual([]);
    await budget.charge(usage);
    await budget.release();
    expect(ops).toEqual([
      expect.objectContaining({
        kind: 'insert',
        value: expect.objectContaining({ feature: 'action_center', action_id: 'a1' }),
      }),
    ]);

    // A call a Stop aborted is written at what a hold would be.
    ops = [];
    const stopped = await guard.reserveAiBudget('o1', { feature: 'content', modelId: 'm' });
    await stopped.keep();
    expect(ops).toEqual([
      expect.objectContaining({
        kind: 'insert',
        value: expect.objectContaining({ feature: 'content', cost_usd: expect.any(Number) }),
      }),
    ]);
  });
});

describe('getImproveQuotaStatus', () => {
  it('counts Chat’s steps as spent, but sizes a call on the others, and leaves own-key rows out', async () => {
    recent = {
      data: [
        ...Array.from({ length: 10 }, () => ({ cost_usd: 0.001, feature: 'chat' })),
        ...Array.from({ length: 5 }, () => ({ cost_usd: 0.02, feature: 'improve' })),
      ],
      error: null,
    };
    const status = await guard.getImproveQuotaStatus('o1', 'google/gemini-3-flash-preview');
    expect(status.spentUsd).toBeCloseTo(0.11);
    // $4.89 left at $0.02 a call: Chat's $0.001 steps don't pull the estimate down.
    expect(status.generationsLeft).toBe(244);
    expect(filters).toContainEqual(['own_key', false]);
  });

  it('counts Quality’s small checks as spent, but sizes a call on the others', async () => {
    recent = {
      data: [
        ...Array.from({ length: 10 }, () => ({ cost_usd: 0.0005, feature: 'quality' })),
        ...Array.from({ length: 5 }, () => ({ cost_usd: 0.02, feature: 'improve' })),
      ],
      error: null,
    };
    const status = await guard.getImproveQuotaStatus('o1', 'google/gemini-3-flash-preview');
    expect(status.spentUsd).toBeCloseTo(0.105);
    // Starter's $5 (#1435): $4.895 left at $0.02 a call; the checks' $0.0005 would make it 9,790.
    expect(status.generationsLeft).toBe(244);
  });
});
