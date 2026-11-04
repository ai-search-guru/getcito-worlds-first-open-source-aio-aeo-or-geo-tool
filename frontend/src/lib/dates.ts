/**
 * Treat a bare `YYYY-MM-DD` dateTo as end-of-day in UTC. Postgres parses
 * a bare date string as 00:00:00 of that day, so `<= '2026-05-31'`
 * silently excludes everything that happened on May 31 itself. Callers
 * — date pickers, the in-product agent's tools, the MCP REST surface —
 * pass bare dates routinely; this helper expands them to `23:59:59.999Z`
 * so the rest of the day is included.
 *
 * Full ISO timestamps (`2026-05-31T15:30:00Z`) are passed through as-is
 * so callers that want a strict upper bound still get one.
 */
export function expandDateToEndOfDay(d?: string | null): string | undefined {
  if (!d) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d}T23:59:59.999Z`;
  return d;
}

/**
 * The UTC calendar day (`YYYY-MM-DD`) a timestamp falls on, for reads over
 * data stored by whole days, like the Analytics sync's. A bare day is
 * returned as it is; nothing, or something unparseable, gives undefined.
 */
export function utcDay(d?: string | null): string | undefined {
  if (!d) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const ms = Date.parse(d);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString().slice(0, 10);
}
