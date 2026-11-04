/**
 * The AI Referral Trend's "vs Google clicks" view (AT-008, spec §3.3): AI
 * visits and Google organic clicks day by day, each indexed to 100 on its
 * first day with any, so two lines of very different sizes compare by shape.
 * Markers show the days actions entered the Action Center and prompts were
 * added.
 *
 * A Google day is left blank, not 0, before Search Console's first day for
 * the brand (the sync keeps no older history) and after the latest day
 * Google has reported (about two days late, §3.01).
 *
 * Pure: the chart draws it.
 */

import type { TrafficGoogleTrend, TrafficTrendPoint } from '@/lib/actions/traffic';

/** The longest stretch the view draws, as the trend does (365 days). */
export const GOOGLE_TREND_MAX_DAYS = 365;

const DAY_MS = 86_400_000;

export interface GoogleTrendPoint {
  /** A UTC day, "2026-10-12". */
  date: string;
  /** AI visits indexed: 100 = the line's first day with any; null before it. */
  ai: number | null;
  /** Google clicks indexed the same way; null where Google has no data for the day. */
  google: number | null;
  visits: number;
  /** Null where Google has no data for the day. */
  clicks: number | null;
  actions: number;
  prompts: number;
}

export interface GoogleTrendView {
  points: GoogleTrendPoint[];
  /** Google's latest reported day when the range runs past it, for the label. */
  googleUntil: string | null;
  /** Any Google clicks in the range; without, the view says so. */
  hasGoogle: boolean;
}

/**
 * The days the view draws: every UTC day from the trend's first to its last,
 * the all-time trend's quiet days included, at most a year. A range that
 * starts mid-day (the rolling 7 and 30 days) leaves out its first, partial
 * day, whose few visits would set a misleading 100. Null for an hourly trend
 * (the 24-hour range): Google reports by day.
 */
export function googleTrendDays(trend: TrafficTrendPoint[], rangeStart?: string): string[] | null {
  if (trend.some((p) => p.date.includes('T'))) return null;
  if (!trend.length) return [];
  let first = Date.parse(`${trend[0].date}T00:00:00Z`);
  if (rangeStart && Date.parse(rangeStart) > first && trend.length > 1) first += DAY_MS;
  const last = Date.parse(`${trend[trend.length - 1].date}T00:00:00Z`);
  const start = Math.max(first, last - (GOOGLE_TREND_MAX_DAYS - 1) * DAY_MS);
  const days: string[] = [];
  for (let t = start; t <= last; t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/** Each value over the series' first value above 0, × 100; null before that day. */
function indexed(values: (number | null)[]): (number | null)[] {
  const start = values.findIndex((v) => v !== null && v > 0);
  if (start === -1) return values.map(() => null);
  const base = values[start] as number;
  return values.map((v, i) => (i < start || v === null ? null : Math.round((v / base) * 100)));
}

/** The view's points for `days` (from `googleTrendDays`). */
export function googleTrend(
  trend: TrafficTrendPoint[],
  google: TrafficGoogleTrend,
  days: string[],
): GoogleTrendView {
  const visitsByDay = new Map(
    trend.map((p) => [
      p.date,
      Object.entries(p).reduce((sum, [key, v]) => (key === 'date' ? sum : sum + Number(v)), 0),
    ]),
  );
  const clicksByDay = new Map(google.clicks.map((c) => [c.day, c.clicks]));
  const markers = new Map(google.markers.map((m) => [m.day, m]));
  const { firstDay, lastDay } = google;

  const visits = days.map((day) => visitsByDay.get(day) ?? 0);
  const clicks = days.map((day) =>
    !firstDay || !lastDay || day < firstDay || day > lastDay ? null : (clicksByDay.get(day) ?? 0),
  );
  const ai = indexed(visits);
  const googleLine = indexed(clicks);
  const last = days[days.length - 1];

  return {
    points: days.map((date, i) => ({
      date,
      ai: ai[i],
      google: googleLine[i],
      visits: visits[i],
      clicks: clicks[i],
      actions: markers.get(date)?.actions ?? 0,
      prompts: markers.get(date)?.prompts ?? 0,
    })),
    googleUntil: lastDay && last && lastDay < last ? lastDay : null,
    hasGoogle: clicks.some((c) => c !== null && c > 0),
  };
}
