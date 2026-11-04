/**
 * One-off: fill organizations.subscription_ends_at from Stripe for
 * subscriptions saved before #1358, whose period end is empty or already past.
 *
 * Run from frontend/, with the production Stripe and Supabase keys:
 *   node --env-file=<env file> scripts/backfill-subscription-ends-at.mjs           # dry run
 *   node --env-file=<env file> scripts/backfill-subscription-ends-at.mjs --apply   # write
 *
 * Needs STRIPE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Scope: organizations with a stripe_subscription_id whose status is active,
 * trialing or past_due. Canceled ones are left alone. Only
 * subscription_ends_at is written, the same value the webhook's
 * customer.subscription.updated writes (lib/billing/periodEnd.ts). When
 * Stripe's status differs from the stored one, it's printed, not written:
 * the next webhook event syncs it. Safe to run again.
 */
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const APPLY = process.argv.includes('--apply');
const STATUSES = ['active', 'trialing', 'past_due'];

for (const name of ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[name]) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Same rule as periodEndIso in lib/billing/periodEnd.ts: item-level first,
// then the subscription's own (older API versions).
function periodEndIso(sub) {
  const itemEnd = sub?.items?.data?.[0]?.current_period_end;
  const subEnd = sub?.current_period_end;
  const seconds =
    typeof itemEnd === 'number' ? itemEnd : typeof subEnd === 'number' ? subEnd : null;
  return seconds == null ? null : new Date(seconds * 1000).toISOString();
}

const now = new Date().toISOString();
const { data: orgs, error } = await supabase
  .from('organizations')
  .select('id, subscription_status, subscription_ends_at, stripe_subscription_id')
  .not('stripe_subscription_id', 'is', null)
  .in('subscription_status', STATUSES)
  .or(`subscription_ends_at.is.null,subscription_ends_at.lt."${now}"`);

if (error) {
  console.error('Reading organizations failed:', error.message);
  process.exit(1);
}

console.log(`${orgs.length} organization(s) to check${APPLY ? '' : ' (dry run)'}.`);

let written = 0;
let failed = 0;
for (const org of orgs) {
  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
  } catch (err) {
    failed++;
    console.error(`  ${org.id}: Stripe read failed: ${err.message}`);
    continue;
  }

  const endsAt = periodEndIso(sub);
  const statusNote =
    sub.status !== org.subscription_status
      ? ` (status: stored ${org.subscription_status}, Stripe ${sub.status})`
      : '';
  console.log(
    `  ${org.id}: ${org.subscription_ends_at ?? 'null'} → ${endsAt ?? 'none'}${statusNote}`,
  );

  if (!APPLY || !endsAt || endsAt === org.subscription_ends_at) continue;

  const { error: updateError } = await supabase
    .from('organizations')
    .update({ subscription_ends_at: endsAt })
    .eq('id', org.id);
  if (updateError) {
    failed++;
    console.error(`  ${org.id}: update failed: ${updateError.message}`);
  } else {
    written++;
  }
}

console.log(
  APPLY
    ? `Done: ${written} written, ${failed} failed.`
    : `Dry run: nothing written, ${failed} failed.`,
);
if (failed) process.exitCode = 1;
