/**
 * timeZone.test.ts
 *
 * Calendar days in the viewer's time zone, checked in fixed zones so the
 * results don't depend on the machine running the tests.
 */

import { describe, expect, test } from 'vitest';
import {
  dayIn,
  dayRangeBounds,
  endOfDayIn,
  isCalendarDay,
  isTimeZone,
  nextDay,
  startOfDayIn,
  zonedInstant,
} from './timeZone';

describe('dayIn', () => {
  test("puts a late-evening UTC answer on the next day in Istanbul's time", () => {
    expect(dayIn('2026-10-12T21:30:00.000Z', 'UTC')).toBe('2026-10-12');
    expect(dayIn('2026-10-12T21:30:00.000Z', 'Europe/Istanbul')).toBe('2026-10-13');
  });

  test('puts an early UTC answer on the previous day in New York', () => {
    expect(dayIn('2026-10-13T02:00:00.000Z', 'America/New_York')).toBe('2026-10-12');
  });
});

describe('startOfDayIn / endOfDayIn', () => {
  test('a day in Istanbul runs from 21:00 UTC the evening before', () => {
    expect(startOfDayIn('2026-10-12', 'Europe/Istanbul')).toBe('2026-10-11T21:00:00.000Z');
    expect(endOfDayIn('2026-10-12', 'Europe/Istanbul')).toBe('2026-10-12T20:59:59.999Z');
  });

  test('UTC days are unchanged', () => {
    expect(startOfDayIn('2026-10-12', 'UTC')).toBe('2026-10-12T00:00:00.000Z');
    expect(endOfDayIn('2026-10-12', 'UTC')).toBe('2026-10-12T23:59:59.999Z');
  });

  test('follows daylight saving: a 23-hour and a 25-hour day in New York', () => {
    // Clocks go forward on 2026-03-08 and back on 2026-11-01.
    expect(startOfDayIn('2026-03-08', 'America/New_York')).toBe('2026-03-08T05:00:00.000Z');
    expect(endOfDayIn('2026-03-08', 'America/New_York')).toBe('2026-03-09T03:59:59.999Z');
    expect(startOfDayIn('2026-11-01', 'America/New_York')).toBe('2026-11-01T04:00:00.000Z');
    expect(endOfDayIn('2026-11-01', 'America/New_York')).toBe('2026-11-02T04:59:59.999Z');
  });
  test('starts the day at the jump where the clocks skip midnight itself', () => {
    // Santiago goes from 23:59 on Sep 5 straight to 01:00 on Sep 6.
    expect(startOfDayIn('2026-09-06', 'America/Santiago')).toBe('2026-09-06T04:00:00.000Z');
    expect(endOfDayIn('2026-09-05', 'America/Santiago')).toBe('2026-09-06T03:59:59.999Z');
    // Beirut skips midnight on Mar 29.
    expect(startOfDayIn('2026-03-29', 'Asia/Beirut')).toBe('2026-03-28T22:00:00.000Z');
  });
});

describe('dayRangeBounds', () => {
  test('turns custom inputs into whole days, leaving an empty or invalid side open', () => {
    expect(dayRangeBounds('2026-10-01', '2026-10-03', 'Europe/Istanbul')).toEqual({
      from: '2026-09-30T21:00:00.000Z',
      to: '2026-10-03T20:59:59.999Z',
    });
    expect(dayRangeBounds('', 'nonsense', 'UTC')).toEqual({ from: undefined, to: undefined });
  });
});

describe('nextDay', () => {
  test('crosses month and year ends', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
});

describe('isTimeZone', () => {
  test('accepts IANA zones and refuses anything else', () => {
    expect(isTimeZone('Europe/Istanbul')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone(42)).toBe(false);
  });
});

describe('zonedInstant', () => {
  test("is the instant a zone's clock reads a time on a day", () => {
    expect(zonedInstant('2026-11-02', 9, 0, 'Europe/Istanbul')).toBe('2026-11-02T06:00:00.000Z');
    expect(zonedInstant('2026-07-01', 23, 45, 'America/New_York')).toBe('2026-07-02T03:45:00.000Z');
    expect(zonedInstant('2026-01-31', 0, 0, 'UTC')).toBe('2026-01-31T00:00:00.000Z');
  });

  test('takes the first of a time passed twice, and moves a skipped one past the jump', () => {
    // New York falls back at 02:00 EDT on 1 November 2026: 01:30 comes twice.
    expect(zonedInstant('2026-11-01', 1, 30, 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    // It springs forward at 02:00 EST on 8 March 2026: 02:30 never shows; 03:30 EDT does.
    expect(zonedInstant('2026-03-08', 2, 30, 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
  });
});

describe('isCalendarDay', () => {
  test('takes real YYYY-MM-DD dates only', () => {
    expect(isCalendarDay('2026-10-12')).toBe(true);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('2026-10-12T00:00:00Z')).toBe(false);
    expect(isCalendarDay('')).toBe(false);
    expect(isCalendarDay(undefined)).toBe(false);
  });
});
