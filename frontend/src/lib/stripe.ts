import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { telemetry: false });

export const PRICE_IDS = {
  starter: {
    monthly: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID!,
    annual: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID,
  },
  growth: {
    monthly: process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID!,
    annual: process.env.STRIPE_GROWTH_ANNUAL_PRICE_ID,
  },
} as const;

/** The Stripe price for a plan billed monthly or yearly; undefined when it isn't set up. */
export function priceIdFor(planId: string, interval: 'month' | 'year'): string | undefined {
  const prices = (PRICE_IDS as Record<string, { monthly?: string; annual?: string }>)[planId];
  return (interval === 'year' ? prices?.annual : prices?.monthly) || undefined;
}
