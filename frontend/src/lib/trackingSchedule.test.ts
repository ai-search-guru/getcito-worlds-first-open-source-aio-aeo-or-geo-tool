import { describe, expect, it } from 'vitest';
import { nextScheduledRun, timeUntil } from './trackingSchedule';

const at = (iso: string) => Date.parse(iso);

describe('nextScheduledRun', () => {
  it('is a day after the last scheduled run', () => {
    expect(
      nextScheduledRun(
        ['2026-10-15T02:04:00.000Z', '2026-10-14T02:01:00.000Z'],
        at('2026-10-15T13:00:00.000Z'),
      ),
    ).toBe('2026-10-16T02:04:00.000Z');
  });

  it('assumes once a day with a single run on record', () => {
    expect(nextScheduledRun(['2026-10-15T02:04:00.000Z'], at('2026-10-15T13:00:00.000Z'))).toBe(
      '2026-10-16T02:04:00.000Z',
    );
  });

  it('follows a self-hosted schedule that runs more often', () => {
    expect(
      nextScheduledRun(
        ['2026-10-15T12:00:00.000Z', '2026-10-15T00:00:00.000Z'],
        at('2026-10-15T13:00:00.000Z'),
      ),
    ).toBe('2026-10-16T00:00:00.000Z');
  });

  it('reads a missed day as the daily schedule, not a two-day one', () => {
    expect(
      nextScheduledRun(
        ['2026-10-15T02:00:00.000Z', '2026-10-13T02:00:00.000Z'],
        at('2026-10-15T13:00:00.000Z'),
      ),
    ).toBe('2026-10-16T02:00:00.000Z');
  });

  it('keeps a daily run that started a little early or late daily', () => {
    expect(
      nextScheduledRun(
        ['2026-10-15T01:20:00.000Z', '2026-10-14T03:00:00.000Z'],
        at('2026-10-15T13:00:00.000Z'),
      ),
    ).toBe('2026-10-16T01:20:00.000Z');
  });

  it('is null once due, or without a scheduled run', () => {
    expect(
      nextScheduledRun(['2026-10-13T02:00:00.000Z'], at('2026-10-15T13:00:00.000Z')),
    ).toBeNull();
    expect(nextScheduledRun([], at('2026-10-15T13:00:00.000Z'))).toBeNull();
    expect(nextScheduledRun(['not a date'], at('2026-10-15T13:00:00.000Z'))).toBeNull();
  });
});

describe('timeUntil', () => {
  const now = at('2026-10-15T13:00:00.000Z');

  it('counts minutes, then hours, then days, each to the nearest', () => {
    expect(timeUntil('2026-10-15T13:40:20.000Z', now)).toEqual({ unit: 'minutes', value: 40 });
    // 12h59m: a day after a run 11h ago reads "13h", not "12h".
    expect(timeUntil('2026-10-16T01:59:00.000Z', now)).toEqual({ unit: 'hours', value: 13 });
    expect(timeUntil('2026-10-17T15:00:00.000Z', now)).toEqual({ unit: 'days', value: 2 });
  });

  it('moves up a unit at the edges rather than writing 60m or 24h', () => {
    expect(timeUntil('2026-10-15T13:59:40.000Z', now)).toEqual({ unit: 'hours', value: 1 });
    expect(timeUntil('2026-10-16T12:45:00.000Z', now)).toEqual({ unit: 'days', value: 1 });
  });

  it('never says less than a minute', () => {
    expect(timeUntil('2026-10-15T13:00:10.000Z', now)).toEqual({ unit: 'minutes', value: 1 });
  });
});
