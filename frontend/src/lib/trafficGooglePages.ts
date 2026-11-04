/**
 * The rules behind "Is AI taking Google clicks?" (AT-008, spec §3.6), kept
 * apart from the section so they're tested on their own.
 */

/** Impressions a page needs in the period before to be compared. */
export const GOOGLE_PAGES_MIN_IMPRESSIONS = 100;

/**
 * The most clicked Google queries the server checks for untracked ones
 * (AT-009): backend/src/lib/untrackedQueries.js's UNTRACKED_QUERY_SCAN.
 */
export const UNTRACKED_QUERY_SCAN = 5000;

const DAY_MS = 86_400_000;

/**
 * The days the section compares, before Google's delay moves them: the
 * range's length in whole days, ending on its last day. The database ends
 * them on the latest day Google has reported instead (about two days late,
 * §3.01). All time has no first day, so nothing to compare.
 */
export function googlePagesWindow(
  from: string | undefined,
  to: string | undefined,
  now = Date.now(),
): { since: string | null; until: string } {
  const end = to ? Date.parse(to) : now;
  const until = new Date(end).toISOString().slice(0, 10);
  if (!from) return { since: null, until };
  const days = Math.max(1, Math.round((end - Date.parse(from)) / DAY_MS));
  const since = new Date(Date.parse(`${until}T00:00:00Z`) - (days - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return { since, until };
}

/** The % rise in impressions: 42 for 1,000 → 1,420. */
export function impressionsRise(row: { impressions: number; prevImpressions: number }): number {
  return Math.round((row.impressions / row.prevImpressions - 1) * 100);
}

/** CTR as a percent with one decimal; null without impressions. */
export function ctrPct(clicks: number, impressions: number): number | null {
  return impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : null;
}
