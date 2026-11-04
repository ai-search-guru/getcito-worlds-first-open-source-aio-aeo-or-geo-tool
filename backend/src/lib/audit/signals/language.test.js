import { describe, expect, it } from 'vitest';
import { guessLanguage, langAttribute } from './language.js';

describe('a page’s language', () => {
  it('reads <html lang> as a two-letter code', () => {
    expect(langAttribute('tr-TR')).toBe('tr');
    expect(langAttribute('en_US')).toBe('en');
    expect(langAttribute(' DE ')).toBe('de');
    expect(langAttribute('x-default')).toBeNull();
    expect(langAttribute('und')).toBeNull();
    expect(langAttribute(undefined)).toBeNull();
  });

  it('guesses it from the commonest words, or the script', () => {
    expect(guessLanguage('İçin çok güzel bir gün ve biz de oradaydık, ama yağmur var.')).toBe('tr');
    expect(guessLanguage('We planned the trip and stayed in a small hotel with the family.')).toBe(
      'en',
    );
    expect(guessLanguage('Wir haben die Reise geplant und sind mit dem Zug gefahren.')).toBe('de');
    expect(guessLanguage('Nous avons visité la ville et nous sommes allés dans un hôtel.')).toBe(
      'fr',
    );
    expect(guessLanguage('小さなチームは、今月、成約できる商談を見て、売上を予測します。')).toBe(
      'ja',
    );
    expect(guessLanguage('小团队通过查看本月可以成交的交易来预测销售。')).toBe('zh');
  });

  it('says nothing when too few words do', () => {
    expect(guessLanguage('Kapadokya 2026')).toBeNull();
    expect(guessLanguage('')).toBeNull();
  });
});
