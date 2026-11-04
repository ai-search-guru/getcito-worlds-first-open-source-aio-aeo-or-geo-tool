import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { TRIAL_DAYS, hasUsedTrial, trialEndDate } from './trial';

const client = (subscriptions: unknown[]) => {
  const list = vi.fn().mockResolvedValue({ data: subscriptions });
  return { client: { subscriptions: { list } } as unknown as Pick<Stripe, 'subscriptions'>, list };
};

describe('hasUsedTrial', () => {
  it('gives a customer with no subscription history the trial', async () => {
    const { client: c } = client([]);
    expect(await hasUsedTrial(c, 'cus_new')).toBe(false);
  });

  it('withholds it once any subscription existed, canceled ones included', async () => {
    const { client: c, list } = client([{ id: 'sub_old', status: 'canceled' }]);
    expect(await hasUsedTrial(c, 'cus_returning')).toBe(true);
    expect(list).toHaveBeenCalledWith({ customer: 'cus_returning', status: 'all', limit: 1 });
  });

  it('does not ask Stripe before a customer exists', async () => {
    const { client: c, list } = client([]);
    expect(await hasUsedTrial(c, null)).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('trialEndDate', () => {
  it('ends a trial started now 14 days later, as Checkout counts it', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(TRIAL_DAYS).toBe(14);
    expect(trialEndDate(now).toISOString()).toBe('2026-11-11T12:00:00.000Z');
    expect(trialEndDate(now, 7).toISOString()).toBe('2026-11-04T12:00:00.000Z');
  });
});
