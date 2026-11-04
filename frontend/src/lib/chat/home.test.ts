import { describe, expect, it } from 'vitest';
import { agoOf, dayPartOf, endOfWeek, firstNameOf } from './home';

/** Chat Home (CHAT-01 items 10, 12): the greeting by the hour, the week's end, the Inbox's times. */

describe('dayPartOf', () => {
  it('switches at 12:00 and 18:00', () => {
    expect(dayPartOf(0)).toBe('morning');
    expect(dayPartOf(11)).toBe('morning');
    expect(dayPartOf(12)).toBe('afternoon');
    expect(dayPartOf(17)).toBe('afternoon');
    expect(dayPartOf(18)).toBe('evening');
    expect(dayPartOf(23)).toBe('evening');
  });
});

describe('firstNameOf', () => {
  it('takes the first word, or nothing', () => {
    expect(firstNameOf('Alex Kim')).toBe('Alex');
    expect(firstNameOf('  Ana  María ')).toBe('Ana');
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});

describe('endOfWeek', () => {
  it("is this week's Sunday, and Sunday itself on a Sunday", () => {
    expect(endOfWeek(new Date('2026-10-26T09:00:00'))).toBe('2026-11-01'); // Monday
    expect(endOfWeek(new Date('2026-10-30T23:59:00'))).toBe('2026-11-01'); // Friday
    expect(endOfWeek(new Date('2026-11-01T10:00:00'))).toBe('2026-11-01'); // Sunday
  });
});

describe('agoOf', () => {
  const now = new Date('2026-10-30T12:00:00');
  it('says minutes within the hour, then the day', () => {
    expect(agoOf('2026-10-30T11:59:40', now)).toEqual({ kind: 'now' });
    expect(agoOf('2026-10-30T11:50:00', now)).toEqual({ kind: 'minutes', minutes: 10 });
    expect(agoOf('2026-10-30T08:00:00', now)).toEqual({ kind: 'today' });
    expect(agoOf('2026-10-29T08:00:00', now)).toEqual({ kind: 'yesterday' });
    expect(agoOf('2026-10-20T08:00:00', now).kind).toBe('day');
  });
});
