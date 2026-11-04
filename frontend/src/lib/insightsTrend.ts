/**
 * The Insights visibility trend (VIS-007), as in the v2 mockup: your line
 * and the competitors you pin (they stay the same whatever the range),
 * markers for the days prompts were added, and the Action Center goal. Kept
 * apart from the chart so the rules are tested on their own.
 */

/** At most this many competitors can be pinned (also a check on brands, 00136). */
export const MAX_PINNED_COMPETITORS = 5;
/** Without pins, the chart shows this many: the strongest at the end of the range. */
const AUTO_COMPETITORS = 4;
/** Prompt-day markers shown at once, so the chart stays readable. */
const MAX_MARKERS = 3;

export const OWN_BRAND_COLOR = 'var(--chart-1)';
/** Competitor colors in line order: pin order, or rank without pins. */
const COMPETITOR_PALETTE = [
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  '#cf6679',
];

interface Entity {
  key: string;
  name: string;
  isOwnBrand: boolean;
}

interface Point {
  date: string;
  day: string;
  values: Record<string, number>;
}

export type TrendLine<E extends Entity = Entity> = E & { color: string };

/**
 * The lines to draw: yours, then the pinned competitors in pin order, or,
 * with nothing pinned, the strongest four at the end of the range (ties
 * broken by the range average), as before pins.
 */
export function trendLines<E extends Entity>(
  entities: E[],
  points: Point[],
  pinned: string[],
): TrendLine<E>[] {
  const own = entities.filter((e) => e.isOwnBrand);
  const competitors = entities.filter((e) => !e.isOwnBrand);
  const byKey = new Map(competitors.map((e) => [e.key, e]));
  const pins = pinned.map((key) => byKey.get(key)).filter((e): e is E => e !== undefined);

  const last = (key: string) => points[points.length - 1]?.values[key] ?? 0;
  const avg = (key: string) =>
    points.reduce((sum, p) => sum + (p.values[key] ?? 0), 0) / Math.max(points.length, 1);
  const shown =
    pins.length > 0
      ? pins.slice(0, MAX_PINNED_COMPETITORS)
      : [...competitors]
          .sort((a, b) => last(b.key) - last(a.key) || avg(b.key) - avg(a.key))
          .slice(0, AUTO_COMPETITORS);

  return [
    ...own.map((e) => ({ ...e, color: OWN_BRAND_COLOR })),
    ...shown.map((e, i) => ({ ...e, color: COMPETITOR_PALETTE[i % COMPETITOR_PALETTE.length] })),
  ];
}

export interface TrendMarkerData {
  promptsAdded: { day: string; count: number }[];
  /** The active "AI visibility" Action Center KPI's target; null without one. */
  goal: number | null;
}

/** The insights_trend_markers payload (00136); its actions_sent isn't shown. */
export function parseTrendMarkers(raw: unknown): Omit<TrendMarkerData, 'goal'> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rows = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    promptsAdded: rows(r.prompts_added).map((d) => ({
      day: String(d.day),
      count: Number(d.count ?? 0),
    })),
  };
}

export type TrendMarker = { kind: 'prompts'; day: string; date: string | null; count: number };

/**
 * The markers, each on the chart point of its day (or the next day with a
 * point): the days the most prompts were added, three at most, in day order. A day after the last point
 * (the latest run hasn't landed yet) gets no `date`: it is listed under the
 * chart but not drawn on a day it didn't happen.
 */
export function trendMarkers(data: TrendMarkerData, points: Point[]): TrendMarker[] {
  const dateOf = (day: string) => points.find((p) => p.day >= day)?.date ?? null;

  return [...data.promptsAdded]
    .sort((a, b) => b.count - a.count || b.day.localeCompare(a.day))
    .slice(0, MAX_MARKERS)
    .map((d) => ({ kind: 'prompts' as const, day: d.day, date: dateOf(d.day), count: d.count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The Y axis top: ticks run 5, 15, 25, … and the top one sits just above
 * the highest value in view, the goal included, so the goal line is never
 * cut off.
 */
export function trendAxisTop(values: number[], goal: number | null): number {
  const max = Math.max(0, ...values, goal ?? 0);
  let top = 5;
  while (top <= max) top += 10;
  return top;
}
