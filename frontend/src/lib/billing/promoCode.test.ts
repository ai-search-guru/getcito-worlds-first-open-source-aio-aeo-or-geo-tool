import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { discountedPrice, findPromotionCode, type PromoOffer } from './promoCode';

const offer = (over: Partial<PromoOffer>): PromoOffer => ({
  code: 'X',
  percentOff: null,
  amountOff: null,
  duration: 'once',
  durationInMonths: null,
  ...over,
});

describe('discountedPrice', () => {
  it('takes a percentage off, to the cent', () => {
    expect(discountedPrice(49, offer({ percentOff: 50 }))).toBe(24.5);
    expect(discountedPrice(249, offer({ percentOff: 50 }))).toBe(124.5);
    expect(discountedPrice(49, offer({ percentOff: 15 }))).toBe(41.65);
  });

  it('takes dollars off, never below zero', () => {
    expect(discountedPrice(49, offer({ amountOff: 10 }))).toBe(39);
    expect(discountedPrice(49, offer({ amountOff: 100 }))).toBe(0);
  });
});

/** A Stripe promotion code on a coupon, as the list expands it. */
const promo = (over: Record<string, unknown> = {}, coupon: Record<string, unknown> = {}) => ({
  id: 'promo_1',
  code: 'SAVE50',
  active: true,
  customer: null,
  expires_at: null,
  max_redemptions: null,
  times_redeemed: 0,
  promotion: {
    type: 'coupon',
    coupon: {
      valid: true,
      percent_off: 50,
      amount_off: null,
      currency: null,
      duration: 'once',
      duration_in_months: null,
      ...coupon,
    },
  },
  ...over,
});

function stripeWith(data: unknown[]) {
  const list = vi.fn(async () => ({ data }));
  return { client: { promotionCodes: { list } } as unknown as Stripe, list };
}

describe('findPromotionCode', () => {
  it('reads what an active code takes off, matched in any case', async () => {
    const { client, list } = stripeWith([promo()]);
    expect(await findPromotionCode(client, ' save50 ', 'cus_1')).toEqual({
      id: 'promo_1',
      offer: {
        code: 'SAVE50',
        percentOff: 50,
        amountOff: null,
        duration: 'once',
        durationInMonths: null,
      },
    });
    expect(list).toHaveBeenCalledWith({
      code: 'save50',
      active: true,
      limit: 1,
      expand: ['data.promotion.coupon'],
    });
  });

  it('reads US dollars off in dollars', async () => {
    const { client } = stripeWith([
      promo(
        {},
        {
          percent_off: null,
          amount_off: 1000,
          currency: 'usd',
          duration: 'repeating',
          duration_in_months: 3,
        },
      ),
    ]);
    expect((await findPromotionCode(client, 'TEN', null))?.offer).toMatchObject({
      percentOff: null,
      amountOff: 10,
      duration: 'repeating',
      durationInMonths: 3,
    });
  });

  it('refuses a code Stripe does not have, without asking for anything not a code', async () => {
    const { client, list } = stripeWith([]);
    expect(await findPromotionCode(client, 'NOPE', null)).toBeNull();
    expect(await findPromotionCode(client, 'not a code!', null)).toBeNull();
    expect(await findPromotionCode(client, '', null)).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('refuses a code that cannot be redeemed now', async () => {
    const cases = [
      promo({ active: false }),
      promo({ expires_at: Math.floor(Date.now() / 1000) - 60 }),
      promo({ max_redemptions: 5, times_redeemed: 5 }),
      promo({ customer: 'cus_other' }),
      promo({}, { valid: false }),
      promo({}, { percent_off: null, amount_off: 1000, currency: 'eur' }),
      promo({ promotion: { type: 'coupon', coupon: 'coupon_1' } }),
    ];
    for (const code of cases) {
      const { client } = stripeWith([code]);
      expect(await findPromotionCode(client, 'SAVE50', 'cus_1')).toBeNull();
    }
  });

  it("takes a code kept for this customer, and one that hasn't expired yet", async () => {
    const { client } = stripeWith([
      promo({ customer: 'cus_1', expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    ]);
    expect(await findPromotionCode(client, 'SAVE50', 'cus_1')).not.toBeNull();
  });
});
