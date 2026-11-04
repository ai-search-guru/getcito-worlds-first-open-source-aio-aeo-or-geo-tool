import { describe, expect, it } from 'vitest';
import { brandRulesSection, cleanBrandRules } from './brandRules.js';

/** A brand's rules (00450) as the server's prompts take them. */

describe('cleanBrandRules', () => {
  it('keeps strings, trimmed, within the column’s limits', () => {
    expect(cleanBrandRules(['  Say "subscription".  ', '', 3, 'x'.repeat(301)])).toEqual([
      'Say "subscription".',
    ]);
    expect(cleanBrandRules(null)).toEqual([]);
    expect(cleanBrandRules(Array.from({ length: 40 }, (_, i) => `rule ${i}`))).toHaveLength(30);
  });
});

describe('brandRulesSection', () => {
  it('lists the rules under the heading, and is empty without any', () => {
    expect(
      brandRulesSection(['No competitor comparisons.', 'Cite official sources.'], 'RULES:'),
    ).toBe('RULES:\n- No competitor comparisons.\n- Cite official sources.');
    expect(brandRulesSection([], 'RULES:')).toBe('');
  });
});
