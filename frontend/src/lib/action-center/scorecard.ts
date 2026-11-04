/**
 * The History tab's scorecard (learning B3): what each kind of action did at
 * this brand.
 *
 * One row per kind, summed by the action_scorecard RPC (00368) from the
 * brand's own actions only — never another brand's. A kind with only a
 * couple of results says so rather than a rate: two actions can't tell
 * whether a kind of work pays off here.
 */

import { ACTION_DISMISS_REASONS, type ActionDismissReason } from './registry';

/** Results with a verdict a kind needs before its success rate is shown. */
export const MIN_SCORECARD_VERDICTS = 3;

export interface ScorecardRow {
  kind: string;
  completed: number;
  improved: number;
  mixed: number;
  noChange: number;
  declined: number;
  notMeasurable: number;
  /** Completed, not read yet. */
  pending: number;
  /** Completed and read for the last time, a month on (learning B1). */
  final: number;
  /** The median relative change in each one's main metric: 0.15 is +15%. */
  medianChange: number | null;
  dismissed: number;
  /** Dismissals by the reason given (learning A5); `none` when none was. */
  dismissReasons: Partial<Record<ActionDismissReason | 'none', number>>;
}

/** Its results with a verdict: improved, mixed, no change or declined. */
export function verdicts(row: ScorecardRow): number {
  return row.improved + row.mixed + row.noChange + row.declined;
}

/** The share of its verdicts that improved, 0–100; null below the minimum. */
export function successRate(row: ScorecardRow): number | null {
  const total = verdicts(row);
  if (total < MIN_SCORECARD_VERDICTS) return null;
  return Math.round((row.improved / total) * 100);
}

/** The reason given most often for dismissing it; ties go to the list's order. */
export function topDismissReason(row: ScorecardRow): ActionDismissReason | null {
  let top: ActionDismissReason | null = null;
  for (const reason of ACTION_DISMISS_REASONS) {
    const count = row.dismissReasons[reason] ?? 0;
    if (count > 0 && (top === null || count > (row.dismissReasons[top] ?? 0))) top = reason;
  }
  return top;
}

/** Busiest kinds first, then the better rate; the kind's id keeps it stable. */
export function sortScorecard(rows: ScorecardRow[]): ScorecardRow[] {
  return [...rows].sort(
    (a, b) =>
      b.completed + b.dismissed - (a.completed + a.dismissed) ||
      (successRate(b) ?? -1) - (successRate(a) ?? -1) ||
      a.kind.localeCompare(b.kind),
  );
}

const count = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** One RPC row in the shape the table reads; null when it names no kind. */
export function parseScorecardRow(raw: unknown): ScorecardRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.kind !== 'string' || !row.kind) return null;
  const change = row.median_change == null ? null : Number(row.median_change);
  const reasons: ScorecardRow['dismissReasons'] = {};
  if (row.dismiss_reasons && typeof row.dismiss_reasons === 'object') {
    const given = row.dismiss_reasons as Record<string, unknown>;
    for (const reason of [...ACTION_DISMISS_REASONS, 'none'] as const) {
      if (count(given[reason])) reasons[reason] = count(given[reason]);
    }
  }
  return {
    kind: row.kind,
    completed: count(row.completed),
    improved: count(row.improved),
    mixed: count(row.mixed),
    noChange: count(row.no_change),
    declined: count(row.declined),
    notMeasurable: count(row.not_measurable),
    pending: count(row.pending),
    final: count(row.final),
    medianChange: change != null && Number.isFinite(change) ? change : null,
    dismissed: count(row.dismissed),
    dismissReasons: reasons,
  };
}
