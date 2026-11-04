import { describe, expect, it } from 'vitest';
import { packEstimate, roundDown } from './addOnEstimates';

/** The estimate table's numbers (CHAT-18 §A item 3): the spec's own four rows. */
describe('packEstimate', () => {
  it('matches the table for the four AI packs', () => {
    expect(packEstimate(1_000)).toEqual({ answers: 200, articles: 60 });
    expect(packEstimate(5_000)).toEqual({ answers: 1_000, articles: 300 });
    expect(packEstimate(25_000)).toEqual({ answers: 5_000, articles: 1_500 });
    expect(packEstimate(100_000)).toEqual({ answers: 20_000, articles: 6_000 });
  });

  it('rounds down, never up', () => {
    expect(roundDown(62.5)).toBe(60);
    expect(roundDown(312.5)).toBe(300);
    expect(roundDown(1_562.5)).toBe(1_500);
    expect(roundDown(9_999)).toBe(9_500);
    expect(roundDown(8)).toBe(0);
  });
});
