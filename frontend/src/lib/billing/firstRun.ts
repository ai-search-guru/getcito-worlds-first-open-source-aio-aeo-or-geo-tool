import { supabaseAdmin } from '@/lib/supabase/admin';
import { API_BASE_URL } from '@/config/api';
import { isSubscriptionActive } from '@/config/plans';

/** Each call to the API gets this long, so a slow server never holds up a webhook. */
const API_TIMEOUT_MS = 5_000;

/**
 * The organization's first brand that is not paused: the one onboarding
 * created. Never the demo brand (00380): it is sample data and never tracked.
 */
async function firstBrandId(orgId: string): Promise<string | null> {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .eq('is_demo', false)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return brand?.id ?? null;
}

async function callApi(path: string, body: Record<string, unknown>, cronSecret: string) {
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
}

/**
 * Start an organization's first tracking run after a purchase, from the
 * Stripe return page or the webhook, whichever comes first: the person may
 * close the tab before the return page loads, and the prompts saved in
 * onboarding would then wait for the nightly run. The webhook also starts it
 * when a delayed payment (SEPA, for one) goes through later. The API starts
 * one run per purchase (backend/src/lib/firstRun.js), so the second caller
 * gets the first one's job back; the API also starts the volume analysis
 * with the run it starts.
 *
 * Only for a subscription that is active or trialing: an incomplete one (a
 * payment not made) gets nothing. Resolves to the run's job id, for the
 * dashboard's progress bar, or null. Never throws: the payment is done
 * whatever happens here, and the nightly run tracks the brand anyway.
 */
export async function startFirstTrackingRun({
  orgId,
  subscriptionStatus,
  purchaseStarted,
  ctx,
}: {
  orgId: string;
  subscriptionStatus: string | null | undefined;
  /**
   * When the purchase began, in Stripe's Unix seconds: the Checkout
   * Session's `created`, or the subscription's.
   */
  purchaseStarted?: number | null;
  /** Who is asking, for the logs. */
  ctx: string;
}): Promise<string | null> {
  if (!isSubscriptionActive(subscriptionStatus)) {
    console.log(`[${ctx}] No first run: subscription is ${subscriptionStatus ?? 'missing'}`);
    return null;
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return null;

  try {
    const brandId = await firstBrandId(orgId);
    if (!brandId) return null;

    const since = purchaseStarted ? new Date(purchaseStarted * 1000).toISOString() : undefined;
    const res = await callApi('/api/internal/trigger-tracking', { brandId, since }, cronSecret);
    if (!res.ok) {
      console.error(`[${ctx}] First run trigger failed:`, res.status);
      return null;
    }
    const { jobId, created } = (await res.json()) as { jobId?: string; created?: boolean };
    console.log(
      `[${ctx}] First run ${created === false ? 'already started' : 'started'} for brand:`,
      brandId,
      'jobId:',
      jobId,
    );
    return jobId ?? null;
  } catch (err) {
    console.error(`[${ctx}] Failed to start the first run:`, err);
    return null;
  }
}
