import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-009 (spec §3.6): Google queries you don't track yet come from the
 * server, which decides "covers" by Prompt Suggestions' rule, over the
 * range's whole days.
 */

let session: { access_token: string } | null = { access_token: 'tok' };
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getUntrackedGoogleQueries } from './traffic';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T09:30:00.000Z'));
  session = { access_token: 'tok' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('getUntrackedGoogleQueries', () => {
  it("asks the server for the range's whole days and reads the answer", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          lastDay: '2026-10-17',
          since: '2026-10-11',
          until: '2026-10-17',
          count: 2,
          capped: false,
          rows: [{ query: 'cold brew ratio', clicks: '25', impressions: 610 }],
        }),
      ),
    );
    const result = await getUntrackedGoogleQueries(
      'b1',
      { dateFrom: '2026-10-12T09:30:00.000Z' },
      { limit: 1 },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/prompts/untracked-queries/b1?until=2026-10-19&limit=1&since=2026-10-13',
      { headers: { Authorization: 'Bearer tok' } },
    );
    expect(result).toEqual({
      lastDay: '2026-10-17',
      since: '2026-10-11',
      until: '2026-10-17',
      count: 2,
      capped: false,
      rows: [{ query: 'cold brew ratio', clicks: 25, impressions: 610 }],
    });
  });

  it('sends no first day for all time, and throws on a failed read or no session', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ count: 0, rows: [] })));
    await getUntrackedGoogleQueries('b1', undefined);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://api.test/api/prompts/untracked-queries/b1?until=2026-10-19&limit=10',
    );

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
    await expect(getUntrackedGoogleQueries('b1', undefined)).rejects.toThrow('boom');

    session = null;
    await expect(getUntrackedGoogleQueries('b1', undefined)).rejects.toThrow('Not authenticated');
  });
});
