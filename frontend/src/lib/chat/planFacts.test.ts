// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/config/plans';
import { planFactsFromOrgRow, planGateLock } from './planFacts';

/** The plan facts Chat's precedence and denials read (CHAT-20 §7, §20), from config/plans.ts. */

describe('planFactsFromOrgRow on the cloud', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  it('gives Starter its features, no Full auto, and Growth as the step up', () => {
    const facts = planFactsFromOrgRow({ plan: 'starter', subscription_status: 'active' });
    expect(facts).toMatchObject({
      planId: 'starter',
      planName: 'Starter',
      selfHosted: false,
      isTrial: false,
      writable: true,
      fullAuto: false,
      nextPlan: {
        id: 'growth',
        name: 'Growth',
        priceMonthly: 249,
        priceDiff: 200,
        afterTrial: false,
      },
    });
    expect(facts.features).toEqual(PLANS.starter.limits.features);
    expect(planGateLock(facts, { feature: 'shopping_analytics' })).toBe('growth');
    expect(planGateLock(facts, { minPlan: 'growth' })).toBe('growth');
    expect(planGateLock(facts, { platforms: true })).toBeNull();
    expect(planGateLock(facts, { feature: 'prompt_volumes' })).toBeNull();
    expect(planGateLock(facts, null)).toBeNull();
  });

  it('opens Full auto on Growth, with Enterprise next at a contract price', () => {
    const facts = planFactsFromOrgRow({ plan: 'growth', subscription_status: 'active' });
    expect(facts).toMatchObject({ planId: 'growth', fullAuto: true, writable: true });
    expect(facts.nextPlan).toEqual({
      id: 'enterprise',
      name: 'Enterprise',
      priceMonthly: null,
      priceDiff: null,
      afterTrial: false,
    });
    expect(planGateLock(facts, { minPlan: 'growth' })).toBeNull();
    expect(planGateLock(facts, { minPlan: 'enterprise' })).toBe('enterprise');
  });

  it("keeps the trial to its plan's features, without Full auto or a plan-ranked gate", () => {
    const facts = planFactsFromOrgRow({ plan: 'growth', subscription_status: 'trialing' });
    expect(facts).toMatchObject({
      planId: 'growth',
      isTrial: true,
      writable: true,
      fullAuto: false,
    });
    expect(planGateLock(facts, { feature: 'shopping_analytics' })).toBeNull();
    expect(planGateLock(facts, { minPlan: 'starter' })).toBe('starter');
    expect(facts.nextPlan).toMatchObject({ id: 'growth', priceMonthly: 249, afterTrial: true });
  });

  it('shows no step up on Enterprise, whose trial is a deal and not the trial', () => {
    const facts = planFactsFromOrgRow({ plan: 'enterprise', subscription_status: 'trialing' });
    expect(facts).toMatchObject({ isTrial: false, fullAuto: true, nextPlan: null });
    const overridden = planFactsFromOrgRow({
      plan: 'enterprise',
      subscription_status: 'active',
      plan_overrides: { maxPrompts: 900 },
    });
    expect(overridden.limits.maxPrompts).toBe(900);
  });

  it("marks a plan that isn't active read-only, entitled to Starter's features", () => {
    for (const status of ['canceled', 'past_due', 'incomplete', null]) {
      const facts = planFactsFromOrgRow({ plan: 'growth', subscription_status: status });
      expect(facts).toMatchObject({ planId: 'growth', writable: false, fullAuto: false });
      expect(facts.features).toEqual(PLANS.starter.limits.features);
    }
  });

  it('reads an unknown plan as Starter', () => {
    expect(planFactsFromOrgRow({ plan: 'pro', subscription_status: 'active' }).planId).toBe(
      'starter',
    );
  });
});

describe('planFactsFromOrgRow self-hosted', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false'));
  afterEach(() => vi.unstubAllEnvs());

  it('gates nothing: every feature, Full auto, never read-only, no upsell', () => {
    const facts = planFactsFromOrgRow({ plan: 'starter', subscription_status: 'canceled' });
    expect(facts).toMatchObject({
      planId: 'self_hosted',
      selfHosted: true,
      writable: true,
      fullAuto: true,
      nextPlan: null,
    });
    expect(planGateLock(facts, { minPlan: 'enterprise' })).toBeNull();
    expect(planGateLock(facts, { feature: 'sso_saml' })).toBeNull();
  });
});
