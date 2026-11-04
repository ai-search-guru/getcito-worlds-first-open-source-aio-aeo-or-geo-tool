import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-008 (spec §3.3): the trend's "vs Google clicks" view reads Search
 * Console's clicks per day and the event markers from ai_traffic_google_trend
 * (00180), between the trend's first and last day.
 */

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getTrafficGoogleTrend } from './traffic';

beforeEach(() => {
  rpc.mockReset();
});

describe('getTrafficGoogleTrend', () => {
  it('reads the days between the two given, with the markers', async () => {
    rpc.mockResolvedValue({
      data: {
        first_day: '2026-07-21',
        last_day: '2026-10-16',
        clicks: [
          { day: '2026-10-12', clicks: '410' },
          { day: '2026-10-13', clicks: 388 },
        ],
        markers: [{ day: '2026-10-13', actions: 2, prompts: '5' }],
      },
      error: null,
    });

    await expect(getTrafficGoogleTrend('b1', '2026-10-12', '2026-10-18')).resolves.toEqual({
      firstDay: '2026-07-21',
      lastDay: '2026-10-16',
      clicks: [
        { day: '2026-10-12', clicks: 410 },
        { day: '2026-10-13', clicks: 388 },
      ],
      markers: [{ day: '2026-10-13', actions: 2, prompts: 5 }],
    });
    expect(rpc).toHaveBeenCalledWith('ai_traffic_google_trend', {
      p_brand_id: 'b1',
      p_since: '2026-10-12',
      p_until: '2026-10-18',
    });
  });

  it('reads no Search Console days as none', async () => {
    rpc.mockResolvedValue({
      data: { first_day: null, last_day: null, clicks: [], markers: [] },
      error: null,
    });
    await expect(getTrafficGoogleTrend('b1', '2026-10-12', '2026-10-18')).resolves.toEqual({
      firstDay: null,
      lastDay: null,
      clicks: [],
      markers: [],
    });
  });

  it('throws when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getTrafficGoogleTrend('b1', '2026-10-12', '2026-10-18')).rejects.toThrow('boom');
  });
});
