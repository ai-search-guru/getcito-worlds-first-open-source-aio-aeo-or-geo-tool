/**
 * formatRelative.test.ts  (issue #767)
 *
 * Pattern follows frontend/src/lib/csv.test.ts.
 *
 * The translator is stubbed with a minimal implementation that mirrors
 * what next-intl produces for the common.relative.* keys so the tests
 * never touch the i18n runtime.
 */

import { expect, test } from 'vitest';
import { formatRelative } from './formatRelative.js';
import { formatDate } from './format';

// ---------------------------------------------------------------------------
// Stub translator
// ---------------------------------------------------------------------------

type Params = Record<string, unknown>;

function makeT() {
  return (key: string, params?: Params): string => {
    switch (key) {
      case 'relative.justNow':
        return 'just now';
      case 'relative.minutesAgo':
        return `${params?.m}m ago`;
      case 'relative.hoursAgo':
        return `${params?.h}h ago`;
      case 'relative.daysAgo':
        return `${params?.d}d ago`;
      default:
        return key;
    }
  };
}

const t = makeT() as ReturnType<typeof import('next-intl').useTranslations<'common'>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function isoHoursAgo(hours: number): string {
  return isoMinutesAgo(hours * 60);
}

function isoDaysAgo(days: number): string {
  return isoHoursAgo(days * 24);
}

// ---------------------------------------------------------------------------
// Null / undefined guard
// ---------------------------------------------------------------------------

test('null returns em-dash', () => {
  expect(formatRelative(null, t)).toBe('—');
});

test('undefined returns em-dash', () => {
  expect(formatRelative(undefined, t)).toBe('—');
});

// ---------------------------------------------------------------------------
// Sub-minute boundary
// ---------------------------------------------------------------------------

test('0 seconds ago → just now', () => {
  expect(formatRelative(new Date().toISOString(), t)).toBe('just now');
});

test('59 seconds ago → just now', () => {
  const iso = new Date(Date.now() - 59_000).toISOString();
  expect(formatRelative(iso, t)).toBe('just now');
});

// ---------------------------------------------------------------------------
// Math.floor vs Math.round at 90 seconds (the rounding bug)
// ---------------------------------------------------------------------------

test('90 seconds ago → 1m ago (floor, not 2m from round)', () => {
  const iso = new Date(Date.now() - 90_000).toISOString();
  expect(formatRelative(iso, t)).toBe('1m ago');
});

// ---------------------------------------------------------------------------
// Minute / hour boundary
// ---------------------------------------------------------------------------

test('1 minute ago → 1m ago', () => {
  expect(formatRelative(isoMinutesAgo(1), t)).toBe('1m ago');
});

test('59 minutes ago → 59m ago', () => {
  expect(formatRelative(isoMinutesAgo(59), t)).toBe('59m ago');
});

test('45 minutes ago → 45m ago (not 1h ago from round)', () => {
  // Prompts used Math.round: 45 min → Math.round(45/60)=1 → "1h ago".
  // Floor keeps it at "45m ago".
  expect(formatRelative(isoMinutesAgo(45), t)).toBe('45m ago');
});

test('60 minutes ago → 1h ago', () => {
  expect(formatRelative(isoMinutesAgo(60), t)).toBe('1h ago');
});

// ---------------------------------------------------------------------------
// Hour / day boundary
// ---------------------------------------------------------------------------

test('23 hours ago → 23h ago', () => {
  expect(formatRelative(isoHoursAgo(23), t)).toBe('23h ago');
});

test('24 hours ago → 1d ago', () => {
  expect(formatRelative(isoHoursAgo(24), t)).toBe('1d ago');
});

// ---------------------------------------------------------------------------
// 30-day cliff (Insights/Traffic bug: counted indefinitely as Xd ago)
// ---------------------------------------------------------------------------

test('29 days ago → 29d ago', () => {
  expect(formatRelative(isoDaysAgo(29), t)).toBe('29d ago');
});

test('30 days ago → a date, not "30d ago"', () => {
  const iso = isoDaysAgo(30);
  const result = formatRelative(iso, t);
  // Must NOT look like "Xd ago"
  expect(result).not.toMatch(/^\d+d ago$/);
  expect(result).toBe(formatDate(iso));
});

test('412 days ago → a date, not "412d ago"', () => {
  const iso = isoDaysAgo(412);
  const result = formatRelative(iso, t);
  expect(result).not.toMatch(/^\d+d ago$/);
  expect(result).toBe(formatDate(iso));
});

test('an older date reads in English whatever the browser language (F7)', () => {
  // A Turkish browser used to show "10.09.2025" here.
  const toLocaleDateString = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleDateString = function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return toLocaleDateString.call(this, locales ?? 'tr-TR', options);
  };
  try {
    expect(formatRelative('2025-09-10T12:00:00.000Z', t)).toBe('Sep 10, 2025');
  } finally {
    Date.prototype.toLocaleDateString = toLocaleDateString;
  }
});
