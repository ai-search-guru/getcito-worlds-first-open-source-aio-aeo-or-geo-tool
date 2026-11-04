import { describe, expect, it } from 'vitest';
import { ALWAYS_ON_SECTION, hiddenMenuSections } from '@/lib/menuAccess';
import {
  SHOWN_DAYS,
  actionPromptCount,
  closedStatus,
  dayIn,
  feedsState,
  parseSuggestionSummary,
  roleFeed,
  sendingZone,
  sentDay,
  shownSince,
  suggestionDot,
  suggestionPageId,
  suggestionPick,
  suggestionStart,
} from './dailySuggestions';

/**
 * Daily suggestions in the Inbox (CHAT-26 §2.2, §5, §6): the last 7 days
 * only, the row's dot, the person's feeds as one state, who gets them, and
 * the summary the nightly job keeps (W2-24's version 1).
 */

describe('shownSince', () => {
  it('shows the last 7 days only', () => {
    expect(SHOWN_DAYS).toBe(7);
    expect(shownSince(new Date('2026-10-29T09:00:00.000Z'))).toBe('2026-10-22T09:00:00.000Z');
  });
});

describe('roleFeed', () => {
  it('gives Admins and Managers suggestions by default, Agency partners once they open the Inbox, Analysts none', () => {
    expect(roleFeed('admin')).toBe('default_on');
    expect(roleFeed('manager')).toBe('default_on');
    expect(roleFeed('agency_partner')).toBe('opt_in');
    expect(roleFeed('analyst')).toBe('never');
    expect(roleFeed(null)).toBe('never');
  });
});

describe('Action Center access (§6)', () => {
  it('needs no check while Action Center is on every menu', () => {
    const why = 'W2-25 daily suggestions must then respect Action Center access (CHAT-26 §6)';
    expect(ALWAYS_ON_SECTION, why).toBe('action-center');
    expect(
      hiddenMenuSections({
        role: 'agency_partner',
        roleHidden: [ALWAYS_ON_SECTION],
        shown: [],
        hidden: [ALWAYS_ON_SECTION],
        workAreas: ['developers'],
      }).has(ALWAYS_ON_SECTION),
      why,
    ).toBe(false);
  });
});

describe('feedsState', () => {
  it('is paused while any brand is, else on while any is, else off, else none', () => {
    expect(feedsState(['on', 'paused'])).toBe('paused');
    expect(feedsState(['off', 'paused'])).toBe('paused');
    expect(feedsState(['off', 'on'])).toBe('on');
    expect(feedsState(['off'])).toBe('off');
    expect(feedsState([])).toBe('none');
  });
});

describe('closedStatus', () => {
  it('is the status of an action done or dismissed, and null while it is open', () => {
    expect(closedStatus('completed')).toBe('completed');
    expect(closedStatus('dismissed')).toBe('dismissed');
    for (const open of ['new', 'in_progress', 'on_hold', null, undefined, 'nope']) {
      expect(closedStatus(open)).toBeNull();
    }
  });
});

describe('suggestionDot', () => {
  const row = { seenAt: null, openedAt: null, startedAt: null };
  it('is new until seen, seen once seen or opened, started once started', () => {
    expect(suggestionDot(row)).toBe('new');
    expect(suggestionDot({ ...row, seenAt: '2026-10-29T08:00:00Z' })).toBe('seen');
    expect(suggestionDot({ ...row, openedAt: '2026-10-29T08:00:00Z' })).toBe('seen');
    expect(
      suggestionDot({
        seenAt: '2026-10-29T08:00:00Z',
        openedAt: '2026-10-29T08:01:00Z',
        startedAt: '2026-10-29T08:02:00Z',
      }),
    ).toBe('started');
  });
});

describe('parseSuggestionSummary', () => {
  it("reads the job's version-1 summary", () => {
    expect(
      parseSuggestionSummary({
        version: 1,
        action: {
          no: 2841,
          kind: 'improve_page_content',
          category: 'growth',
          impact: 'high',
          createdAt: '2026-10-23T08:00:00Z',
          payload: { targetEntity: 'pages', targetCount: 5 },
        },
        priority: { score: 81, level: 'high', reason: null },
        waitingDays: 6,
        ranking: { score: 87, waitPoints: 1, startNowPoints: 5, variety: false },
        startNow: { method: 'optimize', pages: 5, minutes: 20 },
        play: null,
      }),
    ).toEqual({
      actionNo: 2841,
      kind: 'improve_page_content',
      payload: { targetEntity: 'pages', targetCount: 5 },
      priorityLevel: 'high',
      startNow: { method: 'optimize', pages: 5, minutes: 20 },
    });
  });

  it('reads a missing or odd part as none, and a level from the score when it has none', () => {
    expect(parseSuggestionSummary(null)).toEqual({
      actionNo: null,
      kind: '',
      payload: {},
      priorityLevel: null,
      startNow: null,
    });
    expect(
      parseSuggestionSummary({
        action: { no: '12', kind: 'add_llms_txt', payload: [] },
        priority: { score: 60 },
        startNow: { method: 'publish', minutes: 4 },
      }),
    ).toEqual({
      actionNo: null,
      kind: 'add_llms_txt',
      payload: {},
      priorityLevel: 'medium',
      startNow: null,
    });
  });
});

describe('sendingZone', () => {
  const ME = 'me';
  it("is the person's latest Chat answer's zone, as the job's", () => {
    expect(
      sendingZone(
        [
          { userId: 'other', timezone: 'America/New_York' },
          { userId: ME, timezone: 'Europe/Istanbul' },
          { userId: ME, timezone: 'Asia/Tokyo' },
        ],
        ME,
      ),
    ).toBe('Europe/Istanbul');
  });

  it("is the workspace's most read zone without one of theirs, the newest on a tie, else UTC", () => {
    expect(
      sendingZone(
        [
          { userId: 'a', timezone: 'Europe/Berlin' },
          { userId: 'b', timezone: 'America/New_York' },
          { userId: 'c', timezone: 'America/New_York' },
          { userId: 'd', timezone: 'Europe/Berlin' },
        ],
        ME,
      ),
    ).toBe('Europe/Berlin');
    expect(
      sendingZone(
        [
          { userId: ME, timezone: 'Not/AZone' },
          { userId: ME, timezone: null },
        ],
        ME,
      ),
    ).toBe('UTC');
    expect(sendingZone([], ME)).toBe('UTC');
  });
});

describe('dayIn', () => {
  it('is the calendar day an instant reads in a zone', () => {
    const at = new Date('2026-10-29T22:30:00Z');
    expect(dayIn(at, 'UTC')).toBe('2026-10-29');
    expect(dayIn(at, 'Europe/Istanbul')).toBe('2026-10-30');
    expect(dayIn(at, 'America/Los_Angeles')).toBe('2026-10-29');
  });
});

describe('sentDay', () => {
  it('says the day it was sent, and whether it is the today the read dated', () => {
    expect(sentDay('2026-10-29', '2026-10-29')).toEqual({ date: 'Oct 29', today: true });
    expect(sentDay('2026-10-28', '2026-10-29')).toEqual({ date: 'Oct 28', today: false });
  });

  it("is never today when the read couldn't date it", () => {
    expect(sentDay('2026-10-29', null)).toEqual({ date: 'Oct 29', today: false });
  });
});

describe('the suggestion’s page (§2.3)', () => {
  it('takes a suggestion’s id from its address, and nothing else', () => {
    expect(suggestionPageId('55555555-5555-4555-8555-555555555555')).toBe(
      '55555555-5555-4555-8555-555555555555',
    );
    // The demo's ids are made by hand, not RFC 4122 ones.
    expect(suggestionPageId('33333333-3333-3333-3333-333333333333')).not.toBeNull();
    expect(suggestionPageId('new')).toBeNull();
  });

  it('reads the pick as the job kept it, and a missing or odd part as none', () => {
    expect(suggestionPick({ priority: { score: 80.6 }, waitingDays: 6 })).toEqual({
      score: 81,
      waitingDays: 6,
    });
    expect(suggestionPick({ priority: { score: '81' }, waitingDays: -1 })).toEqual({
      score: null,
      waitingDays: null,
    });
    expect(suggestionPick(null)).toEqual({ score: null, waitingDays: null });
  });

  it('starts the Content Editor on a new page’s task first, else an existing page’s, on its first page', () => {
    const payload = { pages: ['https://acme.example/ridge', 'https://acme.example/crest'] };
    const tasks = [
      { id: 't1', taskKey: 'review_findings', status: 'new' },
      { id: 't2', taskKey: 'optimize_content', status: 'new' },
      { id: 't3', taskKey: 'create_content_draft', status: 'in_progress' },
    ];
    expect(suggestionStart(tasks, payload)).toEqual({ taskId: 't3', method: 'create', page: null });
    expect(suggestionStart(tasks.slice(0, 2), payload)).toEqual({
      taskId: 't2',
      method: 'optimize',
      page: 'https://acme.example/ridge',
    });
    expect(suggestionStart(tasks.slice(0, 2), {})).toEqual({
      taskId: 't2',
      method: 'optimize',
      page: null,
    });
  });

  it('starts none when the writing is done, skipped or failed, or there is none', () => {
    const done = ['completed', 'skipped', 'failed'].map((status, i) => ({
      id: `t${i}`,
      taskKey: 'refresh_content',
      status,
    }));
    expect(suggestionStart(done, {})).toBeNull();
    expect(suggestionStart([{ id: 't1', taskKey: null, status: 'new' }], {})).toBeNull();
  });

  it('counts the prompts an action names, its list first', () => {
    expect(actionPromptCount({ promptIds: ['a', 'b'], promptCount: 9 })).toBe(2);
    expect(actionPromptCount({ promptCount: 9 })).toBe(9);
    expect(actionPromptCount({ promptCount: 'nine' })).toBe(0);
  });
});
