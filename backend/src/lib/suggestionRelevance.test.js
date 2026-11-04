import { describe, expect, it } from 'vitest';
import { RATING_TOKENS, ratingCostUsd, toRelevance } from './suggestionRelevance.js';

describe('toRelevance', () => {
  it('stores the 0–10 rating on a 0–1 scale', () => {
    expect([0, 6, 8, 10].map(toRelevance)).toEqual([0, 0.6, 0.8, 1]);
  });

  it('rounds a fractional rating to a whole step', () => {
    expect(toRelevance(7.4)).toBe(0.7);
    expect(toRelevance(5.5)).toBe(0.6);
  });

  it('caps an out-of-range rating instead of rejecting it', () => {
    expect(toRelevance(14)).toBe(1);
    expect(toRelevance(-2)).toBe(0);
  });

  it('is null when the model gave no rating', () => {
    expect([undefined, null, '', 'high', Number.NaN].map(toRelevance)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('ratingCostUsd', () => {
  it('charges the rule once and the field per suggestion, for every attempt', () => {
    // Gemini 3 Flash: $0.50 in, $3 out per million tokens.
    const one = (RATING_TOKENS.input * 0.5 + 25 * RATING_TOKENS.perSuggestion * 3) / 1e6;
    const model = 'google/gemini-3-flash-preview';
    expect(ratingCostUsd(model, { suggestions: 25, attempts: 1 })).toBeCloseTo(one, 12);
    expect(ratingCostUsd(model, { suggestions: 25, attempts: 3 })).toBeCloseTo(3 * one, 12);
  });

  it('leaves a Starter month room for about 30 refreshes', () => {
    const model = 'google/gemini-3-flash-preview';
    const once = ratingCostUsd(model, { suggestions: 25, attempts: 1 });
    const worstCase = ratingCostUsd(model, { suggestions: 25, attempts: 3 });
    // 0.1% of $49: ~30 refreshes, and still 10 if every one retried twice.
    expect(Math.floor(0.049 / once)).toBeGreaterThanOrEqual(30);
    expect(Math.floor(0.049 / worstCase)).toBeGreaterThanOrEqual(10);
  });
});
