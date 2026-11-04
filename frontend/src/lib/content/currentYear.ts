/**
 * A past year in an opportunity's title or question, shown as the current
 * one. Generators wrote the year they ran in ("Top 10 CRM tools in 2026"), so
 * the text read a year out of date from New Year's Day; a range ("2025-2026")
 * is moved to end this year. The stored text is not changed, and a tracked
 * prompt's own text never is: the prompt is tracked by it.
 *
 * backend/src/lib/currentYear.js shows the server's reads the same way;
 * change both together.
 */

/**
 * GetCito writes opportunities and prompts since 2025. A year before that in
 * one is history ("since 2019"), not the year it was written in.
 */
export const FIRST_WRITTEN_YEAR = 2025;

/** Words before a year that make it a point in time, not the year written in. */
const HISTORY = /\b(?:since|from|until|till|before|after|between|in early|in late)\s*$/i;

const YEARS = /\b(20\d{2})(?:(\s*[-–—/]\s*)(20\d{2}))?\b/g;

/**
 * The text with a past year written as the current one, and a range ending in
 * a past year moved to end this year ("2024-2025" in 2026: "2025-2026").
 * Years before FIRST_WRITTEN_YEAR, after one of the HISTORY words, or not
 * past are left alone.
 */
export function refreshYears<T extends string | null | undefined>(
  text: T,
  year: number = new Date().getUTCFullYear(),
): T {
  if (!text) return text;
  return text.replace(
    YEARS,
    (match, first: string, dash: string | undefined, last: string | undefined, offset: number) => {
      if (HISTORY.test(text.slice(Math.max(0, offset - 16), offset))) return match;
      const end = Number(last ?? first);
      if (end < FIRST_WRITTEN_YEAR || end >= year) return match;
      if (!last) return String(year);
      const start = Number(first);
      if (start > end) return match;
      return `${start + (year - end)}${dash}${year}`;
    },
  ) as T;
}
