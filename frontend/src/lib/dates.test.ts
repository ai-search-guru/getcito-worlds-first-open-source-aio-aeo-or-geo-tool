import { describe, expect, it } from 'vitest';
import { expandDateToEndOfDay, utcDay } from './dates';

describe('expandDateToEndOfDay', () => {
  it('takes a bare day to its last millisecond and leaves a timestamp alone', () => {
    expect(expandDateToEndOfDay('2026-05-31')).toBe('2026-05-31T23:59:59.999Z');
    expect(expandDateToEndOfDay('2026-05-31T15:30:00Z')).toBe('2026-05-31T15:30:00Z');
    expect(expandDateToEndOfDay(undefined)).toBeUndefined();
  });
});

describe('utcDay', () => {
  it('gives the UTC day a timestamp falls on', () => {
    expect(utcDay('2026-10-11T09:30:00.000Z')).toBe('2026-10-11');
    expect(utcDay('2026-10-17T23:59:59.999Z')).toBe('2026-10-17');
    // An offset moves it to the day it is in UTC.
    expect(utcDay('2026-10-12T01:00:00+03:00')).toBe('2026-10-11');
  });

  it('returns a bare day as it is', () => {
    expect(utcDay('2026-10-11')).toBe('2026-10-11');
  });

  it('gives undefined for nothing or something unparseable', () => {
    expect(utcDay(undefined)).toBeUndefined();
    expect(utcDay(null)).toBeUndefined();
    expect(utcDay('')).toBeUndefined();
    expect(utcDay('not a date')).toBeUndefined();
  });
});
