import type Stripe from 'stripe';

/** Length of the free trial a first subscription starts with. */
export const TRIAL_DAYS = 14;

/** The day a free trial started now ends, as Checkout's trial_period_days counts it. */
export function trialEndDate(now: number = Date.now(), days: number = TRIAL_DAYS): Date {
  return new Date(now + days * 24 * 60 * 60 * 1000);
}

/**
 * Whether this Stripe customer has already had a subscription, and with it
 * the free trial.
 *
 * Checkout used to start every subscription with a trial. An organization
 * could take the trial, cancel before it ended, subscribe again and get
 * another one — indefinitely, with the same account and card. The trial is
 * now for a customer's first subscription only. Every subscription a customer
 * ever had is listed by Stripe (status 'all' includes canceled and expired
 * ones), so one result is enough to know.
 */
export async function hasUsedTrial(
  client: Pick<Stripe, 'subscriptions'>,
  customerId: string | null | undefined,
): Promise<boolean> {
  if (!customerId) return false;
  const { data } = await client.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 1,
  });
  return data.length > 0;
}
