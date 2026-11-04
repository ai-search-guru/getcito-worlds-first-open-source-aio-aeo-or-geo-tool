import type { ChatListItem } from './conversations';

/**
 * The chat menu's lists (CHAT-01 agentic update): Agents at work first —
 * the chats that need the person, then the ones running, then unread
 * results — and every other chat under Pinned or its day: Today, Yesterday,
 * Previous 7 days, Previous 30 days, then by month. Days are the person's
 * own, in the browser's time zone. A chat is in one list only.
 */

export type DayGroup =
  | { kind: 'pinned' }
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'week' }
  | { kind: 'month' }
  /** A calendar month before the last 30 days: its first day, local. */
  | { kind: 'calendar'; month: Date };

export interface ChatGroup {
  key: string;
  group: DayGroup;
  chats: ChatListItem[];
}

export interface ChatMenuLists {
  /** Needs you, then running or paused, then unread results; newest first in each. */
  atWork: ChatListItem[];
  /** Pinned first, then by day, newest first. */
  groups: ChatGroup[];
}

/** Agents at work shows this many rows until See all. */
export const AT_WORK_ROWS = 3;

/**
 * Where a chat sits in Agents at work, or null when it isn't there. Only the
 * person's own chats: a teammate's shared chat waits on its author's OK, not
 * theirs, and keeps its dot under its day.
 */
function atWorkRank(chat: ChatListItem): number | null {
  if (!chat.mine) return null;
  if (chat.state === 'needsYou') return 0;
  if (chat.state === 'running' || chat.state === 'paused') return 1;
  if (chat.unread) return 2;
  return null;
}

/** The local midnight that starts `date`'s day. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The day group of a time, against `now`, in local time. */
export function dayGroupOf(at: Date, now: Date): DayGroup {
  const today = startOfDay(now);
  const day = startOfDay(at);
  if (day >= today) return { kind: 'today' };
  // Calendar days, not 24-hour spans, so a summer-time change moves nothing.
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (day >= yesterday) return { kind: 'yesterday' };
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
  if (day >= week) return { kind: 'week' };
  const month = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30).getTime();
  if (day >= month) return { kind: 'month' };
  return { kind: 'calendar', month: new Date(at.getFullYear(), at.getMonth(), 1) };
}

function keyOf(group: DayGroup): string {
  return group.kind === 'calendar'
    ? `calendar-${group.month.getFullYear()}-${group.month.getMonth() + 1}`
    : group.kind;
}

const newestFirst = (a: ChatListItem, b: ChatListItem) =>
  Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);

/** The menu's lists from the chats, as of `now`. */
export function chatMenuLists(chats: ChatListItem[], now = new Date()): ChatMenuLists {
  const atWork = chats
    .map((chat) => ({ chat, rank: atWorkRank(chat) }))
    .filter((entry): entry is { chat: ChatListItem; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || newestFirst(a.chat, b.chat))
    .map((entry) => entry.chat);
  const working = new Set(atWork.map((chat) => chat.id));

  const groups: ChatGroup[] = [];
  const byKey = new Map<string, ChatGroup>();
  const add = (group: DayGroup, chat: ChatListItem) => {
    const key = keyOf(group);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { key, group, chats: [] };
      byKey.set(key, entry);
      groups.push(entry);
    }
    entry.chats.push(chat);
  };
  const rest = chats.filter((chat) => !working.has(chat.id)).sort(newestFirst);
  for (const chat of rest.filter((c) => c.pinned)) add({ kind: 'pinned' }, chat);
  for (const chat of rest.filter((c) => !c.pinned)) {
    add(dayGroupOf(new Date(chat.lastMessageAt), now), chat);
  }
  return { atWork, groups };
}

/** How many of the person's own chats need them: Home's count and the main menu's amber dot. */
export function needsYouCount(chats: ChatListItem[]): number {
  return chats.filter((chat) => chat.mine && chat.state === 'needsYou').length;
}

/**
 * Whether any chat is working: the menu reads its list more often then. A
 * chat that waits on an OK or is paused changes only when someone acts on
 * it, which can take days, so it doesn't count.
 */
export function anyUnderWay(chats: ChatListItem[]): boolean {
  return chats.some((chat) => chat.state === 'running');
}
