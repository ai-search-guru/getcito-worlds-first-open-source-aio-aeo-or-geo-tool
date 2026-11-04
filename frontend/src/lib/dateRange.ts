import type { DateRangePreset } from '@/components/filters/DateRangeFilter';

export interface DateRangeWindow {
  dateFrom?: string;
  dateTo?: string;
  days?: { dayFrom?: string; dayTo?: string };
}

/**
 * Every preset except 24h describes whole UTC calendar days, carried in
 * `days` — that is what lets the aggregate actions answer from the daily
 * rollup tables (00066) instead of rescanning the brand's history. The
 * timestamp fields are kept in step for the paths that still take
 * timestamps, so both paths describe the same window.
 *
 * A preset window is the trailing N calendar days ending today: numbers
 * move when a tracking run completes, not continuously as the clock's
 * trailing edge slides. 24h keeps its rolling window — it is anchored to
 * the last completed run downstream and stays on the raw path.
 */
export function getDateRange(
  preset: DateRangePreset,
  custom: { from: string; to: string },
): DateRangeWindow {
  if (preset === 'all') return { dateFrom: undefined, dateTo: undefined, days: {} };
  if (preset === 'custom') {
    return {
      dateFrom: custom.from ? `${custom.from}T00:00:00.000Z` : undefined,
      dateTo: custom.to ? `${custom.to}T23:59:59.999Z` : undefined,
      days: { dayFrom: custom.from || undefined, dayTo: custom.to || undefined },
    };
  }
  if (preset === '24h') {
    const from = new Date();
    from.setHours(from.getHours() - 24);
    return { dateFrom: from.toISOString(), dateTo: undefined };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const dayFrom = from.toISOString().slice(0, 10);
  const dayTo = to.toISOString().slice(0, 10);
  return { dateFrom: `${dayFrom}T00:00:00.000Z`, dateTo: undefined, days: { dayFrom, dayTo } };
}
