import { z } from 'zod';
import {
  FIRST_MONTH_OFFER,
  PLANS,
  SUBSCRIBABLE_PLANS,
  firstMonthOfferOn,
  type PlanId,
} from '@/config/plans';
import { discountedPrice, type PromoOffer } from './promoCode';

/** How often a subscription bills, as Stripe's `recurring.interval` names it. */
export type BillingInterval = 'month' | 'year';

/**
 * The first-month offer's code (FIRST_MONTH_OFFER): a Stripe promotion code
 * for a 50% off, once-only coupon on Starter and Growth. Billing fills it in
 * when a trial is bought monthly, and "Buy now" applies it at Checkout.
 */
export const FIRST_MONTH_CODE: string = FIRST_MONTH_OFFER.code;

/**
 * How a new subscription starts at Checkout, both with a card: `buy` bills
 * the full plan from day one (the first-month offer on a monthly plan);
 * `trial` starts the free trial, with no offer, for an organization that
 * never had a subscription.
 */
export const CHECKOUT_MODES = ['buy', 'trial'] as const;
export type CheckoutMode = (typeof CHECKOUT_MODES)[number];

/**
 * What a band or a title can offer, in words: the free trial (only a
 * workspace that never had a subscription), the first-month offer (while
 * it's on), both, or neither.
 */
export type OfferChoice = 'both' | 'trial' | 'discount' | 'none';

/**
 * How a new plan starts, as the start selector above the plan cards picks
 * it: the free trial (billed monthly once it ends), or bought now, monthly
 * (where a code such as the first-month offer applies) or a year up front.
 */
export type StartChoice = 'trial' | 'month' | 'year';

/** The billing period a start choice subscribes to. */
export function choicePeriod(choice: StartChoice): BillingInterval {
  return choice === 'year' ? 'year' : 'month';
}

/** How Checkout starts for a start choice. */
export function choiceMode(choice: StartChoice): CheckoutMode {
  return choice === 'trial' ? 'trial' : 'buy';
}

/**
 * What a plan costs on the day it starts: nothing for the free trial, the
 * first month with the code's discount (`discounted`, monthly only), or the
 * period's price. Null for a plan with no price.
 */
export function dueToday(
  planId: PlanId,
  choice: StartChoice,
  discounted: PromoOffer | null,
): number | null {
  if (choice === 'trial') return 0;
  const price = periodPrice(planId, choicePeriod(choice));
  if (price == null) return null;
  return choice === 'month' && discounted ? discountedPrice(price, discounted) : price;
}

/** A monthly price's first month with the first-month offer, to the cent. */
export function firstMonthPrice(monthly: number): number {
  return Math.round(monthly * (100 - FIRST_MONTH_OFFER.percentOff)) / 100;
}

export function offerChoice(trialAvailable: boolean, offerOn = firstMonthOfferOn()): OfferChoice {
  if (trialAvailable) return offerOn ? 'both' : 'trial';
  return offerOn ? 'discount' : 'none';
}

/**
 * Whether a promotion code goes with this billing period: a monthly plan
 * only, since a year up front has its own discount.
 */
export function takesPromoCode(interval: BillingInterval): boolean {
  return interval === 'month';
}

/** A plan's price for one billing period, from the config; null when it has none. */
export function periodPrice(planId: PlanId, interval: BillingInterval): number | null {
  const pricing = PLANS[planId].pricing;
  if (!pricing) return null;
  return interval === 'year' ? (pricing.annual ?? null) : pricing.monthly;
}

/** What paying a year up front saves against twelve months, in whole percent. */
export function annualSaving(planId: PlanId): number | null {
  const pricing = PLANS[planId].pricing;
  if (!pricing?.annual) return null;
  return Math.round((1 - pricing.annual / (pricing.monthly * 12)) * 100);
}

/** PATCH /api/stripe/subscription's body. */
export const planRequestSchema = z.object({
  newPlanId: z.enum(['starter', 'growth']).optional(),
  interval: z.enum(['month', 'year']).optional(),
  reactivate: z.boolean().optional(),
  /** End a free trial today on the chosen plan and period; the card on file pays at once. */
  buyNow: z.boolean().optional(),
  promoCode: z.string().trim().max(64).optional(),
});

export type PlanRequest = z.infer<typeof planRequestSchema>;

export type PlanChange =
  | { kind: 'buy_now'; planId: PlanId; interval: BillingInterval; promoCode: string | null }
  | { kind: 'change'; planId: PlanId; interval: BillingInterval }
  | { kind: 'refused'; error: string };

/**
 * What a plan request asks of the organization's subscription.
 *
 *  - buy now: only while it's trialing. The trial ends today on the plan and
 *    period asked for (any of them: a Starter trial can buy Growth, or a
 *    year), and the card added for the trial pays the first period at once.
 *    A promotion code only goes with a monthly plan: a year up front has its
 *    own discount.
 *  - change: another plan or period on the same subscription, prorated. A
 *    trial carries on through it.
 */
export function planChange(
  current: { status: string; planId: string; interval: BillingInterval | null },
  request: Pick<PlanRequest, 'newPlanId' | 'interval' | 'buyNow' | 'promoCode'>,
): PlanChange {
  const planId = (request.newPlanId ?? current.planId) as PlanId;
  const interval = request.interval ?? current.interval ?? 'month';
  if (!SUBSCRIBABLE_PLANS.includes(planId)) return { kind: 'refused', error: 'Invalid plan' };

  if (request.buyNow) {
    if (current.status !== 'trialing') {
      return { kind: 'refused', error: 'Only a free trial can be bought now' };
    }
    const promoCode = takesPromoCode(interval) ? request.promoCode || null : null;
    return { kind: 'buy_now', planId, interval, promoCode };
  }

  if (planId === current.planId && interval === (current.interval ?? 'month')) {
    return { kind: 'refused', error: 'Already on this plan' };
  }
  return { kind: 'change', planId, interval };
}

/**
 * Stripe statuses with a subscription still there to change or fix: billing
 * on it, a payment being retried (`past_due`, `unpaid`; the card is updated
 * in Stripe's billing page), or a trial paused for a card.
 */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused']);

/**
 * Whether the organization has no subscription left to change — a canceled
 * plan, an expired first payment, or none ever — so choosing a plan starts a
 * new one through Checkout instead of changing the old one, which Stripe
 * refuses once it has ended.
 */
export function subscriptionEnded(status: string | null | undefined): boolean {
  return !status || !LIVE_STATUSES.has(status);
}
