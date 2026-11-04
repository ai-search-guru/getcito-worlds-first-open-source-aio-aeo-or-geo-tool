import type { PriorityLevel } from '@/lib/action-center/priority';

/**
 * What every priority score is built from (learning D4): the web app's twin
 * of backend/src/lib/priorityCore.js, for the score worked out here (the
 * Content Plan's, plan.ts) and the levels shown for the Action Center's
 * (action-center/priority.ts). Only the pieces the web app uses are here;
 * the cases in backend/src/lib/priority-core.fixtures.json are checked
 * against both files, so the two can't drift apart.
 */

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

/** `n` to `digits` decimals. */
export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * A count on a log scale: 0 → 0, `fullAt` and above → 1. What isn't a
 * number counts as nothing: a score never turns NaN.
 */
export function logScale(value: number, fullAt: number): number {
  const count = Number(value);
  if (Number.isNaN(count)) return 0;
  return clamp(Math.log10(1 + Math.max(0, count)) / Math.log10(1 + fullAt));
}

/** A screen's level cut-offs: the Action Center's and the Content Plan's differ. */
export interface LevelCutoffs {
  critical: number;
  high: number;
  medium: number;
}

/** The level a score falls in, at a screen's own cut-offs. */
export function levelOf(score: number, { critical, high, medium }: LevelCutoffs): PriorityLevel {
  if (score >= critical) return 'critical';
  if (score >= high) return 'high';
  if (score >= medium) return 'medium';
  return 'low';
}
