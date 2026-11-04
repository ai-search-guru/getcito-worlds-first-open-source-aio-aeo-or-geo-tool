import { describe, expect, it } from 'vitest';

import {
  compareNullsLast,
  comparePromptSortRows,
  isAllPromptsSortKey,
  promptSortValue,
  type PromptSortRow,
} from './promptSort';

describe('compareNullsLast', () => {
  it('sorts non-null values ascending', () => {
    expect([5, 1, 3].sort((a, b) => compareNullsLast(a, b, 'asc'))).toEqual([1, 3, 5]);
  });

  it('sorts non-null values descending', () => {
    expect([5, 1, 3].sort((a, b) => compareNullsLast(a, b, 'desc'))).toEqual([5, 3, 1]);
  });

  it('keeps nulls last in ascending order', () => {
    const sorted = [3, null, 1, null, 2].sort((a, b) => compareNullsLast(a, b, 'asc'));
    expect(sorted).toEqual([1, 2, 3, null, null]);
  });

  it('keeps nulls last in descending order too', () => {
    const sorted = [3, null, 1, null, 2].sort((a, b) => compareNullsLast(a, b, 'desc'));
    expect(sorted).toEqual([3, 2, 1, null, null]);
  });

  it('treats equal values and two nulls as ties', () => {
    expect(compareNullsLast(4, 4, 'asc')).toBe(0);
    expect(compareNullsLast(null, null, 'desc')).toBe(0);
  });
});

describe('promptSortValue', () => {
  const row = {
    createdAt: '2026-10-17T08:00:00.000Z',
    visibility: {
      score: null,
      totalMentions: 9,
      totalCitations: 1,
      runs: 21,
      lastRunAt: '2026-10-17T10:00:00.000Z',
    },
    position: { avg: 1.5 },
    volume: { estAiVolume: 1200 },
  };

  it('sorts Added by when the prompt was added, for every prompt', () => {
    expect(promptSortValue('added', row)).toBe(Date.parse('2026-10-17T08:00:00.000Z'));
    expect(promptSortValue('added', { createdAt: '2026-10-01T00:00:00.000Z' })).toBe(
      Date.parse('2026-10-01T00:00:00.000Z'),
    );
  });

  it("reads each column's figure, a score with no runs counting as 0", () => {
    expect(promptSortValue('visibility', row)).toBe(0);
    expect(promptSortValue('mentions', row)).toBe(9);
    expect(promptSortValue('citations', row)).toBe(1);
    expect(promptSortValue('position', row)).toBe(1.5);
    expect(promptSortValue('volume', row)).toBe(1200);
    expect(promptSortValue('runs', row)).toBe(21);
    expect(promptSortValue('lastRun', row)).toBe(Date.parse('2026-10-17T10:00:00.000Z'));
  });

  it('leaves a prompt with no figures empty, so it sorts last', () => {
    const bare = { createdAt: row.createdAt };
    for (const key of ['visibility', 'position', 'volume', 'runs', 'lastRun'] as const) {
      expect(promptSortValue(key, bare)).toBeNull();
    }
  });

  it('knows the sort keys the URL may carry', () => {
    expect(isAllPromptsSortKey('added')).toBe(true);
    expect(isAllPromptsSortKey('lastRun')).toBe(true);
    expect(isAllPromptsSortKey('created')).toBe(false);
    expect(isAllPromptsSortKey(null)).toBe(false);
  });
});

describe('comparePromptSortRows', () => {
  const row = (
    estAiVolume: number | null,
    confidence?: 'high' | 'medium' | 'low',
  ): PromptSortRow => ({
    createdAt: '2026-10-01T00:00:00Z',
    volume: estAiVolume === null ? undefined : { estAiVolume, confidence },
  });

  it('puts low-confidence volumes after the confident ones, before rows with none', () => {
    const rows = [
      row(9000, 'low'),
      row(null),
      row(500, 'high'),
      row(2000, 'medium'),
      row(100, 'low'),
    ];
    const order = (dir: 'asc' | 'desc') =>
      [...rows]
        .sort((a, b) => comparePromptSortRows('volume', a, b, dir))
        .map((r) => r.volume?.estAiVolume ?? null);
    expect(order('desc')).toEqual([2000, 500, 9000, 100, null]);
    expect(order('asc')).toEqual([500, 2000, 100, 9000, null]);
  });

  it('sorts other columns as before', () => {
    const a = {
      createdAt: '2026-10-02T00:00:00Z',
      volume: { estAiVolume: 1, confidence: 'low' as const },
    };
    const b = { createdAt: '2026-10-01T00:00:00Z' };
    expect(comparePromptSortRows('added', a, b, 'desc')).toBeLessThan(0);
  });
});
