import { describe, expect, it } from 'vitest';
import { numberFormat } from './numberFormat';

describe('numberFormat', () => {
  const en = numberFormat('en');
  const tr = numberFormat('tr');

  it('writes numbers in the locale, with fixed decimals when asked', () => {
    expect(en.number(1234.5)).toBe('1,234.5');
    expect(tr.number(1234.5)).toBe('1.234,5');
    expect(en.number(48, 1)).toBe('48.0');
    expect(en.number(17.4)).toBe('17.4');
  });

  it('places the percent sign as the locale does', () => {
    expect(en.percent(64.3)).toBe('64.3%');
    expect(tr.percent(64.3)).toBe('%64,3');
    expect(en.percent(38)).toBe('38%');
  });

  it('shortens large counts', () => {
    expect(en.compact(39_900)).toBe('39.9K');
    expect(en.compact(1_200_000)).toBe('1.2M');
    expect(en.compact(940)).toBe('940');
  });

  it('signs changes with a true minus and ±0', () => {
    expect(en.signed(1.5)).toBe('+1.5');
    expect(en.signed(-3.2)).toBe('−3.2');
    expect(en.signed(0)).toBe('±0');
    expect(tr.signed(-1234.5)).toBe('−1.234,5');
  });
});
