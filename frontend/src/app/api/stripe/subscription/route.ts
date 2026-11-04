import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripe, priceIdFor } from '@/lib/stripe';
import { alignPromptsToPlanForOrg } from '@/lib/planEngines';
import { periodEndIso } from '@/lib/billing/periodEnd';
import { planChange, planRequestSchema, type BillingInterval } from '@/lib/billing/planPurchase';
import { planItemOf } from '@/lib/billing/addOns';

type SubscriptionItem = {
  id: string;
  current_period_end?: number;
  // A storage pack's item names its purchase here (lib/billing/addOns.ts).
  metadata?: Record<string, string> | null;
  price: {
    unit_amount: number | null;
    recurring: { interval: string } | null;
  };
};

type SubscriptionRaw = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  metadata: Record<string, string>;
  items: { data: SubscriptionItem[] };
  // Some older API versions still return this on the subscription itself.
  // Newer versions (2025-03-31+) moved it to subscription items.
  current_period_end?: number;
};

async function getOrgStripeIds() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) return null;

  const { data: org } = await supabase
    .from('organizations')
    .select(
      'id, plan, subscription_status, stripe_customer_id, stripe_subscription_id, subscription_ends_at',
    )
    .eq('id', profile.organization_id)
    .single();

  return org ? { ...org, role: profile.role as string | null } : null;
}

/** A card the charge needs was declined, or its bank wants it confirmed. */
function paymentFailed(err: unknown) {
  const message = err instanceof Error ? err.message : 'Payment failed';
  return NextResponse.json({ error: message, code: 'payment_failed' }, { status: 402 });
}

/** GET — current subscription details */
export async function GET() {
  try {
    const org = await getOrgStripeIds();
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!org.stripe_subscription_id) {
      return NextResponse.json({
        planId: org.plan ?? 'starter',
        status: org.subscription_status ?? 'inactive',
        currentPeriodEnd: org.subscription_ends_at,
        cancelAtPeriodEnd: false,
        priceAmount: null,
        interval: null,
      });
    }

    const sub = (await stripe.subscriptions.retrieve(
      org.stripe_subscription_id as string,
    )) as unknown as SubscriptionRaw;

    const item = planItemOf(sub.items.data);
    const price = item?.price;

    return NextResponse.json({
      planId: org.plan ?? 'starter',
      status: sub.status,
      currentPeriodEnd: periodEndIso(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      priceAmount: price?.unit_amount ? price.unit_amount / 100 : null,
      interval: price?.recurring?.interval ?? null,
    });
  } catch (err) {
    console.error('[stripe/subscription] GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

/** The subscription's billing period, from its plan item's price. */
function intervalOf(sub: SubscriptionRaw): BillingInterval | null {
  const interval = planItemOf(sub.items.data)?.price?.recurring?.interval;
  return interval === 'month' || interval === 'year' ? interval : null;
}

/** The subscription as GET returns it, after a change. */
function subscriptionBody(planId: string, sub: SubscriptionRaw) {
  const price = planItemOf(sub.items.data)?.price;
  return {
    planId,
    status: sub.status,
    currentPeriodEnd: periodEndIso(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    priceAmount: price?.unit_amount ? price.unit_amount / 100 : null,
    interval: price?.recurring?.interval ?? null,
  };
}

/**
 * PATCH — reactivate, change plan or billing period (upgrade/downgrade,
 * monthly ↔ annual), or buy a free trial now.
 */
export async function PATCH(req: NextRequest) {
  try {
    const org = await getOrgStripeIds();
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Buying, changing or reactivating the plan charges the organization's
    // card: admins only, as the Anthropic key and team management are.
    if (org.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can change the plan', code: 'admin_only' },
        { status: 403 },
      );
    }

    if (!org.stripe_subscription_id) {
      return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
    }

    const parsed = planRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const body = parsed.data;

    const subscriptionId = org.stripe_subscription_id as string;

    // Reactivate a canceled-at-period-end subscription
    if (body.reactivate) {
      const updated = (await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      })) as unknown as SubscriptionRaw;
      // Mirrored at once, as the webhook does after: the app-wide "plan
      // ends" band goes on the next page (00386).
      await supabaseAdmin
        .from('organizations')
        .update({ cancel_at_period_end: false })
        .eq('id', org.id);
      return NextResponse.json({
        status: updated.status,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: periodEndIso(updated),
      });
    }

    const currentSub = (await stripe.subscriptions.retrieve(
      subscriptionId,
    )) as unknown as SubscriptionRaw;
    // The plan's item: a storage pack's (CHAT-18) stays as it is.
    const itemId = planItemOf(currentSub.items.data)?.id;

    if (!itemId) {
      return NextResponse.json({ error: 'Subscription item not found' }, { status: 400 });
    }

    const change = planChange(
      {
        status: currentSub.status,
        planId: (org.plan as string | null) ?? 'starter',
        interval: intervalOf(currentSub),
      },
      body,
    );
    if (change.kind === 'refused') {
      return NextResponse.json({ error: change.error }, { status: 400 });
    }

    const priceId = priceIdFor(change.planId, change.interval);
    if (!priceId) {
      return NextResponse.json({ error: 'Price not configured' }, { status: 400 });
    }

    let updated: SubscriptionRaw;
    if (change.kind === 'buy_now') {
      let promotionCodeId: string | null = null;
      if (change.promoCode) {
        const { data: codes } = await stripe.promotionCodes.list({
          code: change.promoCode,
          active: true,
          limit: 1,
        });
        promotionCodeId = codes[0]?.id ?? null;
        if (!promotionCodeId) {
          return NextResponse.json(
            { error: "That promo code isn't valid", code: 'invalid_promo_code' },
            { status: 400 },
          );
        }
      }
      try {
        // The trial ends today and the first period is invoiced at once on
        // the card added for the trial. Nothing changes unless it's paid:
        // a declined card (or one its bank wants confirmed) is an error, and
        // the trial carries on.
        updated = (await stripe.subscriptions.update(subscriptionId, {
          items: [{ id: itemId, price: priceId }],
          trial_end: 'now',
          cancel_at_period_end: false,
          proration_behavior: 'none',
          payment_behavior: 'error_if_incomplete',
          ...(promotionCodeId ? { discounts: [{ promotion_code: promotionCodeId }] } : {}),
          metadata: { plan_id: change.planId, organization_id: org.id },
        })) as unknown as SubscriptionRaw;
      } catch (err) {
        return paymentFailed(err);
      }
    } else {
      try {
        // A new billing period is invoiced at once: as when buying, nothing
        // changes unless it's paid, so a declined card leaves the plan as it
        // was rather than on the new period and past due.
        updated = (await stripe.subscriptions.update(subscriptionId, {
          items: [{ id: itemId, price: priceId }],
          metadata: { plan_id: change.planId, organization_id: org.id },
          proration_behavior: 'create_prorations',
          payment_behavior: 'error_if_incomplete',
        })) as unknown as SubscriptionRaw;
      } catch (err) {
        return paymentFailed(err);
      }
    }

    // Optimistic DB update. Stripe has already accepted the change, so this
    // is the server mirroring its own decision, not the caller writing their
    // own plan — hence the service role, same as the webhook. The period end
    // too, as the webhook writes it: a trial bought now starts its first
    // period today, and the monthly quotas, AI usage among them, count from
    // that period (quotaPeriodStart), so the trial's usage is left behind at
    // once rather than when the webhook lands. Buying a trial now resumes it
    // too (cancel_at_period_end false, above): the app-wide "plan ends" band
    // goes at once (00386).
    const endsAt = periodEndIso(updated);
    await supabaseAdmin
      .from('organizations')
      .update({
        plan: change.planId,
        subscription_status: updated.status,
        ...(endsAt ? { subscription_ends_at: endsAt } : {}),
        ...(change.kind === 'buy_now' ? { cancel_at_period_end: false } : {}),
      })
      .eq('id', org.id);

    // Align prompts to the new plan's engine set so an upgrade actually
    // expands (Starter → Growth: 2 → 8 engines) or trims (Growth → Starter:
    // 8 → 2) the tracked engines. Same helper used by the Stripe success
    // route (#78) and the webhook (#79). We do it here too because PATCH
    // performs the optimistic plan write itself — by the time the matching
    // `subscription.updated` webhook arrives, the snapshot guard there
    // would see "plan unchanged" and skip alignment. A period change alone
    // keeps the plan's engines.
    if (change.planId !== org.plan) {
      try {
        const result = await alignPromptsToPlanForOrg(org.id, change.planId);
        console.log(
          `[stripe/subscription] Aligned ${result.promptCount} prompt(s) to plan=${change.planId} (${result.platforms.length} scrapers, ${result.models.length} models) for org ${org.id}`,
        );
      } catch (alignErr) {
        console.error('[stripe/subscription] Plan-engine alignment threw:', alignErr);
      }
    }

    return NextResponse.json(subscriptionBody(change.planId, updated));
  } catch (err) {
    console.error('[stripe/subscription] PATCH error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

/** DELETE — cancel subscription at period end (admins only, as changing the plan is) */
export async function DELETE() {
  try {
    const org = await getOrgStripeIds();
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (org.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can cancel the plan', code: 'admin_only' },
        { status: 403 },
      );
    }

    if (!org.stripe_subscription_id) {
      return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
    }

    const updated = (await stripe.subscriptions.update(org.stripe_subscription_id as string, {
      cancel_at_period_end: true,
    })) as unknown as SubscriptionRaw;
    // Mirrored at once, as the webhook does after: every page shows when the
    // plan ends (00386), with its period end.
    const endsAt = periodEndIso(updated);
    await supabaseAdmin
      .from('organizations')
      .update({
        cancel_at_period_end: true,
        ...(endsAt ? { subscription_ends_at: endsAt } : {}),
      })
      .eq('id', org.id);

    return NextResponse.json({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: periodEndIso(updated),
    });
  } catch (err) {
    console.error('[stripe/subscription] DELETE error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
