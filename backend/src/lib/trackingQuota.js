/**
 * On-demand tracking cost controls (cloud mode).
 *
 * Both user-triggered tracking entry points — POST /api/tracking/check and
 * POST /api/tracking/analyze-new — enqueue a real tracking job that spends
 * Cloro + LLM credits. They must enforce the same cloud-mode guards so neither
 * can be used to bypass billing:
 *
 *   1. an active (or trialing) subscription is required,
 *   2. a per-brand daily on-demand cap, and
 *   3. a per-brand cooldown between on-demand runs.
 *
 * Self-hosted installs (isCloud() === false) are unrestricted.
 *
 * Quota accounting keys off jobs whose `data` carries `onDemand: true`, so any
 * caller that goes through this guard must also tag its job with onDemand:true
 * (otherwise its runs won't count toward the cap / cooldown).
 */
import supabaseAdmin from '../config/supabase.js';
import { isCloud, getPlan, isSubscriptionActive } from '../config/plans.js';

/**
 * Carries the HTTP status + JSON body a route should return when a run is
 * blocked, so the existing response shapes are preserved exactly.
 */
export class TrackingQuotaError extends Error {
  constructor(statusCode, body) {
    super(body.message || 'Tracking quota exceeded');
    this.name = 'TrackingQuotaError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

/**
 * Enforce the cloud-mode subscription gate + daily on-demand limit + cooldown
 * for an on-demand tracking run. No-op when self-hosted. Throws
 * TrackingQuotaError when the run must be blocked.
 *
 * @param {string} brandId
 * @param {string} organizationId  the brand's organization_id
 */
export async function enforceOnDemandTrackingQuota(brandId, organizationId) {
  if (!isCloud()) return;

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan, subscription_status')
    .eq('id', organizationId)
    .single();

  // Block tracking outright when the org's Stripe subscription isn't active or
  // trialing. Previously this fell back to starter limits, which let
  // unsubscribed signups run jobs silently.
  if (!isSubscriptionActive(org?.subscription_status)) {
    throw new TrackingQuotaError(402, {
      message:
        'An active subscription or free trial is required to run tracking. Please choose a plan to continue.',
    });
  }

  const plan = getPlan(org.plan);
  const { maxDailyOnDemand, onDemandCooldownMinutes } = plan.limits;

  // Daily on-demand limit
  if (maxDailyOnDemand !== -1) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: todayCount } = await supabaseAdmin
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('type', 'tracking')
      .gte('created_at', todayStart.toISOString())
      .contains('data', { onDemand: true });

    if ((todayCount || 0) >= maxDailyOnDemand) {
      throw new TrackingQuotaError(429, {
        success: false,
        message: `Daily on-demand analysis limit reached (${maxDailyOnDemand}/day). Next analyses will run with the daily scheduled job.`,
        limit: maxDailyOnDemand,
      });
    }
  }

  // Cooldown between on-demand runs
  if (onDemandCooldownMinutes > 0) {
    const cooldownCutoff = new Date(Date.now() - onDemandCooldownMinutes * 60 * 1000).toISOString();

    const { data: recentJobs } = await supabaseAdmin
      .from('jobs')
      .select('created_at')
      .eq('brand_id', brandId)
      .eq('type', 'tracking')
      .contains('data', { onDemand: true })
      .gte('created_at', cooldownCutoff)
      .limit(1);

    if (recentJobs && recentJobs.length > 0) {
      const nextAvailable = new Date(
        new Date(recentJobs[0].created_at).getTime() + onDemandCooldownMinutes * 60 * 1000,
      );
      const minutesLeft = Math.ceil((nextAvailable.getTime() - Date.now()) / 60_000);
      throw new TrackingQuotaError(429, {
        success: false,
        message: `Please wait ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''} before running another analysis.`,
        retryAfterMinutes: minutesLeft,
      });
    }
  }
}
