/**
 * How the AI Traffic trend buckets a window (AT-017, spec §3.01): hour by
 * hour for a day or less, as the 24-hour range is; by day otherwise. Plain
 * functions, so the server's loaders and the client can share them.
 */

const HOUR_MS = 3_600_000;

/**
 * Whether a window reads hour by hour: a day or less, as the 24-hour range
 * is. An hour of slack keeps a window measured a little after its start on
 * hours. Longer windows read by day.
 */
export function isHourlyWindow(from: string | undefined, to: string): boolean {
  if (!from) return false;
  return Date.parse(to) - Date.parse(from) <= 25 * HOUR_MS;
}

/** The UTC hours a window touches, as "2026-10-17T13:00:00.000Z" keys. */
export function listUtcHours(from: string, to: string): string[] {
  const hours: string[] = [];
  const end = Date.parse(to);
  for (let t = Math.floor(Date.parse(from) / HOUR_MS) * HOUR_MS; t <= end; t += HOUR_MS) {
    hours.push(new Date(t).toISOString());
  }
  return hours;
}

/** The hour a timestamp falls in, as listUtcHours names it. */
export function utcHourKey(iso: string): string {
  return new Date(Math.floor(Date.parse(iso) / HOUR_MS) * HOUR_MS).toISOString();
}
