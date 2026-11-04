import { categoryWords } from '@/lib/shopping/categories';
import { contentWords, matchScores, missingWords, queryTerms } from '@/lib/shopping/matchScore';
import {
  FIRST_WORDS,
  readiness,
  type CatalogProductRow,
  type ReadinessCheck,
} from '@/lib/shopping/products';

/**
 * A product's page in Product Visibility (ECOM-011): the shopping questions
 * it belongs on, where it stands on each one's latest shelf, and, for the
 * one it's missing most, "Why not your product?": it beside the product AI
 * picked, row by row, from what the catalog and the answers hold.
 */

/** A card of a shopping answer, as the product's page reads it. */
export interface DetailCard {
  promptId: string;
  promptText: string;
  platform: string;
  promptResultId: string;
  at: string;
  position: number;
  title: string;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviews: number | null;
  merchant: string | null;
  image: string | null;
  role: string;
  productId: string | null;
  /** The searches AI ran for the answer (its fan-out). */
  searches: readonly string[];
}

export interface ShelfProduct {
  title: string;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviews: number | null;
  merchant: string | null;
  image: string | null;
}

/** The product on one question's shelf, on one channel. */
export interface ProductShelfLine {
  promptId: string;
  promptText: string;
  platform: string;
  /** Its place on the latest shelf, from 1, or null when it isn't on it. */
  rank: number | null;
  /** The shelf's first product not the brand's own, above this one; null when none is. */
  winner: ShelfProduct | null;
  /** Its keyword match with the question and AI's searches, 0–100 (GetCito estimate). */
  score: number;
  winnerScore: number | null;
  /** The question's words the product's title and opening don't have. */
  missing: string[];
}

/** A question is the product's at this score or more, when nothing else ties it to it. */
export const RELEVANT_SCORE = 40;
/** Questions a product's page lists at most. */
export const MAX_LINES = 20;
/** Questions whose shelves a product's page reads at most (detailPrompts). */
export const DETAIL_PROMPTS = 60;

/** What the product says first: its title and its description's opening (ECOM-024). */
export function productText(product: CatalogProductRow): string {
  const opening = String(product.description ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, FIRST_WORDS)
    .join(' ');
  return `${product.title} ${opening}`.trim();
}

/** The product's category's last level, as words: "Bags > Hiking backpacks" → hiking, backpack. */
function categoryOf(product: CatalogProductRow): string[] {
  return product.category ? categoryWords(product.category.split('>').at(-1)!) : [];
}

/**
 * The questions whose shelves a product's page reads (ECOM-011), so it
 * reads those, not every shelf of the window: the one asked for, those it
 * was on (listed in `prompts` or not), those of its category, then those
 * sharing the most words with its title and opening; `max` at most. A
 * question none of these ties to it could only make its list through AI's
 * searches alone (productShelves).
 */
export function detailPrompts(
  product: CatalogProductRow,
  prompts: readonly { id: string; text: string }[],
  {
    appeared,
    include = null,
    max = DETAIL_PROMPTS,
  }: { appeared: ReadonlySet<string>; include?: string | null; max?: number },
): string[] {
  const category = categoryOf(product);
  const words = new Set(contentWords(productText(product)));
  const listed = new Set(prompts.map((prompt) => prompt.id));
  const unlisted = [include, ...appeared].flatMap((id) =>
    id && !listed.has(id) ? [{ id, text: '', tier: id === include ? 0 : 1, shared: 0 }] : [],
  );
  const ranked = prompts.flatMap((prompt) => {
    const promptWords = new Set(categoryWords(prompt.text));
    const tier =
      prompt.id === include
        ? 0
        : appeared.has(prompt.id)
          ? 1
          : category.length > 0 && category.every((word) => promptWords.has(word))
            ? 2
            : 3;
    const shared = contentWords(prompt.text).filter((word) => words.has(word)).length;
    return tier < 3 || shared > 0 ? [{ id: prompt.id, text: prompt.text, tier, shared }] : [];
  });
  return [
    ...new Set(
      [...unlisted, ...ranked]
        .sort((a, b) => a.tier - b.tier || b.shared - a.shared || a.text.localeCompare(b.text))
        .map((prompt) => prompt.id),
    ),
  ].slice(0, max);
}

/**
 * The product's shelves: the questions of its category (its name in them),
 * those it was on, and those its words match well enough, each channel's
 * latest shelf, most relevant first. `include`: a question kept whatever
 * its match, the one the Shelf's "Why not you?" opened the product for.
 */
export function productShelves(
  product: CatalogProductRow,
  cards: readonly DetailCard[],
  { include = null }: { include?: string | null } = {},
): ProductShelfLine[] {
  const category = categoryOf(product);
  const text = productText(product);
  const shelves = new Map<string, DetailCard[]>();
  for (const card of cards) {
    const key = `${card.promptId}:${card.platform}`;
    if (!shelves.has(key)) shelves.set(key, []);
    shelves.get(key)!.push(card);
  }
  const lines: ProductShelfLine[] = [];
  for (const shelf of shelves.values()) {
    const first = shelf[0];
    const latestRun = shelf.reduce((a, b) => (b.at > a.at ? b : a)).promptResultId;
    const latest = shelf
      .filter((card) => card.promptResultId === latestRun)
      .sort((a, b) => a.position - b.position);
    const terms = queryTerms(first.promptText, [...new Set(shelf.flatMap((c) => c.searches))]);
    const others = latest.filter((card) => card.productId !== product.id);
    const scores = matchScores(terms, [text, ...others.map((card) => card.title)]);
    const at = latest.findIndex((card) => card.productId === product.id);
    const appeared = shelf.some((card) => card.productId === product.id);
    const promptWords = new Set(categoryWords(first.promptText));
    const inCategory = category.length > 0 && category.every((word) => promptWords.has(word));
    const asked = include !== null && first.promptId === include;
    if (!asked && !appeared && !inCategory && scores[0] < RELEVANT_SCORE) continue;
    // The rival above it (above all, when it isn't on the shelf): never one
    // of the brand's own products, which it needn't beat.
    const winnerCard =
      latest.find(
        (card, i) => card.role !== 'own' && card.productId !== product.id && (at < 0 || i < at),
      ) ?? null;
    lines.push({
      promptId: first.promptId,
      promptText: first.promptText,
      platform: first.platform,
      rank: at >= 0 ? at + 1 : null,
      winner: winnerCard
        ? {
            title: winnerCard.title,
            price: winnerCard.price,
            currency: winnerCard.currency,
            rating: winnerCard.rating,
            reviews: winnerCard.reviews,
            merchant: winnerCard.merchant,
            image: winnerCard.image,
          }
        : null,
      score: scores[0],
      winnerScore: winnerCard ? (scores[1 + others.indexOf(winnerCard)] ?? null) : null,
      missing: missingWords(terms, text),
    });
  }
  return lines
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
        a.promptText.localeCompare(b.promptText),
    )
    .slice(0, MAX_LINES);
}

/**
 * The shelf to explain: the one asked for (the Shelf's "Why not you?", a
 * question and its channel) when it has a winner, else the most relevant
 * one it's missing, else the one it ranks lowest on.
 */
export function focusShelf(
  lines: readonly ProductShelfLine[],
  prefer: { promptId: string; platform?: string | null } | null = null,
): ProductShelfLine | null {
  if (prefer) {
    const asked = lines.find(
      (line) =>
        line.promptId === prefer.promptId &&
        (!prefer.platform || line.platform === prefer.platform) &&
        line.winner,
    );
    if (asked) return asked;
  }
  const missing = lines.filter((line) => line.rank === null && line.winner);
  if (missing.length) return missing[0];
  const behind = lines
    .filter((line) => line.rank !== null && line.rank > 1 && line.winner)
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  return behind[0] ?? null;
}

/** ✓ the product matches, ✕ it's missing it, ↓ it's weaker, or just what each has. */
export type ComparisonState = 'match' | 'missing' | 'weaker' | 'info';

export interface ComparisonRow {
  key: 'score' | 'price' | 'rating' | 'firstWords' | 'gtin' | 'photo' | 'stock' | 'merchant';
  you: string | null;
  winner: string | null;
  state: ComparisonState;
  /** Values for the row's note (en.json shopping.detail.notes). */
  note?: { key: string; values?: Record<string, string | number> };
}

/** Prices this close are "close" (ECOM-011's "Close"). */
const CLOSE_PRICE = 0.1;

/**
 * "Why not your product?": the product beside the shelf's winner, row by
 * row. `own` is how the answers showed the product, for its rating; `price`
 * formats a price as the page does.
 */
export function comparison(
  product: CatalogProductRow,
  line: ProductShelfLine,
  {
    own,
    price,
    storeDomain,
  }: {
    own: { rating: number | null; reviews: number | null } | null;
    price: (value: number, currency: string | null) => string;
    storeDomain: string | null;
  },
): ComparisonRow[] {
  const winner = line.winner;
  const rows: ComparisonRow[] = [];
  rows.push({
    key: 'score',
    you: String(line.score),
    winner: line.winnerScore === null ? null : String(line.winnerScore),
    state:
      line.winnerScore !== null && line.score < line.winnerScore
        ? line.score < line.winnerScore / 2
          ? 'missing'
          : 'weaker'
        : 'match',
    note: line.missing.length
      ? { key: 'missingWords', values: { words: line.missing.slice(0, 6).join(', ') } }
      : undefined,
  });
  if (product.price !== null || winner?.price !== null) {
    const you = product.price;
    const them = winner?.price ?? null;
    const gap = you !== null && them !== null && them > 0 ? (you - them) / them : null;
    rows.push({
      key: 'price',
      you: you === null ? null : price(you, product.currency),
      winner: them === null ? null : price(them, winner?.currency ?? null),
      state: gap === null ? 'info' : gap > CLOSE_PRICE ? 'weaker' : 'match',
      note:
        gap === null
          ? undefined
          : Math.abs(gap) <= CLOSE_PRICE
            ? { key: 'close' }
            : gap > 0
              ? { key: 'higher', values: { percent: Math.round(gap * 100) } }
              : { key: 'lower', values: { percent: Math.round(-gap * 100) } },
    });
  }
  const rating = (r: number | null, n: number | null) =>
    r === null ? null : n ? `${r.toFixed(1)} · ${n.toLocaleString('en-US')}` : r.toFixed(1);
  rows.push({
    key: 'rating',
    you: rating(own?.rating ?? null, own?.reviews ?? null),
    winner: rating(winner?.rating ?? null, winner?.reviews ?? null),
    state:
      own?.rating === null || own?.rating === undefined
        ? winner?.rating
          ? 'missing'
          : 'info'
        : winner?.rating && own.rating < winner.rating
          ? 'weaker'
          : 'match',
  });
  const ready = readiness(product);
  const has = (check: ReadinessCheck) => !ready.missing.includes(check);
  // Without a product type there's nothing to look for: not a miss (products.ts).
  const untyped = ready.unknown.includes('typeFirst');
  rows.push({
    key: 'firstWords',
    you: null,
    winner: null,
    state: untyped ? 'info' : has('typeFirst') ? 'match' : 'missing',
    note: { key: untyped ? 'noType' : 'firstWords' },
  });
  rows.push({ key: 'gtin', you: null, winner: null, state: has('gtin') ? 'match' : 'missing' });
  rows.push({ key: 'photo', you: null, winner: null, state: has('image') ? 'match' : 'missing' });
  rows.push({ key: 'stock', you: null, winner: null, state: has('inStock') ? 'match' : 'missing' });
  if (winner?.merchant) {
    rows.push({
      key: 'merchant',
      you: storeDomain,
      winner: winner.merchant,
      state: 'info',
    });
  }
  return rows;
}
