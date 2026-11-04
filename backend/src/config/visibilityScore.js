/**
 * AI Visibility Score — the single source of truth for the blend on the
 * server side (Daily Pulse, reports summary snapshots).
 *
 * score = 100 × (w.mention × mention rate
 *              + w.citation × citation rate
 *              + w.position × position factor)
 *
 * Mirrors frontend/src/lib/visibilityScore.ts — keep the two in sync.
 */

export const VISIBILITY_SCORE_WEIGHTS = {
  mention: 0.6,
  citation: 0.25,
  position: 0.15,
};

/**
 * Evidence shrinkage for the position factor: the blend uses
 * pf × mentionAnswers / (mentionAnswers + POSITION_SUPPORT_ANSWERS), so the
 * position term needs a body of mentions before it pays out — a perfect
 * average over a handful of answers must not outrank entities that actually
 * show up. High-volume entities are untouched; only thin samples are damped.
 *
 * Calibrated at 20 (half strength at 20 mentioned answers) — see the web
 * mirror for the rationale.
 */
export const POSITION_SUPPORT_ANSWERS = 20;

/**
 * 0-100 score, one decimal. Returns null when the scope has no answers.
 * @param {{ answers: number, mentionAnswers: number, citationAnswers: number,
 *           positionFactor: number | null }} components
 */
export function computeAiVisibilityScore({
  answers,
  mentionAnswers,
  citationAnswers,
  positionFactor,
}) {
  if (!answers) return null;
  const w = VISIBILITY_SCORE_WEIGHTS;
  const positionSupport = mentionAnswers / (mentionAnswers + POSITION_SUPPORT_ANSWERS);
  const raw =
    100 *
    (w.mention * (mentionAnswers / answers) +
      w.citation * (citationAnswers / answers) +
      w.position * (positionFactor ?? 0) * positionSupport);
  return Math.round(raw * 10) / 10;
}
