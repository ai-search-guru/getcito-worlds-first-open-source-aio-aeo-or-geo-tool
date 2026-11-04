import { describe, it, expect } from 'vitest';
import { regionToLocationCode, languageToCode } from './dataforseoCodes.js';

describe('dataforseo-codes', () => {
  describe('regionToLocationCode', () => {
    it('should map uppercase region codes', () => {
      expect(regionToLocationCode('US')).toBe(2840);
      expect(regionToLocationCode('GB')).toBe(2826);
      expect(regionToLocationCode('DE')).toBe(2276);
    });

    it('should be case-insensitive', () => {
      expect(regionToLocationCode('us')).toBe(2840);
      expect(regionToLocationCode('gb')).toBe(2826);
      expect(regionToLocationCode('De')).toBe(2276);
    });

    it('should return undefined for unknown regions', () => {
      expect(regionToLocationCode('XX')).toBeUndefined();
      expect(regionToLocationCode('Mars')).toBeUndefined();
    });

    it('should return undefined for null/undefined input', () => {
      expect(regionToLocationCode(null)).toBeUndefined();
      expect(regionToLocationCode(undefined)).toBeUndefined();
      expect(regionToLocationCode('')).toBeUndefined();
    });
  });

  describe('languageToCode', () => {
    it('should map supported language codes', () => {
      expect(languageToCode('en')).toBe('en');
      expect(languageToCode('de')).toBe('de');
      expect(languageToCode('ja')).toBe('ja');
    });

    it('should be case-insensitive', () => {
      expect(languageToCode('EN')).toBe('en');
      expect(languageToCode('De')).toBe('de');
      expect(languageToCode('JA')).toBe('ja');
    });

    it('should return undefined for unsupported languages', () => {
      expect(languageToCode('zh')).toBeUndefined();
      expect(languageToCode('pt-br')).toBeUndefined();
    });

    it('should return undefined for null/undefined input', () => {
      expect(languageToCode(null)).toBeUndefined();
      expect(languageToCode(undefined)).toBeUndefined();
      expect(languageToCode('')).toBeUndefined();
    });
  });
});
