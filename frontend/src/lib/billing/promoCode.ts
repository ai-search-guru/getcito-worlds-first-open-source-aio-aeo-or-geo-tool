import type Stripe from 'stripe';
import { z } from 'zod';

/**
 * What a promotion code takes off, as the plan dialog shows it: a percentage
 * or an amount in dollars, for the first invoice (`once`), a number of
 * months (`repeating`) or every one (`forever`).
 */
export interface PromoOffer {
  /** The code as Stripe has it, whatever case it was typed in. */
  code: string;
  percentOff: number | null;
  /** Dollars off each discounted invoice; prices are in USD. */
  amountOff: number | null;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths: number | null;
}

/** A promotion code as typed: Stripe's own characters, letters, digits and dashes. */
export const promoCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/);

/**
 * A plan's price for its first discounted period with the offer, rounded to
 * the cent and never below zero.
 */
export function discountedPrice(price: number, offer: PromoOffer): number {
  const cents = Math.round(price * 100);
  const off =
    offer.percentOff != null
      ? Math.round((cents * offer.percentOff) / 100)
      : Math.round((offer.amountOff ?? 0) * 100);
  return Math.max(0, cents - off) / 100;
}

/**
 * The Stripe promotion code a customer typed, when it can be redeemed now:
 * active, not expired or used up, not kept for another customer, on a valid
 * coupon that takes a percentage or US dollars off. Null otherwise, and for
 * anything that isn't a code at all. Stripe matches the code in any case.
 */
export async function findPromotionCode(
  client: Pick<Stripe, 'promotionCodes'>,
  code: string,
  customerId: string | null | undefined,
): Promise<{ id: string; offer: PromoOffer } | null> {
  const typed = promoCodeSchema.safeParse(code);
  if (!typed.success) return null;
  const { data } = await client.promotionCodes.list({
    code: typed.data,
    active: true,
    limit: 1,
    expand: ['data.promotion.coupon'],
  });
  const promo = data[0];
  if (!promo?.active) return null;
  const now = Math.floor(Date.now() / 1000);
  if (promo.expires_at != null && promo.expires_at <= now) return null;
  if (promo.max_redemptions != null && promo.times_redeemed >= promo.max_redemptions) return null;
  const restrictedTo = typeof promo.customer === 'string' ? promo.customer : promo.customer?.id;
  if (restrictedTo && restrictedTo !== customerId) return null;

  const coupon = promo.promotion?.coupon;
  if (!coupon || typeof coupon === 'string' || !coupon.valid) return null;
  const percentOff = coupon.percent_off ?? null;
  const amountOff =
    coupon.amount_off != null && coupon.currency?.toLowerCase() === 'usd'
      ? coupon.amount_off / 100
      : null;
  if (!(percentOff && percentOff > 0) && !(amountOff && amountOff > 0)) return null;

  return {
    id: promo.id,
    offer: {
      code: promo.code,
      percentOff: percentOff && percentOff > 0 ? percentOff : null,
      amountOff: percentOff && percentOff > 0 ? null : amountOff,
      duration: coupon.duration,
      durationInMonths: coupon.duration_in_months ?? null,
    },
  };
}
