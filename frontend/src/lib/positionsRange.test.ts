/**
 * positionsRange.test.ts  (PROMPT-002)
 *
 * Tests the URL round trip of the Positions panel's own range.
 */

import { describe, expect, test } from 'vitest';
import { panelRangeFromTable, parsePositionsRange, positionsUrlParams } from './positionsRange';

describe('positionsUrlParams', () => {
  test('a closed panel clears every param', () => {
    expect(
      positionsUrlParams(null, { preset: 'custom', from: '2026-10-01', to: '2026-10-05' }),
    ).toEqual({
      positions: null,
      positionsRange: null,
      positionsFrom: null,
      positionsTo: null,
    });
  });

  test('a preset range keeps only the prompt and the preset', () => {
    expect(positionsUrlParams('p1', { preset: '7d', from: '2026-10-01', to: '' })).toEqual({
      positions: 'p1',
      positionsRange: '7d',
      positionsFrom: null,
      positionsTo: null,
    });
  });

  test('a custom range carries its dates, and omits a missing one', () => {
    expect(positionsUrlParams('p1', { preset: 'custom', from: '2026-10-01', to: '' })).toEqual({
      positions: 'p1',
      positionsRange: 'custom',
      positionsFrom: '2026-10-01',
      positionsTo: null,
    });
  });
});

describe('parsePositionsRange', () => {
  test('reads back what positionsUrlParams wrote', () => {
    const range = { preset: 'custom' as const, from: '2026-10-01', to: '2026-10-05' };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(positionsUrlParams('p1', range))) if (v) params.set(k, v);
    expect(parsePositionsRange(params, '30d')).toEqual(range);
  });

  test('falls back to the table preset when the link has none or an unknown one', () => {
    expect(parsePositionsRange(new URLSearchParams(), '30d')).toEqual({
      preset: '30d',
      from: '',
      to: '',
    });
    expect(parsePositionsRange(new URLSearchParams('positionsRange=1y'), '7d').preset).toBe('7d');
  });
});

describe('panelRangeFromTable', () => {
  // The table's custom Oct 1 – Oct 3, as resolved on an Istanbul and a New York clock.
  const istanbul = { from: '2026-09-30T21:00:00.000Z', to: '2026-10-03T20:59:59.999Z' };
  const newYork = { from: '2026-10-01T04:00:00.000Z', to: '2026-10-04T03:59:59.999Z' };

  test("opens the panel on the table's own days, whatever the viewer's zone", () => {
    const want = { preset: 'custom', from: '2026-10-01', to: '2026-10-03' };
    expect(panelRangeFromTable('custom', istanbul, 'Europe/Istanbul')).toEqual(want);
    expect(panelRangeFromTable('custom', newYork, 'America/New_York')).toEqual(want);
  });

  test('a preset carries no dates', () => {
    expect(panelRangeFromTable('7d', istanbul, 'Europe/Istanbul')).toEqual({
      preset: '7d',
      from: '',
      to: '',
    });
  });
});
