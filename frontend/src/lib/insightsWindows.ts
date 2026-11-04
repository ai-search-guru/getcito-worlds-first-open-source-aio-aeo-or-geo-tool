import { expandDateToEndOfDay } from '@/lib/dates';

// ── Daily-rollup routing (00066) ────────────────────────────────────────────
//
// The aggregate RPCs used to rescan a brand's whole history per page load;
// past ~55k results that exceeds the authenticated role's 8s statement
// timeout and the wide presets die. Presets describe their rollup windows as
// whole UTC days (24h uses the latest completed run's day(s)), and calls that
// carry one are answered from the daily tables — cost scales with days in the window,
// never with accumulated results.
//
// Topic-filtered calls are served from the rollups too (00164): with
// p_topic_id the *_daily reads answer from the prompt-grain tables, keyed
// through each prompt's current topic, so reassigning a prompt still moves
// its history. Every daily call must pass p_topic_id along — without it the
// rollup answers for the whole brand.

/**
 * Whole-day UTC window, 'YYYY-MM-DD' inclusive on both ends. Its presence in
 * an action's opts marks the call as servable from the daily rollups; either
 * bound may be absent (the All-time preset carries an empty window).
 */
export interface DayWindow {
  dayFrom?: string;
  dayTo?: string;
}

export interface WindowedOpts {
  topicId?: string;
  days?: DayWindow;
  /** Previous completed run's day window, when a view is anchored to a run. */
  previousDays?: DayWindow;
}

/** The day window to serve from rollups, or null when the raw path must answer. */
export function dailyWindow(opts?: WindowedOpts): DayWindow | null {
  return opts?.days ?? null;
}

export const DAY_MS = 86_400_000;

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Current + previous equal-length day windows for the ↑/↓ delta math. An
 * unbounded window anchors to the trailing 7 days, mirroring what the raw
 * path's `now() - 7d` default has always compared against. When a previous
 * completed run's window is supplied, use it instead of deriving an adjacent
 * equal-length period — but only when it ends before the current one starts:
 * two runs on the same UTC day (the nightly one, then a Run All) would
 * otherwise compare the day with itself and read every change as 0. The
 * previous window ends the day BEFORE the current one starts by default — the
 * raw path's timestamp arithmetic let the two windows share their boundary
 * instant.
 */
export function deltaDayWindows(
  days: DayWindow,
  previousDays?: DayWindow,
): {
  cur: { dayFrom: string; dayTo: string };
  prev: { dayFrom: string; dayTo: string };
} {
  const curTo = days.dayTo ?? utcToday();
  const curFrom = days.dayFrom ?? addDays(curTo, -6);
  const len = Math.round((Date.parse(curTo) - Date.parse(curFrom)) / DAY_MS) + 1;
  const prevTo = addDays(curFrom, -1);
  const defaultPrev = { dayFrom: addDays(prevTo, -(len - 1)), dayTo: prevTo };
  const prev =
    previousDays?.dayFrom && previousDays?.dayTo && previousDays.dayTo < curFrom
      ? { dayFrom: previousDays.dayFrom, dayTo: previousDays.dayTo }
      : defaultPrev;
  return {
    cur: { dayFrom: curFrom, dayTo: curTo },
    prev,
  };
}

// ── Comparison windows (VIS-001) ────────────────────────────────────────────

/**
 * One window an Insights number is computed over: whole UTC days, answered
 * from the daily rollups, or a timestamp range, answered from the raw rows
 * (the 24h view). An absent bound is open.
 */
export type MetricWindow =
  | { kind: 'days'; days: DayWindow }
  | { kind: 'range'; from?: string; to?: string };

export interface ComparisonWindows {
  /** The window the number on screen covers. */
  cur: MetricWindow;
  /** The previous comparison window; null for All time, which has none. */
  prev: MetricWindow | null;
  /** Length of `cur` in days (24h is 1); null for All time. */
  windowDays: number | null;
}

/**
 * The windows behind the Visibility number and its change. The card, the
 * breakdown panel and the leaderboard all take their windows from here, so
 * the same filters always compare the same answers (VIS-001).
 *
 * - Whole-day windows compare against the equal run of whole days ending
 *   the day before by default (deltaDayWindows), or a supplied previous run.
 * - Timestamp windows compare against the equal span ending where the
 *   current one starts.
 * - All time has no previous window: there is no earlier period of the same
 *   length to compare with, so it shows no change at all.
 */
export function comparisonWindows(
  opts?: WindowedOpts & { dateFrom?: string; dateTo?: string },
  now: Date = new Date(),
): ComparisonWindows {
  const daily = dailyWindow(opts);
  if (daily) {
    if (!daily.dayFrom) return { cur: { kind: 'days', days: daily }, prev: null, windowDays: null };
    const { cur, prev } = deltaDayWindows(daily, opts?.previousDays);
    return {
      cur: { kind: 'days', days: daily },
      prev: { kind: 'days', days: prev },
      windowDays: dayCount(cur),
    };
  }

  const from = opts?.dateFrom || undefined;
  const to = expandDateToEndOfDay(opts?.dateTo) ?? now.toISOString();
  if (!from) return { cur: { kind: 'range', from: undefined, to }, prev: null, windowDays: null };
  const span = Date.parse(to) - Date.parse(from);
  return {
    cur: { kind: 'range', from, to },
    prev: { kind: 'range', from: new Date(Date.parse(from) - span).toISOString(), to: from },
    windowDays: Math.max(1, Math.round(span / DAY_MS)),
  };
}

function dayCount(days: { dayFrom: string; dayTo: string }): number {
  return Math.round((Date.parse(days.dayTo) - Date.parse(days.dayFrom)) / DAY_MS) + 1;
}

/**
 * A window's bounds for display: 'YYYY-MM-DD' UTC days for whole-day
 * windows, ISO timestamps otherwise; '' for an open bound.
 */
export function windowBounds(win: MetricWindow): { from: string; to: string } {
  return win.kind === 'days'
    ? { from: win.days.dayFrom ?? '', to: win.days.dayTo ?? '' }
    : { from: win.from ?? '', to: win.to ?? '' };
}

/**
 * The Visibility number and its change, from the scores of the two windows.
 * An empty current window reads as 0 (the card has always shown a number);
 * the change is null when there is nothing to compare with.
 */
export function visibilityChange(
  curScore: number | null,
  prevScore: number | null,
): { value: number; prev: number | null; change: number | null } {
  const value = curScore ?? 0;
  return {
    value,
    prev: prevScore,
    change: prevScore === null ? null : Math.round((value - prevScore) * 10) / 10,
  };
}
