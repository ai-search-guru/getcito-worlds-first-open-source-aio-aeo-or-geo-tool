import type { AddOnKind, AddOnProductRow } from './addOns';

/**
 * What Settings › Billing › Add-ons shows of the packs (CHAT-18 §A items 3–4,
 * §E item 17), worked out on the server from the dollars the browser never
 * gets: what a pack adds is a share of the plan's monthly AI limit (never
 * dollars of model cost, never the markup), storage in GB; the credit left
 * and a purchase's price are in the pack's own dollars, what the workspace
 * paid. Pure: the server action reads the rows.
 */

/** What a pack adds, for its card. */
export type AddOnAdds =
  /** Under one monthly limit: "+20% of the monthly limit". */
  | { kind: 'share'; percent: number }
  /** One or more: "+1 monthly limit", "+2.5 monthly limits". */
  | { kind: 'limits'; count: number }
  /** Storage: "+25 GB". */
  | { kind: 'storage'; gb: number };

export interface AddOnPackView {
  id: string;
  kind: AddOnKind;
  priceCents: number;
  currency: string;
  /** Storage renews each month; AI credits are one payment. */
  monthly: boolean;
  /** AI credits: how long they last. */
  validMonths: number | null;
  /** "Most picked" on its tab. */
  mostPicked: boolean;
  /** Its Stripe price is set up here: it can be bought. */
  available: boolean;
  /** Null when the plan has no monthly limit to measure it against. */
  adds: AddOnAdds | null;
}

const GB = 1024 ** 3;

/** Whole gigabytes (00413 stores bytes, 1 GB = 1024³). */
export const gigabytes = (bytes: number) => Math.round(bytes / GB);

/**
 * What an AI pack adds against the plan's included monthly limit
 * (`includedUsd`), rounded down so it never says more than it gives; a
 * storage pack's GB. Null without a limit to measure against (unlimited).
 */
export function packAdds(
  pack: Pick<AddOnProductRow, 'kind' | 'grant_ai_usd' | 'grant_bytes'>,
  includedUsd: number | null,
): AddOnAdds | null {
  if (pack.kind === 'storage') {
    return pack.grant_bytes ? { kind: 'storage', gb: gigabytes(pack.grant_bytes) } : null;
  }
  if (!pack.grant_ai_usd || !includedUsd || includedUsd <= 0) return null;
  const ratio = pack.grant_ai_usd / includedUsd;
  // A hair over, so 0.2 × 100 reads 20, not 19.
  if (ratio < 1) return { kind: 'share', percent: Math.max(1, Math.floor(ratio * 100 + 1e-9)) };
  return { kind: 'limits', count: Math.floor(ratio * 10 + 1e-9) / 10 };
}

export function packView(pack: AddOnProductRow, includedUsd: number | null): AddOnPackView {
  return {
    id: pack.id,
    kind: pack.kind,
    priceCents: pack.price_cents,
    currency: pack.currency,
    monthly: pack.billing === 'monthly',
    validMonths: pack.valid_months,
    mostPicked: pack.highlight,
    available: pack.active && !!pack.stripe_price_id,
    adds: packAdds(pack, includedUsd),
  };
}

/** A grant's credit left, in model-cost dollars, with its pack's price for it. */
export interface CreditGrant {
  usdTotal: number;
  usdUsed: number;
  expiresAt: string;
  /** The pack's price and the model cost it grants: credit shows at the price paid. */
  priceCents: number;
  grantUsd: number;
}

/** A grant's credit left in the pack's own cents, rounded down. */
export function creditLeftCents(grant: CreditGrant): number {
  const left = Math.max(0, grant.usdTotal - grant.usdUsed);
  if (grant.grantUsd <= 0) return 0;
  return Math.floor((left * grant.priceCents) / grant.grantUsd + 1e-6);
}

/**
 * "AI credit: $X left · expires {date}": what's left on the grants still
 * valid, and the soonest end among those with some left (the one the budget
 * draws on first). Null when nothing is left.
 */
export function creditLine(
  grants: CreditGrant[],
  now: Date,
): { leftCents: number; expiresAt: string } | null {
  const open = grants
    .filter((g) => Date.parse(g.expiresAt) > now.getTime())
    .map((g) => ({ cents: creditLeftCents(g), expiresAt: g.expiresAt }))
    .filter((g) => g.cents > 0);
  if (!open.length) return null;
  return {
    leftCents: open.reduce((sum, g) => sum + g.cents, 0),
    expiresAt: open.map((g) => g.expiresAt).sort()[0],
  };
}

/** A purchase as the history lists it. */
export type AddOnPurchaseState =
  'processing' | 'active' | 'used_up' | 'expired' | 'ended' | 'refunded';

/**
 * The purchase's state for the history: still waiting for Stripe; AI credits
 * active, used up or expired; storage active until the period paid for, then
 * ended (a removed item isn't renewed); refunded.
 */
export function purchaseState(
  purchase: { status: string; kind: AddOnKind },
  grant: { leftCents: number; until: string | null } | null,
  now: Date,
): AddOnPurchaseState | null {
  switch (purchase.status) {
    case 'pending':
      return 'processing';
    case 'refunded':
      return 'refunded';
    case 'cancelled':
      return 'ended';
    case 'paid': {
      const ended = !grant?.until || Date.parse(grant.until) <= now.getTime();
      if (purchase.kind === 'storage') return ended ? 'ended' : 'active';
      if (ended) return 'expired';
      return grant && grant.leftCents > 0 ? 'active' : 'used_up';
    }
    default:
      return null;
  }
}
