/**
 * AI Visibility Score — the single source of truth for the blend.
 *
 * score = 100 × (w.mention × mention rate
 *              + w.citation × citation rate
 *              + w.position × position factor)
 *
 * - mention rate / citation rate: share of answers (0..1) naming / citing
 *   the entity — deterministic parse-time detection, no LLM judges.
 * - position factor: mean of 1/mention_position over answers that name the
 *   entity (0..1; 1 = always named first). Null when never named. Before it
 *   enters the blend it is shrunk by the evidence behind it (see
 *   POSITION_SUPPORT_ANSWERS) — a perfect average over a handful of answers
 *   must not outrank entities that actually show up.
 *
 * The same formula applies to ANY answer set — brand-wide, per prompt, per
 * topic, per platform, per day — which is what keeps every surface's number
 * identical for the same scope and window.
 *
 * Mirrors backend/src/config/visibilityScore.js — keep the two in sync.
 */

export const VISIBILITY_SCORE_WEIGHTS = {
  mention: 0.6,
  citation: 0.25,
  position: 0.15,
} as const;

/**
 * Evidence shrinkage for the position factor: the blend uses
 * pf × mentionAnswers / (mentionAnswers + POSITION_SUPPORT_ANSWERS), so the
 * position term needs a body of mentions before it pays out. Without this, a
 * competitor named first in 6 of 16k answers scored a flat 15-point position
 * floor and ranked above one named in 500+. High-volume entities are
 * untouched; only thin samples are damped.
 *
 * Calibrated at 20 (half strength at 20 mentioned answers): at 10, a perfect
 * position over ~6 answers still edged out an entity mentioned 4× more often
 * in mid positions — presence should win that comparison.
 */
export const POSITION_SUPPORT_ANSWERS = 20;

export interface VisibilityScoreComponents {
  /** Total answers in the scope (the shared denominator). */
  answers: number;
  /** Answers with >= 1 mention of the entity. */
  mentionAnswers: number;
  /** Answers citing the entity's own domain. */
  citationAnswers: number;
  /** Mean of 1/position over mentioning answers; null when never mentioned. */
  positionFactor: number | null;
}

/** 0-100 score, one decimal. Returns null when the scope has no answers. */
export function computeAiVisibilityScore(c: VisibilityScoreComponents): number | null {
  if (!c.answers) return null;
  const w = VISIBILITY_SCORE_WEIGHTS;
  const positionSupport = c.mentionAnswers / (c.mentionAnswers + POSITION_SUPPORT_ANSWERS);
  const raw =
    100 *
    (w.mention * (c.mentionAnswers / c.answers) +
      w.citation * (c.citationAnswers / c.answers) +
      w.position * (c.positionFactor ?? 0) * positionSupport);
  return Math.round(raw * 10) / 10;
}
