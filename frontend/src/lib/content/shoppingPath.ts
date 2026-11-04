import { z } from 'zod';
import { variantStock } from '@/lib/content/feedMatch';
import type { SiteType } from '@/lib/content/pageTypes';

/**
 * A draft's shopping path (shopping path, 00351), as the Brief tab shows it:
 * the category pages and catalog products the page links on an online shop,
 * the products left out and why, and the person's locks, removals and
 * additions. The API picks them (backend/src/lib/shoppingPath.js); the
 * person changes them here.
 */

/**
 * The page types a shopping path fits, and how many products each links: a
 * copy of the API's PRODUCTS_FOR (backend/src/lib/shoppingPath.js), which
 * decides; change both together.
 */
export const PRODUCTS_FOR: Record<string, number> = {
  best_of: 8,
  buying_guide: 5,
  comparison: 4,
  alternatives: 4,
  guide: 4,
  blog_post: 3,
};

/**
 * The path's caps, the API's (backend/src/lib/shoppingPath.js): products,
 * issues a product, left out, the person's locks and additions (each), and
 * removals; a product's or a page's title in characters.
 */
export const MAX_PRODUCTS = 40;
export const MAX_ISSUES = 20;
export const MAX_LEFT_OUT = 10;
export const MAX_KEPT = 40;
export const MAX_REMOVED = 200;
export const TITLE_CHARS = 200;

/** Whether a page of this type on this kind of site takes a shopping path. */
export function shoppingPathFits(siteType: SiteType, pageType: string | null): boolean {
  return siteType === 'ecommerce' && pageType != null && Object.hasOwn(PRODUCTS_FOR, pageType);
}

/** An amount above 0, or null: a price of 0 is none given. */
const positive = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) && value > 0 ? value : null;

/**
 * A price as a card reads it: the sale price when it's under the price, or
 * when there's no price; else the price; null without either. The API's
 * rule (backend/src/lib/catalog/offer.js priceAmount): change both together.
 */
export function priceAmount({
  price,
  salePrice,
}: {
  price: number | null | undefined;
  salePrice: number | null | undefined;
}): number | null {
  const regular = positive(price);
  const sale = positive(salePrice);
  if (regular == null) return sale;
  return sale != null && sale < regular ? sale : regular;
}

/**
 * A price as a product card shows it ("$189.00", priceAmount's), in its
 * currency; null without one. Before you publish compares a card's with
 * the catalog's now (shoppingCheck.ts).
 */
export function priceText(product: {
  price: number | null;
  salePrice: number | null;
  currency: string | null;
}): string | null {
  const amount = priceAmount(product);
  if (amount == null) return null;
  try {
    return product.currency
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: product.currency }).format(
          amount,
        )
      : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amount);
  } catch {
    // A currency code Intl doesn't know: the amount and the code as the catalog has them.
    return `${amount} ${product.currency}`;
  }
}

/** In stock before low stock (limited availability): the better stock, the lower. */
function inStockRank(availability: string | null): number {
  return (availability ?? '').toLowerCase().replace(/[\s-]+/g, '_') === 'limited_availability'
    ? 1
    : 0;
}

/**
 * The variant in stock a product is shown with: the best stock, then the
 * lowest price at it, one with no price last; null with none in stock. The
 * API's rule (backend/src/lib/catalog/offer.js bestInStock), so a card put in
 * by hand shows the price the agent's grid would.
 */
export function bestInStock<
  V extends { availability: string | null; price: number | null; sale_price: number | null },
>(variants: readonly V[]): V | null {
  const amount = (v: V) => priceAmount({ price: v.price, salePrice: v.sale_price }) ?? Infinity;
  return (
    variants
      .filter((v) => variantStock(v.availability) === 'in')
      .sort(
        (a, b) =>
          inStockRank(a.availability) - inStockRank(b.availability) || amount(a) - amount(b),
      )[0] ?? null
  );
}

/** Why a product is left out, as the API says it: sold out, refused, no link, gone from the catalog. */
export const LEFT_OUT_REASONS = ['sold_out', 'refused', 'no_link', 'gone'] as const;
export type LeftOutReason = (typeof LEFT_OUT_REASONS)[number];

/** A left-out reason as the Brief tab words it: 'other' for one the API added since. */
export function leftOutReason(reason: string): LeftOutReason | 'other' {
  return (LEFT_OUT_REASONS as readonly string[]).includes(reason)
    ? (reason as LeftOutReason)
    : 'other';
}

/**
 * Why a draft has no shopping path, as the API says it: not a shop, a page
 * type that takes none, no catalog, nothing in it for the topic; 'other'
 * for one the API added since.
 */
export const NO_PATH_REASONS = ['not_a_shop', 'page_type', 'no_catalog', 'no_match'] as const;
export type NoPathReason = (typeof NO_PATH_REASONS)[number] | 'other';

const id = z.string().min(1).max(100);
const title = z.string().max(TITLE_CHARS);
/** A link the tab follows: http(s) only; any other (javascript:, a relative path) is read as none. */
const link = z
  .string()
  .max(2048)
  .transform((url) => (/^https?:\/\//i.test(url) ? url : null));
/** As the API's stock.js spells it: lowercased, spaces and hyphens as "_". */
const stock = z.string().transform((s) => s.toLowerCase().replace(/[\s-]+/g, '_'));
const time = z.string().min(1).max(40);

/**
 * The path as content_drafts.shopping_path keeps it, read for the tab only:
 * links and stock are cleaned on the way in, so a change is never saved
 * from it (saveDraftShoppingPath saves the person's choices alone).
 * `savedAt` is the person's last change: a save, and a build, write only
 * over the path they read.
 */
export const shoppingPathSchema = z.object({
  version: z.literal(1),
  builtAt: time,
  savedAt: time.nullish(),
  pageType: z.string().nullable(),
  categories: z.array(z.object({ name: z.string(), url: link, title: title.nullable() })).max(5),
  products: z
    .array(
      z.object({
        id,
        title,
        url: link,
        price: z.number().nullable(),
        salePrice: z.number().nullable(),
        currency: z.string().nullable(),
        availability: stock,
        image: link.nullable(),
        issues: z
          .array(z.object({ code: z.string(), attribute: z.string().nullable() }))
          .max(MAX_ISSUES),
        score: z.number(),
      }),
    )
    .max(MAX_PRODUCTS),
  leftOut: z
    .array(
      z.object({
        id,
        // Null for a kept product the catalog no longer has, and no path named.
        title: title.nullable(),
        // Any reason: one the API added since is worded as 'other' (leftOutReason).
        reason: z.string().min(1).max(40),
      }),
    )
    .max(MAX_LEFT_OUT),
  locked: z.array(id).max(MAX_KEPT),
  removed: z.array(id).max(MAX_REMOVED),
  added: z.array(id).max(MAX_KEPT),
});

/** The person's choices, all a save writes. */
export const shoppingChoicesSchema = shoppingPathSchema.pick({
  locked: true,
  removed: true,
  added: true,
});

export type ShoppingPath = z.infer<typeof shoppingPathSchema>;
export type ShoppingProduct = ShoppingPath['products'][number];
export type ShoppingChoices = z.infer<typeof shoppingChoicesSchema>;

/** The person's choices in a path. */
export function choicesOf(path: ShoppingPath): ShoppingChoices {
  return { locked: path.locked, removed: path.removed, added: path.added };
}

/**
 * Where a product goes on the page, by page type: a list's picks, a
 * comparison's options, or a link in the text. `index` counts from 0.
 */
export function placementOf(
  pageType: string | null,
  index: number,
): { key: 'pick' | 'compared' | 'linked'; n: number } {
  if (pageType === 'best_of' || pageType === 'buying_guide') return { key: 'pick', n: index + 1 };
  if (pageType === 'comparison' || pageType === 'alternatives') {
    return { key: 'compared', n: index + 1 };
  }
  return { key: 'linked', n: index + 1 };
}

/**
 * The path with a product removed: out of the page, and never picked again.
 * Past MAX_REMOVED, the oldest removal is forgotten.
 */
export function withRemoved(path: ShoppingPath, productId: string): ShoppingPath {
  return {
    ...path,
    products: path.products.filter((p) => p.id !== productId),
    locked: path.locked.filter((p) => p !== productId),
    added: path.added.filter((p) => p !== productId),
    removed: [...new Set([...path.removed, productId])].slice(-MAX_REMOVED),
  };
}

/** The path with a product locked, or unlocked: a locked one stays when the path is built again. */
export function withLocked(path: ShoppingPath, productId: string, locked: boolean): ShoppingPath {
  const rest = path.locked.filter((p) => p !== productId);
  return { ...path, locked: locked ? [...rest, productId].slice(-MAX_KEPT) : rest };
}

/** The path with a product added by the person: kept, and no longer removed. */
export function withAdded(path: ShoppingPath, productId: string): ShoppingPath {
  return {
    ...path,
    added: [...new Set([...path.added, productId])].slice(-MAX_KEPT),
    removed: path.removed.filter((p) => p !== productId),
  };
}
