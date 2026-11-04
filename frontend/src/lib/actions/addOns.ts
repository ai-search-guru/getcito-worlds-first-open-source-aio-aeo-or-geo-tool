'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS, getPlan, isCloud } from '@/config/plans';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  ADD_ON_PRODUCT_COLUMNS,
  ADD_ON_PURCHASE_KEY,
  addOnOnSale,
  loadStripe,
  planItemOf,
  type AddOnKind,
  type AddOnProductRow,
} from '@/lib/billing/addOns';
import {
  creditLeftCents,
  creditLine,
  gigabytes,
  packView,
  purchaseState,
  type AddOnPackView,
  type AddOnPurchaseState,
  type CreditGrant,
} from '@/lib/billing/addOnView';

/**
 * Buying an add-on pack (CHAT-18 §C–E), behind CHAT_AGENTIC: an Admin of a
 * workspace on a paid, active plan picks a pack, and
 *   - AI credits open a Stripe Checkout (one payment; its invoice has the
 *     pack's line), whose page the browser goes to;
 *   - storage is added to the plan's subscription as a monthly item,
 *     prorated for this period and charged to the card on file at once.
 * Either way a purchase row waits as pending, and only the Stripe webhook
 * grants the pack once it is paid (lib/billing/addOnWebhook.ts): a return
 * from Checkout grants nothing. Chat never starts a purchase.
 *
 * Never throws (#1777): every refusal is a reason the page can word.
 *   - chat_off: Chat is off for the workspace; no pack is on sale.
 *   - admin_only: billing is the Admins' (CHAT-20 §4); others ask one.
 *   - trial: the free trial can't buy packs ("Choose a plan").
 *   - no_plan: the plan isn't active (ended, past due).
 *   - unavailable: the pack isn't on sale here (no Stripe price on this
 *     deployment, switched off, no Stripe key at all), or storage on a plan
 *     it can't join (one billed yearly, or without a Stripe subscription).
 * Stripe is loaded only here, when a purchase starts (loadStripe): without
 * its key the module still loads, and so do the actions bundled with it.
 *   - payment_failed: the card on file was declined for storage; `message`
 *     is Stripe's, for the page to show.
 *   - failed: anything else (Stripe or the database didn't answer).
 */

export type AddOnPurchaseFailure =
  'chat_off' | 'admin_only' | 'trial' | 'no_plan' | 'unavailable' | 'payment_failed' | 'failed';

export type AddOnPurchaseStart =
  /** AI credits: the browser goes on to Stripe Checkout. */
  | { ok: true; next: 'checkout'; url: string }
  /** Storage: added to the plan; it counts once the webhook hears it was paid. */
  | { ok: true; next: 'added' }
  | { ok: false; failure: AddOnPurchaseFailure; message?: string };

const productIdSchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

const refuse = (failure: AddOnPurchaseFailure, message?: string): AddOnPurchaseStart => ({
  ok: false,
  failure,
  ...(message ? { message } : {}),
});

/** Starts buying the pack `productId`. See above for what it answers. */
export async function startAddOnPurchase(productId: string): Promise<AddOnPurchaseStart> {
  try {
    return await start(productId);
  } catch (err) {
    console.error('[add-ons] Purchase start failed:', err);
    return refuse('failed');
  }
}

type StripeClient = NonNullable<Awaited<ReturnType<typeof loadStripe>>>;

interface Buyer {
  stripe: StripeClient;
  userId: string;
  email: string | null;
  organizationId: string;
  customerId: string | null;
  subscriptionId: string | null;
}

async function start(productId: unknown): Promise<AddOnPurchaseStart> {
  const parsed = productIdSchema.safeParse(productId);
  if (!parsed.success) return refuse('unavailable');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return refuse('failed');

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();
  const organizationId = profile?.organization_id as string | undefined;
  if (!organizationId || !chatAgenticEnabled(organizationId)) return refuse('chat_off');
  if (profile?.role !== 'admin') return refuse('admin_only');
  if (!isCloud()) return refuse('unavailable');

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('subscription_status, stripe_customer_id, stripe_subscription_id')
    .eq('id', organizationId)
    .maybeSingle();
  if (org?.subscription_status === 'trialing') return refuse('trial');
  if (org?.subscription_status !== 'active') return refuse('no_plan');

  const { data: product } = await supabaseAdmin
    .from('add_on_products')
    .select(ADD_ON_PRODUCT_COLUMNS)
    .eq('id', parsed.data)
    .maybeSingle();
  if (!product || !addOnOnSale(product as AddOnProductRow)) return refuse('unavailable');
  // Without its key, Stripe sells nothing here.
  const stripe = await loadStripe();
  if (!stripe) return refuse('unavailable');

  const buyer: Buyer = {
    stripe,
    userId: user.id,
    email: user.email ?? null,
    organizationId,
    customerId: (org.stripe_customer_id as string | null) ?? null,
    subscriptionId: (org.stripe_subscription_id as string | null) ?? null,
  };
  const pack = product as AddOnProductRow;
  return pack.kind === 'ai' ? startAiCheckout(buyer, pack) : addStorageItem(buyer, pack);
}

/** The purchase's row, pending until the webhook hears it was paid. */
async function newPurchase(buyer: Buyer, pack: AddOnProductRow): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('add_on_purchases')
    .insert({
      organization_id: buyer.organizationId,
      product_id: pack.id,
      bought_by: buyer.userId,
      status: 'pending',
      currency: pack.currency,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Purchase not written');
  return data.id as string;
}

/** What every Stripe object of the purchase carries, for the webhook to find it by. */
const metadataOf = (purchaseId: string, buyer: Buyer, pack: AddOnProductRow) => ({
  [ADD_ON_PURCHASE_KEY]: purchaseId,
  organization_id: buyer.organizationId,
  product_id: pack.id,
});

/** The workspace's Stripe customer; one is made for a workspace without (Enterprise set up by hand). */
async function customerOf(buyer: Buyer): Promise<string> {
  if (buyer.customerId) return buyer.customerId;
  const customer = await buyer.stripe.customers.create({
    ...(buyer.email ? { email: buyer.email } : {}),
    metadata: { organization_id: buyer.organizationId, supabase_user_id: buyer.userId },
  });
  await supabaseAdmin
    .from('organizations')
    .update({ stripe_customer_id: customer.id })
    .eq('id', buyer.organizationId);
  return customer.id;
}

/**
 * AI credits: a Checkout in payment mode, its invoice made by Stripe with the
 * pack's line (the Stripe product's name, "AI credits · $50"). The purchase,
 * the payment and the invoice all name the purchase.
 */
async function startAiCheckout(buyer: Buyer, pack: AddOnProductRow): Promise<AddOnPurchaseStart> {
  const customer = await customerOf(buyer);
  const purchaseId = await newPurchase(buyer, pack);
  const metadata = metadataOf(purchaseId, buyer, pack);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const session = await buyer.stripe.checkout.sessions.create(
    {
      mode: 'payment',
      customer,
      client_reference_id: buyer.organizationId,
      line_items: [{ price: pack.stripe_price_id as string, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      invoice_creation: { enabled: true, invoice_data: { metadata } },
      success_url: `${appUrl}/dashboard/settings/billing?add_on=paid#add-ons`,
      cancel_url: `${appUrl}/dashboard/settings/billing#add-ons`,
    },
    // One Checkout per purchase, however often the call is retried.
    { idempotencyKey: `add-on-${purchaseId}` },
  );
  await supabaseAdmin
    .from('add_on_purchases')
    .update({ stripe_checkout_session_id: session.id })
    .eq('id', purchaseId);
  return session.url ? { ok: true, next: 'checkout', url: session.url } : refuse('failed');
}

/** A card declined, or one its bank wants confirmed: Stripe's 402. */
function declined(err: unknown): err is { message: string } {
  const e = err as { type?: string; statusCode?: number; message?: unknown } | null;
  return (
    !!e && typeof e.message === 'string' && (e.type === 'StripeCardError' || e.statusCode === 402)
  );
}

/**
 * Storage: a monthly item on the plan's subscription (CHAT-18 item 15),
 * invoiced at once for the rest of this period and charged to the card on
 * file. Nothing changes unless it's paid: a declined card is an error and
 * the purchase fails. A plan billed yearly can't take a monthly item.
 */
async function addStorageItem(buyer: Buyer, pack: AddOnProductRow): Promise<AddOnPurchaseStart> {
  if (!buyer.subscriptionId) return refuse('unavailable');
  const subscription = await buyer.stripe.subscriptions.retrieve(buyer.subscriptionId);
  if (planItemOf(subscription.items.data)?.price?.recurring?.interval !== 'month') {
    return refuse('unavailable');
  }
  const purchaseId = await newPurchase(buyer, pack);
  let itemId: string;
  try {
    const item = await buyer.stripe.subscriptionItems.create(
      {
        subscription: subscription.id,
        price: pack.stripe_price_id as string,
        quantity: 1,
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        metadata: metadataOf(purchaseId, buyer, pack),
      },
      { idempotencyKey: `add-on-${purchaseId}` },
    );
    itemId = item.id;
  } catch (err) {
    // Declined: nothing was added. Any other error may have reached Stripe,
    // so the purchase stays pending for the webhook to settle.
    if (!declined(err)) throw err;
    await supabaseAdmin
      .from('add_on_purchases')
      .update({ status: 'failed' })
      .eq('id', purchaseId)
      .eq('status', 'pending');
    return refuse('payment_failed', err.message);
  }
  // The webhook may have written it first, from the invoice.
  await supabaseAdmin
    .from('add_on_purchases')
    .update({ stripe_subscription_item_id: itemId })
    .eq('id', purchaseId)
    .is('stripe_subscription_item_id', null);
  return { ok: true, next: 'added' };
}

// ─── Settings › Billing › Add-ons ──────────────────────────────────────────

/** A purchase as Billing's history lists it (CHAT-18 item 17). */
export interface AddOnPurchaseView {
  id: string;
  createdAt: string;
  kind: AddOnKind;
  /** The pack's price: an AI pack goes by it ("AI credits · $50"). */
  packPriceCents: number;
  /** What was paid (a storage pack's first period is prorated); null until paid. */
  paidCents: number | null;
  currency: string;
  /** Storage: the GB it adds. */
  gb: number | null;
  state: AddOnPurchaseState;
  /** AI: the credit left, in the pack's own dollars. */
  creditLeftCents: number | null;
  /** AI: when its credit ends. Storage: the end of the period paid for. */
  until: string | null;
  hasInvoice: boolean;
}

export interface BillingAddOns {
  isAdmin: boolean;
  /** Whether the workspace can buy: an active paid plan; the free trial can't (CHAT-18). */
  buy: 'open' | 'trial' | 'no_plan';
  packs: AddOnPackView[];
  /** "AI credit: $X left · expires {date}"; null when none is left. */
  credit: { leftCents: number; expiresAt: string } | null;
  /** Admins only: billing is theirs. */
  purchases: AddOnPurchaseView[] | null;
}

export type BillingAddOnsRead =
  | { ok: true; addOns: BillingAddOns }
  /** off: Chat is off for the workspace, or not the cloud: no section. */
  | { ok: false; failure: 'off' | 'failed' };

/** How many purchases the history lists, newest first. */
const HISTORY_ROWS = 20;
/** A Checkout left unpaid this long was abandoned: the history leaves it out. */
const PENDING_SHOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Settings › Billing › Add-ons for the signed-in person (CHAT-18 §B item 6,
 * §E item 17), behind CHAT_AGENTIC: the packs with what each adds to this
 * workspace's plan, the AI credit left, and, for Admins, the purchases.
 * Dollars here are the packs' prices, what the workspace pays; the model
 * cost a pack grants stays on the server. Never throws (#1777).
 */
export async function getBillingAddOns(): Promise<BillingAddOnsRead> {
  try {
    const addOns = await readBillingAddOns(new Date());
    return addOns ? { ok: true, addOns } : { ok: false, failure: 'off' };
  } catch (err) {
    console.error('[add-ons] Billing read failed:', err);
    return { ok: false, failure: 'failed' };
  }
}

function rows<T>({ data, error }: { data: unknown; error: { message: string } | null }): T[] {
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

/**
 * The plan's own monthly AI limit, what an AI pack is measured against: the
 * plan's, not the trial's smaller one; Enterprise's own when GetCito set one
 * at least the plan's. Null when unlimited.
 */
function monthlyLimitUsd(org: { plan?: unknown; plan_overrides?: unknown } | null): number | null {
  const plan = getPlan(org?.plan as string | null | undefined);
  let usd = plan.limits.improveMonthlyBudgetUsd;
  const overrides = org?.plan_overrides as Record<string, unknown> | null | undefined;
  const own = overrides?.improveMonthlyBudgetUsd;
  if (
    plan.id === 'enterprise' &&
    typeof own === 'number' &&
    Number.isFinite(own) &&
    own >= PLANS.enterprise.limits.improveMonthlyBudgetUsd
  ) {
    usd = own;
  }
  return usd > 0 ? usd : null;
}

interface GrantRow {
  purchase_id: string;
  usd_total: number;
  usd_used: number;
  expires_at: string;
}

interface PurchaseRow {
  id: string;
  product_id: string;
  status: string;
  created_at: string;
  amount_paid_cents: number | null;
  currency: string;
  stripe_invoice_id: string | null;
}

async function readBillingAddOns(now: Date): Promise<BillingAddOns | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();
  const organizationId = profile?.organization_id as string | undefined;
  if (!organizationId || !chatAgenticEnabled(organizationId) || !isCloud()) return null;
  const isAdmin = profile?.role === 'admin';

  const [org, products, grants, purchases, storage] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select('plan, subscription_status, plan_overrides')
      .eq('id', organizationId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data as { plan?: unknown; subscription_status?: unknown; plan_overrides?: unknown };
      }),
    supabaseAdmin
      .from('add_on_products')
      .select(ADD_ON_PRODUCT_COLUMNS)
      .then((r) => rows<AddOnProductRow>(r)),
    supabaseAdmin
      .from('ai_credit_grants')
      .select('purchase_id, usd_total, usd_used, expires_at')
      .eq('organization_id', organizationId)
      .then((r) => rows<GrantRow>(r)),
    supabaseAdmin
      .from('add_on_purchases')
      .select('id, product_id, status, created_at, amount_paid_cents, currency, stripe_invoice_id')
      .eq('organization_id', organizationId)
      .in('status', ['pending', 'paid', 'refunded', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(200)
      .then((r) => rows<PurchaseRow>(r)),
    isAdmin
      ? supabaseAdmin
          .from('storage_grants')
          .select('purchase_id, active_until')
          .eq('organization_id', organizationId)
          .then((r) => rows<{ purchase_id: string; active_until: string }>(r))
      : Promise.resolve([]),
  ]);

  const productById = new Map(products.map((p) => [p.id, p]));
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  // Each grant with its pack's price, for the credit in the pack's own dollars.
  const priced = new Map<string, CreditGrant>();
  for (const grant of grants) {
    const product = productById.get(purchaseById.get(grant.purchase_id)?.product_id ?? '');
    if (!product?.grant_ai_usd) continue;
    priced.set(grant.purchase_id, {
      usdTotal: Number(grant.usd_total),
      usdUsed: Number(grant.usd_used),
      expiresAt: grant.expires_at,
      priceCents: product.price_cents,
      grantUsd: Number(product.grant_ai_usd),
    });
  }

  const status = org?.subscription_status;
  const included = monthlyLimitUsd(org);
  const packs = products
    .filter((p) => p.active)
    .sort((a, b) => (a.kind === b.kind ? a.sort - b.sort : a.kind === 'ai' ? -1 : 1))
    .map((p) => packView(p, included));

  return {
    isAdmin,
    buy: status === 'active' ? 'open' : status === 'trialing' ? 'trial' : 'no_plan',
    packs,
    credit: creditLine([...priced.values()], now),
    purchases: isAdmin ? history(purchases, productById, priced, storage, now) : null,
  };
}

function history(
  purchases: PurchaseRow[],
  productById: Map<string, AddOnProductRow>,
  priced: Map<string, CreditGrant>,
  storage: { purchase_id: string; active_until: string }[],
  now: Date,
): AddOnPurchaseView[] {
  const storageUntil = new Map(storage.map((g) => [g.purchase_id, g.active_until]));
  const listed: AddOnPurchaseView[] = [];
  for (const purchase of purchases) {
    const product = productById.get(purchase.product_id);
    if (!product) continue;
    if (
      purchase.status === 'pending' &&
      now.getTime() - Date.parse(purchase.created_at) > PENDING_SHOWN_MS
    ) {
      continue;
    }
    const grant = priced.get(purchase.id);
    const leftCents = grant ? creditLeftCents(grant) : 0;
    const until =
      product.kind === 'ai' ? (grant?.expiresAt ?? null) : (storageUntil.get(purchase.id) ?? null);
    const state = purchaseState(
      { status: purchase.status, kind: product.kind },
      { leftCents, until },
      now,
    );
    if (!state) continue;
    listed.push({
      id: purchase.id,
      createdAt: purchase.created_at,
      kind: product.kind,
      packPriceCents: product.price_cents,
      paidCents: purchase.amount_paid_cents,
      currency: purchase.currency,
      gb: product.grant_bytes ? gigabytes(product.grant_bytes) : null,
      state,
      creditLeftCents: product.kind === 'ai' && state === 'active' ? leftCents : null,
      until,
      hasInvoice: !!purchase.stripe_invoice_id,
    });
    if (listed.length === HISTORY_ROWS) break;
  }
  return listed;
}
