import { describe, expect, it } from 'vitest';
import * as agentSchedule from '../agentSchedule';
import { nextJobRun, nextRecurringFire, parseRecurringRule } from './rule';

/**
 * When scheduled work runs (CHAT-12 items 2, 17; acceptance criteria): the
 * RRULE subset an agent's trigger and a Chat schedule share, on the zone's
 * clock across daylight saving, and a job's next run (a one-time job has
 * none once it ran; a rule or a zone that doesn't read is said so).
 */

const rule = (text: string) => parseRecurringRule(text)!;

describe('the shared rule', () => {
  it('is the one agentSchedule.ts exports, so agents read the same', () => {
    expect(agentSchedule.parseRecurringRule).toBe(parseRecurringRule);
    expect(agentSchedule.nextRecurringFire).toBe(nextRecurringFire);
  });
});

describe('daylight saving', () => {
  it('runs "every Monday at 9:00" in New York at 09:00 local before and after 1 November 2026', () => {
    const monday9 = rule('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9');
    // Sunday 25 Oct: the next Monday is the 26th, 09:00 EDT (UTC-4).
    const first = nextRecurringFire(monday9, 'America/New_York', new Date('2026-10-25T12:00Z'));
    expect(first).toBe('2026-10-26T13:00:00.000Z');
    // Daylight saving ends on 1 Nov: 2 Nov, 09:00 EST (UTC-5).
    const second = nextRecurringFire(monday9, 'America/New_York', new Date(first!));
    expect(second).toBe('2026-11-02T14:00:00.000Z');
  });

  it('keeps a European daily slot at its local time when the clocks go back', () => {
    const daily9 = rule('FREQ=DAILY;BYHOUR=9');
    // London: BST (UTC+1) until Sunday 25 Oct 2026, GMT after.
    expect(nextRecurringFire(daily9, 'Europe/London', new Date('2026-10-24T09:00Z'))).toBe(
      '2026-10-25T09:00:00.000Z',
    );
    expect(nextRecurringFire(daily9, 'Europe/London', new Date('2026-10-24T07:00Z'))).toBe(
      '2026-10-24T08:00:00.000Z',
    );
    // Istanbul keeps UTC+3 all year.
    expect(nextRecurringFire(daily9, 'Europe/Istanbul', new Date('2026-10-25T07:00Z'))).toBe(
      '2026-10-26T06:00:00.000Z',
    );
  });

  it('moves a time the clocks skip to just after the jump, once', () => {
    // New York springs forward on 14 March 2027: 02:30 doesn't exist, it is 03:30 EDT.
    const daily230 = rule('FREQ=DAILY;BYHOUR=2;BYMINUTE=30');
    const day = nextRecurringFire(daily230, 'America/New_York', new Date('2027-03-14T05:00Z'));
    expect(day).toBe('2027-03-14T07:30:00.000Z');
    // The day after is 02:30 EDT again.
    expect(nextRecurringFire(daily230, 'America/New_York', new Date(day!))).toBe(
      '2027-03-15T06:30:00.000Z',
    );
  });

  it('runs a time the clocks pass twice once, at the first', () => {
    // New York falls back on 1 Nov 2026: 01:30 comes twice, EDT first.
    const daily130 = rule('FREQ=DAILY;BYHOUR=1;BYMINUTE=30');
    const once = nextRecurringFire(daily130, 'America/New_York', new Date('2026-11-01T04:00Z'));
    expect(once).toBe('2026-11-01T05:30:00.000Z');
    expect(nextRecurringFire(daily130, 'America/New_York', new Date(once!))).toBe(
      '2026-11-02T06:30:00.000Z',
    );
  });
});

describe('a job’s next run', () => {
  const AT = new Date('2026-11-02T06:00:30.000Z');

  it('is a recurring job’s next slot after the time given, never the one just run', () => {
    expect(
      nextJobRun(
        { kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9', timezone: 'Europe/Istanbul' },
        AT,
      ),
    ).toEqual({ at: '2026-11-09T06:00:00.000Z', unreadable: false });
    // The month's last day, at 18:00 UTC.
    expect(
      nextJobRun(
        { kind: 'recurring', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=18', timezone: 'UTC' },
        AT,
      ),
    ).toEqual({ at: '2026-11-30T18:00:00.000Z', unreadable: false });
  });

  it('is none for a one-time job or a follow-up check once it ran', () => {
    for (const kind of ['once', 'followup_check']) {
      expect(nextJobRun({ kind, rrule: null, timezone: 'UTC' }, AT)).toEqual({
        at: null,
        unreadable: false,
      });
    }
  });

  it('says a rule or a zone it can’t read, rather than guess', () => {
    expect(nextJobRun({ kind: 'recurring', rrule: 'FREQ=HOURLY', timezone: 'UTC' }, AT)).toEqual({
      at: null,
      unreadable: true,
    });
    expect(nextJobRun({ kind: 'recurring', rrule: null, timezone: 'UTC' }, AT).unreadable).toBe(
      true,
    );
    expect(
      nextJobRun({ kind: 'recurring', rrule: 'FREQ=DAILY;BYHOUR=9', timezone: 'Mars/Olympus' }, AT),
    ).toEqual({ at: null, unreadable: true });
  });
});
