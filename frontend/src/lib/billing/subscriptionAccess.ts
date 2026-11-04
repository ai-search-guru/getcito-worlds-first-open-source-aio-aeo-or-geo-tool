import type { TeamRole } from '@/components/context/RoleProvider';

// Type-only reference to the server client — no runtime import, so this helper
// stays free of server-module coupling.
type ServerSupabase = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

export type SubscriptionAccess =
  { state: 'ok' } | { state: 'choose_plan' } | { state: 'read_only'; adminName: string | null };

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Decide what an authenticated, onboarded org member may do when their org's
 * subscription is not active.
 *
 *   - active / trialing                 → 'ok'           (full access)
 *   - never subscribed + admin          → 'choose_plan'  (a new account that left
 *                                                         onboarding before its plan
 *                                                         step: back to that step),
 *                                                         unless the org has a demo
 *                                                         brand: 'read_only', so the
 *                                                         admin explores the demo
 *   - anything else                     → 'read_only'    (a trial that ended, a
 *                                                         canceled or unpaid plan:
 *                                                         every page opens, no
 *                                                         action runs until a plan
 *                                                         is chosen in Billing)
 *
 * "Never subscribed" is an org without a Stripe subscription id: onboarding
 * marks itself complete before its plan step, so a new account that stops at
 * the plan cards is onboarded but has never had a subscription. Once Stripe
 * has given one, the id stays, even after the subscription is deleted.
 *
 * Members other than admins can't buy a plan, so the read-only notices ask
 * them to turn to an admin: the org's first admin is named when the caller's
 * RLS client can read their row, and the wording falls back to a generic one
 * otherwise (never throws).
 */
export async function evaluateSubscriptionAccess(
  supabase: ServerSupabase,
  organizationId: string,
  role: TeamRole,
  subscriptionStatus: string | null,
  everSubscribed: boolean,
  {
    hasDemoBrand = false,
  }: {
    /**
     * The organization has a demo brand (onboarding's "Explore the demo"): an
     * admin who never subscribed browses it read-only instead of going back
     * to the plan step.
     */
    hasDemoBrand?: boolean;
  } = {},
): Promise<SubscriptionAccess> {
  if (subscriptionStatus && ACTIVE_STATUSES.has(subscriptionStatus)) {
    return { state: 'ok' };
  }
  if (role === 'admin') {
    return everSubscribed || hasDemoBrand
      ? { state: 'read_only', adminName: null }
      : { state: 'choose_plan' };
  }

  const { data: owner } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('organization_id', organizationId)
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return { state: 'read_only', adminName: (owner?.full_name as string | null) ?? null };
}

/** Why a workspace is read-only, as the upgrade notices say it. */
export type ReadOnlyReason = 'ended' | 'payment_failed';

/**
 * Why an action opens the upgrade dialog: the workspace is read-only (its
 * plan ended, a payment is being retried, or it never had a plan: 'trial',
 * whose dialog offers the free trial), or the brand on screen is the demo
 * brand ('demo'), whose dialog makes the demo's offer.
 */
export type UpgradeReason = ReadOnlyReason | 'trial' | 'demo';

/**
 * The reason, from Stripe's subscription status. A payment being retried
 * (`past_due`, `unpaid`) is fixed by updating the card in Stripe's billing
 * page. Anything else — a trial or a plan canceled, a first payment that
 * expired — reads the same: the row keeps no trace of whether it was a trial,
 * so the notices don't claim either.
 */
export function readOnlyReason(status: string | null | undefined): ReadOnlyReason {
  return status === 'past_due' || status === 'unpaid' ? 'payment_failed' : 'ended';
}
