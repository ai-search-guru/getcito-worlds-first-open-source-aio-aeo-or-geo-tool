import { generationCostUsd } from './improveCost.js';

/**
 * How relevant a suggested prompt is to the brand (VIS-011). The refresh's
 * model rates each suggestion 0–10 in the same answer that writes it: a whole
 * number is a few output tokens per suggestion, where a second call to judge
 * the list would cost about as much as the refresh itself. Stored 0–1, the
 * scale of the Insights Opportunities card's 0.6 threshold.
 */
export const RELEVANCE_SCALE = 10;

/**
 * Below this a suggestion is never offered as an opportunity (Visibility spec
 * v2, fixed). Mirrors frontend/src/lib/insightsOpportunities.ts.
 */
export const RELEVANCE_THRESHOLD = 0.6;

/**
 * Share of the plan price that rating relevance may add to suggestion
 * refreshes each month (plan.limits.relevanceMonthlyBudgetUsd).
 */
export const RELEVANCE_BUDGET_SHARE = 0.001;

/**
 * What rating adds to one refresh attempt, rounded up so the budget is
 * charged at least what was spent: the rule and the schema field in the
 * input (~85 tokens); per suggestion in the output, `"relevance": 10,`
 * (~5 tokens) and the model's reasoning about it, which thinking models such
 * as Gemini 3 Flash bill as output (allowed ~15). The usage rows keep each
 * call's real tokens to check this against.
 */
export const RATING_TOKENS = { input: 120, perSuggestion: 20 };

/**
 * The model's rating as stored: rounded to a whole step and clamped, so an
 * out-of-range rating caps instead of failing the whole generated batch.
 * Null when the model gave none.
 */
export function toRelevance(rating) {
  if (rating === null || rating === undefined || rating === '') return null;
  const n = Number(rating);
  if (!Number.isFinite(n)) return null;
  return Math.min(RELEVANCE_SCALE, Math.max(0, Math.round(n))) / RELEVANCE_SCALE;
}

/** USD that rating adds to a refresh of `attempts` model calls. */
export function ratingCostUsd(modelId, { suggestions, attempts }) {
  return generationCostUsd(modelId, {
    inputTokens: RATING_TOKENS.input * attempts,
    outputTokens: RATING_TOKENS.perSuggestion * suggestions * attempts,
  });
}
