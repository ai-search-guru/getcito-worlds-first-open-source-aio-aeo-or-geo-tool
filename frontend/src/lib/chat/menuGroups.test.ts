import { describe, expect, it } from 'vitest';
import type { ChatListItem } from './conversations';
import { anyUnderWay, chatMenuLists, dayGroupOf, needsYouCount } from './menuGroups';

/**
 * The chat menu's lists (CHAT-01 agentic update): Agents at work — needs
 * you, then running, then unread results — and every other chat once, under
 * Pinned or its day in local time: Today, Yesterday, Previous 7 days,
 * Previous 30 days, then by month.
 */

const chat = (id: string, row: Partial<ChatListItem> = {}): ChatListItem => ({
  id,
  title: id,
  brand: null,
  pinned: false,
  archived: false,
  shared: false,
  mine: true,
  ownerInitials: null,
  lastMessageAt: '2026-10-30T09:00:00',
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
  finishedAt: null,
  ...row,
});

// Local times: the groups are the person's own days.
const NOW = new Date('2026-10-30T12:00:00');

describe('dayGroupOf', () => {
  it('splits at local midnights, not 24-hour spans', () => {
    expect(dayGroupOf(new Date('2026-10-30T00:00:00'), NOW).kind).toBe('today');
    expect(dayGroupOf(new Date('2026-10-29T23:59:59'), NOW).kind).toBe('yesterday');
    expect(dayGroupOf(new Date('2026-10-29T00:00:00'), NOW).kind).toBe('yesterday');
    expect(dayGroupOf(new Date('2026-10-28T23:59:59'), NOW).kind).toBe('week');
    expect(dayGroupOf(new Date('2026-10-23T00:00:00'), NOW).kind).toBe('week');
    expect(dayGroupOf(new Date('2026-10-22T23:59:59'), NOW).kind).toBe('month');
    expect(dayGroupOf(new Date('2026-09-30T00:00:00'), NOW).kind).toBe('month');
  });

  it('puts anything older under its calendar month', () => {
    const group = dayGroupOf(new Date('2026-09-12T10:00:00'), NOW);
    expect(group).toEqual({ kind: 'calendar', month: new Date('2026-09-01T00:00:00') });
  });
});

describe('chatMenuLists', () => {
  it('lists Agents at work as needs you, running, then unread, each newest first', () => {
    const { atWork } = chatMenuLists(
      [
        chat('done', { state: 'done', unread: true, lastMessageAt: '2026-10-30T11:00:00' }),
        chat('run-old', { state: 'running', lastMessageAt: '2026-10-30T08:00:00' }),
        chat('need', { state: 'needsYou' }),
        chat('run-new', { state: 'running', lastMessageAt: '2026-10-30T10:00:00' }),
        chat('paused', { state: 'paused', lastMessageAt: '2026-10-30T07:00:00' }),
        chat('idle'),
      ],
      NOW,
    );
    expect(atWork.map((c) => c.id)).toEqual(['need', 'run-new', 'run-old', 'paused', 'done']);
  });

  it('puts every other chat once: Pinned first, then by day, newest first', () => {
    const { groups } = chatMenuLists(
      [
        chat('today-1', { lastMessageAt: '2026-10-30T08:00:00' }),
        chat('today-2', { lastMessageAt: '2026-10-30T11:00:00' }),
        chat('pinned', { pinned: true, lastMessageAt: '2026-09-01T08:00:00' }),
        chat('yesterday', { lastMessageAt: '2026-10-29T08:00:00' }),
        chat('working', { state: 'running' }),
        chat('august', { lastMessageAt: '2026-08-15T08:00:00' }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.key, g.chats.map((c) => c.id)])).toEqual([
      ['pinned', ['pinned']],
      ['today', ['today-2', 'today-1']],
      ['yesterday', ['yesterday']],
      ['calendar-2026-8', ['august']],
    ]);
  });
});

describe('needsYouCount and anyUnderWay', () => {
  it('counts what needs the person, and says whether anything still works', () => {
    const chats = [chat('a', { state: 'needsYou' }), chat('b', { state: 'done', unread: true })];
    expect(needsYouCount(chats)).toBe(1);
    expect(anyUnderWay([...chats, chat('r', { state: 'running' })])).toBe(true);
    expect(anyUnderWay([chat('c', { state: 'done' })])).toBe(false);
  });

  it("doesn't count a chat that waits on an OK or is paused as working: it can wait for days", () => {
    expect(anyUnderWay([chat('a', { state: 'needsYou' }), chat('b', { state: 'paused' })])).toBe(
      false,
    );
  });
});

describe("a teammate's shared chat", () => {
  const theirs = (id: string, row: Partial<ChatListItem> = {}) =>
    chat(id, { mine: false, shared: true, ownerInitials: 'SL', ...row });

  it("stays out of Agents at work and Home's count: it waits on its author, not the person", () => {
    const chats = [
      theirs('their-wait', { state: 'needsYou' }),
      theirs('their-run', { state: 'running' }),
      chat('my-wait', { state: 'needsYou' }),
    ];
    const { atWork, groups } = chatMenuLists(chats, NOW);
    expect(atWork.map((c) => c.id)).toEqual(['my-wait']);
    expect(needsYouCount(chats)).toBe(1);
    // Listed under its day instead, with its dot.
    expect(groups.flatMap((g) => g.chats.map((c) => c.id)).sort()).toEqual([
      'their-run',
      'their-wait',
    ]);
  });
});
