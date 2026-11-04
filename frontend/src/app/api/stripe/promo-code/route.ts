import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { takesPromoCode } from '@/lib/billing/planPurchase';
import { findPromotionCode } from '@/lib/billing/promoCode';

/** POST /api/stripe/promo-code's body. */
const promoCodeRequestSchema = z.object({ code: z.string().max(200) });

/**
 * POST /api/stripe/promo-code
 * Whether a promotion code typed in the plan dialog can be redeemed, and what
 * it takes off, read from Stripe: `{ valid: false }`, or the offer with
 * `monthlyOnly` (a code goes with a monthly plan only). Checkout checks the
 * code again; this only shows the price. Admins only, as buying a plan is.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = promoCodeRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();
    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (profile.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can change the plan', code: 'admin_only' },
        { status: 403 },
      );
    }

    // A code kept for one customer is only that customer's.
    const { data: org } = await supabase
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', profile.organization_id)
      .single();

    const found = await findPromotionCode(
      stripe,
      parsed.data.code,
      (org?.stripe_customer_id as string | null) ?? null,
    );
    if (!found) return NextResponse.json({ valid: false });
    return NextResponse.json({
      valid: true,
      ...found.offer,
      monthlyOnly: !takesPromoCode('year'),
    });
  } catch (err) {
    console.error('[stripe/promo-code]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
