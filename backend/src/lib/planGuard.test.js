import { beforeAll, describe, expect, it } from 'vitest';

let applyPlanOverrides;

beforeAll(async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  ({ applyPlanOverrides } = await import('./planGuard.js'));
});

const plan = {
  id: 'enterprise',
  name: 'Enterprise',
  limits: { maxBrands: -1, maxPrompts: -1, allowedModels: [] },
};

describe('applyPlanOverrides', () => {
  it('merges enterprise overrides without mutating the plan', () => {
    const result = applyPlanOverrides(plan, {
      plan: 'enterprise',
      plan_overrides: { maxPrompts: 500, allowedModels: ['claude-sonnet-5'] },
    });

    expect(result).not.toBe(plan);
    expect(result.limits).not.toBe(plan.limits);
    expect(result.limits.maxPrompts).toBe(500);
    expect(result.limits.allowedModels).toEqual(['claude-sonnet-5']);
    expect(plan).toEqual({
      id: 'enterprise',
      name: 'Enterprise',
      limits: { maxBrands: -1, maxPrompts: -1, allowedModels: [] },
    });
  });

  it('ignores non-enterprise and invalid overrides', () => {
    expect(
      applyPlanOverrides(plan, {
        plan: 'growth',
        plan_overrides: { maxPrompts: 500 },
      }),
    ).toEqual(plan);
    expect(applyPlanOverrides(plan, { plan: 'enterprise', plan_overrides: null })).toEqual(plan);
    expect(applyPlanOverrides(plan, { plan: 'enterprise', plan_overrides: 'invalid' })).toEqual(
      plan,
    );
    expect(applyPlanOverrides(plan, { plan: 'enterprise', plan_overrides: [] })).toEqual(plan);
  });
});

describe('applyPlanOverrides — the Enterprise AI budget', () => {
  const enterprise = {
    id: 'enterprise',
    name: 'Enterprise',
    limits: { maxPrompts: -1, improveMonthlyBudgetUsd: 4.99 },
  };
  const budget = (plan_overrides) =>
    applyPlanOverrides(enterprise, { plan: 'enterprise', plan_overrides }).limits
      .improveMonthlyBudgetUsd;

  it('stays at the plan default whatever the contract is worth (2026-10-27)', () => {
    expect(budget({ contractMonthlyUsd: 300 })).toBe(4.99);
    expect(budget({ contractMonthlyUsd: 1000 })).toBe(4.99);
    expect(budget({ contractMonthlyUsd: 100000 })).toBe(4.99);
  });

  it('takes the customer’s own budget, set explicitly', () => {
    expect(budget({ improveMonthlyBudgetUsd: 80 })).toBe(80);
    expect(budget({ contractMonthlyUsd: 2000, improveMonthlyBudgetUsd: 7 })).toBe(7);
  });

  it('keeps the plan’s budget when the one set by hand isn’t a number', () => {
    // null would read as unlimited, and "80$" would fail every AI call.
    for (const own of [null, '80', '80$', Number.NaN, Infinity, {}]) {
      expect(budget({ improveMonthlyBudgetUsd: own })).toBe(4.99);
    }
  });

  it('keeps the plan’s budget, its floor, for one set below it (#1598)', () => {
    // 0 or -5 would answer every AI call "used up", -1 would read as unlimited.
    for (const own of [0, -5, -1, 4.98]) {
      expect(budget({ improveMonthlyBudgetUsd: own })).toBe(4.99);
    }
    expect(budget({ improveMonthlyBudgetUsd: 4.99 })).toBe(4.99);
  });

  it('keeps the default without a usable contract value', () => {
    expect(budget({ maxPrompts: 900 })).toBe(4.99);
    expect(budget({ contractMonthlyUsd: 'n/a' })).toBe(4.99);
  });
});

describe('applyPlanOverrides — relevance allowance from the contract value', () => {
  const enterprise = {
    id: 'enterprise',
    name: 'Enterprise',
    limits: { maxPrompts: -1, improveMonthlyBudgetUsd: 4.99, relevanceMonthlyBudgetUsd: 0.499 },
  };
  const limits = (plan_overrides) =>
    applyPlanOverrides(enterprise, { plan: 'enterprise', plan_overrides }).limits;

  it('is 0.1% of the monthly contract, rounded down', () => {
    expect(limits({ contractMonthlyUsd: 1000 }).relevanceMonthlyBudgetUsd).toBe(1);
    expect(limits({ contractMonthlyUsd: 1234.5678 }).relevanceMonthlyBudgetUsd).toBe(1.234567);
  });

  it('never drops below the plan default, and an explicit value wins', () => {
    expect(limits({ contractMonthlyUsd: 300 }).relevanceMonthlyBudgetUsd).toBe(0.499);
    expect(
      limits({ contractMonthlyUsd: 2000, relevanceMonthlyBudgetUsd: 0.5 })
        .relevanceMonthlyBudgetUsd,
    ).toBe(0.5);
  });

  it('leaves the AI budget at the plan default', () => {
    expect(limits({ contractMonthlyUsd: 1000 }).improveMonthlyBudgetUsd).toBe(4.99);
  });
});

describe('relevance allowance per plan', () => {
  it('is 0.1% of each plan price, unlimited on self-hosted', async () => {
    const { PLANS } = await import('../config/plans.js');
    expect(PLANS.starter.limits.relevanceMonthlyBudgetUsd).toBe(0.049);
    expect(PLANS.growth.limits.relevanceMonthlyBudgetUsd).toBe(0.249);
    expect(PLANS.enterprise.limits.relevanceMonthlyBudgetUsd).toBe(0.499);
    expect(PLANS.self_hosted.limits.relevanceMonthlyBudgetUsd).toBe(-1);
  });
});

describe('catalog products per plan (ECOM-019)', () => {
  it('is 5,000 / 50,000, set per Enterprise customer, uncapped on self-hosted', async () => {
    const { PLANS } = await import('../config/plans.js');
    expect(PLANS.starter.limits.maxCatalogProducts).toBe(5_000);
    expect(PLANS.growth.limits.maxCatalogProducts).toBe(50_000);
    expect(PLANS.enterprise.limits.maxCatalogProducts).toBe(-1);
    expect(PLANS.self_hosted.limits.maxCatalogProducts).toBe(-1);
    expect(
      applyPlanOverrides(PLANS.enterprise, {
        plan: 'enterprise',
        plan_overrides: { maxCatalogProducts: 250_000 },
      }).limits.maxCatalogProducts,
    ).toBe(250_000);
  });
});
