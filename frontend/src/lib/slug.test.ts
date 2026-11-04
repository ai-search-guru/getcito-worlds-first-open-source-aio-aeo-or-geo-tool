import { expect, test } from 'vitest';
import { slugify } from './slug.js';

test('plain ASCII names lowercase and hyphenate', () => {
  expect(slugify('Hello World')).toBe('hello-world');
  expect(slugify('Acme Corp')).toBe('acme-corp');
});

test('accented Latin letters are transliterated, not deleted', () => {
  expect(slugify('Öz Güven')).toBe('oz-guven');
  expect(slugify('Ürün')).toBe('urun');
  expect(slugify('Müller')).toBe('muller');
  expect(slugify('Çiğdem')).toBe('cigdem');
  expect(slugify('café')).toBe('cafe');
});

test('Turkish letters that do not decompose are handled', () => {
  expect(slugify('Şeker')).toBe('seker');
  expect(slugify('Ağaç')).toBe('agac');
});

test('Turkish dotless/dotted i is pinned to i regardless of lowercasing', () => {
  expect(slugify('Işık')).toBe('isik');
  expect(slugify('İstanbul')).toBe('istanbul');
});

test('names that used to collapse to the same slug now stay distinct', () => {
  expect(slugify('Ağaç')).not.toBe(slugify('Aa'));
});

test('German ß, Nordic ø, and Polish ł are transliterated', () => {
  expect(slugify('Straße')).toBe('strasse');
  expect(slugify('Nørgaard')).toBe('norgaard');
  expect(slugify('Łódź')).toBe('lodz');
});

test('whitespace collapses and edge hyphens are trimmed', () => {
  expect(slugify('  Öz   Güven  ')).toBe('oz-guven');
  expect(slugify('--Ürün--')).toBe('urun');
});

test('returns an empty string when nothing survives', () => {
  expect(slugify('!!!')).toBe('');
  expect(slugify('   ')).toBe('');
});
