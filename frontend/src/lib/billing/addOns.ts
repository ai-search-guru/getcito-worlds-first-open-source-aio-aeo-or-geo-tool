/**
 * Add-on packs (CHAT-18, 00413), behind CHAT_AGENTIC: AI credits and storage
 * a workspace's Admins buy with Stripe when a limit runs out.
 *
 *   - AI credits: one payment (a Stripe Checkout in payment mode, its invoice
 *     carrying the pack's line), valid 12 months, adding half its price in
 *     model cost to the AI budget (the server's aiCredits.js draws on it).
 *   - Storage: a monthly item added to the plan's Stripe subscription,
 *     prorated for the current period and charged to the card on file, then
 *     renewed with the plan.
 *
 * Nothing is granted before Stripe says it was paid: only the webhook writes
 * grants (addOnWebhook.ts). Each Stripe object a pack makes carries the
 * purchase's id in its metadata, so the webhook finds it again.
 */

import type Stripe from 'stripe';

/**
 * The Stripe client, loaded only when a pack's purchase or webhook needs it;
 * null without STRIPE_SECRET_KEY (local development, self-hosted). lib/
 * stripe.ts makes its client when it is loaded and throws without the key,
 * so importing it at the top of a module that Settings loads (a server
 * action's bundle) would break every action beside it.
 */
export async function loadStripe(): Promise<Stripe | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return (await import('@/lib/stripe')).stripe;
}

/** The metadata key that names the add_on_purchases row on a pack's Stripe objects. */
export const ADD_ON_PURCHASE_KEY = 'add_on_purchase_id';

export type AddOnKind = 'ai' | 'storage';

/** An add_on_products row: the packs on sale, staff-edited. Server only (dollars of model cost). */
export interface AddOnProductRow {
  id: string;
  kind: AddOnKind;
  name: string;
  price_cents: number;
  currency: string;
  billing: 'one_time' | 'monthly';
  grant_ai_usd: number | null;
  grant_bytes: number | null;
  valid_months: number | null;
  stripe_price_id: string | null;
  active: boolean;
  highlight: boolean;
  sort: number;
}

export const ADD_ON_PRODUCT_COLUMNS =
  'id, kind, name, price_cents, currency, billing, grant_ai_usd, grant_bytes, valid_months, stripe_price_id, active, highlight, sort';

/** A pack is sold only while it is active and has its Stripe price on this deployment. */
export function addOnOnSale(product: Pick<AddOnProductRow, 'active' | 'stripe_price_id'>): boolean {
  return product.active && !!product.stripe_price_id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The purchase a Stripe object's metadata names, or null when it isn't a pack's. */
export function purchaseIdOf(metadata: Record<string, string> | null | undefined): string | null {
  const id = metadata?.[ADD_ON_PURCHASE_KEY];
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

/**
 * `months` after `from`, in UTC, on the same day or the month's last when it
 * is shorter (31 January + 1 month = 28 or 29 February).
 */
export function addMonthsUtc(from: Date, months: number): Date {
  const day = from.getUTCDate();
  const shifted = new Date(from.getTime());
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted;
}

/** A subscription item as the plan's routes read it. */
type SubscriptionItemLike = { metadata?: Record<string, string> | null };

/**
 * The plan's item on a subscription that may also hold storage packs: the
 * first that isn't a pack's (a pack's item carries its purchase in its
 * metadata). A plan change or a price read must never take a pack's.
 */
export function planItemOf<T extends SubscriptionItemLike>(items: readonly T[]): T | undefined {
  return items.find((item) => !purchaseIdOf(item.metadata)) ?? items[0];
}
