import { describe, expect, it } from 'vitest';
import { editSpans } from './editSpans.js';

/** Edits kept apart and in order, checked against their neighbours (#1544 review). */

/** What a list of edits says is free, read the slow way: against every one. */
const freeByAll = (spans, start, end) => spans.every((e) => end <= e.start || start >= e.end);

describe('editSpans', () => {
  it('keeps edits in order of start and says what is free, as against every edit', () => {
    const { spans, free, add } = editSpans();
    for (const [start, end] of [
      [20, 25],
      [5, 10],
      [30, 31],
    ]) {
      expect(free(start, end)).toBe(true);
      add({ start, end });
    }
    expect(spans.map((e) => e.start)).toEqual([5, 20, 30]);
    for (const [start, end] of [
      [0, 5],
      [0, 6],
      [9, 11],
      [10, 20],
      [10, 21],
      [24, 30],
      [26, 29],
      [31, 40],
      [3, 40],
    ]) {
      expect(free(start, end), `${start}-${end}`).toBe(freeByAll(spans, start, end));
    }
  });

  it('reads an empty span at another one’s start as the slow check does', () => {
    const { spans, free, add } = editSpans();
    add({ start: 5, end: 10 });
    expect(free(5, 5)).toBe(true);
    add({ start: 5, end: 5 });
    expect(free(5, 7)).toBe(false);
    expect(free(5, 7)).toBe(freeByAll(spans, 5, 7));
    expect(free(10, 12)).toBe(true);
  });

  it('agrees with the slow check on random edits', () => {
    const { spans, free, add } = editSpans();
    let seed = 7;
    const next = (n) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    for (let i = 0; i < 2000; i++) {
      const start = next(500);
      const end = start + next(6);
      const fast = free(start, end);
      expect(fast, `${start}-${end}`).toBe(freeByAll(spans, start, end));
      if (fast) add({ start, end });
    }
  });
});
