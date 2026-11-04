import { describe, expect, it } from 'vitest';
import { addMonthsUtc, addOnOnSale, planItemOf, purchaseIdOf } from './addOns';

const PURCHASE = 'a0000000-0000-4000-8000-000000000001';

describe('add-on packs', () => {
  it('are on sale only while active with a Stripe price', () => {
    expect(addOnOnSale({ active: true, stripe_price_id: 'price_1' })).toBe(true);
    expect(addOnOnSale({ active: true, stripe_price_id: null })).toBe(false);
    expect(addOnOnSale({ active: false, stripe_price_id: 'price_1' })).toBe(false);
  });

  it('name their purchase in Stripe metadata, and nothing else passes for one', () => {
    expect(purchaseIdOf({ add_on_purchase_id: PURCHASE })).toBe(PURCHASE);
    expect(purchaseIdOf({ add_on_purchase_id: 'not-an-id' })).toBeNull();
    expect(purchaseIdOf({ plan_id: 'growth' })).toBeNull();
    expect(purchaseIdOf(null)).toBeNull();
  });

  it('last whole months, on the month’s last day when it is shorter', () => {
    const at = (iso: string, months: number) => addMonthsUtc(new Date(iso), months).toISOString();
    expect(at('2026-10-30T10:00:00.000Z', 12)).toBe('2027-10-30T10:00:00.000Z');
    expect(at('2027-01-31T08:00:00.000Z', 1)).toBe('2027-02-28T08:00:00.000Z');
    expect(at('2027-12-31T23:59:00.000Z', 2)).toBe('2028-02-29T23:59:00.000Z');
  });

  it('never take the plan’s place on its subscription', () => {
    const pack = { id: 'si_pack', metadata: { add_on_purchase_id: PURCHASE } };
    const plan = { id: 'si_plan', metadata: {} };
    expect(planItemOf([pack, plan])).toBe(plan);
    expect(planItemOf([plan, pack])).toBe(plan);
    expect(planItemOf([])).toBeUndefined();
  });
});
