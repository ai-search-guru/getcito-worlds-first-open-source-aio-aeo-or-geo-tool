import { describe, expect, it } from 'vitest';
import { brandRulesValid, MAX_BRAND_RULE_LENGTH, parseBrandRules } from './brandRules';

/** A brand's rules (00450), as Settings › Content saves them. */

describe('parseBrandRules', () => {
  it('keeps one rule per line, trimmed and each once, and names the lines too long', () => {
    const long = 'x'.repeat(MAX_BRAND_RULE_LENGTH + 1);
    expect(
      parseBrandRules(
        '  No topics comparing us with a named competitor.\n\nSay "subscription".\n' +
          `${long}\nSay   "subscription".`,
      ),
    ).toEqual({
      rules: ['No topics comparing us with a named competitor.', 'Say "subscription".'],
      tooLong: [4],
    });
  });
});

describe('brandRulesValid', () => {
  it('takes what parseBrandRules gives, within the limits', () => {
    expect(brandRulesValid(['Cite official sources for health claims.'])).toBe(true);
    expect(brandRulesValid([])).toBe(true);
    expect(brandRulesValid([' padded '])).toBe(false);
    expect(brandRulesValid(['same', 'same'])).toBe(false);
    expect(brandRulesValid(['x'.repeat(MAX_BRAND_RULE_LENGTH + 1)])).toBe(false);
    expect(brandRulesValid(Array.from({ length: 31 }, (_, i) => `rule ${i}`))).toBe(false);
  });
});
