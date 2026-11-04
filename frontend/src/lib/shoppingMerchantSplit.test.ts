import { describe, expect, it } from 'vitest';
import { toMerchantSplit, wholePercents } from './shoppingMerchantSplit';

describe('toMerchantSplit', () => {
  it('splits the classified own cards and keeps the unclassified apart', () => {
    const split = toMerchantSplit({
      own_store_cards: 50,
      amazon_cards: '30',
      walmart_cards: 10,
      ebay_cards: 5,
      other_marketplace_cards: 3,
      reseller_cards: 2,
      unclassified_cards: '40',
    });

    expect(split.classifiedCards).toBe(100);
    expect(split.unclassifiedCards).toBe(40);
    expect(split.parts).toEqual([
      { segment: 'own_store', cards: 50, percent: 50 },
      { segment: 'amazon', cards: 30, percent: 30 },
      { segment: 'walmart', cards: 10, percent: 10 },
      { segment: 'ebay', cards: 5, percent: 5 },
      { segment: 'other_marketplace', cards: 3, percent: 3 },
      { segment: 'reseller', cards: 2, percent: 2 },
    ]);
  });

  it('is all zeros without a row (no access or no cards)', () => {
    const split = toMerchantSplit(undefined);
    expect(split.classifiedCards).toBe(0);
    expect(split.unclassifiedCards).toBe(0);
    expect(split.parts.every((p) => p.cards === 0 && p.percent === 0)).toBe(true);
  });

  it('leaves unclassified cards out of the percentages', () => {
    const split = toMerchantSplit({
      own_store_cards: 1,
      amazon_cards: 1,
      walmart_cards: 0,
      ebay_cards: 0,
      other_marketplace_cards: 0,
      reseller_cards: 0,
      unclassified_cards: 98,
    });
    expect(split.parts.slice(0, 2).map((p) => p.percent)).toEqual([50, 50]);
  });
});

describe('wholePercents', () => {
  it('adds up to 100 where rounding each share would not', () => {
    // 33.3 / 33.3 / 33.3 rounds to 99; 16.7 × 6 rounds to 102.
    expect(wholePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(wholePercents([1, 1, 1, 1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(wholePercents([286, 2190, 11752, 0, 0, 0]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('is all zeros when there is nothing to split', () => {
    expect(wholePercents([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
