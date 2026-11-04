import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-012 (spec §3.5): Broken AI links read ai_traffic_broken_links (00186)
 * over the page's range, and the Pages section counts them with its tabs.
 */

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getTrafficBrokenLinks, getTrafficPages } from './traffic';

const BRAND = '33333333-3333-3333-3333-333333333333';
const WEEK = { dateFrom: '2026-10-12T09:00:00.000Z', dateTo: '2026-10-19T09:00:00.000Z' };

const link = {
  page: '/guides/espresso-machine-for-beginner',
  visits: '3',
  platforms: ['chatgpt.com', 'perplexity.ai'],
  citations: 14,
  last_visit: '2026-10-19T08:27:11.697849+00:00',
  status: '404',
  target: '/guides/espresso-machines-for-beginners',
  target_reason: 'similar',
};

beforeEach(() => rpc.mockReset());

describe('getTrafficBrokenLinks', () => {
  it('reads each missing page with its visits and suggested redirect', async () => {
    rpc.mockResolvedValue({
      data: {
        count: 3,
        rows: [
          link,
          {
            page: '/',
            visits: 1,
            platforms: null,
            citations: null,
            last_visit: '2026-10-18T12:00:00+00:00',
            status: 'title',
            target: null,
            target_reason: null,
          },
          {
            page: '/index.php',
            visits: 2,
            platforms: ['chatgpt.com'],
            citations: 0,
            last_visit: '2026-10-18T10:00:00+00:00',
            status: '404',
            target: null,
            target_reason: 'query',
          },
        ],
      },
      error: null,
    });

    const result = await getTrafficBrokenLinks(BRAND, WEEK, { limit: 20 });

    expect(rpc).toHaveBeenCalledWith('ai_traffic_broken_links', {
      p_brand_id: BRAND,
      p_from: WEEK.dateFrom,
      p_to: expect.stringMatching(/^2026-10-19T/),
      p_limit: 20,
      p_offset: 0,
    });
    expect(result).toEqual({
      count: 3,
      rows: [
        {
          page: '/guides/espresso-machine-for-beginner',
          visits: 3,
          platforms: ['chatgpt.com', 'perplexity.ai'],
          citations: 14,
          lastVisit: '2026-10-19T08:27:11.697849+00:00',
          status: '404',
          target: '/guides/espresso-machines-for-beginners',
          targetReason: 'similar',
        },
        {
          page: '/',
          visits: 1,
          platforms: [],
          citations: 0,
          lastVisit: '2026-10-18T12:00:00+00:00',
          status: 'title',
          target: null,
          targetReason: null,
        },
        // A route on the page: no redirect, and the reason says why.
        {
          page: '/index.php',
          visits: 2,
          platforms: ['chatgpt.com'],
          citations: 0,
          lastVisit: '2026-10-18T10:00:00+00:00',
          status: '404',
          target: null,
          targetReason: 'query',
        },
      ],
    });
  });

  // 00200: a single-page app's route that shows its not-found page with a 200.
  it('reads a soft 404, and an unknown status as a 404', async () => {
    rpc.mockResolvedValue({
      data: {
        count: 2,
        rows: [
          { ...link, page: '/app/old-route', status: 'soft404' },
          { ...link, page: '/x', status: 'teapot' },
        ],
      },
      error: null,
    });
    const result = await getTrafficBrokenLinks(BRAND, WEEK);
    expect(result.rows.map((r) => [r.page, r.status])).toEqual([
      ['/app/old-route', 'soft404'],
      ['/x', '404'],
    ]);
  });

  it('throws on a failed read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(getTrafficBrokenLinks(BRAND, WEEK)).rejects.toThrow('permission denied');
  });
});

describe('getTrafficPages: Broken AI links', () => {
  const answer = (name: string) =>
    name === 'ai_traffic_pages'
      ? {
          data: {
            counts: {
              all: 14,
              no_ai_traffic: 3,
              cited_not_clicked: 1,
              traffic_no_prompt: 2,
              broken_ai_links: 6,
            },
            rows: [],
          },
          error: null,
        }
      : { data: { count: 6, rows: [link] }, error: null };

  it('counts the broken links with the other tabs, and reads none of their rows elsewhere', async () => {
    rpc.mockImplementation(async (name: string) => answer(name));

    const result = await getTrafficPages(BRAND, WEEK, { tab: 'noAiTraffic', limit: 10 });

    expect(result.counts).toEqual({
      noAiTraffic: 3,
      citedNotClicked: 1,
      trafficNoPrompt: 2,
      brokenAiLinks: 6,
      all: 14,
    });
    expect(rpc).toHaveBeenCalledWith(
      'ai_traffic_pages',
      expect.objectContaining({ p_tab: 'no_ai_traffic', p_limit: 10 }),
    );
    // The count comes with the other tabs': the broken list isn't read for it.
    expect(rpc).not.toHaveBeenCalledWith('ai_traffic_broken_links', expect.anything());
  });

  it('keeps the card up when the broken list fails on its own tab', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockImplementation(async (name: string) =>
      name === 'ai_traffic_pages' ? answer(name) : { data: null, error: { message: 'timeout' } },
    );
    const result = await getTrafficPages(BRAND, WEEK, { tab: 'brokenAiLinks', limit: 10 });
    expect(result.counts.brokenAiLinks).toBe(6);
    expect(result.brokenLinks).toEqual([]);
  });

  it('reads the broken links as the tab, and only the counts of the rest', async () => {
    rpc.mockImplementation(async (name: string) => answer(name));

    const result = await getTrafficPages(BRAND, WEEK, {
      tab: 'brokenAiLinks',
      limit: 20,
      offset: 10,
    });

    expect(result.brokenLinks.map((row) => row.page)).toEqual([
      '/guides/espresso-machine-for-beginner',
    ]);
    expect(rpc).toHaveBeenCalledWith(
      'ai_traffic_pages',
      expect.objectContaining({ p_tab: 'all', p_limit: 0, p_offset: 0 }),
    );
    expect(rpc).toHaveBeenCalledWith(
      'ai_traffic_broken_links',
      expect.objectContaining({ p_limit: 20, p_offset: 10 }),
    );
  });
});
