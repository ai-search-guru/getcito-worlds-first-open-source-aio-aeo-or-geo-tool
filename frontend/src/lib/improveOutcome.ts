/**
 * An Improve action's position outcome (PROMPT-008), as the server's daily
 * sweep stores it on `actions.position_outcome` (improveOutcome.js): the
 * prompt's last 7 days per platform next to the baseline taken at send time.
 *
 * Pure on purpose: the Outcome card, the Positions panel and History all read
 * the same stored value through these helpers.
 */

export type OutcomeVerdict = 'improved' | 'declined' | 'unchanged' | 'not_enough_data';

/** One 7-day read of one platform. */
export interface PlatformRead {
  platform: string;
  state: string;
  runs: number;
  mentionedRuns: number;
  mentionPosition: number | null;
}

export interface OutcomePlatform {
  platform: string;
  before: PlatformRead;
  after: PlatformRead | null;
  verdict: OutcomeVerdict;
}

export interface ImproveOutcome {
  measuredAt: string;
  window: { from: string; to: string };
  /** The read 30 days after completion; it is not refreshed again. */
  final: boolean;
  platforms: OutcomePlatform[];
  summary: {
    total: number;
    measurable: number;
    improved: number;
    declined: number;
    /** Mean position over the platforms ranked on both sides. */
    avgBefore: number | null;
    avgAfter: number | null;
  };
}

const VERDICTS: OutcomeVerdict[] = ['improved', 'declined', 'unchanged', 'not_enough_data'];

const isRead = (v: unknown): v is PlatformRead =>
  !!v && typeof v === 'object' && typeof (v as PlatformRead).platform === 'string';

/** The stored JSON, or null when it is missing or not the shape this build reads. */
export function parseImproveOutcome(value: unknown): ImproveOutcome | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ImproveOutcome>;
  if (typeof v.measuredAt !== 'string' || !Array.isArray(v.platforms) || !v.summary) return null;
  const platforms = v.platforms.filter(
    (p): p is OutcomePlatform =>
      !!p &&
      typeof p.platform === 'string' &&
      isRead(p.before) &&
      (p.after === null || isRead(p.after)) &&
      VERDICTS.includes(p.verdict),
  );
  return { ...(v as ImproveOutcome), final: !!v.final, platforms };
}

/** How one side of a row reads: "#2.0", "Not mentioned", "Mentioned" or "No runs". */
export type ReadLabel =
  | { kind: 'position'; value: string }
  | { kind: 'not_mentioned' }
  | { kind: 'mentioned' }
  | { kind: 'no_runs' };

/**
 * "Not mentioned" follows the Improve tab's rule, as the verdict does: the
 * server's `state` is not_mentioned when the brand is in fewer than half the
 * runs, so 1 mention in 10 runs reads "Not mentioned", not its position.
 */
export function readLabel(read: PlatformRead | null): ReadLabel {
  if (!read || !read.runs) return { kind: 'no_runs' };
  if (read.state === 'not_mentioned' || !read.mentionedRuns) return { kind: 'not_mentioned' };
  if (read.mentionPosition === null) return { kind: 'mentioned' };
  return { kind: 'position', value: `#${read.mentionPosition.toFixed(1)}` };
}

/** Platform id → name, from the platforms an Improve action's payload lists. */
export function improvePlatformLabels(
  payload: Record<string, unknown> | null,
): Record<string, string> {
  const platforms = Array.isArray(payload?.platforms) ? payload.platforms : [];
  const labels: Record<string, string> = {};
  for (const p of platforms as { id?: unknown; label?: unknown }[]) {
    if (typeof p?.id === 'string' && typeof p.label === 'string') labels[p.id] = p.label;
  }
  return labels;
}

/** What the Positions panel says about an Improve action still being tracked. */
export interface ImprovingAction {
  actionId: string;
  actionNo: number;
  avgBefore: number | null;
  avgAfter: number | null;
}

const TRACKED = ['new', 'in_progress', 'on_hold', 'completed'];

/**
 * The newest of a prompt's Improve actions that is still tracked: open, or
 * completed with its final read not yet taken. Dismissed ones never count.
 */
export function pickImprovingAction(
  rows: { id: string; action_no: number; status: string; position_outcome: unknown }[],
): ImprovingAction | null {
  for (const row of rows) {
    if (!TRACKED.includes(row.status)) continue;
    const outcome = parseImproveOutcome(row.position_outcome);
    if (outcome?.final) continue;
    return {
      actionId: row.id,
      actionNo: Number(row.action_no),
      avgBefore: outcome?.summary.avgBefore ?? null,
      avgAfter: outcome?.summary.avgAfter ?? null,
    };
  }
  return null;
}
