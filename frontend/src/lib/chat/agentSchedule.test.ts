import { describe, expect, it } from 'vitest';
import {
  formatRecurringRule,
  nextRecurringFire,
  nextScheduleFire,
  parseRecurringRule,
  scheduleConfigSchema,
} from './agentSchedule';

/**
 * An agent's Schedule trigger (CHAT-21 §E): once, or by an RRULE subset in
 * a time zone, at most once a day; its next fire worked out on the zone's
 * clock, daylight saving included.
 */

// Thursday 29 October 2026, 12:00 UTC (15:00 in Istanbul).
const NOW = new Date('2026-10-29T12:00:00.000Z');

describe('the RRULE subset', () => {
  it('reads daily, weekly and monthly rules, in canonical order', () => {
    expect(parseRecurringRule('FREQ=WEEKLY;BYDAY=FR,MO;BYHOUR=9')).toEqual({
      freq: 'WEEKLY',
      byDay: ['MO', 'FR'],
      byMonthDay: null,
      hour: 9,
      minute: 0,
    });
    const rule = parseRecurringRule('RRULE:BYMINUTE=30;BYHOUR=7;FREQ=DAILY')!;
    expect(formatRecurringRule(rule)).toBe('FREQ=DAILY;BYHOUR=7;BYMINUTE=30');
    expect(parseRecurringRule('FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=18')?.byMonthDay).toBe(-1);
  });

  it('refuses what it can’t keep to: more than daily, a missing day or hour, unknown parts', () => {
    for (const text of [
      'FREQ=HOURLY;BYHOUR=9',
      'FREQ=WEEKLY;BYHOUR=9',
      'FREQ=MONTHLY;BYHOUR=9',
      'FREQ=MONTHLY;BYMONTHDAY=31;BYHOUR=9',
      'FREQ=DAILY',
      'FREQ=DAILY;BYHOUR=9,17',
      'FREQ=DAILY;BYHOUR=24',
      'FREQ=DAILY;BYHOUR=9;INTERVAL=2',
      'FREQ=DAILY;BYDAY=MO,MO;BYHOUR=9',
      'FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1;BYHOUR=9',
      'FREQ=DAILY;FREQ=DAILY;BYHOUR=9',
      '',
    ]) {
      expect(parseRecurringRule(text), text).toBeNull();
    }
  });
});

describe('the next fire', () => {
  it('finds the next weekday slot on the zone’s clock', () => {
    const monday9 = parseRecurringRule('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9')!;
    expect(nextRecurringFire(monday9, 'Europe/Istanbul', NOW)).toBe('2026-11-02T06:00:00.000Z');
    // Today's slot already went (09:00 Istanbul is 06:00 UTC): tomorrow's.
    const daily9 = parseRecurringRule('FREQ=DAILY;BYHOUR=9')!;
    expect(nextRecurringFire(daily9, 'Europe/Istanbul', NOW)).toBe('2026-10-30T06:00:00.000Z');
    // Still to come today.
    const daily18 = parseRecurringRule('FREQ=DAILY;BYHOUR=18')!;
    expect(nextRecurringFire(daily18, 'Europe/Istanbul', NOW)).toBe('2026-10-29T15:00:00.000Z');
  });

  it('follows the month’s last day and daylight saving', () => {
    const last = parseRecurringRule('FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=8')!;
    expect(nextRecurringFire(last, 'UTC', new Date('2027-02-01T00:00:00Z'))).toBe(
      '2027-02-28T08:00:00.000Z',
    );
    // New York leaves daylight saving on 1 November: 09:00 is 13:00 UTC before, 14:00 after.
    const daily = parseRecurringRule('FREQ=DAILY;BYHOUR=9')!;
    expect(nextRecurringFire(daily, 'America/New_York', NOW)).toBe('2026-10-29T13:00:00.000Z');
    expect(nextRecurringFire(daily, 'America/New_York', new Date('2026-11-01T12:00:00Z'))).toBe(
      '2026-11-01T14:00:00.000Z',
    );
  });

  it('reads a trigger’s stored settings: a one-off until it passes, nothing for bad ones', () => {
    expect(nextScheduleFire({ type: 'once', at: '2026-11-05T10:00:00.000Z' }, NOW)).toBe(
      '2026-11-05T10:00:00.000Z',
    );
    expect(nextScheduleFire({ type: 'once', at: '2026-10-01T10:00:00.000Z' }, NOW)).toBeNull();
    expect(
      nextScheduleFire(
        { type: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9', timezone: 'Europe/Istanbul' },
        NOW,
      ),
    ).toBe('2026-11-02T06:00:00.000Z');
    expect(nextScheduleFire({ type: 'recurring', rrule: 'nonsense', timezone: 'UTC' }, NOW)).toBe(
      null,
    );
    expect(nextScheduleFire(null, NOW)).toBeNull();
  });
});

describe('the settings it keeps', () => {
  it('keeps a one-off in UTC and a rule in canonical form, and refuses an unknown zone', () => {
    expect(scheduleConfigSchema.parse({ type: 'once', at: '2026-11-05T13:00:00+03:00' })).toEqual({
      type: 'once',
      at: '2026-11-05T10:00:00.000Z',
    });
    expect(
      scheduleConfigSchema.parse({
        type: 'recurring',
        rrule: 'BYHOUR=9;FREQ=WEEKLY;BYDAY=MO',
        timezone: 'Europe/Istanbul',
      }),
    ).toEqual({
      type: 'recurring',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
      timezone: 'Europe/Istanbul',
    });
    expect(
      scheduleConfigSchema.safeParse({
        type: 'recurring',
        rrule: 'FREQ=DAILY;BYHOUR=9',
        timezone: 'Mars/Olympus',
      }).success,
    ).toBe(false);
    expect(
      scheduleConfigSchema.safeParse({ type: 'recurring', rrule: 'FREQ=HOURLY', timezone: 'UTC' })
        .success,
    ).toBe(false);
    expect(scheduleConfigSchema.safeParse({ type: 'once', at: 'tomorrow' }).success).toBe(false);
  });
});
