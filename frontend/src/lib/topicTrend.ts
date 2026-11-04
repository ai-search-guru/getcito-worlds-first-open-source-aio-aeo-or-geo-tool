/**
 * The Topics overview's window and trend days (00156), apart from the server
 * action that reads them: a 'use server' module may only export async
 * functions.
 */

/** The window the overview covers, as the page's date range resolves it. */
export interface TopicsWindow {
  from: string;
  /** Omitted: up to now. */
  to?: string;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days a window spans, at least one. An hour of slack: a rolling 7 days
 * starts where the browser put it and ends when the server reads it, a moment
 * later, which must not make it 8. topics_overview_window counts the same way.
 */
export function windowDayCount(from: number, to: number): number {
  return Math.max(1, Math.ceil((to - from) / DAY_MS - 1 / 24));
}

/**
 * A window's trend days, oldest first: its whole days counted back from the
 * end, as topics_overview_window (00156) reads the competitor rollup, so a
 * rolling 7 days draws today and the 6 days before, not a clipped eighth.
 * None for a window under two days: one day has no line to draw.
 */
export function topicTrendDays(window: TopicsWindow, now = Date.now()): string[] {
  const to = window.to ? Date.parse(window.to) : now;
  const days = windowDayCount(Date.parse(window.from), to);
  if (days < 2) return [];
  return Array.from({ length: days }, (_, i) =>
    new Date(to - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

/**
 * A custom range's window as whole UTC days, the days the rollups hold
 * (00156). The date inputs name calendar days; read in the viewer's zone, a
 * range picked west of UTC would end on the next UTC day and every rollup day
 * would shift one later. A missing bound falls back to the resolved range's.
 */
export function customUtcWindow(
  from: string,
  to: string,
  resolved: { from: string; to?: string },
): TopicsWindow {
  return {
    from: from ? `${from}T00:00:00.000Z` : resolved.from,
    to: to ? `${to}T23:59:59.999Z` : resolved.to,
  };
}
