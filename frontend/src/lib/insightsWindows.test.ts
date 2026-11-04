import { describe, expect, it } from 'vitest';
import {
  comparisonWindows,
  deltaDayWindows,
  visibilityChange,
  windowBounds,
} from './insightsWindows';

describe('comparisonWindows', () => {
  it('compares a 30-day preset with the 30 whole days before it', () => {
    const w = comparisonWindows({
      dateFrom: '2026-09-15T00:00:00.000Z',
      days: { dayFrom: '2026-09-15', dayTo: '2026-10-14' },
    });

    expect(w.cur).toEqual({ kind: 'days', days: { dayFrom: '2026-09-15', dayTo: '2026-10-14' } });
    expect(w.prev).toEqual({ kind: 'days', days: { dayFrom: '2026-08-16', dayTo: '2026-09-14' } });
    // Counted in days, not rounded from elapsed time: 30, whatever the hour.
    expect(w.windowDays).toBe(30);
  });

  it('has no previous window for All time', () => {
    const w = comparisonWindows({ days: {} });

    expect(w.cur).toEqual({ kind: 'days', days: {} });
    expect(w.prev).toBeNull();
    expect(w.windowDays).toBeNull();
  });

  it('compares whole days when a topic is selected too (00164)', () => {
    const w = comparisonWindows({
      topicId: 'topic-1',
      dateFrom: '2026-09-15T00:00:00.000Z',
      days: { dayFrom: '2026-09-15', dayTo: '2026-10-14' },
    });

    expect(w.cur).toEqual({ kind: 'days', days: { dayFrom: '2026-09-15', dayTo: '2026-10-14' } });
    expect(w.prev).toEqual({ kind: 'days', days: { dayFrom: '2026-08-16', dayTo: '2026-09-14' } });
    expect(w.windowDays).toBe(30);
  });

  it('compares an anchored 24h window with the 24 hours before it', () => {
    const w = comparisonWindows({
      dateFrom: '2026-10-13T06:00:00.000Z',
      dateTo: '2026-10-14T06:00:00.000Z',
    });

    expect(w.prev).toEqual({
      kind: 'range',
      from: '2026-10-12T06:00:00.000Z',
      to: '2026-10-13T06:00:00.000Z',
    });
    expect(w.windowDays).toBe(1);
  });

  it('has no previous window on the raw path without a start', () => {
    const now = new Date('2026-10-14T12:00:00.000Z');
    const w = comparisonWindows({}, now);

    expect(w.cur).toEqual({ kind: 'range', from: undefined, to: '2026-10-14T12:00:00.000Z' });
    expect(w.prev).toBeNull();
  });

  it('agrees with deltaDayWindows, which the other cards use', () => {
    const days = { dayFrom: '2026-10-08', dayTo: '2026-10-14' };
    const w = comparisonWindows({ days });

    expect(w.prev).toEqual({ kind: 'days', days: deltaDayWindows(days).prev });
  });

  it("uses the previous completed run's days for a run-anchored comparison (#999)", () => {
    const days = { dayFrom: '2026-10-18', dayTo: '2026-10-19' };
    const previousDays = { dayFrom: '2026-10-16', dayTo: '2026-10-16' };
    const w = comparisonWindows({ days, previousDays });

    expect(w.cur).toEqual({ kind: 'days', days });
    expect(w.prev).toEqual({ kind: 'days', days: previousDays });
    expect(deltaDayWindows(days, previousDays).prev).toEqual(previousDays);
  });

  it('compares with the day before when the previous run was on the same day', () => {
    // The nightly run, then a Run All later the same UTC day.
    const days = { dayFrom: '2026-10-19', dayTo: '2026-10-19' };
    const w = comparisonWindows({ days, previousDays: days });

    expect(w.prev).toEqual({ kind: 'days', days: { dayFrom: '2026-10-18', dayTo: '2026-10-18' } });
  });

  it('compares with the day before when the previous run ran into the current day', () => {
    // The previous run started before midnight and completed after it.
    const days = { dayFrom: '2026-10-19', dayTo: '2026-10-19' };
    const previousDays = { dayFrom: '2026-10-18', dayTo: '2026-10-19' };

    expect(deltaDayWindows(days, previousDays).prev).toEqual({
      dayFrom: '2026-10-18',
      dayTo: '2026-10-18',
    });
  });
});

describe('visibilityChange', () => {
  it('rounds the change to one decimal', () => {
    expect(visibilityChange(17.4, 15.9)).toEqual({ value: 17.4, prev: 15.9, change: 1.5 });
  });

  it('has no change without a previous score', () => {
    expect(visibilityChange(17.4, null)).toEqual({ value: 17.4, prev: null, change: null });
  });

  it('reads an empty current window as 0', () => {
    expect(visibilityChange(null, 3)).toEqual({ value: 0, prev: 3, change: -3 });
  });
});

describe('windowBounds', () => {
  it('gives days for whole-day windows and timestamps otherwise', () => {
    expect(
      windowBounds({ kind: 'days', days: { dayFrom: '2026-08-16', dayTo: '2026-09-14' } }),
    ).toEqual({ from: '2026-08-16', to: '2026-09-14' });
    expect(
      windowBounds({ kind: 'range', from: undefined, to: '2026-10-14T06:00:00.000Z' }),
    ).toEqual({
      from: '',
      to: '2026-10-14T06:00:00.000Z',
    });
  });
});
