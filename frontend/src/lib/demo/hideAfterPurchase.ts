import { isSubscriptionActive } from '@/config/plans';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Once a plan is bought, the organization's demo brand leaves the brand list:
 * hidden, never deleted (decided 2026-10-28), so the person lands on their own
 * brand and an admin can show it again from the brand menu. Called where a
 * new subscription starts — Stripe's checkout.session.completed and the
 * return from Checkout, whichever comes first, or the update that says a
 * delayed first payment went through — and never on a renewal or
 * another update: only a demo brand still shown is touched, so one an admin
 * showed again stays shown. A subscription Stripe doesn't count as started
 * (its first payment still open) hides nothing. Through the service role:
 * row-level security doesn't let members write the demo brand. Its sample
 * chats go with it (Chat's menu lists a person's chats of every brand);
 * shown again, the demo is rebuilt with them (the server's setDemoHidden).
 * Never throws: the purchase stands either way.
 */
export async function hideDemoBrandAfterPurchase(
  orgId: string,
  subscriptionStatus: string | null | undefined,
  ctx: string,
): Promise<void> {
  if (!isSubscriptionActive(subscriptionStatus)) return;
  try {
    const { data, error } = await supabaseAdmin
      .from('brands')
      .update({ demo_hidden_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('is_demo', true)
      .is('demo_hidden_at', null)
      .select('id');
    if (error) {
      console.error(`[${ctx}] Could not hide the demo brand of org ${orgId}:`, error);
      return;
    }
    const hidden = (data ?? []).map((brand) => brand.id);
    if (hidden.length === 0) return;
    const chats = await supabaseAdmin.from('chat_conversations').delete().in('brand_id', hidden);
    if (chats.error) {
      console.error(
        `[${ctx}] Could not remove the demo brand's chats of org ${orgId}:`,
        chats.error,
      );
    }
  } catch (err) {
    console.error(`[${ctx}] Hiding the demo brand threw for org ${orgId}:`, err);
  }
}
