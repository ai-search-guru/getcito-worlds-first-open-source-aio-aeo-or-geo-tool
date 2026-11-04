/**
 * What every priority score is built from (learning D4).
 *
 * Four screens order work by a score: the Action Center
 * (action-center/priority.js), content opportunities (opportunityLimits.js),
 * the Site Audit inbox (audit/priority.js) and, in the web app, the Content
 * Plan (frontend/src/lib/content/plan.ts, through this file's twin,
 * frontend/src/lib/priorityCore.ts). Each keeps its own factors: what makes an
 * action urgent isn't what makes a page worth auditing. What they share is
 * here, once: how a count becomes 0–1, the weight of a search's intent, how
 * factors add up to a score, how a kind's past results move it, and how a
 * score reads as a level. A change to one of these (a new kind of learning)
 * reaches every screen that uses it.
 *
 * The cases in priority-core.fixtures.json are checked against this file and
 * its web twin, so the two can't drift apart.
 *
 * Pure.
 */

/** `n` held between `min` and `max` (0 and 1 unless said). */
export const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));

/** `n` to `digits` decimals. */
export function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * A count on a log scale: 0 → 0, `fullAt` and above → 1. Demand, sessions
 * and conversions all grow by orders of magnitude, and on a straight scale
 * the few largest would flatten the rest to 0. What isn't a number counts as
 * nothing: a score never turns NaN.
 */
export function logScale(value, fullAt) {
  const count = Number(value);
  if (Number.isNaN(count)) return 0;
  return clamp(Math.log10(1 + Math.max(0, count)) / Math.log10(1 + fullAt));
}

/** How commercial a search is, by its intent: comparing and choosing above learning. */
export const INTENT_WEIGHTS = Object.freeze({
  comparison: 1.0,
  'best-top': 0.95,
  'vs-review': 0.9,
  recommendation: 0.85,
  'how-to': 0.75,
  'problem-solving': 0.7,
  'what-is': 0.6,
  other: 0.5,
});

/**
 * Factors times their weights, added up in the weights' order: the total and
 * what each factor gave. A factor's points are `value × weight / scale`:
 * scale 1 for factors read 0–1, 100 for ones read 0–100 against weights out
 * of 100.
 *
 * @param {Record<string, number>} factors
 * @param {Record<string, number>} weights
 * @returns {{ total: number, parts: Array<{ key: string, value: number, weight: number, points: number }> }}
 */
export function weightedScore(factors, weights, scale = 1) {
  const parts = Object.entries(weights).map(([key, weight]) => ({
    key,
    value: factors[key],
    weight,
    points: (factors[key] * weight) / scale,
  }));
  return { total: parts.reduce((sum, p) => sum + p.points, 0), parts };
}

/**
 * Past success (learning B4): from a kind's results at this brand, the share
 * that improved, pulled toward `prior` by `pseudoCount` imagined results so a
 * couple of results barely move it, and the points that moves a score: the
 * rate's distance from the prior times `swing`. None read: the prior, no
 * points.
 *
 * @param {{ improved?: number, results?: number } | undefined} track
 * @param {{ prior: number, pseudoCount: number, swing: number }} settings
 */
export function pastSuccessOf(track, { prior, pseudoCount, swing }) {
  const improved = Math.max(0, Math.floor(Number(track?.improved) || 0));
  const results = Math.max(improved, Math.floor(Number(track?.results) || 0));
  const rate = (improved + pseudoCount * prior) / (results + pseudoCount);
  return { rate, points: (rate - prior) * swing, improved, results };
}

/**
 * The level a score falls in, at a screen's own cut-offs: the Action
 * Center's and the Content Plan's differ, since their scores spread
 * differently.
 *
 * @param {number} score
 * @param {{ critical: number, high: number, medium: number }} cutoffs
 * @returns {'critical' | 'high' | 'medium' | 'low'}
 */
export function levelOf(score, { critical, high, medium }) {
  if (score >= critical) return 'critical';
  if (score >= high) return 'high';
  if (score >= medium) return 'medium';
  return 'low';
}
