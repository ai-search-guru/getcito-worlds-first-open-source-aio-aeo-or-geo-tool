/**
 * suggestedDate.test.ts  (CONTENT-002)
 *
 * The Suggested column's date and the list's date filter bounds.
 */

import { describe, expect, test } from 'vitest';
import { suggestedBounds, suggestedDate } from './suggestedDate';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3_600_000;

describe('suggestedDate', () => {
  test('relative for the first week, in the UI language', () => {
    expect(suggestedDate(ago(2 * H), 'en', NOW).label).toBe('2 hours ago');
    expect(suggestedDate(ago(2 * 24 * H), 'en', NOW).label).toBe('2 days ago');
    expect(suggestedDate(ago(5 * 60_000), 'en', NOW).label).toBe('5 minutes ago');
    expect(suggestedDate(ago(2 * 24 * H), 'tr', NOW).label).toBe('2 gün önce');
  });

  test('a short date after a week, with the year only when it differs', () => {
    expect(suggestedDate('2026-09-25T09:14:00Z', 'en', NOW).label).toBe('Sep 25');
    expect(suggestedDate('2025-12-30T09:14:00Z', 'en', NOW).label).toBe('Dec 30, 2025');
  });

  test('the tooltip has the full date and time', () => {
    expect(suggestedDate('2026-09-25T09:14:00Z', 'en', NOW).full).toMatch(/Sep 25, 2026/);
  });
});

describe('suggestedBounds', () => {
  const now = new Date(2026, 9, 13, 12);

  test('this month starts on the 1st; last 30 days is a rolling window', () => {
    expect(suggestedBounds('month', {}, now)).toEqual({
      from: new Date(2026, 9, 1).toISOString(),
    });
    expect(suggestedBounds('last30', {}, now)).toEqual({
      from: new Date(now.getTime() - 30 * 24 * H).toISOString(),
    });
    expect(suggestedBounds('all', {}, now)).toEqual({});
  });

  test('a custom range includes the whole last day and ignores empty inputs', () => {
    expect(suggestedBounds('custom', { from: '2026-10-01', to: '2026-10-05' }, now)).toEqual({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(new Date(2026, 9, 6).getTime() - 1).toISOString(),
    });
    expect(suggestedBounds('custom', { from: '' }, now)).toEqual({});
  });
});
