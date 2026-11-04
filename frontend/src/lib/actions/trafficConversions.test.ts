import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-014 (spec §3.4b): where AI visitors convert reads ai_traffic_conversions
 * (00179) over the page's days, and a short range with fewer than 30 AI
 * visits reads the last 30 days instead.
 */

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getTrafficConversions } from './traffic';

const answer = (sessions: number) => ({
  data: {
    sessions,
    has_revenue: true,
    page_count: 1,
    answer_count: 1,
    pages: [
      {
        page: '/gifts',
        sessions: 50,
        key_events: 5,
        key_event_sessions: 4,
        transactions: 1,
        revenue: '120.5',
        best_platform: 'chatgpt.com',
      },
    ],
    answers: [
      {
        platform: 'chatgpt.com',
        topic_id: 't1',
        topic: 'Coffee gifts',
        pages: 1,
        sessions: 40,
        key_events: 4,
        key_event_sessions: 3,
        revenue: 120.5,
      },
    ],
  },
  error: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T12:30:00.000Z'));
  rpc.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getTrafficConversions', () => {
  it("reads the range's days and turns the rows into the cards' shape", async () => {
    rpc.mockResolvedValue(answer(75));
    const result = await getTrafficConversions('b1', { dateFrom: '2026-10-11T12:30:00.000Z' });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('ai_traffic_conversions', {
      p_brand_id: 'b1',
      p_since: '2026-10-11',
      p_until: '2026-10-18',
      p_limit: 10,
    });
    expect(result).toEqual({
      aiVisits: 75,
      hasRevenue: true,
      widened: false,
      pageCount: 1,
      answerCount: 1,
      pages: [
        {
          page: '/gifts',
          aiVisits: 50,
          keyEvents: 5,
          keyEventSessions: 4,
          transactions: 1,
          revenue: 120.5,
          bestPlatform: 'chatgpt.com',
        },
      ],
      answers: [
        {
          platform: 'chatgpt.com',
          topicId: 't1',
          topic: 'Coffee gifts',
          pages: 1,
          aiVisits: 40,
          keyEvents: 4,
          keyEventSessions: 3,
          revenue: 120.5,
        },
      ],
    });
  });

  it('reads the last 30 days when a short range has fewer than 30 AI visits', async () => {
    rpc.mockResolvedValueOnce(answer(4)).mockResolvedValueOnce(answer(64));
    const result = await getTrafficConversions(
      'b1',
      { dateFrom: '2026-10-17T12:30:00.000Z' },
      { limit: 100 },
    );

    expect(rpc).toHaveBeenLastCalledWith('ai_traffic_conversions', {
      p_brand_id: 'b1',
      p_since: '2026-09-18',
      p_until: '2026-10-18',
      p_limit: 100,
    });
    expect(result).toMatchObject({ widened: true, aiVisits: 64 });
  });

  it('keeps all time as it is, and gives empty cards for a brand outside the organization', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getTrafficConversions('b1', undefined)).toEqual({
      aiVisits: 0,
      hasRevenue: false,
      widened: false,
      pageCount: 0,
      answerCount: 0,
      pages: [],
      answers: [],
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_since: null, p_until: null });
  });

  it('fails loudly when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getTrafficConversions('b1', undefined)).rejects.toThrow('boom');
  });
});
