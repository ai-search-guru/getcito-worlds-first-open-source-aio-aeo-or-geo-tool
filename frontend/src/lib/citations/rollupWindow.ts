/**
 * Which window of the Citations daily rollups (00118) answers a filter set.
 *
 * Windows are whole UTC days, as on Insights: 7/30/90 days count today, and
 * 24h is the latest completed tracking run's day(s), which the caller looks
 * up (`'latest-run'`). Null means the raw functions must answer: a
 * single-prompt filter, which the rollups don't carry and which keeps the raw
 * read small.
 */

export type RollupDatePreset = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom';

export interface RollupWindowFilters {
  datePreset: RollupDatePreset;
  dateFrom?: string;
  dateTo?: string;
  promptIds?: string[];
}

export interface DayWindow {
  dayFrom?: string;
  dayTo?: string;
}

const PRESET_DAYS: Partial<Record<RollupDatePreset, number>> = { '7d': 7, '30d': 30, '90d': 90 };

/** UTC calendar day of a date, as 'YYYY-MM-DD'. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function rollupDayWindow(
  filters: RollupWindowFilters,
  now: Date = new Date(),
): DayWindow | 'latest-run' | null {
  if (filters.promptIds && filters.promptIds.length > 0) return null;
  if (filters.datePreset === '24h') return 'latest-run';
  if (filters.datePreset === 'all') return {};
  if (filters.datePreset === 'custom') {
    return {
      dayFrom: filters.dateFrom ? filters.dateFrom.slice(0, 10) : undefined,
      dayTo: filters.dateTo ? filters.dateTo.slice(0, 10) : undefined,
    };
  }
  const days = PRESET_DAYS[filters.datePreset] ?? 30;
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { dayFrom: utcDay(from), dayTo: utcDay(now) };
}

/** The days a completed run touched: from its start day through its completion day. */
export function runDayWindow(run: { started_at: string; completed_at: string }): DayWindow {
  return { dayFrom: utcDay(new Date(run.started_at)), dayTo: utcDay(new Date(run.completed_at)) };
}
