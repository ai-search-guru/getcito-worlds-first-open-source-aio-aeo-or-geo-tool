import type { PositionsSummary } from './promptPositions';

/**
 * Whether a tracked prompt calls for content, and which, in the Positions
 * panel's period (the user's thresholds, 2026-10-22). No answer mentions or
 * cites the brand: write a page for it. The brand is mentioned rarely, or
 * late: optimize the page AI cites for it, or one picked in Start. Fewer
 * answers than a threshold needs say nothing either way.
 */

/** Mentioned in fewer than this share of the answers is rarely… */
export const RARE_SHARE = 0.2;
/** …once there are this many answers. */
export const MIN_ANSWERS = 5;
/** An average position after this one is late… */
export const LATE_POSITION = 3;
/** …over this many answers that place the brand. */
export const MIN_PLACED = 3;

export type ContentStep =
  | { kind: 'create'; answers: number }
  | { kind: 'optimize'; reason: 'rare'; mentionPct: number; answers: number }
  | { kind: 'optimize'; reason: 'late'; position: number };

export function contentStep(
  summary: Pick<
    PositionsSummary,
    'answers' | 'mentionedAnswers' | 'citedAnswers' | 'mentionPosition'
  >,
): ContentStep | null {
  const { answers, mentionedAnswers, citedAnswers, mentionPosition } = summary;
  if (answers === 0) return null;
  if (mentionedAnswers === 0 && citedAnswers === 0) return { kind: 'create', answers };
  if (answers >= MIN_ANSWERS && mentionedAnswers / answers < RARE_SHARE) {
    // Rounded down, so a share under the line never reads as 20%.
    const mentionPct = Math.floor((mentionedAnswers / answers) * 100);
    return { kind: 'optimize', reason: 'rare', mentionPct, answers };
  }
  if (
    mentionPosition &&
    mentionPosition.count >= MIN_PLACED &&
    mentionPosition.avg > LATE_POSITION
  ) {
    return { kind: 'optimize', reason: 'late', position: mentionPosition.avg };
  }
  return null;
}
