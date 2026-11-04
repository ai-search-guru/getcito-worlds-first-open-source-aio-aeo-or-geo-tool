/**
 * Calendar days in the viewer's time zone, for the prompts pages: the
 * Positions panel's days and the custom date ranges follow the viewer's
 * clock, as the answer times on the prompt detail page already do. Every
 * function takes the IANA zone, so the rules are tested in fixed zones; the
 * browser passes its own (`viewerTimeZone`).
 */

/** The viewer's IANA time zone, or UTC when it can't be read. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Whether `timeZone` is an IANA zone this runtime knows. */
export function isTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** The wall clock an instant shows in `timeZone`, field by field. */
function wallClock(ms: number, timeZone: string) {
  let fmt = formats.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formats.set(timeZone, fmt);
  }
  const fields: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year ?? NaN,
    month: fields.month ?? NaN,
    day: fields.day ?? NaN,
    hour: fields.hour ?? NaN,
    minute: fields.minute ?? NaN,
    second: fields.second ?? NaN,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The calendar date, YYYY-MM-DD, an instant falls on in `timeZone`. */
export function dayIn(instant: string | number, timeZone: string): string {
  const { year, month, day } = wallClock(new Date(instant).getTime(), timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** How far `timeZone`'s clock is ahead of UTC at an instant, in ms. */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  const wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
}

const HALF_DAY_MS = 43_200_000;

/**
 * When a calendar date starts in `timeZone`, as an ISO instant. Midnight is
 * tried with the offsets in force half a day either side, which covers a
 * daylight-saving change that night; the earliest that reads as `day` wins.
 * Where the clocks jump over midnight itself, that is the jump.
 */
export function startOfDayIn(day: string, timeZone: string): string {
  const midnight = Date.parse(`${day}T00:00:00.000Z`);
  const candidates = [midnight - HALF_DAY_MS, midnight, midnight + HALF_DAY_MS].map(
    (at) => midnight - offsetAt(at, timeZone),
  );
  const onDay = candidates.filter((t) => dayIn(t, timeZone) === day);
  return new Date(Math.min(...(onDay.length ? onDay : candidates))).toISOString();
}

/**
 * When `timeZone`'s clock reads `hour`:`minute` on a calendar date, as an ISO
 * instant: a scheduled time ("every Monday 09:00, Istanbul"). The offsets in
 * force half a day either side are tried, as startOfDayIn does. A time the
 * clocks pass twice (autumn) is the first; one they skip (spring) is that
 * long after, on the new clock (02:30 → 03:30).
 */
export function zonedInstant(day: string, hour: number, minute: number, timeZone: string): string {
  const wall = Date.parse(`${day}T00:00:00.000Z`) + (hour * 60 + minute) * 60_000;
  const candidates = [wall - HALF_DAY_MS, wall + HALF_DAY_MS].map(
    (at) => wall - offsetAt(at, timeZone),
  );
  const exact = candidates.filter((t) => t + offsetAt(t, timeZone) === wall);
  return new Date(exact.length ? Math.min(...exact) : Math.max(...candidates)).toISOString();
}

/** The last millisecond of a calendar date in `timeZone`, as an ISO instant. */
export function endOfDayIn(day: string, timeZone: string): string {
  return new Date(Date.parse(startOfDayIn(nextDay(day), timeZone)) - 1).toISOString();
}

/**
 * A custom range's YYYY-MM-DD inputs as instants: from the start of the first
 * day to the end of the last, on `timeZone`'s clock. An empty or invalid
 * input leaves its side open (undefined).
 */
export function dayRangeBounds(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): { from?: string; to?: string } {
  return {
    from: isCalendarDay(from) ? startOfDayIn(from, timeZone) : undefined,
    to: isCalendarDay(to) ? endOfDayIn(to, timeZone) : undefined,
  };
}

/** Whether `value` is a real calendar date written YYYY-MM-DD. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  // Rolled-over dates (Feb 30 → Mar 2) don't read back the same.
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** The calendar date after `day`. Pure date arithmetic, no zone involved. */
export function nextDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
