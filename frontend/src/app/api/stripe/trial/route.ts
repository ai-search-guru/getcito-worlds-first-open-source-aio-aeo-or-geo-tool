import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { TRIAL_DAYS, hasUsedTrial } from '@/lib/billing/trial';

/**
 * GET /api/stripe/trial
 * Whether the caller's organization would get the free trial at checkout, so
 * the plan step does not promise one it will not give.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();
    const { data: org } = profile?.organization_id
      ? await supabase
          .from('organizations')
          .select('stripe_customer_id')
          .eq('id', profile.organization_id)
          .single()
      : { data: null };

    const used = await hasUsedTrial(stripe, org?.stripe_customer_id as string | null);
    return NextResponse.json({ trialAvailable: !used, trialDays: TRIAL_DAYS });
  } catch (err) {
    console.error('[stripe/trial]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
