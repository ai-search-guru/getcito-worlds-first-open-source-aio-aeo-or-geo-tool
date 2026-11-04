/**
 * "Where AI sends shoppers" (#1277): where the cards for the brand's own
 * products link, as shopping_merchant_split (00268) counts them for the
 * Overview tab's window and filters. Only classified cards enter the split;
 * a card with no merchant URL is counted apart, never spread over the
 * segments, so the segments always add up to the classified cards.
 */

export const MERCHANT_SPLIT_SEGMENTS = [
  'own_store',
  'amazon',
  'walmart',
  'ebay',
  'other_marketplace',
  'reseller',
] as const;

export type MerchantSplitSegment = (typeof MERCHANT_SPLIT_SEGMENTS)[number];

/** One row of shopping_merchant_split; bigint counts may arrive as strings. */
export interface MerchantSplitRow {
  own_store_cards: number | string;
  amazon_cards: number | string;
  walmart_cards: number | string;
  ebay_cards: number | string;
  other_marketplace_cards: number | string;
  reseller_cards: number | string;
  unclassified_cards: number | string;
}

export interface MerchantSplitPart {
  segment: MerchantSplitSegment;
  cards: number;
  /** Whole percent of the classified cards; the parts add up to 100. */
  percent: number;
}

export interface ShoppingMerchantSplit {
  parts: MerchantSplitPart[];
  classifiedCards: number;
  /** Own-product cards with no merchant URL, left out of the parts. */
  unclassifiedCards: number;
}

const ROW_COLUMN: Record<MerchantSplitSegment, keyof MerchantSplitRow> = {
  own_store: 'own_store_cards',
  amazon: 'amazon_cards',
  walmart: 'walmart_cards',
  ebay: 'ebay_cards',
  other_marketplace: 'other_marketplace_cards',
  reseller: 'reseller_cards',
};

function count(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Whole percentages that add up to exactly 100 (largest remainder): rounding
 * each share on its own can show 99% or 101%. All zeros when the total is 0.
 */
export function wholePercents(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return counts.map(() => 0);
  // Multiplied first, so whole shares stay whole (7/50 → 14, not 14.000…2).
  const exact = counts.map((n) => (n * 100) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, n) => sum + n, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

/** The RPC's row as the card's parts; no row (no access, no data) is all zeros. */
export function toMerchantSplit(row: MerchantSplitRow | null | undefined): ShoppingMerchantSplit {
  const cards = MERCHANT_SPLIT_SEGMENTS.map((segment) => count(row?.[ROW_COLUMN[segment]]));
  const percents = wholePercents(cards);
  return {
    parts: MERCHANT_SPLIT_SEGMENTS.map((segment, i) => ({
      segment,
      cards: cards[i],
      percent: percents[i],
    })),
    classifiedCards: cards.reduce((sum, n) => sum + n, 0),
    unclassifiedCards: count(row?.unclassified_cards),
  };
}
