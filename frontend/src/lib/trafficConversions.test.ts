import { describe, expect, it } from 'vitest';
import { conversionRate, widensToLast30Days } from './trafficConversions';

/** Where AI visitors convert (AT-014): its rate and its 30-day fallback. */

describe('conversionRate', () => {
  it("is Analytics' session key event rate, from 30 AI visits", () => {
    expect(conversionRate({ aiVisits: 40, keyEvents: 6, keyEventSessions: 5 })).toEqual({
      kind: 'rate',
      pct: 12.5,
    });
    expect(conversionRate({ aiVisits: 30, keyEvents: 0, keyEventSessions: 0 })).toEqual({
      kind: 'rate',
      pct: 0,
    });
  });

  it('says Low sample below 30 AI visits (§5.4)', () => {
    expect(conversionRate({ aiVisits: 29, keyEvents: 9, keyEventSessions: 9 })).toEqual({
      kind: 'low',
    });
  });

  it('has no rate for key events synced before the session rate was read', () => {
    expect(conversionRate({ aiVisits: 80, keyEvents: 4, keyEventSessions: 0 })).toEqual({
      kind: 'unknown',
    });
  });
});

describe('widensToLast30Days', () => {
  const NOW = '2026-10-18T12:00:00.000Z';
  const ago = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

  it('widens a short range with fewer than 30 AI visits', () => {
    expect(widensToLast30Days({ from: ago(1), to: NOW }, 4)).toBe(true);
    expect(widensToLast30Days({ from: ago(7), to: NOW }, 29)).toBe(true);
  });

  it('keeps a range with enough visits, a 30-day or longer one, and all time', () => {
    expect(widensToLast30Days({ from: ago(7), to: NOW }, 30)).toBe(false);
    expect(widensToLast30Days({ from: ago(30), to: NOW }, 2)).toBe(false);
    expect(widensToLast30Days({ from: ago(90), to: NOW }, 2)).toBe(false);
    expect(widensToLast30Days({ to: NOW }, 0)).toBe(false);
  });
});
