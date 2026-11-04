/**
 * A brand's rules in its own words (customer priorities item 8, 00450), set
 * in Settings › Content and read by the server, never from the browser, wherever the
 * server writes for the brand: Site Audit's AI recommendations, new content
 * opportunities and the Content Agent. They shape what's suggested and
 * written; scores don't change. Read with readBrandRules (brandRulesRead.js).
 */

/** As the column's check: at most 30 rules of at most 300 characters. */
const MAX_RULES = 30;
const MAX_RULE_LENGTH = 300;

/** The rules as a prompt takes them: strings, trimmed, within the column's limits. */
export function cleanBrandRules(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((rule) => typeof rule === 'string')
    .map((rule) => rule.trim().replace(/\s+/g, ' '))
    .filter((rule) => rule.length > 0 && rule.length <= MAX_RULE_LENGTH)
    .slice(0, MAX_RULES);
}

/**
 * The rules as a prompt section under `heading`, one per line; empty without
 * any, so the prompt is as it was.
 */
export function brandRulesSection(rules, heading) {
  const list = cleanBrandRules(rules);
  return list.length ? `${heading}\n${list.map((rule) => `- ${rule}`).join('\n')}` : '';
}
