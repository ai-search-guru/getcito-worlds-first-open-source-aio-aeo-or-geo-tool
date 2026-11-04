import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Billing page's AI usage meter reads the period's spend on the
 * workspace's one AI budget by feature (ai_usage_by_feature, 00242), as
 * shares of the plan's budget; the editor meter reads a page's share.
 */

let org;
let spend;
let rpcCalls;
// The page's ledger rows, and the filters its read used.
let pageRows;
let pageFilters;

function query(table) {
  const builder = {
    select: () => builder,
    eq: (column, value) => {
      if (table === 'prompt_improve_usage') pageFilters.push(['eq', column, value]);
      return builder;
    },
    gte: (column, value) => {
      if (table === 'prompt_improve_usage') pageFilters.push(['gte', column, value]);
      return builder;
    },
    maybeSingle: () => builder,
    single: () => builder,
    then: (resolve) =>
      resolve({
        data: table === 'organizations' ? org : table === 'prompt_improve_usage' ? pageRows : null,
        error: null,
      }),
  };
  return builder;
}

let guard;

beforeEach(async () => {
  vi.resetModules();
  process.env.IS_CLOUD = 'true';
  org = {
    plan: 'starter',
    subscription_status: 'active',
    // Renews on the 20th: the period runs from the 20th of last month.
    subscription_ends_at: '2026-11-20T09:00:00Z',
  };
  spend = [];
  rpcCalls = [];
  pageRows = [];
  pageFilters = [];
  vi.doMock('../config/supabase.js', () => ({
    default: {
      from: (t) => query(t),
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        return { data: spend, error: null };
      },
    },
  }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  guard = await import('./planGuard.js');
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.IS_CLOUD;
  vi.doUnmock('../config/supabase.js');
  // One test reads plans.js mocked: here, so a failing one can't pass it on.
  vi.doUnmock('../config/plans.js');
});

describe('getAiUsage', () => {
  it('reads the period’s spend by feature as shares of the plan’s budget', async () => {
    // Starter's budget is $5.
    spend = [
      { feature: 'improve', cost_usd: '0.625' },
      { feature: 'content', cost_usd: '1.502' },
    ];
    const usage = await guard.getAiUsage('o1');
    expect(rpcCalls).toEqual([
      {
        fn: 'ai_usage_by_feature',
        args: { p_organization_id: 'o1', p_since: usage.periodStart },
      },
    ]);
    expect(usage).toMatchObject({
      plan: 'starter',
      unlimited: false,
      percentUsed: 42.5,
      // Only what used some: the task writer and the quality checks had none.
      features: [
        { feature: 'improve', percent: 12.5 },
        { feature: 'content', percent: 30 },
      ],
    });
    // The period follows the subscription: it renews on the 20th.
    expect(usage.periodStart.slice(0, 10)).toBe('2026-10-20');
    expect(usage.periodEnd.slice(0, 10)).toBe('2026-11-20');
  });

  it('reads spend past the budget as all of it, the features scaled to fit', async () => {
    spend = [
      { feature: 'content', cost_usd: '7.5' },
      { feature: 'action_center', cost_usd: '2.5' },
    ];
    const usage = await guard.getAiUsage('o1');
    expect(usage.percentUsed).toBe(100);
    expect(usage.features).toEqual([
      { feature: 'content', percent: 75 },
      { feature: 'action_center', percent: 25 },
    ]);
  });

  it('counts the Content Editor’s quality checks in its row, which has no row of its own', async () => {
    spend = [
      { feature: 'quality', cost_usd: '0.25' },
      { feature: 'improve', cost_usd: '0.5' },
      { feature: 'content', cost_usd: '1' },
    ];
    const usage = await guard.getAiUsage('o1');
    expect(usage.percentUsed).toBe(35);
    // In the meter's order, whatever order the spend comes in.
    expect(usage.features).toEqual([
      { feature: 'improve', percent: 10 },
      { feature: 'content', percent: 25 },
    ]);
    // Quality checks alone still make the Content Editor's row.
    spend = [{ feature: 'quality', cost_usd: '0.05' }];
    expect((await guard.getAiUsage('o1')).features).toEqual([{ feature: 'content', percent: 1 }]);
  });

  it('lists a sliver of spend at 0, for the page to read as under a tenth', async () => {
    // $0.002 of Starter's $5 is 0.04%: under a tenth, but used.
    spend = [
      { feature: 'action_center', cost_usd: '0.002' },
      { feature: 'content', cost_usd: '0' },
    ];
    const usage = await guard.getAiUsage('o1');
    expect(usage.percentUsed).toBe(0);
    expect(usage.features).toEqual([{ feature: 'action_center', percent: 0 }]);
  });

  it('lists spend it can’t place last, and nothing when nothing was spent', async () => {
    spend = [
      { feature: 'other', cost_usd: '0.25' },
      { feature: 'improve', cost_usd: '0.5' },
    ];
    expect((await guard.getAiUsage('o1')).features).toEqual([
      { feature: 'improve', percent: 10 },
      { feature: 'other', percent: 5 },
    ]);
    spend = [];
    const empty = await guard.getAiUsage('o1');
    expect(empty.percentUsed).toBe(0);
    expect(empty.features).toEqual([]);
  });

  it('reads just under the budget as just under, and all of it only once spent', async () => {
    spend = [{ feature: 'improve', cost_usd: '4.998' }];
    expect((await guard.getAiUsage('o1')).percentUsed).toBe(99.9);
    spend = [{ feature: 'improve', cost_usd: '5' }];
    expect((await guard.getAiUsage('o1')).percentUsed).toBe(100);
  });

  it('scales unknown spend with the rest when past the budget', async () => {
    spend = [
      { feature: 'improve', cost_usd: '7.5' },
      { feature: 'other', cost_usd: '2.5' },
    ];
    const usage = await guard.getAiUsage('o1');
    expect(usage.features).toContainEqual({ feature: 'improve', percent: 75 });
    expect(usage.features).toContainEqual({ feature: 'other', percent: 25 });
  });

  it('reads a budget of nothing as used up, as the AI features are', async () => {
    // No plan has one, and a budget set by hand below the plan's isn't
    // taken (#1598): a plan read with 0 all the same still reads used up.
    vi.resetModules();
    vi.doMock('../config/plans.js', async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        getPlan: (id) => {
          const plan = real.getPlan(id);
          return { ...plan, limits: { ...plan.limits, improveMonthlyBudgetUsd: 0 } };
        },
      };
    });
    guard = await import('./planGuard.js');
    spend = [];
    const usage = await guard.getAiUsage('o1');
    expect(usage.percentUsed).toBe(100);
    expect(usage.features).toEqual([]);
  });

  it('meters an Enterprise budget set below the plan’s on the plan’s $50 (#1598)', async () => {
    org = { ...org, plan: 'enterprise', plan_overrides: { improveMonthlyBudgetUsd: 0 } };
    spend = [{ feature: 'improve', cost_usd: 5 }];
    const usage = await guard.getAiUsage('o1');
    expect(usage.percentUsed).toBe(10);
  });

  it('has no meter without an active plan', async () => {
    org = { ...org, subscription_status: 'incomplete' };
    await expect(guard.getAiUsage('o1')).rejects.toMatchObject({ statusCode: 402 });
  });

  it('says what work a page asks about takes, as shares of the budget, never past it', async () => {
    // Starter's $5, more than half of it spent: an estimate stays a share of the budget.
    spend = [{ feature: 'content', cost_usd: '3' }];
    const usage = await guard.getAiUsage('o1', { estimates: { writeThis: 0.17, tiny: 0.001 } });
    expect(usage.estimates).toEqual({ writeThis: 3.4, tiny: 0 });
    expect(usage.percentUsed).toBe(60);
    // None asked: none answered.
    expect(await guard.getAiUsage('o1')).not.toHaveProperty('estimates');
  });

  it('shows no meter for an unlimited budget', async () => {
    delete process.env.IS_CLOUD;
    vi.resetModules();
    guard = await import('./planGuard.js');
    const usage = await guard.getAiUsage('o1');
    expect(usage).toMatchObject({ unlimited: true, percentUsed: null, features: [] });
    expect(rpcCalls).toEqual([]);
  });
});

describe('getDraftAiUsage', () => {
  it('reads the page’s spend this period as a share of the budget, from the org’s own rows', async () => {
    // Starter's budget is $5: 0.185 is 3.7%.
    pageRows = [{ cost_usd: '0.125' }, { cost_usd: '0.06' }];
    spend = [{ feature: 'content', cost_usd: '1' }];
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: false, percent: 3.7 });
    expect(pageFilters).toEqual([
      ['eq', 'organization_id', 'o1'],
      ['eq', 'content_draft_id', 'd1'],
      // Calls on the workspace's own key never count (00405).
      ['eq', 'own_key', false],
      // The same period as the month's figure: it renews on the 20th.
      ['gte', 'used_at', '2026-10-20T09:00:00.000Z'],
    ]);
  });

  it('reads a page with no AI calls as 0, and one with a sliver as 0.1', async () => {
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: false, percent: 0 });
    // A small Fix run on a big budget: $0.005 of Enterprise's $50.
    org = { ...org, plan: 'enterprise' };
    pageRows = [{ cost_usd: '0.005' }];
    spend = [{ feature: 'content', cost_usd: '0.005' }];
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: false, percent: 0.1 });
  });

  it('scales the page’s spend to fit once the month’s is past the budget, as the month’s figure', async () => {
    // The last call took the month to $5.35 of Starter's $5, all on this page.
    pageRows = [{ cost_usd: '5.35' }];
    spend = [{ feature: 'content', cost_usd: '5.35' }];
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: false, percent: 100 });
    // Half of it on this page.
    pageRows = [{ cost_usd: '2.675' }];
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: false, percent: 50 });
  });

  it('rejects with plan_limit without an active plan, and shows none for an unlimited budget', async () => {
    org = { ...org, subscription_status: 'incomplete' };
    await expect(guard.getDraftAiUsage('o1', 'd1')).rejects.toMatchObject({ statusCode: 402 });

    delete process.env.IS_CLOUD;
    vi.resetModules();
    guard = await import('./planGuard.js');
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: true, percent: null });
    expect(pageFilters).toEqual([]);
  });
});

describe('the free trial’s AI budget', () => {
  it('is $2 whatever the plan while the subscription is trialing, and says it is the trial’s', async () => {
    org = { ...org, plan: 'growth', subscription_status: 'trialing' };
    spend = [{ feature: 'content', cost_usd: '0.42' }];
    expect(await guard.getAiUsage('o1')).toMatchObject({ trial: true, percentUsed: 21 });
    // Paid: Growth's own $25.
    org = { ...org, subscription_status: 'active' };
    expect(await guard.getAiUsage('o1')).toMatchObject({ trial: false, percentUsed: 1.7 });
  });

  it('leaves Enterprise with its own (a deal’s budget), and an unlimited one as it is', () => {
    const plan = (budget) => ({ id: 'x', limits: { improveMonthlyBudgetUsd: budget } });
    const trialing = (over) => ({ plan: 'starter', subscription_status: 'trialing', ...over });
    const deal = trialing({ plan: 'enterprise', plan_overrides: { improveMonthlyBudgetUsd: 80 } });
    expect(guard.applyTrialAiBudget(plan(80), deal)).toEqual(plan(80));
    expect(guard.applyTrialAiBudget(plan(-1), trialing())).toEqual(plan(-1));
  });

  it('holds Starter and Growth trials to $2, and a smaller budget to its own', () => {
    const plan = (budget) => ({ id: 'x', limits: { improveMonthlyBudgetUsd: budget } });
    const trial = { plan: 'growth', subscription_status: 'trialing' };
    expect(guard.applyTrialAiBudget(plan(25), trial)).toEqual({
      id: 'x',
      trial: true,
      limits: { improveMonthlyBudgetUsd: 2 },
    });
    expect(guard.applyTrialAiBudget(plan(0.5), trial).limits.improveMonthlyBudgetUsd).toBe(0.5);
    expect(guard.applyTrialAiBudget(plan(25), { ...trial, subscription_status: 'active' })).toEqual(
      plan(25),
    );
  });
});
