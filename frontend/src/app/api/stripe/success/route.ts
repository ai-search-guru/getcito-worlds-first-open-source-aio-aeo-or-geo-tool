import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { alignPromptsToPlanForOrg } from '@/lib/planEngines';
import { periodEndIso } from '@/lib/billing/periodEnd';
import { startFirstTrackingRun } from '@/lib/billing/firstRun';
import { hideDemoBrandAfterPurchase } from '@/lib/demo/hideAfterPurchase';
import { DASHBOARD_HOME } from '@/config/home';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (!sessionId) {
    return NextResponse.redirect(`${appUrl}${DASHBOARD_HOME}`);
  }

  let trackingJobId: string | null = null;

  try {
    // Retrieve and validate the Stripe checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    if (session.payment_status === 'paid' || session.status === 'complete') {
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;

      const subscription =
        typeof session.subscription === 'string'
          ? await stripe.subscriptions.retrieve(session.subscription)
          : session.subscription;

      const subscriptionId = subscription?.id;
      const orgId = (subscription as { metadata?: { organization_id?: string } })?.metadata
        ?.organization_id;
      const planId = (subscription as { metadata?: { plan_id?: string } })?.metadata?.plan_id;

      if (orgId && customerId && subscriptionId) {
        // As the webhook's checkout.session.completed writes it.
        const endsAt = periodEndIso(subscription);
        // Update org subscription (resolves webhook race condition)
        const { error: updateError } = await supabaseAdmin
          .from('organizations')
          .update({
            // What Stripe reports: trialing for a first subscription, active
            // for one started without a trial.
            subscription_status: subscription?.status ?? 'trialing',
            plan: planId || 'starter',
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            ...(endsAt ? { subscription_ends_at: endsAt } : {}),
          })
          .eq('id', orgId);

        if (updateError) {
          console.error('[stripe/success] DB update error:', updateError);
        } else {
          console.log('[stripe/success] DB updated for org:', orgId);

          // Align onboarding-created prompts to the just-confirmed plan's
          // engine set. Onboarding saves prompts at step 4 with the default
          // Starter set (2 scrapers); without this, a user who picks Growth
          // at step 6 still ends up tracking only those 2 engines (#78).
          // The shared helper is also called from the Stripe webhook so
          // upgrades / downgrades of existing orgs stay in sync (#79).
          try {
            const result = await alignPromptsToPlanForOrg(orgId, planId || 'starter');
            console.log(
              `[stripe/success] Aligned ${result.promptCount} prompt(s) to plan=${planId || 'starter'} (${result.platforms.length} scrapers, ${result.models.length} models) for org ${orgId}`,
            );
          } catch (alignErr) {
            console.error('[stripe/success] Plan-engine alignment threw:', alignErr);
          }

          // A plan bought: the demo brand steps aside before the dashboard
          // opens, whether or not the webhook came first, so the person lands
          // on their own brand (the layout lists no hidden brand, and the
          // brand kept from before falls back to the first one listed).
          await hideDemoBrandAfterPurchase(orgId, subscription?.status, 'stripe/success');

          // The first run, or the one the webhook already started for this
          // checkout: its id goes to the dashboard either way.
          trackingJobId = await startFirstTrackingRun({
            orgId,
            subscriptionStatus: subscription?.status,
            purchaseStarted: session.created,
            ctx: 'stripe/success',
          });
        }
      }
    }
  } catch (err) {
    console.error('[stripe/success] Error:', err);
  }

  // The first tracking run's id rides along: TrackingJobHandoff keeps it for
  // Visibility's progress bar.
  const redirectUrl = new URL(`${appUrl}${DASHBOARD_HOME}`);
  if (trackingJobId) {
    redirectUrl.searchParams.set('jobId', trackingJobId);
  }
  return NextResponse.redirect(redirectUrl.toString());
}
