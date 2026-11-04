import type { AuditAutoStatus } from '@/lib/actions/audits';

/**
 * Where an auto-audit run of the billing month stands (SA-006): done once
 * recorded; missed when its turn ended without a run (auto-audit was off
 * then, or not out yet); next for the first one still to come; upcoming
 * after it.
 */
export type AutoRunState = 'done' | 'missed' | 'next' | 'upcoming';

type AutoSchedule = Pick<AuditAutoStatus, 'runs' | 'periodEnd'>;

/** A run's turn lasts until the next one starts, the last one's until the month ends (autoAudit.js). */
const turnEnds = (auto: AutoSchedule) =>
  auto.runs.map((_, i) => Date.parse(auto.runs[i + 1]?.at ?? auto.periodEnd));

/** The month's five runs with their state at `now`, for the quota card's dots. */
export function autoRunStates(
  auto: AutoSchedule,
  now: Date,
): { day: number; at: string; state: AutoRunState }[] {
  const ends = turnEnds(auto);
  let nextFound = false;
  return auto.runs.map((run, i) => {
    let state: AutoRunState = 'upcoming';
    if (run.done) state = 'done';
    else if (ends[i] <= now.getTime()) state = 'missed';
    else if (!nextFound) {
      state = 'next';
      nextFound = true;
    }
    return { day: run.day, at: run.at, state };
  });
}

export interface NextAutoRun {
  /** The day its turn starts: this month's next run, or next month's first. */
  at: string;
  /**
   * Its turn has started but it hasn't run: auto-audit was turned on after
   * that morning's sweep, say. The next daily sweep takes it, within a day,
   * so it isn't "today".
   */
  soon: boolean;
}

/**
 * The next run: the first of this month still to come, else the next
 * billing month's first, on the day this one ends. Counted whether or not
 * auto-audit is on, so turning it on can say when it starts.
 */
export function nextAutoRun(auto: AutoSchedule, now: Date): NextAutoRun {
  const ends = turnEnds(auto);
  const i = auto.runs.findIndex((run, j) => !run.done && ends[j] > now.getTime());
  if (i === -1) return { at: auto.periodEnd, soon: false };
  const { at } = auto.runs[i];
  return { at, soon: Date.parse(at) <= now.getTime() };
}
