/**
 * The Tracked Prompts table's Positions cell (PROMPT-007): average mention
 * position over the selected range, its change against the previous period of
 * the same length, and one dot per platform.
 *
 * Pure on purpose: the server action loads per-platform sums
 * (prompt_position_summaries_json, 00153) and this turns them into the cell. The
 * average is the Positions panel's: the mean mention position over the
 * answers that mention the brand, on the plan-included platforms.
 */

import { positionTone } from '@/lib/positionTone';
import { MIN_MENTION_RATE } from '@/lib/promptImprove';

/** One platform's sums for one prompt over a window. */
export interface PlatformPositionRow {
  platform: string;
  runs: number;
  mentionAnswers: number;
  positionSum: number;
  positionCount: number;
  entitySum: number;
  entityCount: number;
}

/**
 * - early     mentioned, in the first third of the brands named
 * - late      mentioned, but further down
 * - mentioned mentioned, with no stored position
 * - missing   mentioned in fewer than half the runs, or never: the Improve
 *             tab's "Not mentioned" (MIN_MENTION_RATE)
 * - no_runs   nothing tracked in the window
 */
export type PlatformDotState = 'early' | 'late' | 'mentioned' | 'missing' | 'no_runs';

export interface PlatformDot {
  id: string;
  label: string;
  state: PlatformDotState;
  /** The platform's average position; null when not mentioned or unknown. */
  avg: number | null;
  runs: number;
  /** Runs that mention the brand, for "mentioned in 8 of 120 runs". */
  mentionedRuns: number;
}

/**
 * Where the brand stands in a prompt's answers across its platforms, for the
 * table's Performance filter. The dots' rule, over all the prompt's answers:
 * - best     named in the first third of the brands an answer lists
 * - good     named in the middle third, or named with no stored position
 * - late     named in the last third
 * - missing  named in fewer than half the runs, or never
 */
export type PromptPerformance = 'best' | 'good' | 'late' | 'missing';

export interface PromptPositionCell {
  /** Average mention position over the window; null when never ranked. */
  avg: number | null;
  /** Previous period's average minus this one: positive means it moved up. */
  delta: number | null;
  dots: PlatformDot[];
  /** Null when nothing was tracked in the window. */
  performance: PromptPerformance | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function average(rows: PlatformPositionRow[]): number | null {
  const sum = rows.reduce((a, r) => a + r.positionSum, 0);
  const count = rows.reduce((a, r) => a + r.positionCount, 0);
  return count > 0 ? round1(sum / count) : null;
}

function performanceOf(rows: PlatformPositionRow[]): PromptPerformance | null {
  const sum = (key: Exclude<keyof PlatformPositionRow, 'platform'>) =>
    rows.reduce((a, r) => a + r[key], 0);
  const runs = sum('runs');
  if (runs === 0) return null;
  if (sum('mentionAnswers') < runs * MIN_MENTION_RATE) return 'missing';
  const count = sum('positionCount');
  if (count === 0) return 'good';
  const rank = sum('positionSum') / count;
  const entities = sum('entityCount');
  const total = entities > 0 ? sum('entitySum') / entities : rank;
  const tone = positionTone(rank, Math.max(total, rank));
  return tone === 'Early' ? 'best' : tone === 'Mid' ? 'good' : 'late';
}

function dotState(row: PlatformPositionRow | undefined): PlatformDotState {
  if (!row || row.runs === 0) return 'no_runs';
  // Same rule as the Improve tab: #1 in 8 of 120 answers is mostly missing.
  if (row.mentionAnswers < row.runs * MIN_MENTION_RATE) return 'missing';
  if (row.positionCount === 0) return 'mentioned';
  const rank = row.positionSum / row.positionCount;
  const total = row.entityCount > 0 ? row.entitySum / row.entityCount : rank;
  return positionTone(rank, Math.max(total, rank)) === 'Early' ? 'early' : 'late';
}

/**
 * The cell for one prompt. `platforms` are the ones the prompt tracks that
 * the plan includes, in display order; rows for any other platform are
 * ignored, so the average matches the panel's.
 */
export function buildPositionCell(
  current: PlatformPositionRow[],
  previous: PlatformPositionRow[],
  platforms: { id: string; label: string }[],
): PromptPositionCell {
  const ids = new Set(platforms.map((p) => p.id));
  const now = current.filter((r) => ids.has(r.platform));
  const before = previous.filter((r) => ids.has(r.platform));
  const avg = average(now);
  const prev = average(before);
  const dots = platforms.map((p) => {
    const row = now.find((r) => r.platform === p.id);
    const state = dotState(row);
    return {
      id: p.id,
      label: p.label,
      state,
      avg:
        row && state !== 'missing' && row.positionCount > 0
          ? round1(row.positionSum / row.positionCount)
          : null,
      runs: row?.runs ?? 0,
      mentionedRuns: row?.mentionAnswers ?? 0,
    };
  });
  return {
    avg,
    delta: avg !== null && prev !== null ? round1(prev - avg) : null,
    dots,
    performance: performanceOf(now),
  };
}

/** What the Prompts table reads of a prompt's answers in the window. */
interface AnswerCounts {
  runs: number;
  mentionAnswers: number;
  citationAnswers: number;
}

/**
 * What the Prompts table's Positions cell shows: the average; for a prompt
 * tracked in the window but never named, "Cited only" when its pages were
 * cited and "Not mentioned" when not, as the panel's legend reads; or "—"
 * for one with no answers (or answers whose positions aren't stored).
 */
export function positionCellKind(
  cell: Pick<PromptPositionCell, 'avg'> | undefined,
  answers: AnswerCounts | undefined,
): 'average' | 'citedOnly' | 'notMentioned' | 'none' {
  if (cell && cell.avg !== null) return 'average';
  if (answers && answers.runs > 0 && answers.mentionAnswers === 0) {
    return answers.citationAnswers > 0 ? 'citedOnly' : 'notMentioned';
  }
  return 'none';
}

/**
 * Whether the row offers its positions panel: whenever the prompt has answers
 * in the window, so one never named can still be opened (to its "Not
 * mentioned" platforms and Improve).
 */
export function opensPositionsPanel(answers: AnswerCounts | undefined): boolean {
  return !!answers && answers.runs > 0;
}

/**
 * Orders prompts furthest behind first, for the Performance filter's Late and
 * Missing: first the prompts late or missing on the most platforms, then
 * those missing on more of them, then the worse average position, a prompt
 * never ranked counting as the furthest back. Negative when `a` is further
 * behind.
 */
export function compareLateness(
  a: PromptPositionCell | undefined,
  b: PromptPositionCell | undefined,
): number {
  const count = (cell: PromptPositionCell | undefined, states: PlatformDotState[]) =>
    cell?.dots.filter((d) => states.includes(d.state)).length ?? 0;
  const behind = (cell: PromptPositionCell | undefined) => cell?.avg ?? Number.POSITIVE_INFINITY;
  return (
    count(b, ['late', 'missing']) - count(a, ['late', 'missing']) ||
    count(b, ['missing']) - count(a, ['missing']) ||
    (behind(b) === behind(a) ? 0 : behind(b) > behind(a) ? 1 : -1)
  );
}

/** The previous period of the same length, ending where this one starts. */
export function previousWindow(window: { from: string; to?: string }, now = Date.now()) {
  const from = Date.parse(window.from);
  const to = window.to ? Date.parse(window.to) : now;
  const span = Math.max(0, to - from);
  return { from: new Date(from - span).toISOString(), to: new Date(from).toISOString() };
}
