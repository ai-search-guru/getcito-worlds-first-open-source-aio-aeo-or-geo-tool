import { describe, it, expect } from 'vitest';
import { getLanguageName, languageCodeOf, LANGUAGE_NAMES } from './languages.js';

describe('languages', () => {
  it('should return correct language names', () => {
    expect(getLanguageName('en')).toBe('English');
    expect(getLanguageName('de')).toBe('German');
  });

  it('should default to English for unknown codes', () => {
    expect(getLanguageName('xyz')).toBe('English');
  });

  it('should have language names configuration object', () => {
    expect(LANGUAGE_NAMES).toBeDefined();
    expect(LANGUAGE_NAMES.en).toBe('English');
  });

  it('reads a language as a code, as a brand or a Language rule names it', () => {
    expect(languageCodeOf('tr')).toBe('tr');
    expect(languageCodeOf('pt-BR')).toBe('pt');
    expect(languageCodeOf('Turkish')).toBe('tr');
    expect(languageCodeOf('English (US)')).toBe('en');
    // A region before the name isn't a language ("UK" is Ukrainian's code).
    expect(languageCodeOf('US English')).toBe('en');
    expect(languageCodeOf('UK English')).toBe('en');
    expect(languageCodeOf('in German')).toBe('de');
    // A code not listed here, on its own, is taken as it is.
    expect(languageCodeOf('pl')).toBe('pl');
    expect(languageCodeOf('pl-PL')).toBe('pl');
    expect(languageCodeOf('Klingon')).toBeNull();
    expect(languageCodeOf('xx yy')).toBeNull();
    expect(languageCodeOf(null)).toBeNull();
  });
});
