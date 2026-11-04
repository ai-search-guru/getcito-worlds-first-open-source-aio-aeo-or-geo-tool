import { describe, expect, it } from 'vitest';
import {
  asksMoreThanOne,
  batchSources,
  growsPastLimit,
  headingLimit,
  suggestionLinks,
  suggestionSources,
  type DraftSuggestion,
} from './suggestions';

/**
 * How long an agent's change may make a heading: an H1 up to 70 characters,
 * other headings up to 90, as 2026's SEO/AEO guides advise. Longer, it has
 * taken in an answer.
 */
describe('growsPastLimit', () => {
  it('holds an H1 to 70 characters and other headings to 90', () => {
    expect([1, 2, 3, 6].map(headingLimit)).toEqual([70, 90, 90, 90]);
    expect(growsPastLimit(1, 20, 70)).toBe(false);
    expect(growsPastLimit(1, 20, 71)).toBe(true);
    expect(growsPastLimit(2, 20, 90)).toBe(false);
    expect(growsPastLimit(2, 20, 91)).toBe(true);
  });

  it('lets a heading already over its limit be shortened, never grown', () => {
    expect(growsPastLimit(2, 120, 110)).toBe(false);
    expect(growsPastLimit(2, 120, 120)).toBe(false);
    expect(growsPastLimit(2, 120, 121)).toBe(true);
  });
});

/** One question per heading: a new question goes in as its own heading. */
describe('asksMoreThanOne', () => {
  it('holds a heading to one question, unless it already asked more', () => {
    expect(asksMoreThanOne('What is AEO?', 'What is AEO? What is an AEO tracker?')).toBe(true);
    expect(asksMoreThanOne('What is AEO?', 'What is AEO？ What is an AEO tracker？')).toBe(true);
    expect(asksMoreThanOne('What is AEO?', 'What is an AEO tracker?')).toBe(false);
    // A subtitle, or "?" inside a word, is no second question.
    expect(asksMoreThanOne('AEO', 'AEO or SEO? Which matters more in 2026')).toBe(false);
    expect(asksMoreThanOne('Guide', 'What?No guide?')).toBe(false);
    expect(asksMoreThanOne('Why AEO? Why now?', 'Why AEO? Why today?')).toBe(false);
  });
});

/** A replace's links (00240), as the editor may put them on. */
describe('suggestionLinks', () => {
  it('keeps safe links inside the words, in order, not overlapping', () => {
    expect(
      suggestionLinks(
        [
          { start: 4, end: 13, href: 'https://acme.example/pricing' },
          { start: 10, end: 20, href: 'https://acme.example/overlap' },
          { start: 14, end: 18, href: '/guides/brew' },
          { start: 19, end: 99, href: 'https://past.example' },
          { start: 20, end: 21, href: 'javascript:alert(1)' },
        ],
        'See our plans for teams.',
      ),
    ).toEqual([
      { start: 4, end: 13, href: 'https://acme.example/pricing' },
      { start: 14, end: 18, href: '/guides/brew' },
    ]);
  });

  it('is null without any', () => {
    expect(suggestionLinks(null, 'x')).toBeNull();
    expect(suggestionLinks([], 'x')).toBeNull();
    expect(suggestionLinks([{ start: 0, end: 1 }], 'x')).toBeNull();
  });
});

describe('a suggestion’s sources (00248, CE-033)', () => {
  const fanout = { kind: 'fanout' as const, ref: 'best tracker', label: 'Best tracker' };
  const page = {
    kind: 'cited_page' as const,
    ref: 'https://a.example/x',
    label: 'https://a.example/x',
  };

  it('keeps the sources it can show, and marks within its words, renumbered', () => {
    const odd = { kind: 'other', ref: 'x', label: 'x' };
    // The unknown kind before them is left out: marks to 1 and 2 now point to 0 and 1.
    expect(
      suggestionSources(
        [odd, fanout, { ...page, ref: '' }, page],
        [
          { start: 0, end: 4, source: 1 },
          { start: 2, end: 6, source: 1 },
          { start: 5, end: 12, source: 3 },
          { start: 6, end: 99, source: 1 },
          { start: 13, end: 14, source: 2 },
        ],
        'Best tracker here',
      ),
    ).toEqual({
      sources: [fanout, page],
      marks: [
        { start: 0, end: 4, source: 0 },
        { start: 5, end: 12, source: 1 },
      ],
    });
    expect(suggestionSources(null, [{ start: 0, end: 1, source: 0 }], 'x')).toEqual({
      sources: null,
      marks: null,
    });
    expect(suggestionSources([], null, 'x')).toEqual({ sources: null, marks: null });
  });

  it("keeps Brief › Your input's sources, the person's own (CE-048)", () => {
    const table = { kind: 'input' as const, ref: 'data:1', label: 'Survey' };
    expect(suggestionSources([table], [{ start: 0, end: 5, source: 0 }], '1,250 teams')).toEqual({
      sources: [table],
      marks: [{ start: 0, end: 5, source: 0 }],
    });
  });

  it('counts a batch’s sources once: "built from N of your sources"', () => {
    const s = (sources: DraftSuggestion['sources']) => ({ sources }) as DraftSuggestion;
    expect(batchSources([s([fanout, page]), s([fanout]), s(null)])).toEqual([fanout, page]);
  });
});
