import { describe, expect, it } from 'vitest';
import { autoRunStates, nextAutoRun } from './auditAutoRuns';

// A billing month from Sep 22 to Oct 22: runs on its days 1, 7, 14, 21 and 28.
const schedule = (done: number[] = []) => ({
  periodEnd: '2026-10-22T00:00:00.000Z',
  runs: [
    { day: 1, at: '2026-09-22T00:00:00.000Z' },
    { day: 7, at: '2026-09-28T00:00:00.000Z' },
    { day: 14, at: '2026-10-05T00:00:00.000Z' },
    { day: 21, at: '2026-10-12T00:00:00.000Z' },
    { day: 28, at: '2026-10-19T00:00:00.000Z' },
  ].map((run) => ({ ...run, done: done.includes(run.day) })),
});

describe('autoRunStates', () => {
  it('marks the runs whose turn ended without a run as missed, not upcoming', () => {
    const states = autoRunStates(schedule([28]), new Date('2026-10-19T12:00:00Z'));
    expect(states.map((r) => r.state)).toEqual(['missed', 'missed', 'missed', 'missed', 'done']);
  });

  it('marks the first run still to come as next and the rest as upcoming', () => {
    const states = autoRunStates(schedule([1]), new Date('2026-09-25T12:00:00Z'));
    expect(states.map((r) => r.state)).toEqual([
      'done',
      'next',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
  });

  it('keeps a run next while its turn lasts, before the sweep records it', () => {
    const states = autoRunStates(schedule([1]), new Date('2026-09-30T12:00:00Z'));
    expect(states.map((r) => r.state)).toEqual([
      'done',
      'next',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
  });
});

describe('nextAutoRun', () => {
  it("is the next billing month's first run once this month's runs are over", () => {
    expect(nextAutoRun(schedule([28]), new Date('2026-10-19T12:00:00Z'))).toEqual({
      at: '2026-10-22T00:00:00.000Z',
      soon: false,
    });
  });

  it('is the next run of this month when one is still to come', () => {
    expect(nextAutoRun(schedule([1]), new Date('2026-09-25T12:00:00Z'))).toEqual({
      at: '2026-09-28T00:00:00.000Z',
      soon: false,
    });
  });

  it("is soon, not today, while a run's turn has started but it hasn't run", () => {
    // Turned on after day 7's morning sweep: the next sweep takes it.
    expect(nextAutoRun(schedule([1]), new Date('2026-09-30T12:00:00Z'))).toEqual({
      at: '2026-09-28T00:00:00.000Z',
      soon: true,
    });
  });
});
