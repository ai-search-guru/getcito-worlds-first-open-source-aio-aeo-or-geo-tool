import { describe, expect, it } from 'vitest';
import {
  bestConvertingPlatform,
  brokenCandidates,
  changeText,
  dailyVisits,
  digestWeek,
  pageCandidates,
  summarySentences,
  topChanges,
  topPlatforms,
  visitChangePct,
} from './summary.js';

/**
 * The AI Traffic weekly digest's words (AT-013, spec §3.8): the page's
 * summary line (AT-007), with its rules, and the week's top three changes.
 */

describe('digestWeek', () => {
  it('reports the last whole Monday-to-Sunday week, whatever day it runs', () => {
    // A Monday morning: the week that ended last night.
    expect(digestWeek(new Date('2026-10-19T02:00:00Z'))).toEqual({
      start: '2026-10-12T00:00:00.000Z',
      end: '2026-10-19T00:00:00.000Z',
      prevStart: '2026-10-05T00:00:00.000Z',
      firstDay: '2026-10-12',
      lastDay: '2026-10-18',
      prevFirstDay: '2026-10-05',
      prevLastDay: '2026-10-11',
    });
    // A Sunday still reports the week before this one.
    expect(digestWeek(new Date('2026-10-25T23:00:00Z')).firstDay).toBe('2026-10-12');
  });
});

describe('the charts', () => {
  const week = digestWeek(new Date('2026-10-19T02:00:00Z'));

  it('gives every day of the week its visits, Monday first, quiet days included', () => {
    expect(
      dailyVisits(week, [
        { day: '2026-10-13', platform: 'chatgpt.com', visits: 3 },
        { day: '2026-10-13', platform: 'grok.com', visits: 1 },
        { day: '2026-10-18', platform: 'chatgpt.com', visits: 2 },
      ]),
    ).toEqual([
      { day: '2026-10-12', visits: 0 },
      { day: '2026-10-13', visits: 4 },
      { day: '2026-10-14', visits: 0 },
      { day: '2026-10-15', visits: 0 },
      { day: '2026-10-16', visits: 0 },
      { day: '2026-10-17', visits: 0 },
      { day: '2026-10-18', visits: 2 },
    ]);
  });

  it('lists the platforms with visits, most first', () => {
    expect(
      topPlatforms([
        { platform: 'perplexity.ai', visits: 11 },
        { platform: 'claude.ai', visits: 0 },
        { platform: 'chatgpt.com', visits: '21' },
        // A key only the public beacon sent, and a referrer nobody named.
        { platform: 'made-up.example', visits: 90 },
        { platform: 'unknown', visits: 40 },
      ]),
    ).toEqual([
      { platform: 'chatgpt.com', visits: 21 },
      { platform: 'perplexity.ai', visits: 11 },
    ]);
  });
});

describe('the summary line', () => {
  it('states a change only when both weeks have 30 visits', () => {
    expect(visitChangePct(42, 60)).toBe(-30);
    expect(visitChangePct(29, 60)).toBeNull();
    expect(visitChangePct(60, 29)).toBeNull();
    expect(visitChangePct(5, 0)).toBeNull();
    expect(visitChangePct(40, 40)).toBeNull();
  });

  it("says what the page says, from Analytics only where it's connected", () => {
    expect(
      summarySentences({
        visits: 42,
        prevVisits: 60,
        platforms: [
          { platform: 'perplexity.ai', visits: 12 },
          { platform: 'chatgpt.com', visits: 30 },
        ],
        gaSessions: 5250,
        platformValue: [
          { platform: 'chatgpt.com', sessions: 30, key_events: 6, key_event_sessions: 6 },
          { platform: 'perplexity.ai', sessions: 31, key_events: 9, key_event_sessions: 9 },
        ],
        citedNotClicked: 3,
        untrackedQueries: 12,
      }),
    ).toEqual([
      'Last week: 42 AI-referred visits, 0.8% of all traffic, down 30% on the week before.',
      'ChatGPT sent the most (30); Perplexity visitors convert best (29% of their visits had a key event).',
      '3 pages are cited in AI answers but get no clicks.',
      "12 Google queries with clicks aren't tracked as prompts.",
    ]);
  });

  it('joins the top and best platform when they are the same, and says nothing it cannot', () => {
    expect(
      summarySentences({
        visits: 1,
        prevVisits: 0,
        platforms: [{ platform: 'grok.com', visits: 1 }],
        gaSessions: null,
        platformValue: null,
        citedNotClicked: 1,
        untrackedQueries: 1,
      }),
    ).toEqual([
      'Last week: 1 AI-referred visit.',
      'Grok sent the most (1).',
      '1 page is cited in AI answers but gets no clicks.',
      "1 Google query with clicks isn't tracked as prompts.",
    ]);
    expect(
      bestConvertingPlatform([
        { platform: 'chatgpt.com', sessions: 40, key_events: 8, key_event_sessions: 8 },
        { platform: 'perplexity.ai', sessions: 30, key_events: 5, key_event_sessions: 3 },
      ]),
    ).toEqual({ platform: 'chatgpt.com', rate: 20 });
    expect(summarySentences({ visits: 0, prevVisits: 4, platforms: [] })).toEqual([
      'Last week: no AI-referred visits.',
    ]);
  });
});

describe('topChanges', () => {
  const week = (platforms, pages) => ({ platforms, pages });

  it('puts broken AI links first, then the biggest moves of 3 visits or more', () => {
    const changes = topChanges({
      prev: week(
        [
          { platform: 'chatgpt.com', visits: 30 },
          { platform: 'perplexity.ai', visits: 10 },
          { platform: 'unknown', visits: 40 },
        ],
        [
          { page: '/menu', visits: 25 },
          { page: '/Gifts', visits: 6 },
        ],
      ),
      cur: week(
        [
          { platform: 'chatgpt.com', visits: 12 },
          { platform: 'perplexity.ai', visits: 11 },
          { platform: 'grok.com', visits: 3 },
          // The beacon is public: a key it was sent isn't a platform.
          { platform: 'made-up.example', visits: 500 },
        ],
        [
          { page: '/menu', visits: 8 },
          { page: '/gifts', visits: 6 },
          // Nor is a path no source but the beacon knows.
          { page: '/buy-now-spam', visits: 400 },
        ],
      ),
      broken: {
        count: 2,
        rows: [
          { page: '/old-menu', target: '/menu', visits: 4, citations: 2 },
          { page: '/old-gifts', target: null, visits: 3, citations: 0 },
        ],
      },
      knownPages: new Set(['/menu', '/gifts']),
    });
    expect(changes).toEqual([
      { type: 'broken', count: 2, page: '/old-menu', target: '/menu' },
      { type: 'platform', name: 'chatgpt.com', before: 30, now: 12 },
      { type: 'page', name: '/menu', before: 25, now: 8 },
    ]);
  });

  it('asks about the pages that moved, and names none it was not told are known', () => {
    const data = {
      prev: week(
        [],
        [
          { page: '/Menu', visits: 10 },
          { page: '/a', visits: 1 },
        ],
      ),
      cur: week(
        [],
        [
          { page: '/menu', visits: 2 },
          { page: '/b', visits: 4 },
        ],
      ),
      broken: null,
    };
    expect(pageCandidates(data)).toEqual(['/b', '/menu']);
    expect(topChanges(data)).toEqual([]);
  });

  // gkhngyk on #1229: the beacon is public, so a broken page or its redirect
  // can be any text a caller sent; and #1228's rule decides what counts.
  it('counts broken links that are cited or have 3 visits, and names only known pages', () => {
    const broken = {
      count: 3,
      rows: [
        { page: '/Free-Crypto-Here', target: '/free-crypto', visits: 5, citations: 0 },
        { page: '/old-menu', target: '/menu-2025', visits: 3, citations: 0 },
        // One stray 404 visit isn't a broken link worth a line.
        { page: '/typo', target: '/', visits: 1, citations: 0 },
      ],
    };
    expect(brokenCandidates(broken)).toEqual(['/free-crypto-here', '/free-crypto']);
    // Neither the page nor the redirect is known: only the count.
    expect(topChanges({ broken, knownPages: new Set(['/menu']) })).toEqual([
      { type: 'broken', count: 2, page: null, target: null },
    ]);
    // The page is known, its redirect isn't.
    expect(topChanges({ broken, knownPages: new Set(['/free-crypto-here']) })).toEqual([
      { type: 'broken', count: 2, page: '/Free-Crypto-Here', target: null },
    ]);
    // AI answers cite it: named, as the signal lists it.
    const cited = {
      count: 1,
      rows: [{ page: '/old-menu', target: '/menu', visits: 1, citations: 4 }],
    };
    expect(topChanges({ broken: cited, knownPages: new Set(['/menu']) })).toEqual([
      { type: 'broken', count: 1, page: '/old-menu', target: '/menu' },
    ]);
    // Only stray visits: no line at all.
    const stray = {
      count: 2,
      rows: [
        { page: '/a', visits: 2 },
        { page: '/b', visits: 1 },
      ],
    };
    expect(topChanges({ broken: stray })).toEqual([]);
    expect(brokenCandidates(stray)).toEqual([]);
  });

  it('names nothing that moved by less than 3 visits', () => {
    expect(
      topChanges({
        prev: week([{ platform: 'chatgpt.com', visits: 10 }], []),
        cur: week([{ platform: 'chatgpt.com', visits: 12 }], []),
        broken: { count: 0, rows: [] },
      }),
    ).toEqual([]);
  });

  it('writes each change in plain words', () => {
    expect(changeText({ type: 'broken', count: 2, page: '/old-menu', target: '/menu' })).toBe(
      '2 pages AI visitors landed on don’t exist: /old-menu, redirect to /menu.',
    );
    expect(changeText({ type: 'broken', count: 1, page: '/', target: null })).toBe(
      '1 page AI visitors landed on doesn’t exist: /.',
    );
    expect(changeText({ type: 'broken', count: 3, page: null, target: null })).toBe(
      '3 pages AI visitors landed on don’t exist.',
    );
    expect(changeText({ type: 'platform', name: 'chatgpt.com', before: 30, now: 12 })).toBe(
      'ChatGPT sent 12 AI visits, down from 30.',
    );
    expect(changeText({ type: 'platform', name: 'grok.com', before: 0, now: 3 })).toBe(
      'Grok sent 3 AI visits, none the week before.',
    );
    expect(changeText({ type: 'page', name: '/new', before: 0, now: 1 })).toBe(
      '/new got 1 AI visit, none the week before.',
    );
    expect(changeText({ type: 'page', name: '/blog/beans', before: 2, now: 14 })).toBe(
      '/blog/beans got 14 AI visits, up from 2.',
    );
  });
});
