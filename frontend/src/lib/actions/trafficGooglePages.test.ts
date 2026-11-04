import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-008 (spec §3.6): Is AI taking Google clicks? reads ai_traffic_google_pages
 * (00181) over the range's whole days, ending on Google's latest reported day.
 */

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getTrafficGooglePages } from './traffic';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T09:30:00.000Z'));
  rpc.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getTrafficGooglePages', () => {
  it('asks for the range ending on the latest reported day, and reads the rows', async () => {
    rpc.mockResolvedValue({
      data: {
        last_day: '2026-10-17',
        since: '2026-10-11',
        until: '2026-10-17',
        prev_since: '2026-10-04',
        prev_until: '2026-10-10',
        count: 3,
        rows: [
          {
            page: '/blog/how-to',
            url: 'https://acme.example/blog/how-to',
            impressions: '1420',
            prev_impressions: 1000,
            clicks: 14,
            prev_clicks: 31,
            prompt_id: 'p1',
          },
          {
            page: '/faq',
            url: 'https://acme.example/faq',
            impressions: 300,
            prev_impressions: 200,
            clicks: 2,
            prev_clicks: 8,
            prompt_id: null,
          },
        ],
      },
      error: null,
    });

    const result = await getTrafficGooglePages('b1', {
      dateFrom: '2026-10-12T09:30:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('ai_traffic_google_pages', {
      p_brand_id: 'b1',
      p_since: '2026-10-13',
      p_until: '2026-10-19',
      p_latest: true,
      p_min_impressions: 100,
      p_limit: 10,
    });
    expect(result).toMatchObject({
      lastDay: '2026-10-17',
      since: '2026-10-11',
      prevUntil: '2026-10-10',
      incomplete: false,
      count: 3,
    });
    expect(result.rows).toEqual([
      {
        page: '/blog/how-to',
        url: 'https://acme.example/blog/how-to',
        impressions: 1420,
        prevImpressions: 1000,
        clicks: 14,
        prevClicks: 31,
        promptId: 'p1',
      },
      {
        page: '/faq',
        url: 'https://acme.example/faq',
        impressions: 300,
        prevImpressions: 200,
        clicks: 2,
        prevClicks: 8,
        promptId: null,
      },
    ]);
  });

  it('sends no first day for all time, and throws when the read fails', async () => {
    rpc.mockResolvedValue({
      data: { last_day: '2026-10-17', since: null, until: null, count: 0, rows: [] },
      error: null,
    });
    const all = await getTrafficGooglePages('b1', undefined, { limit: 100_000 });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_since: null,
      p_until: '2026-10-19',
      p_limit: 100_000,
    });
    expect(all).toMatchObject({ lastDay: '2026-10-17', since: null, rows: [] });

    rpc.mockResolvedValue({
      data: { last_day: '2026-10-17', since: '2026-07-01', incomplete: true, count: 0, rows: [] },
      error: null,
    });
    await expect(getTrafficGooglePages('b1', undefined)).resolves.toMatchObject({
      incomplete: true,
      rows: [],
    });

    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getTrafficGooglePages('b1', undefined)).rejects.toThrow('boom');
  });
});
