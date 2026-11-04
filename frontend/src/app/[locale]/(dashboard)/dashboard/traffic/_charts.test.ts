import { describe, expect, it } from 'vitest';
import { getPlatformName } from '@/lib/trafficPlatforms';
import { formatTrafficBucketDate, getPlatformFilterItems } from './_charts';

describe('getPlatformFilterItems', () => {
  it('starts with the all-platforms option, whose value is empty', () => {
    expect(getPlatformFilterItems([], 'All platforms')).toEqual([
      { value: '', label: 'All platforms' },
    ]);
    expect(getPlatformFilterItems(['chatgpt.com'], 'All platforms')[0]).toEqual({
      value: '',
      label: 'All platforms',
    });
  });

  it('labels each platform with its display name while keeping its domain as the value', () => {
    expect(
      getPlatformFilterItems(['chatgpt.com', 'perplexity.ai', 'claude.ai'], 'All platforms').slice(
        1,
      ),
    ).toEqual([
      { value: 'chatgpt.com', label: 'ChatGPT' },
      { value: 'perplexity.ai', label: 'Perplexity' },
      { value: 'claude.ai', label: 'Claude' },
    ]);
  });

  it('falls back to the domain for a platform without a display name', () => {
    expect(getPlatformFilterItems(['example.org'], 'All platforms').slice(1)).toEqual([
      { value: 'example.org', label: 'example.org' },
    ]);
    expect(getPlatformName('example.org')).toBe('example.org');
  });

  it('keeps the order of the platforms it is given', () => {
    const values = getPlatformFilterItems(['poe.com', 'bing.com', 'you.com'], 'All platforms').map(
      (item) => item.value,
    );
    expect(values).toEqual(['', 'poe.com', 'bing.com', 'you.com']);
  });
});

describe('formatTrafficBucketDate', () => {
  it('names a UTC day in English, whatever the browser language (F7)', () => {
    // A Turkish browser used to show "12 Eki".
    const toLocaleDateString = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function (
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      return toLocaleDateString.call(this, locales ?? 'tr-TR', options);
    };
    try {
      expect(formatTrafficBucketDate('2026-10-12')).toBe('Oct 12');
    } finally {
      Date.prototype.toLocaleDateString = toLocaleDateString;
    }
  });
});

describe('formatTrafficBucketDate for the 24-hour range', () => {
  it("names an hour on the axis, and its day too in the tooltip, in the member's time zone", () => {
    const hour = '2026-10-17T13:00:00.000Z';
    expect(formatTrafficBucketDate(hour, { timeZone: 'UTC' })).toBe('13:00');
    expect(formatTrafficBucketDate(hour, { withDay: true, timeZone: 'UTC' })).toBe('Oct 17, 13:00');
    expect(formatTrafficBucketDate(hour, { timeZone: 'Europe/Istanbul' })).toBe('16:00');
  });
});
