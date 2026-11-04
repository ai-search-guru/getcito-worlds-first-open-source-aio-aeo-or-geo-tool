import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../messages/en.json';
import {
  nextRuns,
  problemWords,
  readWhen,
  whenPhrase,
  whenWords,
  type WhenReading,
  type WhenWords,
} from './when';

/**
 * Reading a date phrase into a schedule (CHAT-12 items 1–6 and its
 * acceptance criteria; W3-02): days with no time at 09:00, calendar days
 * unless working days are said, ready by vs run at, recurring rules that
 * keep their local time across daylight saving, and phrases that could mean
 * two dates asked, never guessed.
 */

const IST = 'Europe/Istanbul';
const NY = 'America/New_York';
// Friday 16 October 2026, 14:00 in Istanbul (UTC+3): CHAT-12's examples.
const FRI = new Date('2026-10-16T11:00:00.000Z');
const t = createTranslator({
  locale: 'en',
  messages,
  namespace: 'chatSchedules.when',
}) as unknown as WhenWords;

const read = (text: string, now = FRI, timeZone = IST) => readWhen(text, { now, timeZone });
const due = (reading: WhenReading) => {
  if (!reading.ok || reading.when.kind !== 'once') throw new Error(JSON.stringify(reading));
  return reading.when;
};
const rule = (reading: WhenReading) => {
  if (!reading.ok || reading.when.kind !== 'recurring') throw new Error(JSON.stringify(reading));
  return reading.when.rrule;
};

describe('readWhen: CHAT-12 acceptance', () => {
  it('reads "Have it ready by Monday" sent Fri 16 Oct 14:00 as due Mon 19 Oct, 09:00', () => {
    const when = due(read('Have it ready by Monday'));
    expect(when).toEqual({ kind: 'once', runMode: 'ready_by', dueAt: '2026-10-19T06:00:00.000Z' });
    expect(whenWords(when, IST, FRI, t)).toBe('Due Mon 19 Oct, 09:00');
  });

  it('counts working days only when they are said', () => {
    expect(due(read('in 3 working days')).dueAt).toBe('2026-10-21T06:00:00.000Z');
    expect(due(read('in 3 business days')).dueAt).toBe('2026-10-21T06:00:00.000Z');
    expect(due(read('in 3 days')).dueAt).toBe('2026-10-19T06:00:00.000Z');
    expect(due(read('in 3 days')).runMode).toBe('run_at');
  });

  it('runs "Every Monday at 9:00" at 09:00 New York time on both sides of the DST change', () => {
    const rrule = rule(read('Every Monday at 9:00', new Date('2026-10-20T12:00:00Z'), NY));
    expect(rrule).toBe('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0');
    const runs = nextRuns({ kind: 'recurring', rrule }, NY, new Date('2026-10-20T12:00:00Z'), 2);
    // EDT (UTC−4) on 26 Oct, EST (UTC−5) on 2 Nov: 09:00 local both times.
    expect(runs).toEqual(['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z']);
  });
});

describe('readWhen: recurring phrases', () => {
  it.each([
    ['every monday at 9', 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0'],
    ['Every Monday', 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0'],
    ['every mon and thu at 8:30am', 'FREQ=WEEKLY;BYDAY=MO,TH;BYHOUR=8;BYMINUTE=30'],
    ['mondays, wednesdays and fridays 3pm', 'FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=15;BYMINUTE=0'],
    ['weekly on Friday at 17:00', 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0'],
    ['every day at 7', 'FREQ=DAILY;BYHOUR=7;BYMINUTE=0'],
    ['daily', 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0'],
    ['every weekday at 9am', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0'],
    ['on weekdays', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0'],
    ['1st of every month', 'FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0'],
    ['the first day of each month at 07:00', 'FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=7;BYMINUTE=0'],
    ['every month on the 15th at noon', 'FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=12;BYMINUTE=0'],
    ['last day of every month', 'FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=9;BYMINUTE=0'],
    ['end of every month at 6pm', 'FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=18;BYMINUTE=0'],
  ])('reads "%s"', (text, rrule) => {
    expect(rule(read(text))).toBe(rrule);
  });

  it('refuses anything more often than once a day', () => {
    for (const text of ['every hour', 'hourly', 'every 2 hours', 'twice a day']) {
      expect(read(text)).toEqual({ ok: false, problem: 'too_often' });
    }
  });

  it('asks which day for "every week", "every month" and a 29th–31st', () => {
    const week = read('every week at 10');
    expect(week.ok).toBe(false);
    if (!week.ok && week.problem === 'ambiguous') {
      expect(week.options.map((o) => o.phrase)).toEqual([
        'every Friday at 10:00',
        'every Monday at 10:00',
      ]);
    }
    const late = read('the 31st of every month');
    expect(!late.ok && late.problem).toBe('ambiguous');
    if (!late.ok && late.problem === 'ambiguous') {
      expect(late.options.map((o) => o.phrase)).toEqual([
        '28th of every month at 09:00',
        'last day of every month at 09:00',
      ]);
      // Each option reads back as itself.
      for (const option of late.options) expect(read(option.phrase).ok).toBe(true);
    }
  });
});

describe('readWhen: one-time phrases', () => {
  it('runs at a time, or is ready by it', () => {
    expect(due(read('tomorrow at 3pm'))).toEqual({
      kind: 'once',
      runMode: 'run_at',
      dueAt: '2026-10-17T12:00:00.000Z',
    });
    expect(due(read('by tomorrow')).runMode).toBe('ready_by');
    expect(due(read('due Nov 5')).dueAt).toBe('2026-11-05T06:00:00.000Z');
    expect(due(read('in 2 hours')).dueAt).toBe('2026-10-16T13:00:00.000Z');
    expect(due(read('in a week')).dueAt).toBe('2026-10-23T06:00:00.000Z');
    expect(due(read('in 1 month')).dueAt).toBe('2026-11-16T06:00:00.000Z');
    expect(due(read('5 November 2026 at 10:30')).dueAt).toBe('2026-11-05T07:30:00.000Z');
    expect(due(read('2026-11-05')).dueAt).toBe('2026-11-05T06:00:00.000Z');
    expect(due(read('Nov 5th at 9am')).dueAt).toBe('2026-11-05T06:00:00.000Z');
    expect(due(read('today at 17:00')).dueAt).toBe('2026-10-16T14:00:00.000Z');
  });

  it('reads a date with no year as the next one', () => {
    expect(due(read('Jan 3')).dueAt).toBe('2027-01-03T06:00:00.000Z');
  });

  it('asks which date for "next Friday", "the 31st" and 5/11, never guessing (item 5)', () => {
    const next = read('next Friday');
    expect(!next.ok && next.problem === 'ambiguous' && next.options.map((o) => o.at)).toEqual([
      '2026-10-23T06:00:00.000Z',
      '2026-10-30T06:00:00.000Z',
    ]);
    const bare = read('the 31st');
    expect(!bare.ok && bare.problem === 'ambiguous' && bare.options.map((o) => o.at)).toEqual([
      '2026-10-31T06:00:00.000Z',
      '2026-12-31T06:00:00.000Z',
    ]);
    const slash = read('5/11');
    expect(!slash.ok && slash.problem).toBe('ambiguous');
    // A day said on that very day: today, if still ahead, or a week on.
    const friday = read('friday at 18:00');
    expect(!friday.ok && friday.problem).toBe('ambiguous');
    expect(due(read('friday at 9')).dueAt).toBe('2026-10-23T06:00:00.000Z');
    if (!next.ok && next.problem === 'ambiguous') {
      expect(problemWords(next, IST, FRI, t)).toBe(
        'That could be Fri 23 Oct, 09:00 or Fri 30 Oct, 09:00. Say which one.',
      );
      expect(read(next.options[1].phrase)).toEqual({
        ok: true,
        when: { kind: 'once', runMode: 'run_at', dueAt: '2026-10-30T06:00:00.000Z' },
      });
    }
  });

  it('refuses a time that passed, one too far ahead and one that does not read', () => {
    expect(read('today at 9')).toEqual({ ok: false, problem: 'past' });
    expect(read('2026-10-01')).toEqual({ ok: false, problem: 'past' });
    expect(read('in 400 days')).toEqual({ ok: false, problem: 'too_far' });
    expect(read('whenever you like')).toEqual({ ok: false, problem: 'unreadable' });
    expect(read('at 25:00 tomorrow')).toEqual({ ok: false, problem: 'unreadable' });
    expect(read('ready by every monday')).toEqual({ ok: false, problem: 'unreadable' });
    expect(read('')).toEqual({ ok: false, problem: 'unreadable' });
    expect(readWhen('tomorrow', { now: FRI, timeZone: 'Mars/Base' })).toEqual({
      ok: false,
      problem: 'unreadable',
    });
  });
});

describe('words and phrases', () => {
  it('says a schedule as the card does, with its zone', () => {
    expect(
      whenWords(
        { kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' },
        IST,
        FRI,
        t,
        {
          withZone: true,
        },
      ),
    ).toBe('Every Monday, 09:00 · Europe/Istanbul');
    expect(
      whenWords(
        { kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH;BYHOUR=8;BYMINUTE=30' },
        IST,
        FRI,
        t,
      ),
    ).toBe('Every Monday and Thursday, 08:30');
    expect(
      whenWords(
        { kind: 'recurring', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=7;BYMINUTE=0' },
        IST,
        FRI,
        t,
      ),
    ).toBe('1st of every month, 07:00');
    expect(
      whenWords(
        { kind: 'recurring', rrule: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0' },
        IST,
        FRI,
        t,
      ),
    ).toBe('Every weekday, 09:00');
    expect(
      whenWords(
        { kind: 'once', runMode: 'run_at', dueAt: '2027-01-03T06:00:00.000Z' },
        IST,
        FRI,
        t,
      ),
    ).toBe('Once, Sun 3 Jan 2027, 09:00');
  });

  it('writes a phrase that reads back as the same schedule', () => {
    for (const text of [
      'every mon and thu at 8:30',
      'in 3 working days',
      'ready by monday',
      'last day of every month',
    ]) {
      const first = read(text);
      if (!first.ok) throw new Error(text);
      expect(read(whenPhrase(first.when, IST))).toEqual(first);
    }
  });

  it('lists the next runs: a recurring one’s slots, a ready-by job now', () => {
    expect(
      nextRuns(
        { kind: 'recurring', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0' },
        IST,
        FRI,
      ),
    ).toEqual(['2026-11-01T06:00:00.000Z', '2026-12-01T06:00:00.000Z', '2027-01-01T06:00:00.000Z']);
    expect(
      nextRuns({ kind: 'once', runMode: 'ready_by', dueAt: '2026-10-19T06:00:00.000Z' }, IST, FRI),
    ).toEqual([FRI.toISOString()]);
  });
});
