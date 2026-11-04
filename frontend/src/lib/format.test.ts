/**
 * format.test.ts
 *
 * The browser's default locale is simulated as Turkish (tr-TR), which uses "."
 * for thousands and "," for decimals — the setup where a prompt's 1,232
 * mentions used to read as "1.232" on the Prompts page.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  formatCompactNumber,
  formatDate,
  formatDateTime,
  formatMonthDay,
  formatNumber,
} from './format.js';

const toLocaleString = Number.prototype.toLocaleString;

beforeEach(() => {
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return toLocaleString.call(this, locales ?? 'tr-TR', options);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the simulated browser locale is Turkish', () => {
  expect((1232).toLocaleString()).toBe('1.232');
});

test('formatNumber uses English separators whatever the browser locale is', () => {
  expect(formatNumber(1232)).toBe('1,232');
  expect(formatNumber(1_234_567)).toBe('1,234,567');
  expect(formatNumber(1234.5)).toBe('1,234.5');
  expect(formatNumber(0)).toBe('0');
});

test('formatCompactNumber keeps decimals below 1,000 in English', () => {
  expect(formatCompactNumber(512.25)).toBe('512.25');
  expect(formatCompactNumber(999)).toBe('999');
});

test('formatCompactNumber abbreviates from 1,000 up', () => {
  expect(formatCompactNumber(1232)).toBe('1.2k');
  expect(formatCompactNumber(2_500_000)).toBe('2.5M');
  expect(formatCompactNumber(3_000_000_000)).toBe('3B');
});

test('dates read in English whatever the browser locale is', () => {
  const toLocaleDateString = Date.prototype.toLocaleDateString;
  const toLocaleStringDate = Date.prototype.toLocaleString;
  vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return toLocaleDateString.call(this, locales ?? 'tr-TR', options);
  });
  vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return toLocaleStringDate.call(this, locales ?? 'tr-TR', options);
  });
  // Midday UTC, so the day is the same in any timezone the tests run in.
  const iso = '2026-10-17T11:05:00.000Z';

  expect(new Date(iso).toLocaleDateString()).toBe('17.10.2026');
  expect(formatMonthDay(iso)).toBe('Oct 17');
  expect(formatDate(iso)).toBe('Oct 17, 2026');
  expect(formatDateTime(iso)).toMatch(/^Oct 17, 2026, \d{1,2}:05\s(AM|PM)$/);
});
