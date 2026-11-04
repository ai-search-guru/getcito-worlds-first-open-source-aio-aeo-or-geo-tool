import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { loadStripe } from '@/lib/billing/addOns';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/add-ons/invoice/{purchaseId}: a pack's invoice (CHAT-18 item 17),
 * from Settings › Billing › Add-ons. Billing is the Admins': an Admin of the
 * purchase's workspace is sent on to the invoice's PDF (or Stripe's invoice
 * page while the PDF isn't ready); anyone else gets 403 or 404. The invoice
 * is looked up only when it is asked for, not each time Billing opens, and
 * Stripe is loaded only then (loadStripe): without its key, 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  try {
    const { purchaseId } = await params;
    if (!UUID.test(purchaseId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();
    const organizationId = profile?.organization_id as string | undefined;
    if (!organizationId || !chatAgenticEnabled(organizationId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can see invoices' }, { status: 403 });
    }

    const { data: purchase } = await supabaseAdmin
      .from('add_on_purchases')
      .select('stripe_invoice_id')
      .eq('id', purchaseId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!purchase?.stripe_invoice_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const stripe = await loadStripe();
    if (!stripe) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const invoice = await stripe.invoices.retrieve(purchase.stripe_invoice_id as string);
    const url = invoice.invoice_pdf ?? invoice.hosted_invoice_url;
    if (!url) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.redirect(url);
  } catch (err) {
    console.error('[add-ons/invoice]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
