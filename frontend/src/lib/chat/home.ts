/**
 * Chat Home's words that depend on the person's own clock (CHAT-01 items
 * 10, 12): the greeting by the hour, and the last day of this week for the
 * Action Center line. Local time, in the browser.
 */

export type DayPart = 'morning' | 'afternoon' | 'evening';

/** Good morning before 12:00, Good afternoon 12:00–17:59, Good evening from 18:00. */
export function dayPartOf(hour: number): DayPart {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** The first name of a full name; null without one. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * The last day of this week, Sunday (weeks run Monday to Sunday), as
 * YYYY-MM-DD in local time: "due this week" is due by the end of it
 * (CHAT-09 item 1), so an overdue task counts too.
 */
export function endOfWeek(now: Date): string {
  const daysToSunday = (7 - now.getDay()) % 7;
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToSunday);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
}

/** How long ago, for the Inbox's rows: "Just now", "{n} min ago", then Today, Yesterday or the day. */
export type AgoLabel =
  | { kind: 'now' }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'day'; date: Date };

export function agoOf(iso: string, now: Date): AgoLabel {
  const at = new Date(iso);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return { kind: 'now' };
  if (minutes < 60) return { kind: 'minutes', minutes };
  if (at.toDateString() === now.toDateString()) return { kind: 'today' };
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return { kind: 'yesterday' };
  return { kind: 'day', date: at };
}
