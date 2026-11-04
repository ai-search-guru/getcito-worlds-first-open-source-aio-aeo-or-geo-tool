import { describe, it, expect } from 'vitest';
import { matchProperty } from './propertyMatch';

// propertyMatchesDomain is covered through the GSC adapter in gsc.test.ts;
// these cases exercise what GA4 adds — a property carrying several site URLs.

describe('matchProperty', () => {
  it('matches a property through any of its site URLs', () => {
    const properties = [
      { value: '111', siteUrls: ['https://example.com', 'https://shop.example.com'] },
      { value: '222', siteUrls: ['http://other.com'] },
    ];
    expect(matchProperty(properties, ['shop.example.com'])).toBe('111');
    expect(matchProperty(properties, ['other.com'])).toBe('222');
  });

  it('ignores properties with no site URLs (app-only GA4 properties)', () => {
    const properties = [
      { value: '111', siteUrls: [] },
      { value: '222', siteUrls: ['https://example.com'] },
    ];
    expect(matchProperty(properties, ['example.com'])).toBe('222');
    expect(matchProperty(properties, ['nothing.com'])).toBeNull();
  });

  it('returns null when several properties match the same domain', () => {
    const properties = [
      { value: '111', siteUrls: ['https://example.com'] },
      { value: '222', siteUrls: ['http://www.example.com'] },
    ];
    expect(matchProperty(properties, ['example.com'])).toBeNull();
  });

  it('returns null for a brand with no domains', () => {
    expect(matchProperty([{ value: '111', siteUrls: ['https://example.com'] }], [])).toBeNull();
  });
});
