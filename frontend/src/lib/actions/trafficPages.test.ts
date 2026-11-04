import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-006 (spec §3.5): the Pages section reads one tab of ai_traffic_pages
 * (00178) at a time, with every tab's count, and turns its rows into the
 * card's shape.
 */

const rpc = vi.fn();
let session: { access_token: string } | null = { access_token: 'tok' };
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc,
    auth: { getSession: async () => ({ data: { session } }) },
  }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getTrafficPages, sendTrafficPagesToActionCenter, suggestPagePrompts } from './traffic';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T12:30:00.000Z'));
  rpc.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  session = { access_token: 'tok' };
});

describe('getTrafficPages', () => {
  it('reads one tab of the range, a slice at a time', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await getTrafficPages(
      'b1',
      { dateFrom: '2026-10-11T12:30:00.000Z' },
      { tab: 'citedNotClicked', limit: 20, offset: 10 },
    );
    expect(rpc).toHaveBeenCalledWith('ai_traffic_pages', {
      p_brand_id: 'b1',
      p_from: '2026-10-11T12:30:00.000Z',
      p_to: '2026-10-18T12:30:00.000Z',
      p_tab: 'cited_not_clicked',
      p_limit: 20,
      p_offset: 10,
    });

    // All time has no start; ten rows unless asked for more.
    await getTrafficPages('b1', undefined, { tab: 'all' });
    expect(rpc).toHaveBeenCalledWith('ai_traffic_pages', {
      p_brand_id: 'b1',
      p_from: null,
      p_to: null,
      p_tab: 'all',
      p_limit: 10,
      p_offset: 0,
    });
  });

  it('gives every tab its count and each row in the card’s terms', async () => {
    // Broken AI links are counted on their own (AT-012).
    const brokenLinks = { data: { count: 2, rows: [] }, error: null };
    rpc.mockImplementation(async (name: string) =>
      name === 'ai_traffic_pages' ? pages : brokenLinks,
    );
    const pages = {
      data: {
        counts: {
          all: 14,
          no_ai_traffic: 8,
          cited_not_clicked: 1,
          traffic_no_prompt: 5,
          broken_ai_links: 2,
        },
        rows: [
          {
            page: '/subscriptions',
            ai_visits: 2,
            ai_key_events: 1,
            ai_platforms: ['chatgpt.com'],
            citations: 4,
            targeting_prompts: 1,
            sessions: 90,
            engaged_sessions: 60,
            key_events: 7,
            transactions: 3,
            revenue: '129.50',
            engagement_seconds: 5400,
            in_sitemap: true,
            broken: true,
            value_rank: 2,
          },
          { page: '/menu', ai_platforms: null, in_sitemap: false, value_rank: null },
        ],
      },
      error: null,
    };

    expect(await getTrafficPages('b1', undefined, { tab: 'all' })).toEqual({
      counts: { noAiTraffic: 8, citedNotClicked: 1, trafficNoPrompt: 5, brokenAiLinks: 2, all: 14 },
      rows: [
        {
          page: '/subscriptions',
          aiVisits: 2,
          aiKeyEvents: 1,
          aiPlatforms: ['chatgpt.com'],
          citations: 4,
          targetingPrompts: 1,
          sessions: 90,
          engagedSessions: 60,
          keyEvents: 7,
          transactions: 3,
          revenue: 129.5,
          engagementSeconds: 5400,
          inSitemap: true,
          broken: true,
          valueRank: 2,
        },
        {
          page: '/menu',
          aiVisits: 0,
          aiKeyEvents: 0,
          aiPlatforms: [],
          citations: 0,
          targetingPrompts: 0,
          sessions: 0,
          engagedSessions: 0,
          keyEvents: 0,
          transactions: 0,
          revenue: 0,
          engagementSeconds: 0,
          inSitemap: false,
          broken: false,
          valueRank: null,
        },
      ],
      brokenLinks: [],
    });
  });

  it('gives empty lists for a brand outside the organization', async () => {
    // 00178 answers null rather than another brand's pages.
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getTrafficPages('b1', undefined, { tab: 'noAiTraffic' })).toEqual({
      counts: { noAiTraffic: 0, citedNotClicked: 0, trafficNoPrompt: 0, brokenAiLinks: 0, all: 0 },
      rows: [],
      brokenLinks: [],
    });
  });

  it('fails loudly when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'unknown tab' } });
    await expect(getTrafficPages('b1', undefined, { tab: 'all' })).rejects.toThrow('unknown tab');
  });
});

describe('sendTrafficPagesToActionCenter (part B)', () => {
  it('posts the pages, their list and the page range for the signed-in member', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ actionId: 'a1', actionNo: 71, created: true }), {
          status: 201,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTrafficPagesToActionCenter(
      'b1',
      { dateFrom: '2026-10-11T12:30:00.000Z' },
      ['/gifts', '/menu'],
      'no_ai_traffic',
    );
    expect(result).toEqual({ actionId: 'a1', actionNo: 71, created: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/action-center/pages');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(JSON.parse(init.body as string)).toEqual({
      brandId: 'b1',
      pages: ['/gifts', '/menu'],
      reason: 'no_ai_traffic',
      from: '2026-10-11T12:30:00.000Z',
      to: '2026-10-18T12:30:00.000Z',
    });
  });

  it("returns the server's reason rather than throwing it", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Failed to send to the Action Center',
              details: 'None of these pages are on the list for this range',
            }),
            { status: 404 },
          ),
      ),
    );
    expect(
      await sendTrafficPagesToActionCenter('b1', undefined, ['/menu'], 'cited_not_clicked'),
    ).toEqual({ error: 'None of these pages are on the list for this range' });

    session = null;
    expect(
      await sendTrafficPagesToActionCenter('b1', undefined, ['/menu'], 'cited_not_clicked'),
    ).toEqual({ error: 'Not authenticated' });
  });
});

describe('suggestPagePrompts (part B2)', () => {
  it("asks the server for the page's prompts over the page range", async () => {
    const answer = {
      page: { path: '/gifts', title: 'Coffee gifts' },
      queries: 1,
      suggestions: [],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(
      await suggestPagePrompts('b1', { dateFrom: '2026-10-11T12:30:00.000Z' }, '/gifts'),
    ).toEqual(answer);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/prompts/suggestions/b1/page');
    expect(JSON.parse(init.body as string)).toEqual({
      page: '/gifts',
      from: '2026-10-11T12:30:00.000Z',
      to: '2026-10-18T12:30:00.000Z',
    });
  });

  it("returns the server's reason, a plan limit's message first", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: 'plan_limit', message: 'Your plan has no suggestions.' }),
            { status: 403 },
          ),
      ),
    );
    expect(await suggestPagePrompts('b1', undefined, '/gifts')).toEqual({
      error: 'Your plan has no suggestions.',
    });
  });
});
