import { dayIn, isTimeZone, nextDay, zonedInstant } from '@/lib/timeZone';

/**
 * When scheduled work runs (CHAT-12 items 1–2, 6; CHAT-21 §E item 22): the
 * RRULE subset an agent's Schedule trigger and a Chat schedule share, read
 * on a time zone's clock, and the next run of a scheduled job. Pure: no
 * database, no clock but the one passed in.
 *
 * The RRULE is a subset of RFC 5545 that needs no package: FREQ DAILY,
 * WEEKLY or MONTHLY; BYDAY (MO…SU) for a daily or weekly rule, which a
 * weekly one needs; BYMONTHDAY (1–28, or -1 for the month's last day) for a
 * monthly one, which needs it; one BYHOUR, and one BYMINUTE (0 when left
 * out). At most once a day, so a schedule never runs more often than a
 * person could read its results. Kept in that canonical order, so it reads
 * the same with a full RRULE library later. A rule keeps its local time
 * across daylight saving: 09:00 stays 09:00 on the zone's clock.
 */

export const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type RruleDay = (typeof RRULE_DAYS)[number];

export interface RecurringRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  /** Days of the week it runs on; null: every day (DAILY only). */
  byDay: RruleDay[] | null;
  /** The day of the month (MONTHLY): 1–28, or -1 for the last. */
  byMonthDay: number | null;
  hour: number;
  minute: number;
}

/** How far ahead a rule's next run is looked for: a monthly rule runs within this. */
const LOOKAHEAD_DAYS = 400;

const integer = (value: string, min: number, max: number): number | null => {
  if (!/^-?\d{1,2}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
};

/** The rule an RRULE text says, or null for one outside the subset (above). */
export function parseRecurringRule(text: string): RecurringRule | null {
  const body = text.trim().replace(/^RRULE:/, '');
  if (!body || body.length > 200) return null;
  const parts = new Map<string, string>();
  for (const part of body.split(';')) {
    const [key, value, extra] = part.split('=');
    if (!key || value === undefined || extra !== undefined || parts.has(key)) return null;
    parts.set(key, value);
  }
  const known = new Set(['FREQ', 'BYDAY', 'BYMONTHDAY', 'BYHOUR', 'BYMINUTE']);
  if ([...parts.keys()].some((key) => !known.has(key))) return null;

  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;
  const hourText = parts.get('BYHOUR');
  const hour = hourText === undefined ? null : integer(hourText, 0, 23);
  if (hour === null) return null;
  const minuteText = parts.get('BYMINUTE');
  const minute = minuteText === undefined ? 0 : integer(minuteText, 0, 59);
  if (minute === null) return null;

  let byDay: RruleDay[] | null = null;
  const dayText = parts.get('BYDAY');
  if (dayText !== undefined) {
    if (freq === 'MONTHLY') return null;
    const days = dayText.split(',');
    if (days.some((d) => !RRULE_DAYS.includes(d as RruleDay))) return null;
    if (new Set(days).size !== days.length) return null;
    byDay = RRULE_DAYS.filter((d) => days.includes(d));
  }
  if (freq === 'WEEKLY' && !byDay) return null;

  let byMonthDay: number | null = null;
  const monthDayText = parts.get('BYMONTHDAY');
  if (monthDayText !== undefined) {
    if (freq !== 'MONTHLY') return null;
    byMonthDay = monthDayText === '-1' ? -1 : integer(monthDayText, 1, 28);
    if (byMonthDay === null) return null;
  }
  if (freq === 'MONTHLY' && byMonthDay === null) return null;

  return { freq, byDay, byMonthDay, hour, minute };
}

/** The rule as its canonical RRULE text: FREQ;BYDAY;BYMONTHDAY;BYHOUR;BYMINUTE. */
export function formatRecurringRule(rule: RecurringRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.byDay) parts.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.byMonthDay !== null) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  parts.push(`BYHOUR=${rule.hour}`, `BYMINUTE=${rule.minute}`);
  return parts.join(';');
}

/** The RRULE day a calendar date falls on. */
function weekdayOf(day: string): RruleDay {
  // getUTCDay: 0 is Sunday.
  return RRULE_DAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];
}

function firesOn(rule: RecurringRule, day: string): boolean {
  if (rule.freq === 'MONTHLY') {
    if (rule.byMonthDay === -1) return nextDay(day).endsWith('-01');
    return Number(day.slice(8, 10)) === rule.byMonthDay;
  }
  return !rule.byDay || rule.byDay.includes(weekdayOf(day));
}

/** The first time after `after` the rule runs in `timeZone`, as an ISO instant. */
export function nextRecurringFire(
  rule: RecurringRule,
  timeZone: string,
  after: Date,
): string | null {
  const afterMs = after.getTime();
  // From the day before, in case the zone's clock is still on it.
  let day = dayIn(afterMs - 86_400_000, timeZone);
  for (let i = 0; i < LOOKAHEAD_DAYS; i++, day = nextDay(day)) {
    if (!firesOn(rule, day)) continue;
    const at = zonedInstant(day, rule.hour, rule.minute, timeZone);
    if (Date.parse(at) > afterMs) return at;
  }
  return null;
}

/** A scheduled job as its next run is worked out (chat_schedules). */
export interface JobTiming {
  kind: string;
  rrule: string | null;
  timezone: string;
}

/**
 * A scheduled job's next run after `after`: a recurring job's next slot on
 * its zone's clock; a one-time job (once, follow-up check) has none once it
 * ran. Null too for a rule or a zone that doesn't read (`unreadable`), which
 * the worker turns off rather than guess.
 */
export function nextJobRun(
  job: JobTiming,
  after: Date,
): { at: string | null; unreadable: boolean } {
  if (job.kind !== 'recurring') return { at: null, unreadable: false };
  const rule = job.rrule ? parseRecurringRule(job.rrule) : null;
  if (!rule || !isTimeZone(job.timezone)) return { at: null, unreadable: true };
  const at = nextRecurringFire(rule, job.timezone, after);
  return { at, unreadable: at === null };
}
