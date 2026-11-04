import { NextResponse } from 'next/server';
import { isCloud, isSubscriptionActive } from '@/config/plans';
import { createClient } from '@/lib/supabase/server';
import { RoleRequiredError, roleRequiredResponse } from '@/lib/mcp/roleGate';

/**
 * GetCito Cloud's read-only mode for the web app's own writes: while a
 * workspace's plan isn't active — its trial ended, or it was canceled — the
 * server actions and Next routes that write straight to Supabase refuse, as
 * the API's requireActiveSubscription refuses its writes and the MCP surface
 * its tools (lib/mcp/subscriptionGate.ts). The buttons are guarded already;
 * this keeps the rule when an action is called anyway. Self-hosted is never
 * gated.
 */
export const SUBSCRIPTION_INACTIVE = {
  error: 'plan_limit',
  code: 'subscription_inactive',
  message:
    "This workspace's plan isn't active (its free trial ended or it was canceled), so it is " +
    'read-only: reading still works, but nothing can be changed, run or generated until an ' +
    'admin chooses a plan in Settings › Billing.',
} as const;

/**
 * A call that writes, runs or spends, refused while the workspace is
 * read-only. Its digest is the code: production masks a server action's
 * error but keeps a digest it was thrown with, so the browser can still tell
 * this refusal (isSubscriptionInactive in lib/apiFailure.ts) and open the
 * upgrade dialog.
 */
export class SubscriptionInactiveError extends Error {
  readonly code = SUBSCRIPTION_INACTIVE.code;
  readonly digest = SUBSCRIPTION_INACTIVE.code;

  constructor() {
    super(SUBSCRIPTION_INACTIVE.message);
    this.name = 'SubscriptionInactiveError';
  }
}

/**
 * The demo brand's refusal (00380): its data is a sample, so nothing on it
 * is changed, run or generated, whatever the plan. The API answers the same
 * code; the browser opens the plan dialog with the demo's offer.
 */
export const DEMO_BRAND = {
  error: 'demo_brand',
  code: 'demo_brand',
  message:
    'This is the demo brand: its data is a sample, so nothing on it can be changed, run or ' +
    'generated. Pick a plan to do this for your own brand.',
} as const;

/**
 * A write on the demo brand, refused. Its digest is the code, as
 * SubscriptionInactiveError's is, for the browser to tell it apart.
 */
export class DemoBrandError extends Error {
  readonly code = DEMO_BRAND.code;
  readonly digest = DEMO_BRAND.code;

  constructor() {
    super(DEMO_BRAND.message);
    this.name = 'DemoBrandError';
  }
}

/** The REST routes' answer to a write while read-only. */
export function subscriptionInactiveResponse(): NextResponse {
  return NextResponse.json(SUBSCRIPTION_INACTIVE, { status: 402 });
}

/**
 * A REST route's answer to a call that threw: 402 subscription_inactive when
 * it was refused (assertWritable, assertSubscriptionActive), 403 when the
 * key's user lacks the role for it (requireManager), else 500 with the
 * error's message.
 */
export function failedCallResponse(err: unknown): NextResponse {
  if (err instanceof SubscriptionInactiveError) return subscriptionInactiveResponse();
  if (err instanceof DemoBrandError) return NextResponse.json(DEMO_BRAND, { status: 402 });
  if (err instanceof RoleRequiredError) return roleRequiredResponse(err);
  const message = err instanceof Error ? err.message : 'Failed';
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Refuse a write while the signed-in person's workspace is read-only, before
 * anything is written. On the cloud it reads their organization through
 * their session and throws SubscriptionInactiveError unless its subscription
 * is active or trialing. A plan that can't be read refuses too (an Error),
 * and so does a call with no one signed in.
 *
 * `onboarding`: setup's own writes (the organization, the brand, its topics,
 * prompts and competitors), open to an organization that never had a
 * subscription, so setup works before its plan step — as the API's
 * ONBOARDING_ROUTES. A plan that ended still refuses them.
 *
 * `brandId`: the brand the action writes for. The demo brand (sample data)
 * refuses with DemoBrandError, whatever the plan; it is read beside the
 * plan, through the person's session. A brand they can't read is left to
 * the write itself, which their row-level security refuses.
 */
export async function assertWritable({
  onboarding = false,
  brandId = null,
}: { onboarding?: boolean; brandId?: string | null } = {}): Promise<void> {
  if (!isCloud()) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // The organization comes with the profile (profiles_organization_id_fkey): one round trip,
  // beside the brand's.
  const [{ data: profile, error }, brandRead] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'organization_id, organizations!profiles_organization_id_fkey(subscription_status, stripe_subscription_id)',
      )
      .eq('id', user.id)
      .maybeSingle(),
    brandId
      ? supabase.from('brands').select('is_demo').eq('id', brandId).maybeSingle()
      : Promise.resolve(null),
  ]);
  if (brandRead?.error) throw new Error(`Could not read the brand: ${brandRead.error.message}`);
  if (brandRead?.data?.is_demo) throw new DemoBrandError();
  if (error) throw new Error(`Could not read the workspace's plan: ${error.message}`);
  if (!profile) throw new SubscriptionInactiveError();
  // Setup creates the organization first: without one, nothing was ever subscribed.
  if (!profile.organization_id) {
    if (onboarding) return;
    throw new SubscriptionInactiveError();
  }

  const org = profile.organizations;
  if (!org) throw new SubscriptionInactiveError();
  if (isSubscriptionActive(org.subscription_status)) return;
  // Never subscribed: the Stripe subscription id, which only billing writes, stays once given.
  if (onboarding && !org.stripe_subscription_id) return;
  throw new SubscriptionInactiveError();
}

/**
 * A Next route's check before it writes: null when it may, else its answer —
 * 402 subscription_inactive while read-only, 500 when the plan can't be read.
 * Call it after the route's own sign-in check, so a missing session stays a 401.
 */
export async function writeRefusal(): Promise<NextResponse | null> {
  try {
    await assertWritable();
    return null;
  } catch (err) {
    return failedCallResponse(err);
  }
}
