import { describe, expect, it } from 'vitest';
import type { BreakdownRow } from '@/lib/actions/tracking';
import { sortBreakdownRowsForDisplay } from './breakdownDisplay';

function row(id: string, cur: number, delta = 0, label = id): BreakdownRow {
  return {
    id,
    label,
    prev: cur - delta,
    cur,
    delta,
    deltaPct: null,
    curRuns: cur,
    prevRuns: cur - delta,
  };
}

describe('sortBreakdownRowsForDisplay', () => {
  it('sorts rows by current value descending without mutating the source order', () => {
    const rows = [row('largest-drop', 3, -7), row('highest-current', 12, 1), row('middle', 8, -2)];

    expect(sortBreakdownRowsForDisplay(rows).map((r) => r.id)).toEqual([
      'highest-current',
      'middle',
      'largest-drop',
    ]);
    expect(rows.map((r) => r.id)).toEqual(['largest-drop', 'highest-current', 'middle']);
  });

  it('uses deterministic tie-breakers for equal current values', () => {
    const rows = [row('b', 5, -1, 'Beta'), row('a', 5, 2, 'Alpha'), row('c', 5, 2, 'Gamma')];

    expect(sortBreakdownRowsForDisplay(rows).map((r) => r.label)).toEqual([
      'Alpha',
      'Gamma',
      'Beta',
    ]);
  });
});
