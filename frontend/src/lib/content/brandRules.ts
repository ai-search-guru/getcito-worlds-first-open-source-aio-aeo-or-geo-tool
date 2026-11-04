/**
 * A brand's rules in its own words (customer priorities item 8, 00450), set
 * in Settings › Content: Site Audit's AI recommendations, new content
 * opportunities and the Content Agent follow them; scores don't change.
 */

/** The most rules a brand keeps, and the longest one (brands.brand_rules' checks). */
export const MAX_BRAND_RULES = 30;
export const MAX_BRAND_RULE_LENGTH = 300;

/**
 * What a person typed, one rule per line, as it's saved: trimmed, each once,
 * in order; and the lines too long to keep (1-based), to say so.
 */
export function parseBrandRules(text: string): { rules: string[]; tooLong: number[] } {
  const rules: string[] = [];
  const tooLong: number[] = [];
  text.split('\n').forEach((line, i) => {
    const rule = line.trim().replace(/\s+/g, ' ');
    if (!rule) return;
    if (rule.length > MAX_BRAND_RULE_LENGTH) tooLong.push(i + 1);
    else if (!rules.includes(rule)) rules.push(rule);
  });
  return { rules, tooLong };
}

/** Whether a list is one a save keeps: parseBrandRules' own output, within the limits. */
export function brandRulesValid(rules: readonly string[]): boolean {
  return (
    rules.length <= MAX_BRAND_RULES &&
    new Set(rules).size === rules.length &&
    rules.every(
      (rule) =>
        typeof rule === 'string' &&
        rule.length > 0 &&
        rule.length <= MAX_BRAND_RULE_LENGTH &&
        rule === rule.trim().replace(/\s+/g, ' '),
    )
  );
}
