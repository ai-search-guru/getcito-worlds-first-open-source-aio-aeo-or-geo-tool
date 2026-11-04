import { describe, expect, it } from 'vitest';
import {
  formatGoogleDays,
  formatPctChange,
  formatRatio,
  formatShare,
  gscLatestDays,
  isShortRange,
  organicRatio,
} from './trafficKpis';

/** AT-017 (spec §3.2): the rules behind the AI Traffic KPI cards. */

describe('gscLatestDays', () => {
  it("reads Google's latest reported day for 24 hours and its last 7 for the week", () => {
    expect(gscLatestDays('24h')).toBe(1);
    expect(gscLatestDays('7d')).toBe(7);
  });

  it('reads longer ranges, all time and custom ranges as they are', () => {
    for (const preset of ['30d', '90d', 'all', 'custom'] as const) {
      expect(gscLatestDays(preset)).toBeNull();
      expect(isShortRange(preset)).toBe(false);
    }
    expect(isShortRange('24h')).toBe(true);
    expect(isShortRange('7d')).toBe(true);
  });
});

describe('formatShare', () => {
  it('writes the spec example with one decimal below 10%', () => {
    expect(formatShare(4, 812)).toBe('0.5%');
    expect(formatShare(3, 4)).toBe('75%');
    expect(formatShare(77, 812)).toBe('9.5%');
  });

  it('writes a sliver as <0.1%, and nothing as 0%', () => {
    expect(formatShare(1, 5000)).toBe('<0.1%');
    expect(formatShare(0, 812)).toBe('0%');
  });

  it('has no share without a whole', () => {
    expect(formatShare(4, 0)).toBeNull();
  });
});

describe('formatPctChange', () => {
  it('signs a change with a true minus', () => {
    expect(formatPctChange(12)).toBe('+12%');
    expect(formatPctChange(-6)).toBe('−6%');
    expect(formatPctChange(1250)).toBe('+1,250%');
  });
});

describe('formatGoogleDays', () => {
  it("names one day, or the range's first and last", () => {
    expect(formatGoogleDays('2026-10-15', '2026-10-15')).toBe('Oct 15');
    expect(formatGoogleDays('2026-10-10', '2026-10-16')).toBe('Oct 10 – Oct 16');
  });

  it('names the last day alone for all time', () => {
    expect(formatGoogleDays(null, '2026-10-16')).toBe('Oct 16');
  });
});

describe('organicRatio', () => {
  const side = (sessions: number, keyEvents: number, keyEventSessions: number) => ({
    sessions,
    keyEvents,
    keyEventSessions,
  });

  it("compares AI visitors' key event rate with Google organic's", () => {
    // 10% of AI sessions against 5% of organic ones.
    expect(organicRatio(side(100, 12, 10), side(1000, 60, 50))).toBeCloseTo(2);
    expect(formatRatio(2)).toBe('2×');
    expect(formatRatio(0.5833)).toBe('0.6×');
  });

  it('compares nothing below 30 sessions or 5 key events on either side (§5.4)', () => {
    expect(organicRatio(side(29, 12, 10), side(1000, 60, 50))).toBeNull();
    expect(organicRatio(side(100, 4, 4), side(1000, 60, 50))).toBeNull();
    expect(organicRatio(side(100, 12, 10), side(1000, 4, 4))).toBeNull();
  });

  it('compares nothing while a rate is unknown (rows synced before it)', () => {
    expect(organicRatio(side(100, 12, 0), side(1000, 60, 50))).toBeNull();
  });
});
