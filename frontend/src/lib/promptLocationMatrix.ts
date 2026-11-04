import { heatShade } from '@/lib/insightsTopics';
import { dayIn, startOfDayIn, viewerTimeZone } from '@/lib/timeZone';

/**
 * The Tracked Prompts Locations view (PROMPT-015b): each tracked prompt in
 * each location the brand tracks, side by side, for one metric at a time.
 * The figures are the table's own, read once per location
 * (getPromptLocationMatrix); this module shapes them.
 */

export type LocationMetric = 'visibility' | 'position' | 'mentions' | 'citations';
export const LOCATION_METRICS: readonly LocationMetric[] = [
  'visibility',
  'position',
  'mentions',
  'citations',
];

/** One prompt in one location. */
export interface PromptLocationCell {
  /** AI Visibility Score, 0–100; null without answers. */
  score: number | null;
  mentions: number;
  citations: number;
  /** Average position the brand is named at; null when never named. */
  position: number | null;
  runs: number;
}

/** By prompt id, then location code. */
export type PromptLocationMatrix = Record<string, Record<string, PromptLocationCell>>;

/** Locations read at most in one go: each is its own read. */
export const MATRIX_REGIONS = 12;

/** The matrix's database reads running at once, at most: each is a heavy aggregate. */
export const MATRIX_READS_AT_ONCE = 3;

/**
 * Whether a window runs up to today on the viewer's clock, so a location
 * with no answers in it can still get them from the next daily run. A
 * custom range that ended earlier, yesterday included, can't.
 */
export function reachesToday(
  window: { to?: string },
  now = Date.now(),
  timeZone = viewerTimeZone(),
): boolean {
  if (!window.to) return true;
  return Date.parse(window.to) >= Date.parse(startOfDayIn(dayIn(now, timeZone), timeZone));
}

/**
 * How long after it's added a prompt can still be waiting for its first
 * answers: the next daily run comes within a day, and a second day spares
 * a slow run.
 */
export const FIRST_ANSWERS_MS = 48 * 60 * 60 * 1000;

/**
 * Whether a place an active prompt is tracked in, with no answers there in
 * a window reaching today, can still get its first ones from the next
 * daily run ("Within 24h"): the prompt was added within FIRST_ANSWERS_MS,
 * or it has answers elsewhere in the window, so the place was most likely
 * just added. An older prompt with answers nowhere just had none in this
 * window, a range without a run or a failed one: a dash.
 */
export function awaitsFirstAnswers(
  prompt: { createdAt: string },
  answeredElsewhere: boolean,
  now = Date.now(),
): boolean {
  return answeredElsewhere || now - Date.parse(prompt.createdAt) < FIRST_ANSWERS_MS;
}

/** A cell's value for the metric; null without answers there (or, for position, never named). */
export function metricValue(
  cell: PromptLocationCell | undefined,
  metric: LocationMetric,
): number | null {
  if (!cell || cell.runs === 0) return null;
  if (metric === 'visibility') return cell.score;
  if (metric === 'mentions') return cell.mentions;
  if (metric === 'citations') return cell.citations;
  return cell.position;
}

/**
 * The locations the view shows: those the prompts track, the most tracked
 * first, then by code, at most MATRIX_REGIONS.
 */
export function matrixLocations(prompts: readonly { regions: readonly string[] }[]): string[] {
  const counts = new Map<string, number>();
  for (const p of prompts) {
    for (const r of new Set(p.regions)) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MATRIX_REGIONS)
    .map(([r]) => r);
}

/**
 * A value's shade, 0 (lightest) to 4, among the values in view, as Brand
 * Visibility's Topics vs competitors shades its map (heatShade). For
 * position, being named earlier is darker; never named stays lightest.
 */
export function cellShade(
  value: number | null,
  inView: readonly number[],
  metric: LocationMetric,
): 0 | 1 | 2 | 3 | 4 {
  if (value === null || value <= 0) return 0;
  const shown = inView.filter((v) => v > 0);
  if (!shown.length) return 0;
  const low = Math.min(...shown);
  const high = Math.max(...shown);
  return metric === 'position'
    ? heatShade(high + low - value, low, high)
    : heatShade(value, low, high);
}

/** Best minus worst location for a prompt; null with fewer than two values. */
export function rowGap(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return null;
  return Math.round((Math.max(...known) - Math.min(...known)) * 10) / 10;
}

/** The metric's average per location, over the prompts with a value there. */
export function locationAverages(
  matrix: PromptLocationMatrix,
  promptIds: readonly string[],
  regions: readonly string[],
  metric: LocationMetric,
): (number | null)[] {
  return regions.map((region) => {
    const values = promptIds
      .map((id) => metricValue(matrix[id]?.[region], metric))
      .filter((v): v is number => v !== null);
    if (!values.length) return null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return metric === 'position' ? Math.round(avg * 10) / 10 : Math.round(avg);
  });
}

export interface MatrixInsights {
  /** By average visibility, with the prompts not tracked there. */
  weakest: { region: string; average: number; untracked: number } | null;
  strongest: { region: string; average: number; tracked: number } | null;
  /** The prompt whose visibility differs most between locations. */
  widest: {
    promptId: string;
    text: string;
    low: number;
    lowAt: string;
    high: number;
    highAt: string;
  } | null;
  /** Visibility across every location, for the weakest's comparison. */
  overall: number | null;
}

/** The three cards above the view, on visibility whatever the metric shown. */
export function matrixInsights(
  matrix: PromptLocationMatrix,
  prompts: readonly { id: string; text: string; regions: readonly string[] }[],
  regions: readonly string[],
): MatrixInsights {
  const ids = prompts.map((p) => p.id);
  const averages = locationAverages(matrix, ids, regions, 'visibility');
  const ranked = regions
    .map((region, i) => ({ region, average: averages[i] }))
    .filter((r): r is { region: string; average: number } => r.average !== null);
  const sorted = [...ranked].sort((a, b) => a.average - b.average);
  const all = prompts.flatMap((p) =>
    regions
      .map((r) => metricValue(matrix[p.id]?.[r], 'visibility'))
      .filter((v): v is number => v !== null),
  );
  let widest: MatrixInsights['widest'] = null;
  let widestGap = -1;
  for (const p of prompts) {
    const values = regions.map((r) => metricValue(matrix[p.id]?.[r], 'visibility'));
    const gap = rowGap(values);
    if (gap === null || gap <= widestGap) continue;
    widestGap = gap;
    const known = values.map((v, i) => ({ v, r: regions[i] })).filter((x) => x.v !== null);
    const lo = known.reduce((a, b) => (b.v! < a.v! ? b : a));
    const hi = known.reduce((a, b) => (b.v! > a.v! ? b : a));
    widest = {
      promptId: p.id,
      text: p.text,
      low: Math.round(lo.v!),
      lowAt: lo.r,
      high: Math.round(hi.v!),
      highAt: hi.r,
    };
  }
  const tracking = (region: string) => prompts.filter((p) => p.regions.includes(region)).length;
  const weakest = sorted[0];
  const strongest = sorted.at(-1);
  return {
    weakest: weakest ? { ...weakest, untracked: prompts.length - tracking(weakest.region) } : null,
    strongest:
      strongest && sorted.length > 1 ? { ...strongest, tracked: tracking(strongest.region) } : null,
    widest,
    overall: all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null,
  };
}
