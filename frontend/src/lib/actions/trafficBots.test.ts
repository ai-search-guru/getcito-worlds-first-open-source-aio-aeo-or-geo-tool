import { describe, expect, it, vi } from 'vitest';

/** AT-011 (spec §3.7): the AI bot report reads ai_bot_report (00185) over the range's days. */

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getTrafficBots } from './traffic';

describe('getTrafficBots', () => {
  it('reads the types, bots, pages and the search-bot alert', async () => {
    rpc.mockResolvedValue({
      data: {
        first_day: '2026-09-01',
        last_seen: '2026-10-19T09:30:00Z',
        types: [
          {
            type: 'search',
            hits: '30',
            pages: 12,
            last_seen: '2026-10-19T09:30:00Z',
            bots: ['oai-searchbot'],
          },
        ],
        bots: [{ bot: 'oai-searchbot', type: 'search', hits: 30, pages: 12, last_seen: null }],
        page_count: 12,
        pages: [
          {
            page: '/menu',
            hits: 9,
            training_last: null,
            search_last: '2026-10-19T09:30:00Z',
            user_last: null,
          },
        ],
        uncrawled_count: 2,
        uncrawled: [{ page: '/gifts', citations: '14' }],
        alert_state: 'on',
        alert_from: '2026-09-30',
        since: '2026-10-12',
      },
      error: null,
    });
    const result = await getTrafficBots('b1', {
      dateFrom: '2026-10-12T09:00:00.000Z',
      dateTo: '2026-10-19',
    });
    expect(rpc).toHaveBeenCalledWith('ai_bot_report', {
      p_brand_id: 'b1',
      p_since: '2026-10-12',
      p_until: '2026-10-19',
      p_limit: 10,
    });
    expect(result).toEqual({
      firstDay: '2026-09-01',
      lastSeen: '2026-10-19T09:30:00Z',
      types: [
        {
          type: 'search',
          hits: 30,
          pages: 12,
          lastSeen: '2026-10-19T09:30:00Z',
          bots: ['oai-searchbot'],
        },
      ],
      bots: [{ bot: 'oai-searchbot', type: 'search', hits: 30, pages: 12, lastSeen: null }],
      pageCount: 12,
      pages: [
        {
          page: '/menu',
          hits: 9,
          trainingLast: null,
          searchLast: '2026-10-19T09:30:00Z',
          userLast: null,
        },
      ],
      uncrawledCount: 2,
      uncrawled: [{ page: '/gifts', citations: 14 }],
      alertState: 'on',
      alertFrom: '2026-09-30',
      since: '2026-10-12',
    });
  });

  it('reads the alert as not started before 30 days of bot data, and throws on a failed read', async () => {
    rpc.mockResolvedValue({
      data: {
        types: [],
        bots: [],
        pages: [],
        page_count: 0,
        uncrawled_count: null,
        uncrawled: null,
      },
      error: null,
    });
    const report = await getTrafficBots('b1', undefined);
    expect(report).toMatchObject({ uncrawledCount: null, uncrawled: null, lastSeen: null });
    expect(rpc.mock.calls.at(-1)?.[1].p_since).toBeNull();

    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getTrafficBots('b1', undefined)).rejects.toThrow('boom');
  });
});
