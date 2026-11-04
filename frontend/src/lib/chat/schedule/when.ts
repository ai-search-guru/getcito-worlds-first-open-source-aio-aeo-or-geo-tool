import { dayIn, isCalendarDay, isTimeZone, nextDay, zonedInstant } from '@/lib/timeZone';
import {
  RRULE_DAYS,
  formatRecurringRule,
  nextRecurringFire,
  parseRecurringRule,
  type RecurringRule,
  type RruleDay,
} from './rule';

/**
 * A date phrase read into a schedule (CHAT-12 items 1–6; W3-02): "every
 * Monday at 9", "have it ready by Monday", "in 3 working days". Pure and
 * deterministic: no clock but the `now` passed in, read on the person's
 * time zone, so the browser's form and the server read a phrase the same.
 *
 *   - A day with no time is 09:00 on that zone's clock (item 3).
 *   - "in 3 days" counts calendar days; "in 3 working days" Monday to
 *     Friday, holidays not skipped (item 4).
 *   - "ready by …" / "by …" starts the work now, due then (ready_by); other
 *     one-time phrases run at that time (run_at). Wave 3 decision: ready_by
 *     starts at once and shows its due time; nothing is worked out backward.
 *   - A recurring phrase is the RRULE subset of rule.ts: daily, weekdays,
 *     weekly on days, monthly on a day (1–28) or the last; at most once a
 *     day (item 6). It keeps its local time across daylight saving.
 *   - A phrase that could mean two dates ("next Friday", "the 31st") is
 *     `ambiguous` with its likely dates, for a question card: never a guess
 *     (item 5). One in the past, too far ahead or more than once a day is
 *     refused with its reason.
 *
 * Phrases are English: Chat hands the tool the person's words in English.
 */

/** What a phrase schedules: once at a time (run at it, or ready by it), or on a rule. */
export type ScheduleWhen =
  | { kind: 'once'; runMode: 'run_at' | 'ready_by'; dueAt: string }
  | { kind: 'recurring'; rrule: string };

/** One of an ambiguous phrase's likely readings: a phrase that reads back, and its first run. */
export interface WhenOption {
  phrase: string;
  at: string;
}

export type WhenProblem = 'ambiguous' | 'past' | 'too_far' | 'too_often' | 'unreadable';

export type WhenReading =
  | { ok: true; when: ScheduleWhen }
  | { ok: false; problem: 'ambiguous'; options: WhenOption[] }
  | { ok: false; problem: Exclude<WhenProblem, 'ambiguous'> };

/** The longest phrase read. */
export const WHEN_MAX_LENGTH = 200;
/** How far ahead a one-time job may be set (as an agent's one-off schedule). */
export const ONCE_MAX_AHEAD_DAYS = 366;
/** A day with no time (item 3). */
const DEFAULT_TIME = { hour: 9, minute: 0 };

const DAY_MS = 86_400_000;

const DAY_WORDS: Record<string, RruleDay> = {
  monday: 'MO',
  mon: 'MO',
  tuesday: 'TU',
  tue: 'TU',
  tues: 'TU',
  wednesday: 'WE',
  wed: 'WE',
  thursday: 'TH',
  thu: 'TH',
  thur: 'TH',
  thurs: 'TH',
  friday: 'FR',
  fri: 'FR',
  saturday: 'SA',
  sat: 'SA',
  sunday: 'SU',
  sun: 'SU',
};

const MONTH_WORDS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fourteen: 14,
  thirty: 30,
};

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

interface Clock {
  hour: number;
  minute: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const clockText = ({ hour, minute }: Clock) => `${pad(hour)}:${pad(minute)}`;

/** The phrase in one case and spacing, "a.m." as "am", with no closing stop. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\ba\.\s?m\.?/g, 'am')
    .replace(/\bp\.\s?m\.?/g, 'pm')
    .replace(/[,;!?]+/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const amPm = (hour: number, half: string): number | null => {
  if (hour < 1 || hour > 12) return null;
  if (half === 'am') return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
};

/**
 * The time a phrase names, and the phrase without it: "9am", "3:30 pm",
 * "17:00", "at 9", "9 o'clock", "noon", "midnight". A bare number is a time
 * only after "at" ("at 9"): "in 3 days" and "the 3rd" keep theirs.
 * `invalid` for a time that can't be ("25:00").
 */
function takeTime(text: string): { rest: string; time: Clock | null; invalid?: true } {
  const found: { re: RegExp; read: (m: RegExpMatchArray) => Clock | null }[] = [
    {
      re: /(?:\bat\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/,
      read: (m) => {
        const hour = amPm(Number(m[1]), m[3]);
        const minute = m[2] ? Number(m[2]) : 0;
        return hour === null || minute > 59 ? null : { hour, minute };
      },
    },
    {
      re: /(?:\bat\s+)?\b(\d{1,2})[:h](\d{2})\b/,
      read: (m) => {
        const hour = Number(m[1]);
        const minute = Number(m[2]);
        return hour > 23 || minute > 59 ? null : { hour, minute };
      },
    },
    {
      re: /(?:\bat\s+)?\b(\d{1,2})\s*o'?clock\b/,
      read: (m) => (Number(m[1]) > 23 ? null : { hour: Number(m[1]), minute: 0 }),
    },
    {
      re: /(?:\bat\s+)?\b(noon|midday|midnight)\b/,
      read: (m) => ({ hour: m[1] === 'midnight' ? 0 : 12, minute: 0 }),
    },
    {
      re: /\bat\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th|days?|weeks?|months?|working|business|of)\b)/,
      read: (m) => (Number(m[1]) > 23 ? null : { hour: Number(m[1]), minute: 0 }),
    },
  ];
  for (const { re, read } of found) {
    const m = text.match(re);
    if (!m) continue;
    const time = read(m);
    const rest = `${text.slice(0, m.index)} ${text.slice(m.index! + m[0].length)}`
      .replace(/\s+/g, ' ')
      .replace(/\bat\s*$/, '')
      .trim();
    return time ? { rest, time } : { rest, time: null, invalid: true };
  }
  return { rest: text, time: null };
}

const numberOf = (word: string): number | null => {
  if (/^\d{1,3}$/.test(word)) return Number(word);
  return Object.hasOwn(NUMBER_WORDS, word) ? NUMBER_WORDS[word] : null;
};

/** A calendar date's weekday, as RRULE names it. */
function weekdayOf(day: string): RruleDay {
  return RRULE_DAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];
}

/** The date `n` calendar days after `day`. */
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The date `n` working days (Monday to Friday) after `day`. */
function addWorkingDays(day: string, n: number): string {
  let at = day;
  for (let left = n; left > 0;) {
    at = nextDay(at);
    if (weekdayOf(at) !== 'SA' && weekdayOf(at) !== 'SU') left -= 1;
  }
  return at;
}

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The same day `n` months on, or the month's last day when it is shorter. */
function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(d, daysIn(year, month)))}`;
}

/** Whether a reading of a phrase is ready by its time: "ready by", "by", "due", "before". */
function takeReadyBy(text: string): { rest: string; readyBy: boolean } {
  const m = text.match(
    /^(?:(?:have|get|make)\s+(?:it|this|them)\s+)?(?:ready\s+by|done\s+by|due(?:\s+by)?|by|before)\s+/,
  );
  return m
    ? { rest: text.slice(m[0].length).trim(), readyBy: true }
    : { rest: text, readyBy: false };
}

// ─── Recurring ───────────────────────────────────────────────────────────────

const RECURRING =
  /\b(every|each|daily|weekly|monthly|hourly|weekdays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/;

/** More than once a day (item 6): "hourly", "every 2 hours", "twice a day". */
const TOO_OFTEN =
  /\b(?:hourly|every\s+(?:\d+\s+|few\s+)?(?:hours?|minutes?|mins?)|twice\s+a\s+day|\d+\s+times\s+a\s+day)\b/;

const ordinalDay = (word: string): number | null => {
  if (word === 'first') return 1;
  if (word === 'last') return -1;
  const m = word.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
  return m ? Number(m[1]) : null;
};

/** The days a list names ("monday, wednesday and friday"), or null when one isn't a day. */
function dayList(text: string): RruleDay[] | null {
  const words = text
    .split(/\s*(?:,|\band\b|&|\/|\+)\s*|\s+/)
    .map((w) => w.replace(/s$/, ''))
    .filter(Boolean);
  if (words.length === 0) return null;
  const days: RruleDay[] = [];
  for (const word of words) {
    const day = Object.hasOwn(DAY_WORDS, word) ? DAY_WORDS[word] : null;
    if (!day) return null;
    if (!days.includes(day)) days.push(day);
  }
  return RRULE_DAYS.filter((d) => days.includes(d));
}

/** A monthly phrase's day of the month, 1–31 or -1 (the last), or null when it isn't one. */
function monthDayOf(text: string): number | null | 'none' {
  const patterns = [
    /^(?:on\s+)?(?:the\s+)?(\w+?)(?:\s+day)?\s+of\s+(?:every|each|the)\s+month$/,
    /^(?:every|each)\s+month\s+(?:on\s+)?(?:the\s+)?(\w+?)(?:\s+day)?$/,
    /^monthly\s+(?:on\s+)?(?:the\s+)?(\w+?)(?:\s+day)?$/,
  ];
  if (/^(?:at\s+the\s+)?end\s+of\s+(?:every|each|the)\s+month$/.test(text)) return -1;
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return ordinalDay(m[1]);
  }
  return 'none';
}

const ruleReading = (rule: RecurringRule): WhenReading => ({
  ok: true,
  when: { kind: 'recurring', rrule: formatRecurringRule(rule) },
});

function readRecurring(text: string, time: Clock, now: Date, timeZone: string): WhenReading {
  const at = { hour: time.hour, minute: time.minute };
  if (/^(?:every|each)\s+(?:single\s+)?day$|^daily$|^every\s+morning$/.test(text)) {
    return ruleReading({ freq: 'DAILY', byDay: null, byMonthDay: null, ...at });
  }
  if (
    /^(?:(?:every|each|on)\s+)?(?:week\s?days?|working\s+days?|business\s+days?)$/.test(text) &&
    !/^(?:on\s+)?(?:week\s?day|working\s+day|business\s+day)$/.test(text)
  ) {
    return ruleReading({
      freq: 'DAILY',
      byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
      byMonthDay: null,
      ...at,
    });
  }

  // Weekly on days: "every monday", "every mon and thu", "mondays", "weekly on friday".
  const weekly = text.match(/^(?:(?:every|each)\s+(?:week\s+on\s+)?|weekly\s+on\s+|on\s+)?(.+?)$/);
  if (weekly) {
    const days = dayList(weekly[1]);
    if (days && days.length > 0) {
      if (days.length === 7)
        return ruleReading({ freq: 'DAILY', byDay: null, byMonthDay: null, ...at });
      return ruleReading({ freq: 'WEEKLY', byDay: days, byMonthDay: null, ...at });
    }
  }

  const today = dayIn(now.getTime(), timeZone);
  if (/^(?:every|each)\s+week$|^weekly$/.test(text)) {
    const days = [...new Set<RruleDay>([weekdayOf(today), 'MO'])];
    return {
      ok: false,
      problem: 'ambiguous',
      options: days.map((day) =>
        recurringOption({ freq: 'WEEKLY', byDay: [day], byMonthDay: null, ...at }, now, timeZone),
      ),
    };
  }

  const monthDay = monthDayOf(text);
  if (monthDay === 'none' && /^(?:every|each)\s+month$|^monthly$/.test(text)) {
    const own = Number(today.slice(8, 10));
    const days = [...new Set([1, own <= 28 ? own : -1])];
    return {
      ok: false,
      problem: 'ambiguous',
      options: days.map((day) =>
        recurringOption({ freq: 'MONTHLY', byDay: null, byMonthDay: day, ...at }, now, timeZone),
      ),
    };
  }
  if (monthDay !== 'none') {
    if (monthDay === null || monthDay === 0 || monthDay > 31)
      return { ok: false, problem: 'unreadable' };
    // The subset runs on 1–28 or the last day: a 29th–31st would skip months.
    if (monthDay > 28) {
      return {
        ok: false,
        problem: 'ambiguous',
        options: [28, -1].map((day) =>
          recurringOption({ freq: 'MONTHLY', byDay: null, byMonthDay: day, ...at }, now, timeZone),
        ),
      };
    }
    return ruleReading({ freq: 'MONTHLY', byDay: null, byMonthDay: monthDay, ...at });
  }
  return { ok: false, problem: 'unreadable' };
}

/** A recurring rule as a phrase that reads back ("every monday at 09:00"), with its first run. */
function recurringOption(rule: RecurringRule, now: Date, timeZone: string): WhenOption {
  return {
    phrase: recurringPhrase(rule),
    at: nextRecurringFire(rule, timeZone, now) ?? now.toISOString(),
  };
}

const ENGLISH_DAYS: Record<RruleDay, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

const englishOrdinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

function recurringPhrase(rule: RecurringRule): string {
  const at = `at ${clockText(rule)}`;
  if (rule.freq === 'MONTHLY') {
    return rule.byMonthDay === -1
      ? `last day of every month ${at}`
      : `${englishOrdinal(rule.byMonthDay ?? 1)} of every month ${at}`;
  }
  const days = rule.byDay ?? [];
  if (days.length === 0) return `every day ${at}`;
  if (days.length === 5 && !days.includes('SA') && !days.includes('SU'))
    return `every weekday ${at}`;
  const names = days.map((d) => ENGLISH_DAYS[d]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `every ${list} ${at}`;
}

// ─── Once ────────────────────────────────────────────────────────────────────

/** A day as a phrase that reads back: "19 oct 2026 at 09:00". */
function oncePhrase(day: string, time: Clock, readyBy: boolean): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${readyBy ? 'ready by ' : ''}${d} ${MONTH_NAMES[m - 1]} ${y} at ${clockText(time)}`;
}

/** The day a date with no year falls on next: this year's, unless it passed. */
function nextOfDate(month: number, date: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const day = `${y}-${pad(month)}-${pad(date)}`;
    if (isCalendarDay(day) && day >= today) return day;
  }
  return null;
}

type DayReading = { day: string } | { days: string[] } | { at: string } | 'past' | null;

/** The day (or days, when it could be either) a one-time phrase names; null when it names none. */
function readDay(text: string, now: Date, timeZone: string): DayReading {
  const today = dayIn(now.getTime(), timeZone);
  const t = text.replace(/^(?:on|at|this|coming|this\s+coming)\s+/, '').trim();
  if (
    t === 'today' ||
    t === 'tonight' ||
    t === 'this evening' ||
    t === 'end of day' ||
    t === 'eod'
  ) {
    return { day: today };
  }
  if (t === 'tomorrow' || t === 'tmrw' || t === 'tomorrow morning')
    return { day: addDays(today, 1) };
  if (/^(?:the\s+)?day\s+after\s+tomorrow$/.test(t)) return { day: addDays(today, 2) };

  const inMatch = t.match(
    /^in\s+(\w+)\s+(working\s+|business\s+)?(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)$/,
  );
  if (inMatch) {
    const n = numberOf(inMatch[1]);
    if (n === null || n < 1) return null;
    const unit = inMatch[3];
    if (/^(?:min|hour|hr)/.test(unit)) {
      if (inMatch[2]) return null;
      const ms = (/^(?:min)/.test(unit) ? 60_000 : 3_600_000) * n;
      return { at: new Date(now.getTime() + ms).toISOString() };
    }
    if (unit.startsWith('day')) {
      return { day: inMatch[2] ? addWorkingDays(today, n) : addDays(today, n) };
    }
    if (inMatch[2]) return null;
    if (unit.startsWith('week')) return { day: addDays(today, 7 * n) };
    return { day: addMonths(today, n) };
  }

  // "monday": the coming one; on that day itself, today or a week on.
  const dayWord = t.match(/^(next\s+)?(\w+)$/);
  if (dayWord && Object.hasOwn(DAY_WORDS, dayWord[2])) {
    const want = DAY_WORDS[dayWord[2]];
    let coming = addDays(today, 1);
    while (weekdayOf(coming) !== want) coming = nextDay(coming);
    // "next friday" is this coming one or the one after (item 5): asked, never guessed.
    if (dayWord[1]) return { days: [coming, addDays(coming, 7)] };
    if (weekdayOf(today) === want) return { days: [today, coming] };
    return { day: coming };
  }
  if (/^next\s+(?:week|month)$/.test(t)) return null;

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isCalendarDay(t) ? (t < today ? 'past' : { day: t }) : null;

  const dayMonth = t.match(
    /^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:\s+(\d{4}))?$/,
  );
  const monthDay = t.match(/^([a-z]+)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/);
  const named = dayMonth
    ? { word: dayMonth[2], date: Number(dayMonth[1]), year: dayMonth[3] }
    : monthDay
      ? { word: monthDay[1], date: Number(monthDay[2]), year: monthDay[3] }
      : null;
  if (named && Object.hasOwn(MONTH_WORDS, named.word)) {
    const month = MONTH_WORDS[named.word];
    if (named.year) {
      const day = `${named.year}-${pad(month)}-${pad(named.date)}`;
      if (!isCalendarDay(day)) return null;
      return day < today ? 'past' : { day };
    }
    const day = nextOfDate(month, named.date, today);
    return day ? { day } : null;
  }

  // "the 31st": this month's, if still ahead, or next month's (item 5).
  const bare = t.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)$/);
  if (bare) {
    const date = Number(bare[1]);
    const [y, m] = today.split('-').map(Number);
    const days: string[] = [];
    for (let i = 0; i < 3 && days.length < 2; i++) {
      const index = y * 12 + (m - 1) + i;
      const day = `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-${pad(date)}`;
      if (isCalendarDay(day) && day >= today) days.push(day);
    }
    return days.length ? { days } : null;
  }

  // 5/11 or 11/5: day/month or month/day; either, when both read.
  const slash = t.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = slash[3] ? (slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : null;
    const read = (month: number, date: number) => {
      if (year) {
        const day = `${year}-${pad(month)}-${pad(date)}`;
        return isCalendarDay(day) && day >= today ? day : null;
      }
      return nextOfDate(month, date, today);
    };
    const days = [...new Set([read(b, a), read(a, b)].filter((d): d is string => !!d))];
    if (days.length === 0) return null;
    return days.length === 1 ? { day: days[0] } : { days };
  }
  return null;
}

function readOnce(
  text: string,
  time: Clock | null,
  readyBy: boolean,
  now: Date,
  timeZone: string,
): WhenReading {
  const day = readDay(text, now, timeZone);
  if (day === null) return { ok: false, problem: 'unreadable' };
  if (day === 'past') return { ok: false, problem: 'past' };
  const limit = now.getTime() + ONCE_MAX_AHEAD_DAYS * DAY_MS;
  const runMode = readyBy ? ('ready_by' as const) : ('run_at' as const);
  if ('at' in day) {
    if (time) return { ok: false, problem: 'unreadable' };
    if (Date.parse(day.at) > limit) return { ok: false, problem: 'too_far' };
    return { ok: true, when: { kind: 'once', runMode, dueAt: day.at } };
  }
  // "tonight" with no time: 20:00; any other day with none, 09:00 (item 3).
  const clock =
    time ??
    (/^(?:tonight|this evening)$/.test(text)
      ? { hour: 20, minute: 0 }
      : /^(?:end of day|eod)$/.test(text)
        ? { hour: 17, minute: 0 }
        : DEFAULT_TIME);
  const instants = ('days' in day ? day.days : [day.day])
    .map((d) => ({ day: d, at: zonedInstant(d, clock.hour, clock.minute, timeZone) }))
    .filter((d) => Date.parse(d.at) > now.getTime());
  if (instants.length === 0) return { ok: false, problem: 'past' };
  if (instants.every((d) => Date.parse(d.at) > limit)) return { ok: false, problem: 'too_far' };
  if ('days' in day && instants.length > 1) {
    return {
      ok: false,
      problem: 'ambiguous',
      options: instants.map((d) => ({ phrase: oncePhrase(d.day, clock, readyBy), at: d.at })),
    };
  }
  return { ok: true, when: { kind: 'once', runMode, dueAt: instants[0].at } };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** A date phrase as a schedule, on `timeZone`'s clock at `now` (above). */
export function readWhen(
  text: string,
  { now, timeZone }: { now: Date; timeZone: string },
): WhenReading {
  if (!isTimeZone(timeZone) || typeof text !== 'string')
    return { ok: false, problem: 'unreadable' };
  const phrase = normalize(text.slice(0, WHEN_MAX_LENGTH));
  if (!phrase) return { ok: false, problem: 'unreadable' };
  const { rest: undated, readyBy } = takeReadyBy(phrase);
  const { rest, time, invalid } = takeTime(undated);
  if (invalid) return { ok: false, problem: 'unreadable' };
  if (TOO_OFTEN.test(rest)) return { ok: false, problem: 'too_often' };
  if (RECURRING.test(rest)) {
    // Ready by is one date: "ready by every monday" isn't one.
    if (readyBy) return { ok: false, problem: 'unreadable' };
    return readRecurring(rest, time ?? DEFAULT_TIME, now, timeZone);
  }
  if (!rest)
    return time
      ? readOnce('today', time, readyBy, now, timeZone)
      : { ok: false, problem: 'unreadable' };
  return readOnce(rest, time, readyBy, now, timeZone);
}

/**
 * The next `count` runs of a schedule after `now`: a recurring one's slots
 * on its zone's clock; a one-time one's start (now for ready by, which
 * starts at once) — or none once it is past.
 */
export function nextRuns(when: ScheduleWhen, timeZone: string, now: Date, count = 3): string[] {
  if (when.kind === 'once') {
    if (when.runMode === 'ready_by') return [now.toISOString()];
    return Date.parse(when.dueAt) > now.getTime() ? [when.dueAt] : [];
  }
  const rule = parseRecurringRule(when.rrule);
  if (!rule || !isTimeZone(timeZone)) return [];
  const runs: string[] = [];
  let after = now;
  for (let i = 0; i < count; i++) {
    const at = nextRecurringFire(rule, timeZone, after);
    if (!at) break;
    runs.push(at);
    after = new Date(Date.parse(at));
  }
  return runs;
}

/** The phrase a schedule reads back from ("every Monday at 09:00", "19 Oct 2026 at 09:00"). */
export function whenPhrase(when: ScheduleWhen, timeZone: string): string {
  if (when.kind === 'recurring') {
    const rule = parseRecurringRule(when.rrule);
    return rule ? recurringPhrase(rule) : when.rrule;
  }
  const local = dayIn(when.dueAt, timeZone);
  const at = new Date(when.dueAt);
  const clock = at.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
  const [hour, minute] = clock.split(':').map(Number);
  return oncePhrase(local, { hour, minute }, when.runMode === 'ready_by');
}

// ─── Words ───────────────────────────────────────────────────────────────────

/**
 * The translator for `chatSchedules.when` (next-intl's, on the server or in
 * the browser): what the words below are read with.
 */
export type WhenWords = (key: string, values?: Record<string, string | number>) => string;

/** A time as the cards say it: "Mon 19 Oct, 09:00", with the year when it isn't this one. */
export function dateWords(iso: string, timeZone: string, now: Date, t: WhenWords): string {
  const part = (at: Date, options: Intl.DateTimeFormatOptions) =>
    at.toLocaleString('en-GB', { ...options, timeZone });
  const at = new Date(iso);
  const year = part(at, { year: 'numeric' });
  const date = [
    part(at, { weekday: 'short' }),
    part(at, { day: 'numeric' }),
    part(at, { month: 'short' }),
    ...(year === part(now, { year: 'numeric' }) ? [] : [year]),
  ].join(' ');
  const time = part(at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return t('dateTime', { date, time });
}

/**
 * A schedule in words (CHAT-12 items 7, 22): "Every Monday, 09:00", "1st of
 * every month, 07:00", "Due Mon 19 Oct, 09:00", "Once, Mon 19 Oct, 09:00";
 * with its zone when `withZone` ("… · Europe/Istanbul").
 */
export function whenWords(
  when: ScheduleWhen,
  timeZone: string,
  now: Date,
  t: WhenWords,
  { withZone = false }: { withZone?: boolean } = {},
): string {
  let words: string;
  if (when.kind === 'once') {
    words = t(when.runMode === 'ready_by' ? 'readyBy' : 'once', {
      date: dateWords(when.dueAt, timeZone, now, t),
    });
  } else {
    const rule = parseRecurringRule(when.rrule);
    if (!rule) return when.rrule;
    const time = clockText(rule);
    const days = rule.byDay ?? [];
    if (rule.freq === 'MONTHLY') {
      words =
        rule.byMonthDay === -1
          ? t('monthlyLast', { time })
          : t('monthly', { day: rule.byMonthDay ?? 1, time });
    } else if (days.length === 0 || days.length === 7) {
      words = t('daily', { time });
    } else if (days.length === 5 && !days.includes('SA') && !days.includes('SU')) {
      words = t('weekdays', { time });
    } else {
      const names = days.map((d) => t(`day.${d}`));
      const list =
        names.length > 1
          ? `${names.slice(0, -1).join(', ')} ${t('and')} ${names.at(-1)}`
          : names[0];
      words = t('weekly', { days: list, time });
    }
  }
  return withZone ? t('zone', { when: words, zone: timeZone }) : words;
}

/** Why a phrase didn't read, in the card's words ("That time has passed."). */
export function problemWords(
  reading: Extract<WhenReading, { ok: false }>,
  timeZone: string,
  now: Date,
  t: WhenWords,
): string {
  if (reading.problem === 'ambiguous') {
    const list = reading.options.map((o) => dateWords(o.at, timeZone, now, t));
    return t('problem.ambiguous', {
      options:
        list.length > 1 ? `${list.slice(0, -1).join(', ')} ${t('or')} ${list.at(-1)}` : list[0],
    });
  }
  return t(`problem.${reading.problem}`);
}

/**
 * The When field's line under it (the card, the job's detail): the schedule
 * in words with its zone, and a recurring job's next run; or why the phrase
 * doesn't read. Pure, so the browser shows it as the person types.
 */
export function whenHint(
  text: string,
  timeZone: string,
  now: Date,
  t: WhenWords,
): { ok: boolean; hint: string } {
  const zone = isTimeZone(timeZone) ? timeZone : 'UTC';
  const reading = readWhen(text, { now, timeZone: zone });
  if (!reading.ok) return { ok: false, hint: problemWords(reading, zone, now, t) };
  const label = whenWords(reading.when, zone, now, t, { withZone: true });
  const [next] = reading.when.kind === 'recurring' ? nextRuns(reading.when, zone, now, 1) : [];
  return {
    ok: true,
    hint: next ? `${label} · ${t('next', { date: dateWords(next, zone, now, t) })}` : label,
  };
}
