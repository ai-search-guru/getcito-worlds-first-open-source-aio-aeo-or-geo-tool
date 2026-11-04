import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { addMonthsUtc, loadStripe, purchaseIdOf } from './addOns';

/**
 * The Stripe webhook's part for add-on packs (CHAT-18 §E items 15–18): the
 * only place a pack is granted, and only once Stripe says it was paid (never
 * on the browser's return from Checkout).
 *
 *   - AI credits: checkout.session.completed (paid at once) or
 *     async_payment_succeeded, and the pack's own invoice.paid: an
 *     ai_credit_grants row of the pack's model-cost dollars, valid its months
 *     (12) from the payment. A Checkout that expires or whose delayed payment
 *     fails is marked failed.
 *   - Storage: invoice.paid with the pack's item on it (the prorated first
 *     invoice, then each renewal of the plan): a storage_grants row active
 *     until the end of the period paid for, moved on by each renewal.
 *   - charge.refunded, in full: the purchase is refunded and its grant taken
 *     back: the AI credits not yet used, the storage from the refund on (its
 *     item taken off the plan's subscription, so it isn't charged again). A
 *     part refund is left to staff.
 *
 * Each event can come twice, late, or before the purchase's start finished
 * writing: a purchase is paid once (only from pending), a grant is written
 * once (its purchase_id is unique: a second insert does nothing), and a
 * storage item not yet written down is found by its pack's price. A
 * failure throws, so the webhook answers 500 and Stripe sends it again.
 */

/** Stripe for the webhook's few lookups; its route has the key (it checked the signature with it). */
async function stripeClient() {
  const stripe = await loadStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  return stripe;
}

type StripeRef = string | { id: string } | null | undefined;
const idOf = (ref: StripeRef): string | null => (typeof ref === 'string' ? ref : (ref?.id ?? null));

const PURCHASE_COLUMNS = 'id, organization_id, product_id, status, stripe_subscription_item_id';

interface Purchase {
  id: string;
  organization_id: string;
  product_id: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';
  stripe_subscription_item_id: string | null;
}

interface PackGrant {
  id: string;
  kind: 'ai' | 'storage';
  grant_ai_usd: number | null;
  grant_bytes: number | null;
  valid_months: number | null;
}

/** A purchase still waiting for its payment, or paid, takes its grant; a failed, refunded or cancelled one never does. */
const GRANTABLE = new Set<Purchase['status']>(['pending', 'paid']);

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

function unwrap<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

async function readPack(productId: string): Promise<PackGrant | null> {
  return unwrap(
    await supabaseAdmin
      .from('add_on_products')
      .select('id, kind, grant_ai_usd, grant_bytes, valid_months')
      .eq('id', productId)
      .maybeSingle(),
  ) as PackGrant | null;
}

async function readPurchase(id: string): Promise<{ purchase: Purchase; pack: PackGrant } | null> {
  const purchase = unwrap(
    await supabaseAdmin
      .from('add_on_purchases')
      .select(PURCHASE_COLUMNS)
      .eq('id', id)
      .maybeSingle(),
  ) as Purchase | null;
  if (!purchase) return null;
  const pack = await readPack(purchase.product_id);
  return pack ? { purchase, pack } : null;
}

/** What a payment says about itself, for the purchase's row. */
interface Payment {
  /** When Stripe recorded it (the event's time, seconds): the grant runs from here. */
  at: number;
  sessionId?: string | null;
  invoiceId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
}

/** The paid purchase's row: once, from pending. */
async function markPaid(purchaseId: string, payment: Payment, expiresAt: string | null) {
  unwrap(
    await supabaseAdmin
      .from('add_on_purchases')
      .update({
        status: 'paid',
        granted_at: iso(payment.at),
        expires_at: expiresAt,
        ...(payment.sessionId ? { stripe_checkout_session_id: payment.sessionId } : {}),
        ...(payment.invoiceId ? { stripe_invoice_id: payment.invoiceId } : {}),
        ...(payment.amountCents != null ? { amount_paid_cents: payment.amountCents } : {}),
        ...(payment.currency ? { currency: payment.currency.toLowerCase() } : {}),
      })
      .eq('id', purchaseId)
      .eq('status', 'pending'),
  );
}

/** A paid AI pack's credits: its model-cost dollars, for its months from the payment. */
async function grantAiCredits(purchaseId: string, payment: Payment) {
  const found = await readPurchase(purchaseId);
  if (!found || found.pack.kind !== 'ai' || found.pack.grant_ai_usd == null) {
    console.warn('[add-ons] No AI pack purchase to grant:', purchaseId);
    return;
  }
  const { purchase, pack } = found;
  if (!GRANTABLE.has(purchase.status)) return;
  const expiresAt = addMonthsUtc(
    new Date(payment.at * 1000),
    pack.valid_months ?? 12,
  ).toISOString();
  // Written first and once: a second delivery, or one racing it, inserts nothing.
  unwrap(
    await supabaseAdmin.from('ai_credit_grants').upsert(
      {
        organization_id: purchase.organization_id,
        purchase_id: purchase.id,
        usd_total: pack.grant_ai_usd,
        usd_used: 0,
        expires_at: expiresAt,
      },
      { onConflict: 'purchase_id', ignoreDuplicates: true },
    ),
  );
  await markPaid(purchase.id, payment, expiresAt);
  // The Checkout's event can come before its invoice was made: the invoice's own event names it.
  if (payment.invoiceId) {
    unwrap(
      await supabaseAdmin
        .from('add_on_purchases')
        .update({ stripe_invoice_id: payment.invoiceId })
        .eq('id', purchase.id)
        .is('stripe_invoice_id', null),
    );
  }
}

/** A purchase that will never be paid (a Checkout expired, a delayed payment failed). */
async function markFailed(purchaseId: string) {
  unwrap(
    await supabaseAdmin
      .from('add_on_purchases')
      .update({ status: 'failed' })
      .eq('id', purchaseId)
      .eq('status', 'pending'),
  );
}

// ─── Storage, from the invoices that pay for it ────────────────────────────

type Line = Stripe.InvoiceLineItem;

const itemOf = (line: Line) => line.parent?.subscription_item_details?.subscription_item ?? null;
const priceOf = (line: Line) => idOf(line.pricing?.price_details?.price);

async function linesOf(invoice: Stripe.Invoice): Promise<Line[]> {
  const lines = invoice.lines?.data ?? [];
  if (!invoice.lines?.has_more || !invoice.id) return lines;
  return (await stripeClient()).invoices
    .listLineItems(invoice.id, { limit: 100 })
    .autoPagingToArray({ limit: 1000 });
}

async function organizationOfCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const org = unwrap(
    await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle(),
  ) as { id: string } | null;
  return org?.id ?? null;
}

/**
 * A line of a pack whose item isn't written on its purchase yet (the
 * invoice can be paid before the purchase's start has written the item's
 * id): the workspace's oldest pending purchase of that pack takes it, and
 * the item's id with it.
 */
async function claimByPrice(
  lines: Line[],
  customerId: string | null,
): Promise<Map<Line, Purchase>> {
  const claimed = new Map<Line, Purchase>();
  const prices = [...new Set(lines.map(priceOf).filter((p): p is string => !!p))];
  if (!prices.length) return claimed;
  const packs = unwrap(
    await supabaseAdmin
      .from('add_on_products')
      .select('id, stripe_price_id')
      .eq('kind', 'storage')
      .in('stripe_price_id', prices),
  ) as { id: string; stripe_price_id: string }[] | null;
  if (!packs?.length) return claimed;
  const orgId = await organizationOfCustomer(customerId);
  if (!orgId) return claimed;
  for (const line of lines) {
    const pack = packs.find((p) => p.stripe_price_id === priceOf(line));
    if (!pack) continue;
    const pending = unwrap(
      await supabaseAdmin
        .from('add_on_purchases')
        .select(PURCHASE_COLUMNS)
        .eq('organization_id', orgId)
        .eq('product_id', pack.id)
        .eq('status', 'pending')
        .is('stripe_subscription_item_id', null)
        .order('created_at', { ascending: true })
        .limit(1),
    ) as Purchase[] | null;
    const purchase = pending?.[0];
    if (!purchase || [...claimed.values()].some((p) => p.id === purchase.id)) continue;
    const item = itemOf(line);
    if (item) {
      unwrap(
        await supabaseAdmin
          .from('add_on_purchases')
          .update({ stripe_subscription_item_id: item })
          .eq('id', purchase.id)
          .is('stripe_subscription_item_id', null),
      );
    }
    claimed.set(line, { ...purchase, stripe_subscription_item_id: item });
  }
  return claimed;
}

/** One paid line of a storage pack: its grant, until the end of the period the line paid for. */
async function grantStorage(
  purchase: Purchase,
  line: Line,
  invoice: Stripe.Invoice,
  paidAt: number,
) {
  if (!GRANTABLE.has(purchase.status)) return;
  const pack = await readPack(purchase.product_id);
  if (!pack || pack.kind !== 'storage' || pack.grant_bytes == null) return;
  const activeUntil = iso(line.period.end);
  unwrap(
    await supabaseAdmin.from('storage_grants').upsert(
      {
        organization_id: purchase.organization_id,
        purchase_id: purchase.id,
        bytes: pack.grant_bytes,
        active_until: activeUntil,
      },
      { onConflict: 'purchase_id', ignoreDuplicates: true },
    ),
  );
  // A renewal moves it on; an older invoice delivered late never moves it back.
  unwrap(
    await supabaseAdmin
      .from('storage_grants')
      .update({ active_until: activeUntil })
      .eq('purchase_id', purchase.id)
      .lt('active_until', activeUntil),
  );
  if (purchase.status === 'pending') {
    await markPaid(
      purchase.id,
      {
        at: paidAt,
        invoiceId: invoice.id ?? null,
        amountCents: line.amount,
        currency: line.currency,
      },
      null,
    );
  }
}

/** A paid invoice's storage packs: granted on the first, moved on by each renewal. */
async function grantStorageFromInvoice(invoice: Stripe.Invoice, paidAt: number): Promise<boolean> {
  // A credit for unused time (an item removed) pays for nothing.
  const lines = (await linesOf(invoice)).filter((line) => line.amount >= 0);
  const items = [...new Set(lines.map(itemOf).filter((i): i is string => !!i))];
  if (!items.length && !lines.some(priceOf)) return false;

  const known = items.length
    ? ((unwrap(
        await supabaseAdmin
          .from('add_on_purchases')
          .select(PURCHASE_COLUMNS)
          .in('stripe_subscription_item_id', items),
      ) ?? []) as Purchase[])
    : [];
  const matched = new Map<Line, Purchase>();
  const rest: Line[] = [];
  for (const line of lines) {
    const purchase = known.find((p) => p.stripe_subscription_item_id === itemOf(line));
    if (purchase) matched.set(line, purchase);
    else rest.push(line);
  }
  for (const [line, purchase] of await claimByPrice(rest, idOf(invoice.customer))) {
    matched.set(line, purchase);
  }
  for (const [line, purchase] of matched) await grantStorage(purchase, line, invoice, paidAt);
  return matched.size > 0;
}

/**
 * An invoice of packs only: an AI pack's own (its metadata names the
 * purchase), or one whose every line is a pack's price (a storage pack's
 * prorated first invoice). The plan's handlers leave those alone: a pack's
 * payment, paid or declined, never changes the plan's status. A read that
 * fails counts as a plan's invoice.
 */
async function packsOnlyInvoice(invoice: Stripe.Invoice): Promise<boolean> {
  if (purchaseIdOf(invoice.metadata)) return true;
  const lines = invoice.lines?.data ?? [];
  if (!lines.length || invoice.lines?.has_more) return false;
  const prices = lines.map(priceOf);
  if (prices.some((p) => !p)) return false;
  const { data, error } = await supabaseAdmin
    .from('add_on_products')
    .select('stripe_price_id')
    .in('stripe_price_id', [...new Set(prices)]);
  if (error) {
    console.error('[add-ons] Pack prices read failed:', error.message);
    return false;
  }
  const packPrices = new Set(
    (data ?? []).map((p: { stripe_price_id: string }) => p.stripe_price_id),
  );
  return prices.every((p) => packPrices.has(p as string));
}

// ─── Refunds ────────────────────────────────────────────────────────────────

/**
 * The purchase a charge paid for: named on the charge or its payment (an AI
 * pack's Checkout), or by its invoice (a storage pack's first invoice).
 */
async function purchaseOfCharge(charge: Stripe.Charge): Promise<string | null> {
  const named = purchaseIdOf(charge.metadata);
  if (named) return named;
  const intentId = idOf(charge.payment_intent);
  if (!intentId) return null;
  const stripe = await stripeClient();
  const intent = await stripe.paymentIntents.retrieve(intentId);
  const onIntent = purchaseIdOf(intent.metadata);
  if (onIntent) return onIntent;
  const payments = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: intentId },
    limit: 1,
  });
  const invoiceId = idOf(payments.data[0]?.invoice);
  if (!invoiceId) return null;
  const rows = unwrap(
    await supabaseAdmin
      .from('add_on_purchases')
      .select('id')
      .eq('stripe_invoice_id', invoiceId)
      .limit(1),
  ) as { id: string }[] | null;
  return rows?.[0]?.id ?? null;
}

/**
 * A refunded storage pack's item comes off the plan's subscription, so it
 * isn't charged again each month for storage it no longer grants. Nothing
 * prorated: the refund settled the money. Already gone: nothing to do.
 */
async function removeStorageItem(itemId: string | null) {
  if (!itemId) return;
  try {
    await (await stripeClient()).subscriptionItems.del(itemId, { proration_behavior: 'none' });
  } catch (err) {
    const e = err as { code?: string; statusCode?: number } | null;
    if (e?.code === 'resource_missing' || e?.statusCode === 404) return;
    throw err;
  }
}

/** A refunded purchase gives back what it hasn't used: once. */
async function refund(purchaseId: string, at: number) {
  const found = await readPurchase(purchaseId);
  if (!found) return;
  const { purchase, pack } = found;
  if (purchase.status === 'refunded' || purchase.status === 'failed') return;
  // Refunded before its payment's own event: nothing was granted, and nothing will be.
  if (purchase.status === 'pending') {
    await markFailed(purchase.id);
    return;
  }
  if (pack.kind === 'ai') {
    const grant = unwrap(
      await supabaseAdmin
        .from('ai_credit_grants')
        .select('id, usd_used')
        .eq('purchase_id', purchase.id)
        .maybeSingle(),
    ) as { id: string; usd_used: number } | null;
    if (grant) {
      // What's used stays used; the rest goes. A draw in between: Stripe sends it again.
      const hit = unwrap(
        await supabaseAdmin
          .from('ai_credit_grants')
          .update({ usd_total: grant.usd_used })
          .eq('id', grant.id)
          .eq('usd_used', grant.usd_used)
          .select('id'),
      ) as { id: string }[] | null;
      if (!hit?.length) throw new Error('AI credit grant changed while refunding');
    }
  } else {
    unwrap(
      await supabaseAdmin
        .from('storage_grants')
        .update({ active_until: iso(at) })
        .eq('purchase_id', purchase.id)
        .gt('active_until', iso(at)),
    );
    await removeStorageItem(purchase.stripe_subscription_item_id);
  }
  unwrap(
    await supabaseAdmin
      .from('add_on_purchases')
      .update({ status: 'refunded' })
      .eq('id', purchase.id)
      .in('status', ['paid', 'cancelled']),
  );
}

/**
 * Handles an event when it is a pack's; true when the plan's handlers must
 * leave it alone (a pack's Checkout, a packs-only invoice). Events of a
 * plan's give false and go on to them, as before. Throws on a database
 * failure, for Stripe to send the event again.
 */
export async function handleAddOnEvent(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      const purchaseId = purchaseIdOf(session.metadata);
      if (!purchaseId) return false;
      // A delayed payment (a bank debit) isn't paid yet: async_payment_succeeded
      // grants it. Only a paid one grants ('no_payment_required' never does).
      if (session.payment_status === 'paid') {
        await grantAiCredits(purchaseId, {
          at: event.created,
          sessionId: session.id,
          invoiceId: idOf(session.invoice),
          amountCents: session.amount_total,
          currency: session.currency,
        });
      }
      return true;
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const purchaseId = purchaseIdOf(event.data.object.metadata);
      if (!purchaseId) return false;
      await markFailed(purchaseId);
      return true;
    }
    case 'invoice.paid': {
      const invoice = event.data.object;
      const purchaseId = purchaseIdOf(invoice.metadata);
      if (purchaseId) {
        await grantAiCredits(purchaseId, {
          at: event.created,
          invoiceId: invoice.id ?? null,
          amountCents: invoice.amount_paid,
          currency: invoice.currency,
        });
        return true;
      }
      return grantStorageFromInvoice(invoice, event.created);
    }
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
      return packsOnlyInvoice(event.data.object);
    case 'charge.refunded': {
      const charge = event.data.object;
      // In part: left to staff, who know what it was for.
      if (!charge.refunded) return false;
      const purchaseId = await purchaseOfCharge(charge);
      if (!purchaseId) return false;
      await refund(purchaseId, event.created);
      return true;
    }
    default:
      return false;
  }
}
