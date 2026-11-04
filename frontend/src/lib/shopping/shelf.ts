import { categoryLeaf, categoryWords } from './categories';
import type { ProductRow } from './products';

/**
 * Product Visibility's Shelf (ECOM-006): for each shopping question the
 * brand tracks, the products AI put on its "shelf", in order, on each
 * channel, and where the brand's own products stand. Read from the product
 * cards of AI answers (prompt_result_shopping_cards), a card the brand's own
 * when matched_brand_role is 'own', and its catalog product when 00360
 * matched one.
 */

/** A card as the shelf reads it. */
export interface ShelfCardRow {
  prompt_result_id: string;
  position: number;
  created_at: string;
  platform: string;
  product_title: string | null;
  price_amount: number | null;
  price_currency: string | null;
  image_url: string | null;
  merchant_domain: string | null;
  rating: number | null;
  review_count: number | null;
  matched_brand_role: string;
  merchant_kind: string | null;
  marketplace: string | null;
  catalog_product_id: string | null;
  prompt_id: string | null;
  prompt_text: string | null;
}

/** A product on a shelf. */
export interface ShelfCard {
  /** Its place on the shelf, from 1. */
  rank: number;
  title: string;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviews: number | null;
  image: string | null;
  merchant: string | null;
  own: boolean;
  /** The marketplace an own product was linked through ("via Amazon"), else null. */
  via: string | null;
  productId: string | null;
}

/** One shopping question on one channel: its latest shelf, and the brand's week on it. */
export interface ShelfRow {
  key: string;
  promptId: string;
  promptText: string;
  platform: string;
  /** When its latest shelf was read. */
  at: string;
  cards: ShelfCard[];
  /** The brand's best place on the latest shelf, or null when it isn't on it. */
  ownRank: number | null;
  /** The shelves read in the last 7 days, and how many had one of the brand's products. */
  weekShelves: number;
  weekOwnShelves: number;
}

/** The products a row shows at most. */
export const SHELF_CARDS = 6;

const WEEK_MS = 7 * 86_400_000;

/**
 * The shelves: one row per question and channel, its newest answer's
 * products in order. The rows the brand isn't on come first, then those it
 * ranks lowest on: what needs work first.
 */
export function buildShelf(cards: readonly ShelfCardRow[], now: number = Date.now()): ShelfRow[] {
  const groups = new Map<
    string,
    {
      promptId: string;
      promptText: string;
      platform: string;
      runs: Map<string, { at: string; cards: ShelfCardRow[] }>;
    }
  >();
  for (const card of cards) {
    if (!card.prompt_id) continue;
    const key = `${card.prompt_id}:${card.platform}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        promptId: card.prompt_id,
        promptText: card.prompt_text ?? '',
        platform: card.platform,
        runs: new Map(),
      };
      groups.set(key, group);
    }
    let run = group.runs.get(card.prompt_result_id);
    if (!run) {
      run = { at: card.created_at, cards: [] };
      group.runs.set(card.prompt_result_id, run);
    }
    if (card.created_at > run.at) run.at = card.created_at;
    run.cards.push(card);
  }

  const rows: ShelfRow[] = [];
  for (const [key, group] of groups) {
    const runs = [...group.runs.values()];
    const latest = runs.reduce((a, b) => (b.at > a.at ? b : a));
    const shelf = [...latest.cards]
      .sort((a, b) => a.position - b.position)
      .map(
        (card, i): ShelfCard => ({
          rank: i + 1,
          title: card.product_title?.trim() || '—',
          price: card.price_amount,
          currency: card.price_currency,
          rating: card.rating,
          reviews: card.review_count,
          image: card.image_url,
          merchant: card.merchant_domain,
          own: card.matched_brand_role === 'own',
          via:
            card.matched_brand_role === 'own' && card.merchant_kind === 'marketplace'
              ? card.marketplace
              : null,
          productId: card.catalog_product_id,
        }),
      );
    const week = runs.filter((run) => now - Date.parse(run.at) <= WEEK_MS);
    rows.push({
      key,
      promptId: group.promptId,
      promptText: group.promptText,
      platform: group.platform,
      at: latest.at,
      cards: shelf.slice(0, SHELF_CARDS),
      ownRank: shelf.find((card) => card.own)?.rank ?? null,
      weekShelves: week.length,
      weekOwnShelves: week.filter((run) =>
        run.cards.some((card) => card.matched_brand_role === 'own'),
      ).length,
    });
  }
  return rows.sort(
    (a, b) =>
      (a.ownRank === null ? 0 : 1) - (b.ownRank === null ? 0 : 1) ||
      (b.ownRank ?? 0) - (a.ownRank ?? 0) ||
      a.promptText.localeCompare(b.promptText) ||
      a.platform.localeCompare(b.platform),
  );
}

/** The brand's place on the shelves over the window. */
export interface ShelfStats {
  /** Product slots in the answers read, and how many held one of the brand's products. */
  slots: number;
  ownSlots: number;
  /** The brand's distinct products on the shelf: catalog products when matched, else titles. */
  products: number;
  /** Whether `products` counts catalog products (00360) rather than titles. */
  fromCatalog: boolean;
  /** Each channel's slots holding the brand's products, most first. */
  channels: { platform: string; ownSlots: number }[];
}

const titleKey = (title: string | null) =>
  String(title ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export function shelfStats(cards: readonly ShelfCardRow[]): ShelfStats {
  const own = cards.filter((card) => card.matched_brand_role === 'own');
  const matched = new Set(
    own.flatMap((card) => (card.catalog_product_id ? [card.catalog_product_id] : [])),
  );
  const titles = new Set(own.map((card) => titleKey(card.product_title)).filter(Boolean));
  const channels = new Map<string, number>();
  for (const card of own) channels.set(card.platform, (channels.get(card.platform) ?? 0) + 1);
  return {
    slots: cards.length,
    ownSlots: own.length,
    products: matched.size || titles.size,
    fromCatalog: matched.size > 0,
    channels: [...channels]
      .map(([platform, ownSlots]) => ({ platform, ownSlots }))
      .sort((a, b) => b.ownSlots - a.ownSlots || a.platform.localeCompare(b.platform)),
  };
}

/** The Shelf's price filter: a shelf is in a band when its products' middle price is. */
export const PRICE_BANDS = ['all', 'under50', '50to100', '100to200', 'over200'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

/** Each band's prices, from its lower bound up to (not with) its upper one. */
export const BAND_RANGE: Record<Exclude<PriceBand, 'all'>, [number, number]> = {
  under50: [0, 50],
  '50to100': [50, 100],
  '100to200': [100, 200],
  over200: [200, Infinity],
};

/**
 * The currency the shelves' prices are in, for the bands' labels: the one
 * most of their priced products show, else null.
 */
export function shelfCurrency(rows: readonly ShelfRow[]): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const card of row.cards) {
      if (card.price === null || !card.currency) continue;
      counts.set(card.currency, (counts.get(card.currency) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  for (const [currency, count] of counts) {
    if (best === null || count > counts.get(best)!) best = currency;
  }
  return best;
}

export function inPriceBand(row: ShelfRow, band: PriceBand): boolean {
  if (band === 'all') return true;
  const prices = row.cards
    .map((card) => card.price)
    .filter((price): price is number => typeof price === 'number')
    .sort((a, b) => a - b);
  if (!prices.length) return false;
  const middle = prices[Math.floor((prices.length - 1) / 2)];
  const [min, max] = BAND_RANGE[band];
  return middle >= min && middle < max;
}

/**
 * Words a shopping question asks with, not for: what's wanted of a product
 * ("best", "under", "cheap") rather than which one, as categoryWords reads
 * them (singular). "Why not you?" matches on neither these nor numbers.
 */
const ASKING_WORDS = new Set([
  'best',
  'top',
  'good',
  'great',
  'cheap',
  'cheapest',
  'affordable',
  'budget',
  'under',
  'over',
  'below',
  'above',
  'less',
  'more',
  'than',
  'most',
  'popular',
  'rated',
  'review',
  'recommend',
  'recommended',
  'buy',
  'price',
  'deal',
  'sale',
  'new',
  'vs',
  'versu',
  'what',
  'which',
  'where',
  'how',
  'is',
  'are',
  'in',
  'on',
  'to',
  'my',
  'me',
  'should',
  'need',
  'want',
  'seller',
]);

/**
 * Words that say who a product is for ("men", "kids") rather than what it
 * is, as categoryWords reads them (singular). In "Why not you?" they break
 * a tie, but never make a product a candidate: "best running shoes for men"
 * doesn't ask for a tee of "Clothing > Men".
 */
const AUDIENCE_WORDS = new Set([
  'men',
  'man',
  'women',
  'woman',
  'lady',
  'male',
  'female',
  'unisex',
  'adult',
  'kid',
  'child',
  'children',
  'boy',
  'girl',
  'baby',
  'toddler',
  'infant',
  'teen',
  'youth',
  'junior',
]);

/** A text's words that name a product: no asking words, numbers or single letters. */
function productWords(text: string): string[] {
  return categoryWords(text).filter(
    (word) => word.length > 1 && !/^\d+$/.test(word) && !ASKING_WORDS.has(word),
  );
}

/**
 * "Why not you?" needs this many of the question's words in a product, short
 * of its category, not counting who it's for (AUDIENCE_WORDS).
 */
export const WHY_NOT_WORDS = 2;

/**
 * "Why not you?" (the mockup's Shelf): for a shelf the brand isn't on, the
 * product of its catalog the question asks for most, by the question's
 * words in the product's title, category and type; the readier one on a
 * tie. A product is a candidate when it has WHY_NOT_WORDS of the question's
 * words, or when its category or type is what the question names (all its
 * words in it), past who it's for: "best running shoes for men under $100"
 * isn't "Men's Best Seller Tee", even of "Clothing > Men". Null when none
 * is, or the brand is on the shelf.
 */
export function whyNotYou(row: ShelfRow, products: readonly ProductRow[]): ProductRow | null {
  if (row.ownRank !== null) return null;
  const asked = new Set(productWords(row.promptText));
  const names = (text: string | null) => {
    const words = productWords(text ?? '');
    return (
      words.some((word) => !AUDIENCE_WORDS.has(word)) && words.every((word) => asked.has(word))
    );
  };
  let best: { row: ProductRow; score: number } | null = null;
  for (const candidate of products) {
    const { product } = candidate;
    const words = new Set(
      productWords(
        [
          product.title,
          product.category ? categoryLeaf(product.category) : '',
          product.productType ?? '',
        ]
          .filter(Boolean)
          .join(' '),
      ),
    );
    let score = 0;
    // The shared words that say what it is, not who it's for.
    let what = 0;
    for (const word of asked) {
      if (!words.has(word)) continue;
      score += 1;
      if (!AUDIENCE_WORDS.has(word)) what += 1;
    }
    const ofCategory =
      names(product.category ? categoryLeaf(product.category) : null) || names(product.productType);
    if (what < WHY_NOT_WORDS && !ofCategory) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        (candidate.readiness > best.row.readiness ||
          (candidate.readiness === best.row.readiness &&
            candidate.product.title.localeCompare(best.row.product.title) < 0)))
    ) {
      best = { row: candidate, score };
    }
  }
  return best?.row ?? null;
}
