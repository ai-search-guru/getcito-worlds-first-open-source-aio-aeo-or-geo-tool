import { formatCompactNumber } from '@/lib/format';
import type { PromptVolume } from '@/types';

/**
 * PROMPT-013: an estimated AI search volume is shown as a range with a
 * confidence, never as a bare number that reads as measured.
 *
 * A prompt's estimate is the median Google volume of its related keywords ×
 * the AI answer rate (00154, 00155: the share of Google searches that get an
 * AI answer). The keywords are head terms that spread widely by design, which
 * is why the median is taken; so how far the estimate can be trusted is read
 * around the median too: how many keywords have Google search data, and how
 * closely the middle half of them agree (their upper over lower quartile).
 * The range is the AI share of that middle half, kept within ½× to 2× of the
 * estimate; with one keyword to go by, it is exactly that.
 */

export type EstimateConfidence = 'high' | 'medium' | 'low';

/**
 * The AI adoption rate the server estimates with by default
 * (AI_VOLUME_MULTIPLIER in backend/src/lib/intentExtraction.js): the share
 * of Google searches that get an AI answer. Each volume row keeps the rate
 * it was estimated with (aiVolumeMultiplier).
 */
export const AI_ADOPTION_RATE = 0.45;

/**
 * What the estimate rests on: a prompt's related keywords, one keyword's
 * own Google volume (Similar Topics), or an AI's guess for a prompt not
 * tracked yet (Prompt Suggestions).
 */
export type EstimateBasis = 'keywords' | 'keyword' | 'guess' | 'snapshot';

export interface VolumeEstimate {
  basis: EstimateBasis;
  /** The stored point estimate: what sorting and totals add up. */
  value: number;
  low: number;
  high: number;
  confidence: EstimateConfidence;
  /** Keywords with Google search data, out of `keywords`. */
  measured: number;
  keywords: number;
  /** The AI adoption rate the estimate used (0.45 = 45%). */
  rate: number;
  /** When the Google volumes were fetched; the latest one for a total. */
  asOf: string | null;
  /** Fetched long enough ago to count one level less. */
  stale: boolean;
}

/**
 * High: at least this many keywords with data, their upper quartile at most
 * AGREE_HIGH × their lower one. Medium: at least two, within AGREE_MEDIUM ×.
 * On prod's 3,025 prompts (2026-10-22) the quartiles at these thresholds
 * split about 38% high, 40% medium and 23% low; the extremes, a median 58×
 * apart, had read 86% low.
 */
const HIGH_MIN_MEASURED = 3;
const AGREE_HIGH = 4;
const AGREE_MEDIUM = 15;
/** Volumes this old count one level less. */
export const STALE_DAYS = 183;
/** The range never strays further than this factor from the estimate (the whole range with one keyword)… */
const MAX_STRETCH = 2;
/** …and is always at least this wide either side of it. */
const MIN_BAND = 0.25;

const LEVELS: EstimateConfidence[] = ['low', 'medium', 'high'];

/**
 * The q-quantile of sorted values, interpolated between the two nearest as
 * Postgres's percentile_cont does: of five, 0.25 is the 2nd and 0.75 the 4th.
 */
function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const below = Math.floor(at);
  const above = Math.ceil(at);
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below);
}

/** Rounds to two significant figures, down or up: 396 → 390, 1,980 → 2,000. */
function roundTo2(value: number, direction: 'down' | 'up'): number {
  if (value <= 0) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
  return (direction === 'down' ? Math.floor(value / step) : Math.ceil(value / step)) * step;
}

/** The range around `value`: [low, high] stretched to the rules above, then rounded outwards. */
function bounds(value: number, low: number, high: number): { low: number; high: number } {
  if (value <= 0) return { low: 0, high: 0 };
  const lo = Math.min(Math.max(low, value / MAX_STRETCH), value * (1 - MIN_BAND));
  const hi = Math.max(Math.min(high, value * MAX_STRETCH), value * (1 + MIN_BAND));
  return { low: roundTo2(lo, 'down'), high: roundTo2(hi, 'up') };
}

/** Fetched long enough ago to count one level less. */
const isStale = (asOf: string | null, now: Date) => {
  const fetched = asOf ? Date.parse(asOf) : NaN;
  return Number.isFinite(fetched) && now.getTime() - fetched > STALE_DAYS * 24 * 60 * 60 * 1000;
};

type VolumeRow = Pick<
  PromptVolume,
  'estAiVolume' | 'googleVolumes' | 'aiVolumeMultiplier' | 'keywords' | 'fetchedAt'
>;

/** One prompt's estimate, from its keywords' Google volumes. */
export function promptVolumeEstimate(row: VolumeRow, now: Date = new Date()): VolumeEstimate {
  const value = Math.max(0, row.estAiVolume);
  const volumes = Object.values(row.googleVolumes ?? {})
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const measured = volumes.length;
  // The middle half of the measured volumes: one broad head term, which the
  // median already ignores, doesn't make the estimate read unsure.
  const lowerQuartile = measured > 0 ? quantile(volumes, 0.25) : 0;
  const upperQuartile = measured > 0 ? quantile(volumes, 0.75) : 0;
  const spread = measured > 0 ? upperQuartile / lowerQuartile : Infinity;

  let level =
    measured >= HIGH_MIN_MEASURED && spread <= AGREE_HIGH
      ? 2
      : measured >= 2 && spread <= AGREE_MEDIUM
        ? 1
        : 0;
  const stale = isStale(row.fetchedAt ?? null, now);
  if (stale) level = Math.max(0, level - 1);
  if (value === 0) level = 0;

  const range =
    measured >= 2
      ? bounds(
          value,
          lowerQuartile * row.aiVolumeMultiplier,
          upperQuartile * row.aiVolumeMultiplier,
        )
      : bounds(value, value / MAX_STRETCH, value * MAX_STRETCH);

  return {
    basis: 'keywords',
    value,
    ...range,
    confidence: LEVELS[level],
    measured,
    keywords: Math.max(row.keywords?.length ?? 0, Object.keys(row.googleVolumes ?? {}).length),
    rate: row.aiVolumeMultiplier,
    asOf: row.fetchedAt ?? null,
    stale,
  };
}

/**
 * One keyword's AI share, as Similar Topics lists it: its Google volume is
 * measured, so only the adoption rate is assumed. Medium, ±25%; low when
 * the keyword has no volume or it is over six months old.
 */
export function keywordVolumeEstimate(
  googleVolume: number,
  rate: number,
  asOf: string | null,
  now: Date = new Date(),
): VolumeEstimate {
  const value = Math.round(Math.max(0, googleVolume) * rate);
  const stale = isStale(asOf, now);
  return {
    basis: 'keyword',
    value,
    ...bounds(value, value, value),
    confidence: value > 0 && !stale ? 'medium' : 'low',
    measured: googleVolume > 0 ? 1 : 0,
    keywords: 1,
    rate,
    asOf,
    stale,
  };
}

/**
 * An AI's guess at a suggested prompt's volume (Prompt Suggestions): no
 * keyword behind it is measured yet, so it is always low, ×½ to ×2.
 */
export function guessedVolumeEstimate(value: number, asOf: string | null): VolumeEstimate {
  const v = Math.max(0, Math.round(value));
  return {
    basis: 'guess',
    value: v,
    ...bounds(v, v / MAX_STRETCH, v * MAX_STRETCH),
    confidence: 'low',
    measured: 0,
    keywords: 0,
    rate: 0,
    asOf,
    stale: false,
  };
}

/**
 * A sum kept from when something was made or last updated, e.g. a content
 * opportunity's prompts' estimates at the time, shown when their current ones
 * can't be read: low, ×½ to ×2, undated (a merge rewrites it unrecorded).
 */
export function snapshotVolumeEstimate(value: number): VolumeEstimate {
  return { ...guessedVolumeEstimate(value, null), basis: 'snapshot' };
}

export interface EstimateTotal extends VolumeEstimate {
  /** How many prompts were added up, and at each confidence. */
  count: number;
  byConfidence: Record<EstimateConfidence, number>;
}

/**
 * Prompts added up: the lows and the highs summed. High when at least 80% of
 * the volume is from high-confidence prompts, low when more than half is from
 * low-confidence ones, medium in between.
 */
export function sumEstimates(estimates: VolumeEstimate[]): EstimateTotal {
  const byConfidence: Record<EstimateConfidence, number> = { high: 0, medium: 0, low: 0 };
  const volumeAt: Record<EstimateConfidence, number> = { high: 0, medium: 0, low: 0 };
  let value = 0;
  let low = 0;
  let high = 0;
  let asOf: string | null = null;
  for (const e of estimates) {
    byConfidence[e.confidence] += 1;
    volumeAt[e.confidence] += e.value;
    value += e.value;
    low += e.low;
    high += e.high;
    if (e.asOf && (!asOf || Date.parse(e.asOf) > Date.parse(asOf))) asOf = e.asOf;
  }
  const confidence: EstimateConfidence =
    value <= 0
      ? 'low'
      : volumeAt.high / value >= 0.8
        ? 'high'
        : volumeAt.low / value > 0.5
          ? 'low'
          : 'medium';
  return {
    basis: 'keywords',
    value,
    low,
    high,
    confidence,
    measured: estimates.reduce((s, e) => s + e.measured, 0),
    keywords: estimates.reduce((s, e) => s + e.keywords, 0),
    rate: estimates[0]?.rate ?? 0,
    asOf,
    stale: estimates.some((e) => e.stale),
    count: estimates.length,
    byConfidence,
  };
}

/** An estimate's average per prompt: the total's range and value divided by its count. */
export function averageEstimate(total: EstimateTotal): EstimateTotal {
  const n = Math.max(1, total.count);
  return {
    ...total,
    value: Math.round(total.value / n),
    low: roundTo2(total.low / n, 'down'),
    high: roundTo2(total.high / n, 'up'),
  };
}

/** An estimate's range scaled by a share, e.g. one platform's part of a total. */
export function scaleEstimate(
  estimate: Pick<VolumeEstimate, 'low' | 'high'>,
  share: number,
): { low: number; high: number } {
  return {
    low: roundTo2(estimate.low * share, 'down'),
    high: roundTo2(estimate.high * share, 'up'),
  };
}

/** "400–2k", "1–3k", "1.2–4.5M"; "0" when there's nothing to estimate. */
export function formatEstimateRange(estimate: Pick<VolumeEstimate, 'low' | 'high'>): string {
  if (estimate.high <= 0) return '0';
  const low = formatCompactNumber(estimate.low);
  const high = formatCompactNumber(estimate.high);
  if (low === high) return high;
  const unit = /[kMB]$/.exec(high)?.[0];
  if (unit && low.endsWith(unit)) return `${low.slice(0, -1)}–${high}`;
  return `${low}–${high}`;
}

/**
 * An estimate isn't ranked on its own when its confidence is low: lists and
 * sorts that go by volume put it after the rest, and it earns no Opportunity
 * level by itself.
 */
export function rankable(estimate: Pick<VolumeEstimate, 'confidence'>): boolean {
  return estimate.confidence !== 'low';
}
