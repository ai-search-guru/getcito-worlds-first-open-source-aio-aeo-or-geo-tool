/**
 * How the Content list and the opportunity panel show when an opportunity
 * was suggested (CONTENT-002): relative for the first week ("2 hours ago",
 * "2 days ago"), then a short date ("Sep 25"), always in the UI's language,
 * with the full date and time for the tooltip.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Up to this age the date reads relative. */
export const RELATIVE_FOR_MS = 7 * DAY;

export function suggestedDate(
  iso: string,
  locale: string,
  now: number = Date.now(),
): { label: string; full: string } {
  const at = new Date(iso);
  const full = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    at,
  );
  const age = Math.max(0, now - at.getTime());
  if (age < RELATIVE_FOR_MS) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
    const label =
      age < HOUR
        ? rtf.format(-Math.max(1, Math.round(age / MINUTE)), 'minute')
        : age < DAY
          ? rtf.format(-Math.round(age / HOUR), 'hour')
          : rtf.format(-Math.round(age / DAY), 'day');
    return { label, full };
  }
  const sameYear = at.getFullYear() === new Date(now).getFullYear();
  const label = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(at);
  return { label, full };
}

export type SuggestedRange = 'all' | 'month' | 'last30' | 'custom';

/**
 * The created_at bounds a date filter preset stands for, as ISO strings;
 * custom takes YYYY-MM-DD inputs and includes the whole "to" day.
 */
export function suggestedBounds(
  range: SuggestedRange,
  custom: { from?: string; to?: string } = {},
  now: Date = new Date(),
): { from?: string; to?: string } {
  if (range === 'month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() };
  }
  if (range === 'last30') return { from: new Date(now.getTime() - 30 * DAY).toISOString() };
  if (range === 'custom') {
    const from = custom.from ? new Date(`${custom.from}T00:00:00`) : null;
    const to = custom.to ? new Date(`${custom.to}T00:00:00`) : null;
    return {
      ...(from && !Number.isNaN(from.getTime()) ? { from: from.toISOString() } : {}),
      ...(to && !Number.isNaN(to.getTime())
        ? { to: new Date(to.getTime() + DAY - 1).toISOString() }
        : {}),
    };
  }
  return {};
}
