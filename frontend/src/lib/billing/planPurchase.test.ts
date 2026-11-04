import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRST_MONTH_OFFER, firstMonthOfferOn } from '@/config/plans';
import {
  FIRST_MONTH_CODE,
  annualSaving,
  choiceMode,
  choicePeriod,
  dueToday,
  firstMonthPrice,
  offerChoice,
  periodPrice,
  planChange,
  planRequestSchema,
  subscriptionEnded,
  takesPromoCode,
} from './planPurchase';
import type { PromoOffer } from './promoCode';

describe('plan prices', () => {
  it('reads a month or a year up front from the config', () => {
    expect(periodPrice('starter', 'month')).toBe(49);
    expect(periodPrice('starter', 'year')).toBe(470);
    expect(periodPrice('growth', 'month')).toBe(249);
    expect(periodPrice('growth', 'year')).toBe(2390);
    expect(periodPrice('enterprise', 'month')).toBeNull();
  });

  it('saves 20% on a year against twelve months', () => {
    expect(annualSaving('starter')).toBe(20);
    expect(annualSaving('growth')).toBe(20);
    expect(annualSaving('enterprise')).toBeNull();
  });
});

describe('planChange', () => {
  const trial = { status: 'trialing', planId: 'starter', interval: 'month' as const };
  const paid = { status: 'active', planId: 'starter', interval: 'month' as const };

  it('buys a trial now on any plan and period', () => {
    expect(planChange(trial, { buyNow: true })).toEqual({
      kind: 'buy_now',
      planId: 'starter',
      interval: 'month',
      promoCode: null,
    });
    expect(
      planChange(trial, { buyNow: true, newPlanId: 'growth', interval: 'year', promoCode: 'X' }),
    ).toEqual({ kind: 'buy_now', planId: 'growth', interval: 'year', promoCode: null });
  });

  it('takes a promo code only with a monthly plan', () => {
    expect(
      planChange(trial, {
        buyNow: true,
        newPlanId: 'growth',
        interval: 'month',
        promoCode: 'SAVE50',
      }),
    ).toMatchObject({ kind: 'buy_now', promoCode: 'SAVE50' });
  });

  it('buys nothing now once the trial is over', () => {
    expect(planChange(paid, { buyNow: true, newPlanId: 'growth' })).toEqual({
      kind: 'refused',
      error: 'Only a free trial can be bought now',
    });
  });

  it('changes the plan, the period or both on a paid plan', () => {
    expect(planChange(paid, { newPlanId: 'growth' })).toEqual({
      kind: 'change',
      planId: 'growth',
      interval: 'month',
    });
    expect(planChange(paid, { interval: 'year' })).toEqual({
      kind: 'change',
      planId: 'starter',
      interval: 'year',
    });
    expect(planChange(paid, { newPlanId: 'starter', interval: 'month' })).toEqual({
      kind: 'refused',
      error: 'Already on this plan',
    });
  });

  it('refuses a plan that is not for sale', () => {
    expect(planChange({ ...paid, planId: 'enterprise' }, { interval: 'year' })).toEqual({
      kind: 'refused',
      error: 'Invalid plan',
    });
    expect(planRequestSchema.safeParse({ newPlanId: 'enterprise' }).success).toBe(false);
    expect(planRequestSchema.safeParse({ interval: 'week' }).success).toBe(false);
  });
});

describe('subscriptionEnded', () => {
  it('keeps a subscription that is billing, trialing or retrying a payment', () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused']) {
      expect(subscriptionEnded(status)).toBe(false);
    }
  });

  it('starts a new one after a cancel, an expired first payment, or none ever', () => {
    for (const status of ['canceled', 'incomplete_expired', 'incomplete', 'inactive', null]) {
      expect(subscriptionEnded(status)).toBe(true);
    }
    expect(subscriptionEnded(undefined)).toBe(true);
  });
});

describe('takesPromoCode', () => {
  it('takes a code with a monthly plan only: a year has its own discount', () => {
    expect(takesPromoCode('month')).toBe(true);
    expect(takesPromoCode('year')).toBe(false);
  });
});

describe('the first-month offer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is SAVE50, half off the first month of a monthly plan', () => {
    expect(FIRST_MONTH_OFFER).toEqual({ code: 'SAVE50', percentOff: 50, period: 'monthly' });
    expect(FIRST_MONTH_CODE).toBe('SAVE50');
    expect(firstMonthPrice(49)).toBe(24.5);
    expect(firstMonthPrice(249)).toBe(124.5);
  });

  it('is on until NEXT_PUBLIC_FIRST_MONTH_OFFER says off', () => {
    expect(firstMonthOfferOn()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_FIRST_MONTH_OFFER', 'off');
    expect(firstMonthOfferOn()).toBe(false);
  });

  it('words what a workspace is offered: the trial only before a first subscription', () => {
    expect(offerChoice(true, true)).toBe('both');
    expect(offerChoice(true, false)).toBe('trial');
    expect(offerChoice(false, true)).toBe('discount');
    expect(offerChoice(false, false)).toBe('none');
    vi.stubEnv('NEXT_PUBLIC_FIRST_MONTH_OFFER', 'off');
    expect(offerChoice(true)).toBe('trial');
  });
});

describe('how a plan starts', () => {
  const save50: PromoOffer = {
    code: 'SAVE50',
    percentOff: 50,
    amountOff: null,
    duration: 'once',
    durationInMonths: null,
  };

  it('starts the trial and Monthly on a month, a year on a year', () => {
    expect(choicePeriod('trial')).toBe('month');
    expect(choicePeriod('month')).toBe('month');
    expect(choicePeriod('year')).toBe('year');
    expect(choiceMode('trial')).toBe('trial');
    expect(choiceMode('month')).toBe('buy');
    expect(choiceMode('year')).toBe('buy');
  });

  it('has nothing due today for the trial, the first month with the code, a year at its price', () => {
    expect(dueToday('starter', 'trial', save50)).toBe(0);
    expect(dueToday('starter', 'month', save50)).toBe(24.5);
    expect(dueToday('growth', 'month', save50)).toBe(124.5);
    expect(dueToday('starter', 'month', null)).toBe(49);
    // A code is for buying monthly: a year has its own discount.
    expect(dueToday('starter', 'year', save50)).toBe(470);
    expect(dueToday('growth', 'year', null)).toBe(2390);
  });
});
