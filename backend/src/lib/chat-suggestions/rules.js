/**
 * Daily suggestions (CHAT-26 §3, §5, §6): the rules that pick at most one
 * open Action Center action a day for a person and brand, with no AI call.
 * Pure: job.js reads the rows and writes what these decide.
 *
 *   * Who: by role (ROLE_FEEDS). Admins and managers have it on by default;
 *     the other roles that can act on an action ("members" in the spec,
 *     agency partners today) once they turn it on, first by opening the
 *     Inbox (W2-25); analysts never. Menu access (00374) never takes Action
 *     Center off a menu (cleanMenuSections strips it, the menu always shows
 *     it), so the role decides.
 *   * When: once the person's day starts, 07:00 in their time zone, until
 *     noon: a suggestion is a morning one. A feed made or turned back on
 *     today starts tomorrow morning. At most one a day and 7 in any 7 days.
 *   * What: the brand's open actions (`new`, `in_progress`; not on hold,
 *     dismissed or deleted), unassigned or the person's own, ranked by
 *     their priority score (the shared priority core, past success
 *     included) plus the candidate queue's wait lift (candidates.js) and a
 *     small lift when "Start now" can open it in the Content Editor.
 *     Skipped: what was suggested to them in the last 14 days (unless put
 *     off and back after the week), what they removed or put off, and what
 *     waits on someone in Chat's "Needs you". When yesterday's was of the
 *     same category and another's score is close, the other comes first.
 *   * Pause: 30 days from the first suggestion after the last use (opened,
 *     started, put off or removed), with at least 7 sent and none used,
 *     pauses the feed until the person turns it back on.
 */

import { resolve } from '../../config/actionEngine.js';
import { scoreCandidate } from '../action-center/candidates.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const { priority } = resolve();

/** The local hour a person's day starts: their suggestion is sent from then. */
export const DAY_STARTS_AT = 7;
/** The local hour the morning's sending ends: a later run waits for tomorrow. */
export const SEND_UNTIL = 12;
/** Hours at least between two suggestions of a feed, whatever the time zones read. */
export const MIN_GAP_HOURS = 12;
/** At most this many in any `WEEK_DAYS` days (the person's calendar days). */
export const WEEK_MAX = 7;
export const WEEK_DAYS = 7;
/** An action suggested within this many days isn't suggested again; rows older are deleted. */
export const KEEP_DAYS = 14;
/** Days from the first suggestion after the last use, with none used, after which a feed is paused. */
export const PAUSE_AFTER_DAYS = 30;
/** Suggestions at least that went unused in those days: a feed that got few isn't paused. */
export const PAUSE_MIN_SENT = 7;
/** Points for an action "Start now" opens in the Content Editor: one sitting's work. */
export const START_NOW_LIFT = 5;
/** Points within which another category comes before yesterday's. */
export const VARIETY_MARGIN = 5;
/** The time estimate: about 4 minutes a page with the agent, until measured runs say better. */
export const MINUTES_PER_PAGE = 4;
/** Open actions: not on hold, completed or dismissed. */
export const OPEN_STATUSES = Object.freeze(['new', 'in_progress']);

/**
 * A role's daily suggestions: `default_on`, a feed made for them; `opt_in`,
 * only once they turn it on; `never`. A role not listed here gets none.
 */
export const ROLE_FEEDS = Object.freeze({
  admin: 'default_on',
  manager: 'default_on',
  agency_partner: 'opt_in',
  analyst: 'never',
});

/** The role's daily suggestions (ROLE_FEEDS); `never` for anything else. */
export function roleFeed(role) {
  return Object.hasOwn(ROLE_FEEDS, role) ? ROLE_FEEDS[role] : 'never';
}

// ─── Time zones ─────────────────────────────────────────────────────────────

const clocks = new Map();

/** The wall-clock format for a zone, or null when the zone isn't one this runtime knows. */
function clockFormat(zone) {
  if (typeof zone !== 'string' || zone.length === 0 || zone.length > 64) return null;
  if (clocks.has(zone)) return clocks.get(zone);
  let format = null;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
    });
  } catch {
    format = null;
  }
  clocks.set(zone, format);
  return format;
}

/** Whether `zone` is an IANA time zone this runtime knows. */
export function isTimeZone(zone) {
  return clockFormat(zone) !== null;
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

/**
 * The calendar day (YYYY-MM-DD) and hour an instant reads in `zone`; UTC's
 * for a zone this runtime doesn't know.
 *
 * @returns {{ day: string, hour: number }}
 */
export function localClock(now, zone) {
  const format = clockFormat(zone) ?? clockFormat('UTC');
  const fields = {};
  for (const part of format.formatToParts(now)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return {
    day: `${pad(fields.year, 4)}-${pad(fields.month)}-${pad(fields.day)}`,
    hour: fields.hour,
  };
}

/** `day` (YYYY-MM-DD) moved by `days`. Pure date arithmetic, no zone involved. */
export function addDays(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The time zones a workspace's people read in, from their latest Chat
 * answers (chat_messages.timezone: the browser's zone each answer was shown
 * in), newest first. A person's own is their latest; the workspace's is the
 * one most of them read in (the newest on a tie); with neither, UTC. No
 * profile or workspace time zone is stored yet (CHAT-12 brings one).
 *
 * @param {Array<{ userId: string, timezone: string | null }>} answers newest first
 * @returns {{ ofPerson: (userId: string) => string, workspace: string }}
 */
export function resolveZones(answers) {
  const own = new Map();
  const counts = new Map();
  for (const { userId, timezone } of answers) {
    if (!isTimeZone(timezone)) continue;
    if (!own.has(userId)) own.set(userId, timezone);
    counts.set(timezone, (counts.get(timezone) ?? 0) + 1);
  }
  let workspace = 'UTC';
  let most = 0;
  // Map order is first-seen order, newest first: a strict > keeps the newest on a tie.
  for (const [zone, count] of counts) {
    if (count > most) {
      workspace = zone;
      most = count;
    }
  }
  return { ofPerson: (userId) => own.get(userId) ?? workspace, workspace };
}

/** Whether `now` falls in the person's morning sending window. */
export function inMorning(now, zone) {
  const { hour } = localClock(now, zone);
  return hour >= DAY_STARTS_AT && hour < SEND_UNTIL;
}

// ─── Sending ────────────────────────────────────────────────────────────────

const timeOf = (value) => Date.parse(value ?? '') || 0;

/**
 * Whether a feed gets today's suggestion now: in the person's morning, none
 * sent on their today, none in the last MIN_GAP_HOURS (a time zone that
 * changed can't send two in a morning), fewer than WEEK_MAX in the
 * WEEK_DAYS calendar days that end today, and not made or turned back on
 * today.
 *
 * "The first suggestion after turning back on arrives the next morning"
 * (CHAT-26 §5), with no column saying when a feed was turned on: a feed
 * made (created_at) or changed (updated_at) on the person's today that got
 * none yesterday waits for tomorrow. That covers a feed made this morning
 * (an admin's, by this job, or a member's on their first Inbox) and Turn
 * back on (the Inbox writes status 'on'). On a usual day yesterday's
 * suggestion is there, so a use that moved updated_at this morning doesn't
 * hold today's back; after a day with none, it does, once.
 *
 * @param {{ now: Date, zone: string, rows: Array<{ sent_on: string, sent_at: string }>,
 *   feed?: { created_at?: string, updated_at?: string|null } }} input
 *   rows: the feed's suggestions kept (the last KEEP_DAYS days).
 * @returns {{ due: true, day: string } | { due: false, reason: string }}
 */
export function dueNow({ now, zone, rows, feed }) {
  const { day, hour } = localClock(now, zone);
  if (hour < DAY_STARTS_AT || hour >= SEND_UNTIL) return { due: false, reason: 'not_morning' };
  if (rows.some((row) => row.sent_on === day)) return { due: false, reason: 'sent_today' };
  const gapFrom = now.getTime() - MIN_GAP_HOURS * HOUR_MS;
  if (rows.some((row) => Date.parse(row.sent_at) > gapFrom)) {
    return { due: false, reason: 'sent_recently' };
  }
  const weekStart = addDays(day, -(WEEK_DAYS - 1));
  const week = rows.filter((row) => row.sent_on >= weekStart && row.sent_on <= day).length;
  if (week >= WEEK_MAX) return { due: false, reason: 'week_full' };
  const changed = Math.max(timeOf(feed?.created_at), timeOf(feed?.updated_at));
  const yesterday = addDays(day, -1);
  if (
    changed > 0 &&
    localClock(new Date(changed), zone).day === day &&
    !rows.some((row) => row.sent_on === yesterday)
  ) {
    return { due: false, reason: 'turned_on_today' };
  }
  return { due: true, day };
}

/**
 * Whether a suggestion still keeps its action from being suggested again:
 * removed (put off before or not); put off until a time still ahead ("Not
 * now", a week); or sent in the last KEEP_DAYS days. A put-off one whose
 * week is over comes back ("back in a week if it's still open").
 */
export function blocksAction(row, now) {
  if (row.removed_at) return true;
  if (row.snoozed_until) return Date.parse(row.snoozed_until) > now.getTime();
  return Date.parse(row.sent_at) > now.getTime() - KEEP_DAYS * DAY_MS;
}

/**
 * The days an action has waited since it opened, and the points that gives
 * it: the candidate queue's (waitPerDay a day, up to waitCapDays).
 */
export function waitOf(action, now) {
  const opened = Date.parse(action.created_at ?? '');
  const days = Number.isFinite(opened) ? Math.max(0, Math.floor((now - opened) / DAY_MS)) : 0;
  return { days, points: Math.min(days, priority.waitCapDays) * priority.waitPerDay };
}

/**
 * A candidate's rank: its priority score with the queue's wait lift
 * (scoreCandidate) and START_NOW_LIFT when "Start now" opens it.
 */
export function rankScore(action, { now, startNow }) {
  const queued = scoreCandidate(
    { priorityScore: action.priority_score, firstSeenAt: action.created_at },
    now,
  );
  return queued + (startNow ? START_NOW_LIFT : 0);
}

/**
 * Today's suggestion for one person and brand, or null when nothing
 * qualifies.
 *
 * @param {object} input
 * @param {Array<{ id: string, category: string, priority_score: number|null,
 *   created_at: string, assignee_id: string|null }>} input.actions the brand's open actions
 * @param {string} input.userId
 * @param {Array<{ action_id: string, sent_at: string, snoozed_until?: string|null,
 *   removed_at?: string|null, category?: string|null }>} input.rows the feed's kept suggestions
 * @param {Set<string>} input.needsYou actions waiting on someone in Chat's "Needs you"
 * @param {Map<string, string>} input.startNow action id → the draft "Start now" opens ('create' | 'optimize')
 * @param {Date} input.now
 * @returns {{ action: object, score: number, wait: { days: number, points: number },
 *   startNow: string | null, variety: boolean } | null}
 */
export function pickSuggestion({ actions, userId, rows, needsYou, startNow, now }) {
  const blocked = new Set(rows.filter((row) => blocksAction(row, now)).map((row) => row.action_id));
  const ranked = actions
    .filter(
      (action) =>
        OPEN_STATUSES.includes(action.status ?? 'new') &&
        (!action.assignee_id || action.assignee_id === userId) &&
        !blocked.has(action.id) &&
        !needsYou.has(action.id),
    )
    .map((action) => ({
      action,
      score: rankScore(action, { now, startNow: startNow.has(action.id) }),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(a.action.created_at ?? 0) - Date.parse(b.action.created_at ?? 0) ||
        String(a.action.id).localeCompare(String(b.action.id)),
    );
  if (ranked.length === 0) return null;

  // Variety: yesterday's category goes behind another's close score.
  const last = [...rows].sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))[0];
  let chosen = ranked[0];
  let variety = false;
  if (last?.category && chosen.action.category === last.category) {
    const other = ranked.find(
      (entry) =>
        entry.action.category !== last.category && chosen.score - entry.score <= VARIETY_MARGIN,
    );
    if (other) {
      chosen = other;
      variety = true;
    }
  }
  return {
    action: chosen.action,
    score: chosen.score,
    wait: waitOf(chosen.action, now),
    startNow: startNow.get(chosen.action.id) ?? null,
    variety,
  };
}

// ─── Pausing ────────────────────────────────────────────────────────────────

/**
 * When a feed was last used: its last_used_at (kept by the Inbox's API), a
 * kept suggestion's own marks (opened, started, removed), or, never used,
 * when it was made. In ms.
 */
export function lastUseOf({ feed, rows }) {
  return Math.max(
    timeOf(feed.created_at),
    timeOf(feed.last_used_at),
    ...rows.flatMap((row) => [row.opened_at, row.started_at, row.removed_at].map(timeOf)),
  );
}

/**
 * Whether a suggestion sent now is the first since the feed's last use: no
 * kept one came after it. The job then marks the feed (an update, so
 * updated_at is now), as the start of the 30 days: suggestions are kept
 * only KEEP_DAYS, so the first one after a use is gone long before the 30
 * are over, and no column holds when it was sent. After a gap of more than
 * KEEP_DAYS with none, the next one marks it again: the count starts over,
 * never sooner.
 */
export function firstSinceUse({ feed, rows }) {
  const since = lastUseOf({ feed, rows });
  return !rows.some((row) => timeOf(row.sent_at) > since);
}

/**
 * Whole days a feed has gone unused, counted from the first suggestion after
 * its last use (the job's mark in updated_at; firstSinceUse), or from the
 * use itself when later. Turning it back on (the Inbox's update) starts the
 * count again too.
 */
export function idleDays({ feed, rows, now }) {
  const from = Math.max(lastUseOf({ feed, rows }), timeOf(feed.updated_at));
  return Math.floor((now.getTime() - from) / DAY_MS);
}

/**
 * Whether an `on` feed is paused: PAUSE_AFTER_DAYS since the first
 * suggestion after its last use (idleDays), with at least PAUSE_MIN_SENT
 * sent since that use and still kept, none of them used. A feed that got
 * one yesterday after a long quiet spell isn't paused today.
 *
 * @param {{ feed: { status: string, created_at?: string, updated_at?: string|null,
 *   last_used_at?: string|null }, rows: Array<object>, now: Date }} input
 */
export function shouldPause({ feed, rows, now }) {
  if (feed.status !== 'on') return false;
  const since = lastUseOf({ feed, rows });
  const unused = rows.filter((row) => timeOf(row.sent_at) > since).length;
  return unused >= PAUSE_MIN_SENT && idleDays({ feed, rows, now }) >= PAUSE_AFTER_DAYS;
}
