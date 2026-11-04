import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/config/plans';
import {
  demoActionName,
  demoOffer,
  effectivePlanForBrand,
  effectivePlanIdForBrand,
  ownBrandOf,
} from './demoBrand';

describe('demoOffer', () => {
  it('starts a workspace that never subscribed with the free trial', () => {
    expect(demoOffer(false)).toBe('trial');
  });

  it('gives a workspace whose plan ended 50% off its first month', () => {
    expect(demoOffer(true)).toBe('first_month');
  });
});

describe('demoActionName', () => {
  it("keeps a read-only label's doing", () => {
    expect(demoActionName('Adding prompts needs a plan')).toBe('Adding prompts');
    expect(demoActionName('Running the Content Agent needs a plan.')).toBe(
      'Running the Content Agent',
    );
  });

  it('keeps a label written another way whole', () => {
    expect(demoActionName('Run all')).toBe('Run all');
  });
});

describe('effectivePlanIdForBrand', () => {
  it('shows the demo brand with Growth on Starter, or with no plan yet', () => {
    expect(effectivePlanIdForBrand('starter', true)).toBe('growth');
  });

  it("keeps the organization's own plan on its own brands", () => {
    expect(effectivePlanIdForBrand('starter', false)).toBe('starter');
  });

  it('keeps a plan at or above Growth, and self-hosted', () => {
    expect(effectivePlanIdForBrand('growth', true)).toBe('growth');
    expect(effectivePlanIdForBrand('enterprise', true)).toBe('enterprise');
    expect(effectivePlanIdForBrand('self_hosted', true)).toBe('self_hosted');
  });
});

describe('effectivePlanForBrand', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the demo brand with Growth's limits", () => {
    expect(effectivePlanForBrand(PLANS.starter, true)).toBe(PLANS.growth);
  });

  it("keeps an organization's plan as read, Enterprise's overrides with it", () => {
    const custom = {
      ...PLANS.enterprise,
      limits: { ...PLANS.enterprise.limits, maxPrompts: 900 },
    };
    expect(effectivePlanForBrand(custom, true)).toBe(custom);
    expect(effectivePlanForBrand(PLANS.starter, false)).toBe(PLANS.starter);
  });
});

describe('ownBrandOf', () => {
  const demo = { id: 'demo', isDemo: true };
  const acme = { id: 'acme', isDemo: false };
  const other = { id: 'other', isDemo: false };

  it('is the brand on screen when it is one of the workspace’s own', () => {
    expect(ownBrandOf({ brands: [demo, acme, other], activeBrandId: 'other' })).toBe(other);
  });

  it('is the first own brand while the demo brand is on screen', () => {
    expect(ownBrandOf({ brands: [demo, acme, other], activeBrandId: 'demo' })).toBe(acme);
    expect(ownBrandOf({ brands: [demo, acme], activeBrandId: null })).toBe(acme);
  });

  it('is none before the workspace has a brand of its own', () => {
    expect(ownBrandOf({ brands: [demo], activeBrandId: 'demo' })).toBeNull();
    expect(ownBrandOf({ brands: [], activeBrandId: null })).toBeNull();
  });
});
