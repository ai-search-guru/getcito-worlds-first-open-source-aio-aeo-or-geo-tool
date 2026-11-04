import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-017 (spec §3.2): the KPI cards' Google totals come from two database
 * functions, asked for only when their source has data, with Search
 * Console's short ranges ending on its latest reported day.
 */

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: (fn: string, args: Record<string, unknown>) => ({ single: () => rpc(fn, args) }),
  }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getTrafficGoogleTotals } from './traffic';

const GA_ROW = {
  sessions: 812,
  ai_sessions: 4,
  ai_engaged_sessions: 3,
  ai_key_events: 1,
  ai_key_event_sessions: 1,
  ai_revenue: 149.9,
  organic_sessions: 1000,
  organic_engaged_sessions: 580,
  organic_key_events: 60,
  organic_key_event_sessions: 50,
};
const GSC_ROW = {
  since: '2026-10-16',
  until: '2026-10-16',
  clicks: 36,
  prev_clicks: 30,
  last_date: '2026-10-16',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T12:30:00.000Z'));
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) => ({
    data: fn === 'ga_traffic_totals' ? GA_ROW : GSC_ROW,
    error: null,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

const DAY = { dateFrom: '2026-10-17T12:30:00.000Z' };

describe('getTrafficGoogleTotals', () => {
  it("reads the range's days, and Search Console's latest reported day for 24 hours", async () => {
    const totals = await getTrafficGoogleTotals('b1', DAY, {
      ga: true,
      gsc: true,
      gscLatestDays: 1,
    });

    expect(rpc).toHaveBeenCalledWith('ga_traffic_totals', {
      p_brand_id: 'b1',
      p_since: '2026-10-17',
      p_until: '2026-10-18',
    });
    expect(rpc).toHaveBeenCalledWith('gsc_click_totals', {
      p_brand_id: 'b1',
      p_since: '2026-10-18',
      p_until: '2026-10-18',
      p_latest: true,
    });
    expect(totals).toEqual({
      ga: {
        sessions: 812,
        aiSessions: 4,
        aiEngagedSessions: 3,
        aiKeyEvents: 1,
        aiKeyEventSessions: 1,
        aiRevenue: 149.9,
        // Google organic, the page's comparison (AT-005).
        organic: { sessions: 1000, engagedSessions: 580, keyEvents: 60, keyEventSessions: 50 },
      },
      gsc: {
        since: '2026-10-16',
        until: '2026-10-16',
        clicks: 36,
        prevClicks: 30,
      },
    });
  });

  it("asks for a week's worth of Search Console's latest days", async () => {
    await getTrafficGoogleTotals(
      'b1',
      { dateFrom: '2026-10-11T12:30:00.000Z' },
      { ga: false, gsc: true, gscLatestDays: 7 },
    );
    expect(rpc).toHaveBeenCalledWith('gsc_click_totals', {
      p_brand_id: 'b1',
      p_since: '2026-10-12',
      p_until: '2026-10-18',
      p_latest: true,
    });
  });

  it('reads a custom range as it is, and all time from the start', async () => {
    await getTrafficGoogleTotals(
      'b1',
      { dateFrom: '2026-09-01', dateTo: '2026-09-30T23:59:59.999Z' },
      { ga: true, gsc: true, gscLatestDays: null },
    );
    expect(rpc).toHaveBeenCalledWith('gsc_click_totals', {
      p_brand_id: 'b1',
      p_since: '2026-09-01',
      p_until: '2026-09-30',
      p_latest: false,
    });

    rpc.mockClear();
    await getTrafficGoogleTotals('b1', {}, { ga: true, gsc: false, gscLatestDays: null });
    expect(rpc).toHaveBeenCalledWith('ga_traffic_totals', {
      p_brand_id: 'b1',
      p_since: null,
      p_until: '2026-10-18',
    });
  });

  it("doesn't ask a source without data", async () => {
    const totals = await getTrafficGoogleTotals('b1', DAY, {
      ga: false,
      gsc: false,
      gscLatestDays: 1,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(totals).toEqual({ ga: null, gsc: null });
  });

  it('keeps no previous period for all time', async () => {
    rpc.mockResolvedValue({
      data: { ...GSC_ROW, since: null, prev_clicks: null },
      error: null,
    });
    const totals = await getTrafficGoogleTotals(
      'b1',
      {},
      {
        ga: false,
        gsc: true,
        gscLatestDays: null,
      },
    );
    expect(totals.gsc).toMatchObject({ since: null, prevClicks: null });
  });

  it('fails loudly when a read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(
      getTrafficGoogleTotals('b1', DAY, { ga: true, gsc: false, gscLatestDays: 1 }),
    ).rejects.toThrow('permission denied');
  });
});
