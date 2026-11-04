/** The parts of a Stripe subscription that say when its current period ends. */
export type SubscriptionPeriod = {
  items?: { data?: Array<{ current_period_end?: number }> };
  // Some older API versions still return this on the subscription itself.
  current_period_end?: number;
};

/**
 * When the subscription's current period ends (while it trials, the trial's
 * end), as an ISO string: `organizations.subscription_ends_at`.
 *
 * Stripe API 2025-03-31 moved `current_period_end` from the subscription
 * onto each subscription item. Read item-level first, fall back to the
 * subscription-level for older API versions, and return null if neither is
 * present (so callers can skip emitting an Invalid Date).
 */
export function periodEndIso(sub: SubscriptionPeriod | null | undefined): string | null {
  const itemEnd = sub?.items?.data?.[0]?.current_period_end;
  const subEnd = sub?.current_period_end;
  const epochSeconds =
    typeof itemEnd === 'number' ? itemEnd : typeof subEnd === 'number' ? subEnd : null;
  if (epochSeconds == null) return null;
  return new Date(epochSeconds * 1000).toISOString();
}
