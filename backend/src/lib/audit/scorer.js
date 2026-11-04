/**
 * Aggregate per-signal verdicts into category scores and a single total,
 * using the rubric's category weights.
 *
 * Partial-coverage rule: a category's score is the mean of its *evaluated*
 * signals only (status !== 'na'); unimplemented signals don't drag it down.
 * The total re-normalizes over the weight of categories that had at least one
 * evaluated signal, so the headline number stays a true 0..1 even mid-rollout.
 * Each result also reports `evaluated / total` so the UI can show coverage.
 */

import { categories, signalsByKey } from './rubric.js';

/**
 * @param {Array<{ key: string, status: string, score: number|null }>} results
 * @returns {{ totalScore: number|null, categoryScores: Record<string, { score: number|null, evaluated: number, total: number }> }}
 */
export function scoreAudit(results) {
  const byKey = new Map(results.map((r) => [r.key, r]));
  const categoryScores = {};

  let weightSum = 0;
  let weightedSum = 0;

  for (const cat of categories) {
    const catSignalKeys = Object.values(signalsByKey)
      .filter((s) => s.category === cat.key)
      .map((s) => s.key);

    const evaluated = catSignalKeys
      .map((k) => byKey.get(k))
      .filter((r) => r && r.status !== 'na' && typeof r.score === 'number');

    if (evaluated.length === 0) {
      categoryScores[cat.key] = { score: null, evaluated: 0, total: catSignalKeys.length };
      continue;
    }

    const score = evaluated.reduce((acc, r) => acc + r.score, 0) / evaluated.length;
    categoryScores[cat.key] = {
      score,
      evaluated: evaluated.length,
      total: catSignalKeys.length,
    };

    weightSum += cat.weight;
    weightedSum += cat.weight * score;
  }

  const totalScore = weightSum > 0 ? weightedSum / weightSum : null;
  return { totalScore, categoryScores };
}
