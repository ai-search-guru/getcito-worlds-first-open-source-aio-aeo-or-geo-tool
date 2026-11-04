import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripe, PRICE_IDS, priceIdFor } from '@/lib/stripe';
import { TRIAL_DAYS, hasUsedTrial } from '@/lib/billing/trial';
import {
  CHECKOUT_MODES,
  FIRST_MONTH_CODE,
  subscriptionEnded,
  takesPromoCode,
} from '@/lib/billing/planPurchase';
import { findPromotionCode } from '@/lib/billing/promoCode';

/** POST /api/stripe/checkout's body. */
const checkoutSchema = z.object({
  planId: z.enum(['starter', 'growth']),
  organizationId: z.string().min(1),
  /** A year up front, from Billing's annual cards; monthly otherwise. */
  interval: z.enum(['month', 'year']).optional(),
  /** Where a canceled checkout goes back to: Billing, or onboarding's plan step. */
  returnTo: z.literal('billing').optional(),
  /**
   * `buy`: the full plan from day one, no trial. `trial`: the free trial, for
   * an organization that never had a subscription, with no promotion code.
   * A card is taken either way.
   */
  mode: z.enum(CHECKOUT_MODES),
  /**
   * A promotion code for a monthly plan bought now (the first-month offer, or
   * one the plan dialog checked): Checkout opens with it applied. Checked
   * again here; the caller's word isn't taken.
   */
  promotionCode: z.string().trim().min(1).max(64).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = checkoutSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const { planId, organizationId, interval, returnTo, mode, promotionCode } = parsed.data;
    // The trial comes without an offer: its code is the price of buying now.
    if (mode === 'trial' && promotionCode) {
      return NextResponse.json(
        { error: 'A free trial takes no promo code', code: 'promo_with_trial' },
        { status: 400 },
      );
    }

    // The org id arrives in the request body, so confirm the caller is
    // actually in it. Row-level security used to be the only thing standing
    // between this and another org's row; the customer id below is now
    // written with the service role, which answers to nothing but this check.
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (callerProfile?.organization_id !== organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Buying a plan charges the organization's card: admins only, as the
    // subscription route has it (a new account's creator is its admin).
    if (callerProfile.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can change the plan', code: 'admin_only' },
        { status: 403 },
      );
    }

    const priceId = priceIdFor(planId, interval === 'year' ? 'year' : 'month');
    if (!priceId) {
      console.error(
        '[stripe/checkout] Missing price ID for plan:',
        planId,
        'PRICE_IDS:',
        PRICE_IDS,
      );
      return NextResponse.json({ error: 'Price not configured for this plan' }, { status: 400 });
    }

    // Fetch org to check for existing Stripe customer
    const { data: org } = await supabase
      .from('organizations')
      .select('stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', organizationId)
      .single();

    // A subscription still there (billing, trialing, or a payment being
    // retried) is changed or fixed in Billing: a second Checkout would start
    // a second subscription on the same card.
    if (
      org?.stripe_subscription_id &&
      !subscriptionEnded(org.subscription_status as string | null)
    ) {
      return NextResponse.json(
        { error: 'This organization already has a subscription', code: 'subscription_exists' },
        { status: 409 },
      );
    }

    let customerId = org?.stripe_customer_id as string | null;

    // The free trial is for an organization's first subscription only: one
    // that had a subscription, or whose Stripe customer did (a trial taken
    // and canceled, a lapsed plan), buys now instead.
    if (
      mode === 'trial' &&
      (org?.stripe_subscription_id || (await hasUsedTrial(stripe, customerId)))
    ) {
      return NextResponse.json(
        { error: 'The free trial has been used', code: 'trial_unavailable' },
        { status: 409 },
      );
    }

    // A code goes with a monthly plan only (a year has its own discount), and
    // must be one Stripe can redeem now: looked up here, not taken on trust.
    // The first-month offer's own code, once Stripe no longer redeems it,
    // leaves the plan at its price, with Checkout's code box instead.
    let promotionCodeId: string | null = null;
    if (promotionCode) {
      if (!takesPromoCode(interval ?? 'month')) {
        return NextResponse.json(
          { error: 'Promo codes are for monthly plans', code: 'promo_code_monthly_only' },
          { status: 400 },
        );
      }
      const found = await findPromotionCode(stripe, promotionCode, customerId);
      if (found) {
        promotionCodeId = found.id;
      } else if (promotionCode.toUpperCase() !== FIRST_MONTH_CODE) {
        return NextResponse.json(
          { error: "That promo code isn't valid", code: 'invalid_promo_code' },
          { status: 400 },
        );
      } else {
        console.warn('[stripe/checkout] The first-month offer code is not redeemable now');
      }
    }

    // Create Stripe customer if none exists
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          organization_id: organizationId,
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;

      await supabaseAdmin
        .from('organizations')
        .update({ stripe_customer_id: customerId })
        .eq('id', organizationId);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const trial = mode === 'trial';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        ...(trial ? { trial_period_days: TRIAL_DAYS } : {}),
        metadata: { organization_id: organizationId, plan_id: planId },
      },
      // A card either way: the trial too, so the plan starts on its own when it ends.
      payment_method_collection: 'always',
      success_url: `${appUrl}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}${returnTo === 'billing' ? '/dashboard/settings/billing' : '/dashboard/onboarding'}`,
      // Stripe takes either a code applied here or its own code box, not both;
      // the trial takes neither.
      ...(promotionCodeId
        ? { discounts: [{ promotion_code: promotionCodeId }] }
        : trial
          ? {}
          : { allow_promotion_codes: true }),
      // Collect billing address + VAT/tax ID up front so invoices are
      // complete; later edits happen in the Customer Portal (/api/stripe/portal).
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      // Required when reusing an existing customer with the two options above:
      // Stripe needs permission to write the collected fields back onto them.
      customer_update: { address: 'auto', name: 'auto' },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[stripe/checkout]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
