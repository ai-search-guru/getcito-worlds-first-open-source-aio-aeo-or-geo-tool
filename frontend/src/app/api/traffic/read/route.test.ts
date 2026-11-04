import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/traffic/read: one of the AI Traffic page's reads by name, run
 * with the member's session; a route so the page's reads run side by side.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
let user: { id: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}));

const reads = vi.hoisted(() => ({
  getTrafficSummary: vi.fn(),
  getTrafficPages: vi.fn(),
  getBotConnections: vi.fn(),
}));
vi.mock('@/lib/actions/traffic', () => ({
  getTrafficBots: vi.fn(),
  getTrafficConversions: vi.fn(),
  getTrafficGooglePages: vi.fn(),
  getTrafficGoogleTotals: vi.fn(),
  getTrafficGoogleTrend: vi.fn(),
  getTrafficLogs: vi.fn(),
  getTrafficPages: reads.getTrafficPages,
  getTrafficSources: vi.fn(),
  getTrafficSummary: reads.getTrafficSummary,
  getTrafficTrend: vi.fn(),
  getUntrackedGoogleQueries: vi.fn(),
}));
vi.mock('@/lib/actions/aiBots', () => ({ getBotConnections: reads.getBotConnections }));

const { POST } = await import('./route');

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/traffic/read', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

const WEEK = { dateFrom: '2026-10-12T00:00:00.000Z', dateTo: '2026-10-19T00:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  user = { id: 'u1' };
});

describe('POST /api/traffic/read', () => {
  it("runs the named read with the action's arguments", async () => {
    reads.getTrafficPages.mockResolvedValue({ counts: { all: 3 }, rows: [] });
    const res = await post({ read: 'pages', args: [BRAND, WEEK, { tab: 'all', limit: 10 }] });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ data: { counts: { all: 3 }, rows: [] } });
    expect(reads.getTrafficPages).toHaveBeenCalledWith(BRAND, WEEK, { tab: 'all', limit: 10 });
  });

  it('passes an argument the browser left out as undefined, not null', async () => {
    reads.getTrafficSummary.mockResolvedValue({ totalVisits: 1 });
    await post({ read: 'summary', args: [BRAND, null] });
    expect(reads.getTrafficSummary).toHaveBeenCalledWith(BRAND, undefined);
  });

  it('reads the bot connections too', async () => {
    reads.getBotConnections.mockResolvedValue({ connections: [] });
    expect(await (await post({ read: 'botConnections', args: [BRAND] })).json()).toEqual({
      data: { connections: [] },
    });
  });

  it('refuses an unknown read, a missing brand, and anyone signed out', async () => {
    expect((await post({ read: 'deleteBrand', args: [BRAND] })).status).toBe(400);
    expect((await post({ read: 'pages', args: ['not-a-brand'] })).status).toBe(400);
    expect((await post({ read: 'pages', args: [] })).status).toBe(400);
    user = null;
    expect((await post({ read: 'pages', args: [BRAND, WEEK] })).status).toBe(401);
    expect(reads.getTrafficPages).not.toHaveBeenCalled();
  });

  it("answers 500 without the read's own error", async () => {
    reads.getTrafficSummary.mockRejectedValue(new Error('canceling statement due to timeout'));
    const res = await post({ read: 'summary', args: [BRAND, WEEK] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load' });
  });
});
