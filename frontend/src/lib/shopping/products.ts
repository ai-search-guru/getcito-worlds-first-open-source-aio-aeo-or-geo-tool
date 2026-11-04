/**
 * Product Visibility's Products table (ECOM-007): every product of the
 * brand's catalog with where it stands on the AI shelf (its cards, 00360),
 * the AI visits its page got and the orders they led to (00361), and how
 * ready it is for AI shopping from what the catalog holds.
 */

/** A catalog product as the table reads it. */
export interface CatalogProductRow {
  id: string;
  title: string;
  url: string | null;
  productType: string | null;
  brand: string | null;
  description: string | null;
  image: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  /**
   * Every variant's price and sale price: an AI answer's price that is one
   * of them is right. Absent, `price` alone.
   */
  prices?: { price: number; currency: string | null }[];
  inStock: boolean;
  hasGtin: boolean;
}

/** One of the brand's cards on a shelf, matched to a catalog product. */
export interface ProductCardRow {
  productId: string;
  /** The question and channel: one shelf. */
  shelf: string;
  /** Its place on the shelf, from 1. */
  rank: number;
  /** The price the answer showed for it, on which channel, and when (ISO). */
  price?: number | null;
  currency?: string | null;
  platform?: string;
  at?: string;
}

/** AI visits and orders per product (00361). */
export interface ProductAiStats {
  productId: string;
  aiVisits: number;
  orders: number;
  revenue: number | null;
  currency: string | null;
}

/** The checks behind a product's readiness, and what each is worth. */
export const READINESS_CHECKS = {
  gtin: 20,
  image: 15,
  inStock: 15,
  price: 10,
  description: 15,
  typeFirst: 10,
  category: 10,
  brand: 5,
} as const;
export type ReadinessCheck = keyof typeof READINESS_CHECKS;

/** Words a description needs to say enough. */
const DESCRIPTION_WORDS = 25;
/** ChatGPT reads about this many words of a description (ECOM-024). */
export const FIRST_WORDS = 40;

const wordsOf = (text: string | null) =>
  String(text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * A product's readiness, 0–100, the checks it misses, and those that can't
 * be checked: a GTIN, a photo, in stock, a price, a description that says
 * enough and names what the product is in its first 40 words, a category
 * and a brand. The first 40 words are checked against the product's type
 * (its feed's product type, else its category's last part): without one,
 * as Shopify often leaves it, that check is unknown and left out of the
 * score, which is then out of the other checks' points.
 */
export function readiness(product: CatalogProductRow): {
  score: number;
  missing: ReadinessCheck[];
  unknown: ReadinessCheck[];
} {
  const description = wordsOf(product.description);
  const type = wordsOf(
    product.productType?.trim() || product.category?.split('>').at(-1)?.trim() || null,
  );
  const firstWords = new Set(description.slice(0, FIRST_WORDS));
  const passed: Record<ReadinessCheck, boolean | null> = {
    gtin: product.hasGtin,
    image: !!product.image,
    inStock: product.inStock,
    price: product.price !== null,
    description: description.length >= DESCRIPTION_WORDS,
    // The type's last word, as a description says it: "Trail running shoe" → "shoe".
    typeFirst: type.length
      ? [type.at(-1)!, type.at(-1)!.replace(/s$/, '')].some((word) =>
          [...firstWords].some((w) => w === word || w.replace(/s$/, '') === word),
        )
      : null,
    category: !!product.category,
    brand: !!product.brand,
  };
  const checks = Object.keys(READINESS_CHECKS) as ReadinessCheck[];
  const missing = checks.filter((check) => passed[check] === false);
  const unknown = checks.filter((check) => passed[check] === null);
  const points = checks
    .filter((check) => passed[check])
    .reduce((sum, check) => sum + READINESS_CHECKS[check], 0);
  return { score: Math.round((100 * points) / checkedPoints(unknown)), missing, unknown };
}

/** The points of the checks made: all 100, less those that couldn't be. */
function checkedPoints(unknown: readonly ReadinessCheck[]): number {
  return unknown.reduce((sum, check) => sum - READINESS_CHECKS[check], 100);
}

/** What a missing check costs a product's score, the checks it couldn't make aside. */
export function readinessPoints(
  check: ReadinessCheck,
  unknown: readonly ReadinessCheck[] = [],
): number {
  return Math.round((100 * READINESS_CHECKS[check]) / checkedPoints(unknown));
}

/** A product's row in the table. */
export interface ProductRow {
  product: CatalogProductRow;
  /** The shelves (question × channel) it was on. */
  shelves: number;
  /** Its share of appearances at #1 or #2, null when never shown. */
  winRate: number | null;
  avgRank: number | null;
  aiVisits: number;
  orders: number;
  revenue: number | null;
  currency: string | null;
  readiness: number;
  missing: ReadinessCheck[];
  /** The checks that couldn't be made (no product type), left out of `readiness`. */
  unknown?: ReadinessCheck[];
  /**
   * A price a channel's latest AI answer shows for it that is none of its
   * variants' (more than PRICE_TOLERANCE off each, in the same currency);
   * null for none.
   */
  wrongPrice: { seen: number; currency: string | null; platform: string | null } | null;
}

/** An answer's price this far from the catalog's is wrong (ECOM-016). */
export const PRICE_TOLERANCE = 0.02;

function wrongPrice(
  product: CatalogProductRow,
  cards: readonly ProductCardRow[],
): ProductRow['wrongPrice'] {
  const known = (
    product.prices?.length
      ? product.prices
      : product.price === null
        ? []
        : [{ price: product.price, currency: product.currency }]
  ).filter((known) => known.price > 0);
  if (!known.length) return null;
  // Each channel's latest answer: an older one's price may have been right then.
  const latest = new Map<string, ProductCardRow>();
  for (const card of cards) {
    const channel = card.platform ?? '';
    const kept = latest.get(channel);
    if (!kept || (card.at ?? '') > (kept.at ?? '')) latest.set(channel, card);
  }
  for (const card of latest.values()) {
    if (typeof card.price !== 'number') continue;
    const seen = card.price;
    const same = known.filter(
      (known) => !card.currency || !known.currency || known.currency === card.currency,
    );
    if (
      same.length &&
      same.every((known) => Math.abs(seen - known.price) / known.price > PRICE_TOLERANCE)
    ) {
      return { seen, currency: card.currency ?? product.currency, platform: card.platform ?? null };
    }
  }
  return null;
}

/** The table's ready-made views (ECOM-007), the AI Traffic "Cited, not clicked" pattern. */
export const PRODUCT_VIEWS = ['all', 'never', 'notClicked', 'notBought', 'topSellers'] as const;
export type ProductView = (typeof PRODUCT_VIEWS)[number];

export function productRows(
  products: readonly CatalogProductRow[],
  cards: readonly ProductCardRow[],
  stats: readonly ProductAiStats[],
): ProductRow[] {
  const byProduct = new Map<
    string,
    { shelves: Set<string>; ranks: number[]; cards: ProductCardRow[] }
  >();
  for (const card of cards) {
    let entry = byProduct.get(card.productId);
    if (!entry) {
      entry = { shelves: new Set(), ranks: [], cards: [] };
      byProduct.set(card.productId, entry);
    }
    entry.shelves.add(card.shelf);
    entry.ranks.push(card.rank);
    entry.cards.push(card);
  }
  const statsOf = new Map(stats.map((s) => [s.productId, s]));
  return products.map((product) => {
    const shown = byProduct.get(product.id);
    const ai = statsOf.get(product.id);
    const ranks = shown?.ranks ?? [];
    const ready = readiness(product);
    return {
      product,
      shelves: shown?.shelves.size ?? 0,
      winRate: ranks.length ? ranks.filter((rank) => rank <= 2).length / ranks.length : null,
      avgRank: ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null,
      aiVisits: ai?.aiVisits ?? 0,
      orders: ai?.orders ?? 0,
      revenue: ai?.revenue ?? null,
      currency: ai?.currency ?? null,
      readiness: ready.score,
      missing: ready.missing,
      unknown: ready.unknown,
      wrongPrice: wrongPrice(product, shown?.cards ?? []),
    };
  });
}

export function inView(row: ProductRow, view: ProductView): boolean {
  switch (view) {
    case 'never':
      return row.shelves === 0;
    case 'notClicked':
      return row.shelves > 0 && row.aiVisits === 0;
    case 'notBought':
      return row.aiVisits > 0 && row.orders === 0;
    case 'topSellers':
      return row.orders > 0;
    default:
      return true;
  }
}

/**
 * How many products each view holds. The rows may be part of the catalog
 * (the table's first PRODUCTS_TABLE_MAX, those on a shelf or visited first):
 * All is then the catalog's `total`, and Never shown the products beyond
 * those shown.
 */
export function viewCounts(
  rows: readonly ProductRow[],
  total: number,
): Record<ProductView, number> {
  const counts = Object.fromEntries(
    PRODUCT_VIEWS.map((id) => [id, rows.filter((row) => inView(row, id)).length]),
  ) as Record<ProductView, number>;
  const shown = rows.length - counts.never;
  counts.all = Math.max(total, rows.length);
  counts.never = counts.all - shown;
  return counts;
}

/** A view's rows, in its order: top sellers by revenue, the rest by shelves, then visits. */
export function viewRows(rows: readonly ProductRow[], view: ProductView): ProductRow[] {
  const listed = rows.filter((row) => inView(row, view));
  return listed.sort((a, b) =>
    view === 'topSellers'
      ? (b.revenue ?? 0) - (a.revenue ?? 0) || b.orders - a.orders
      : b.shelves - a.shelves ||
        b.aiVisits - a.aiVisits ||
        a.product.title.localeCompare(b.product.title),
  );
}
