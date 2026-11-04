import { describe, expect, it } from 'vitest';
import { contentWords, matchScores, missingWords, queryTerms, sameProduct } from './matchScore';

/** #1282, part 1: the keyword half of a product's match with a shopping prompt. */

const COMPETING = [
  'Trailrunner Waterproof Hiking Boot',
  'City Sneaker Classic White',
  'Summit Trail Shoe for Wet Rock',
  'Everyday Running Shoe',
];

describe('contentWords', () => {
  it('keeps the words that say what the product is, as matched', () => {
    expect(contentWords('What are the best waterproof hiking boots for wet rock?')).toEqual([
      'waterproof',
      'hiking',
      'boot',
      'wet',
      'rock',
    ]);
  });

  it('lowercases a Turkish İ without a stray dot, and drops Turkish small and intent words', () => {
    expect(contentWords('İSTANBUL için en iyi robot süpürge tavsiyesi')).toEqual([
      'istanbul',
      'robot',
      'süpürge',
    ]);
  });
});

describe('queryTerms', () => {
  it("takes the prompt's words, then its searches', each once", () => {
    expect(
      queryTerms('Best waterproof hiking boots', [
        'waterproof hiking boots wet rock',
        'hiking boots grip',
      ]),
    ).toEqual(['waterproof', 'hiking', 'boot', 'wet', 'rock', 'grip']);
  });

  it('keeps at most 30 words', () => {
    const many = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    expect(queryTerms(many)).toHaveLength(30);
  });
});

describe('matchScores', () => {
  const terms = queryTerms('waterproof hiking boots for wet rock');

  it('scores 0 to 100, the product with more of the words higher', () => {
    const [boot, sneaker, trail] = matchScores(terms, COMPETING);
    expect(boot).toBeGreaterThan(trail);
    expect(trail).toBeGreaterThan(sneaker);
    expect(sneaker).toBe(0);
    for (const score of matchScores(terms, COMPETING)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("raises a product's score when it gains a missing word", () => {
    const before = matchScores(terms, COMPETING)[0];
    const after = matchScores(terms, [
      'Trailrunner Waterproof Hiking Boot for Wet Rock',
      ...COMPETING.slice(1),
    ])[0];
    expect(after).toBeGreaterThan(before);
  });

  it('reads 100 for a product with every word at a typical length', () => {
    expect(matchScores(['boot', 'waterproof'], ['Waterproof boot', 'Waterproof boot'])).toEqual([
      100, 100,
    ]);
  });

  it('scores 0 with no query words, and an empty list for no products', () => {
    expect(matchScores([], COMPETING)).toEqual([0, 0, 0, 0]);
    expect(matchScores(terms, [])).toEqual([]);
  });
});

describe('missingWords', () => {
  it("lists the query's words the product lacks, never one it has", () => {
    const terms = queryTerms('waterproof hiking boots for wet rock');
    expect(missingWords(terms, 'Trailrunner Waterproof Hiking Boot')).toEqual(['wet', 'rock']);
    expect(missingWords(terms, 'Waterproof hiking boots for wet rock')).toEqual([]);
  });
});

describe('sameProduct', () => {
  it('reads two titles as one product, case, spaces and punctuation aside', () => {
    expect(
      sameProduct('Trailrunner  Waterproof-Hiking Boot', 'trailrunner waterproof hiking boot'),
    ).toBe(true);
    expect(sameProduct('Trailrunner Boot', 'Trailrunner Boot 2')).toBe(false);
  });
});
