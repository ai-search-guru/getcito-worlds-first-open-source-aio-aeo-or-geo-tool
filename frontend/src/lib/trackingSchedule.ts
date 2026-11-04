/**
 * When a brand's tracking runs (VIS-012): the Insights header's "Last run
 * 11h ago · next run in 13h". Read from the tracking-run ledger (00044), so
 * the cloud and self-hosted installs work the same without knowing the cron.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A gap up to this long between scheduled runs is a schedule of its own; longer is daily. */
const SUB_DAILY_MAX = 20 * HOUR;

/**
 * When the next scheduled run is due: the last scheduled (cron) run's start
 * plus the schedule's period. Tracking runs once a day; a shorter gap between
 * the last two runs means a self-hosted install runs more often, and a longer
 * one is a missed day, not a slower schedule. Null without a scheduled run,
 * or once it's due (running now, or not coming on its own: a plan without
 * daily monitoring, a brand with no active prompts).
 *
 * @param cronStarts `started_at` of the latest scheduled runs, newest first
 */
export function nextScheduledRun(cronStarts: string[], now = Date.now()): string | null {
  const [last, prev] = cronStarts.map((s) => Date.parse(s)).filter(Number.isFinite);
  if (last === undefined) return null;
  const gap = prev === undefined ? DAY : Math.round((last - prev) / HOUR) * HOUR;
  const period = gap >= HOUR && gap <= SUB_DAILY_MAX ? gap : DAY;
  const next = last + period;
  return next > now ? new Date(next).toISOString() : null;
}

/**
 * The time until `iso`, as the header writes it: minutes under an hour,
 * hours under a day, days after that, each to the nearest, so 12h59m reads
 * "13h" and 59m30s reads "1h". Never less than a minute.
 */
export function timeUntil(
  iso: string,
  now = Date.now(),
): { unit: 'minutes' | 'hours' | 'days'; value: number } {
  const diff = Math.max(0, Date.parse(iso) - now);
  const minutes = Math.round(diff / MINUTE);
  if (minutes < 60) return { unit: 'minutes', value: Math.max(1, minutes) };
  const hours = Math.round(diff / HOUR);
  if (hours < 24) return { unit: 'hours', value: hours };
  return { unit: 'days', value: Math.round(diff / DAY) };
}
