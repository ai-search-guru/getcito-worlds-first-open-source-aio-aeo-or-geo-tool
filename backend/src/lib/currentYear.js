/**
 * The year in generated text.
 *
 * Generators wrote the year they ran in into prompts and opportunity titles
 * ("Top 10 CRM tools in 2026"), and the text froze with it: on New Year's Day
 * every such title reads a year out of date. Generators are now told the
 * current year and to leave years out unless the need is about one
 * (yearRule). What was written before is shown with the current year
 * (refreshYears): a past year in an opportunity's title or question reads as
 * this year, and a range ("2025-2026") ends this year. Stored text is not
 * changed, and a tracked prompt's own text never is: it is what the prompt is
 * tracked by.
 *
 * frontend/src/lib/content/currentYear.ts shows text the same way; change both
 * together.
 */

/**
 * GetCito writes opportunities and prompts since 2025. A year before that in
 * one is history ("since 2019"), not the year it was written in.
 */
export const FIRST_WRITTEN_YEAR = 2025;

export function currentYear(now = new Date()) {
  return now.getUTCFullYear();
}

/** The generators' rule, one line in their instructions. */
export function yearRule(year = currentYear()) {
  return `- Current year: ${year}. Leave years out unless the need is about a particular year (a tax rule, an event, a season); when one belongs, write ${year} or later, never an earlier year.`;
}

/** Words before a year that make it a point in time, not the year written in. */
const HISTORY = /\b(?:since|from|until|till|before|after|between|in early|in late)\s*$/i;

const YEARS = /\b(20\d{2})(?:(\s*[-–—/]\s*)(20\d{2}))?\b/g;

/**
 * The text with a past year written as the current one, and a range ending in
 * a past year moved to end this year ("2024-2025" in 2026: "2025-2026").
 * Years before FIRST_WRITTEN_YEAR, after one of the HISTORY words, or not
 * past are left alone.
 */
export function refreshYears(text, year = currentYear()) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(YEARS, (match, first, dash, last, offset, whole) => {
    if (HISTORY.test(whole.slice(Math.max(0, offset - 16), offset))) return match;
    const end = Number(last ?? first);
    if (end < FIRST_WRITTEN_YEAR || end >= year) return match;
    if (!last) return String(year);
    const start = Number(first);
    if (start > end) return match;
    return `${start + (year - end)}${dash}${year}`;
  });
}
