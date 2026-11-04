import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-004 (spec §5.2): the AI Traffic page's summary reads the snippet and
 * Google Analytics day by day through ai_traffic_merged (00176) — the
 * snippet on days it was active, Analytics on the others, never summed —
 * for the range and the period before it. The 24-hour range reads the
 * snippet alone.
 */

type Merged = {
  visits: number;
  pageviews: number;
  analytics_days: string[];
  platforms: { platform: string; visits: number }[];
  pages: { page: string; visits: number }[];
  days: { day: string; platform: string; visits: number }[];
};

const CURRENT: Merged = {
  visits: 167,
  pageviews: 6,
  analytics_days: ['2026-10-12', '2026-10-13'],
  platforms: [
    { platform: 'chatgpt.com', visits: 116 },
    { platform: 'perplexity.ai', visits: 47 },
    { platform: 'gemini.google.com', visits: 4 },
  ],
  pages: [
    { page: '/menu', visits: 115 },
    { page: '/pricing', visits: 46 },
    { page: '/faq', visits: 6 },
  ],
  days: [],
};
const PREVIOUS: Merged = {
  visits: 40,
  pageviews: 0,
  analytics_days: [],
  platforms: [{ platform: 'chatgpt.com', visits: 40 }],
  pages: [{ page: '/menu', visits: 40 }],
  days: [],
};

// Google Analytics' engagement per platform (AT-005).
const PLATFORM_VALUE = [
  {
    platform: 'chatgpt.com',
    sessions: 120,
    engaged_sessions: 80,
    key_events: 9,
    key_event_sessions: 7,
  },
];

// How often tracked answers cite each page, by its lower-cased path (AT-006).
const CITATIONS = [{ page_key: '/menu', page: '/Menu', citations: 9 }];

/** The reads beside the merged one, which answer the same whatever the range. */
const OTHER_READS: Record<string, unknown> = {
  ga_platform_value: PLATFORM_VALUE,
  ai_traffic_page_citations: CITATIONS,
};

const rpc = vi.fn();

/** The merged read answers `merged`; the other reads stay as above. */
const answerMerged = (merged: Merged) =>
  rpc.mockImplementation(async (fn: string) => ({
    data: OTHER_READS[fn] ?? merged,
    error: null,
  }));
let snippetCount = 0;
let analyticsRows: { id: string }[] = [];

function query() {
  const builder: Record<string, unknown> = {};
  let head = false;
  for (const method of ['select', 'eq', 'is', 'gt', 'gte', 'lte', 'lt', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      if (method === 'select') head = (args[1] as { head?: boolean } | undefined)?.head === true;
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(head ? { count: snippetCount, error: null } : { data: analyticsRows, error: null });
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => query(), rpc }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getTrafficSummary } from './traffic';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T12:30:00.000Z'));
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args: { p_to_inclusive: boolean }) => ({
    data: OTHER_READS[fn] ?? (args.p_to_inclusive ? CURRENT : PREVIOUS),
    error: null,
  }));
  snippetCount = 6;
  analyticsRows = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getTrafficSummary', () => {
  it('reads the range and the period before from the snippet and Google Analytics', async () => {
    await getTrafficSummary('b1', { dateFrom: '2026-10-11T12:30:00.000Z' });

    expect(rpc).toHaveBeenCalledWith('ai_traffic_merged', {
      p_brand_id: 'b1',
      p_from: '2026-10-11T12:30:00.000Z',
      p_to: '2026-10-18T12:30:00.000Z',
      p_to_inclusive: true,
      p_analytics: true,
    });
    // The previous period ends where the range starts, without its last moment.
    expect(rpc).toHaveBeenCalledWith('ai_traffic_merged', {
      p_brand_id: 'b1',
      p_from: '2026-10-04T12:30:00.000Z',
      p_to: '2026-10-11T12:30:00.000Z',
      p_to_inclusive: false,
      p_analytics: true,
    });
  });

  it('gives the visits, pageviews, Analytics days and breakdowns against the period before', async () => {
    const summary = await getTrafficSummary('b1', { dateFrom: '2026-10-11T12:30:00.000Z' });

    expect(summary).toMatchObject({
      totalVisits: 167,
      totalVisitsPrev: 40,
      totalPageviews: 6,
      analyticsDays: ['2026-10-12', '2026-10-13'],
      hasPreviousPeriod: true,
      hasAnyData: true,
    });
    expect(summary.platformBreakdown).toEqual([
      {
        platform: 'chatgpt.com',
        visits: 116,
        visitsPrev: 40,
        analytics: { sessions: 120, engagedSessions: 80, keyEvents: 9, keyEventSessions: 7 },
        surfaces: [],
      },
      // Platforms Analytics never saw have no engagement figures.
      { platform: 'perplexity.ai', visits: 47, visitsPrev: 0, analytics: null, surfaces: [] },
      { platform: 'gemini.google.com', visits: 4, visitsPrev: 0, analytics: null, surfaces: [] },
    ]);
    // Over the range's days, as the KPI cards read Analytics.
    expect(rpc).toHaveBeenCalledWith('ga_platform_value', {
      p_brand_id: 'b1',
      p_since: '2026-10-11',
      p_until: '2026-10-18',
    });
    // Answers cite /menu whatever the case of its path (AT-006).
    expect(summary.topPages[0]).toEqual({
      url: '/menu',
      visits: 115,
      visitsPrev: 40,
      citations: 9,
    });
    expect(summary.topPages[1].citations).toBe(0);
    expect(rpc).toHaveBeenCalledWith('ai_traffic_page_citations', {
      p_brand_id: 'b1',
      p_since: '2026-10-11',
      p_until: '2026-10-18',
    });
  });

  // #1283: ChatGPT Shopping's product cards, part of ChatGPT's visits (00251).
  it("gives a platform's surfaces under it, with their own change and Analytics figures", async () => {
    rpc.mockImplementation(async (fn: string, args: { p_to_inclusive: boolean }) => {
      if (fn === 'ga_platform_value') {
        return {
          data: [
            {
              ...PLATFORM_VALUE[0],
              surfaces: [
                {
                  surface: 'shopping',
                  sessions: 30,
                  engaged_sessions: 24,
                  key_events: 5,
                  key_event_sessions: 4,
                },
              ],
            },
          ],
          error: null,
        };
      }
      if (fn !== 'ai_traffic_merged') return { data: OTHER_READS[fn], error: null };
      return {
        data: args.p_to_inclusive
          ? {
              ...CURRENT,
              surfaces: [
                { platform: 'chatgpt.com', surface: 'shopping', visits: 31 },
                // A surface this page doesn't know yet stays in its platform's row.
                { platform: 'perplexity.ai', surface: 'travel', visits: 3 },
              ],
            }
          : {
              ...PREVIOUS,
              surfaces: [{ platform: 'chatgpt.com', surface: 'shopping', visits: 9 }],
            },
        error: null,
      };
    });

    const summary = await getTrafficSummary('b1', { dateFrom: '2026-10-11T12:30:00.000Z' });

    const [chatgpt, perplexity] = summary.platformBreakdown;
    // ChatGPT's own total still includes its Shopping visits.
    expect(chatgpt).toMatchObject({
      platform: 'chatgpt.com',
      visits: 116,
      analytics: { sessions: 120, engagedSessions: 80, keyEvents: 9, keyEventSessions: 7 },
    });
    expect(chatgpt.surfaces).toEqual([
      {
        surface: 'shopping',
        visits: 31,
        visitsPrev: 9,
        analytics: { sessions: 30, engagedSessions: 24, keyEvents: 5, keyEventSessions: 4 },
      },
    ]);
    expect(perplexity.surfaces).toEqual([]);
    expect(summary.totalVisits).toBe(167);
  });

  it('keeps the top 10 pages for the page, and all of them for an export', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({ page: `/p${i}`, visits: 12 - i }));
    answerMerged({ ...CURRENT, pages });
    const window = { dateFrom: '2026-10-11T12:30:00.000Z' };
    expect((await getTrafficSummary('b1', window)).topPages).toHaveLength(10);
    expect(
      (await getTrafficSummary('b1', window, { topPages: Number.MAX_SAFE_INTEGER })).topPages,
    ).toHaveLength(12);
  });

  it('reads the last 24 hours from the snippet alone: Google Analytics has no hours', async () => {
    await getTrafficSummary('b1', { dateFrom: '2026-10-17T12:30:00.000Z' });
    for (const [fn, args] of rpc.mock.calls) {
      if (fn === 'ai_traffic_merged') expect(args.p_analytics).toBe(false);
    }
  });

  it('reads all time from the start, with no period before', async () => {
    const summary = await getTrafficSummary('b1', {});
    expect(rpc.mock.calls.filter(([fn]) => fn === 'ai_traffic_merged')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith(
      'ai_traffic_merged',
      expect.objectContaining({ p_from: null, p_to: null }),
    );
    expect(summary.hasPreviousPeriod).toBe(false);
    expect(summary.totalVisitsPrev).toBe(0);
    expect(summary.hasAnyData).toBe(true);
  });

  it('counts a brand with only Google Analytics history as having data', async () => {
    answerMerged({ ...CURRENT, visits: 0, platforms: [], pages: [] });
    snippetCount = 0;
    analyticsRows = [{ id: 'ga1' }];
    const window = { dateFrom: '2026-10-17T12:30:00.000Z' };
    expect((await getTrafficSummary('b1', window)).hasAnyData).toBe(true);

    analyticsRows = [];
    expect((await getTrafficSummary('b1', window)).hasAnyData).toBe(false);
  });

  it('fails loudly when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    // (Both the merged read and the platform figures fail; either one is enough.)
    await expect(getTrafficSummary('b1', { dateFrom: '2026-10-11T12:30:00.000Z' })).rejects.toThrow(
      'permission denied',
    );
  });
});
