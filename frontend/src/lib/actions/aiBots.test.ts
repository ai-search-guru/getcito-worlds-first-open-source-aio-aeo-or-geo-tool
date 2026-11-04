import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The AI bot report's connections (AT-010), read and made through the server. */

let session: { access_token: string } | null = { access_token: 'tok' };
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { createBotConnection, getBotConnections, revokeBotConnection } from './aiBots';

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  session = { access_token: 'tok' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI bot connection actions', () => {
  it("reads the brand's connections and this month's use", async () => {
    fetchMock.mockResolvedValue(
      json({
        connections: [{ id: 'c1', kind: 'vercel_drain', created_at: 't0', last_event_at: null }],
        usage: {
          month: '2026-10-01',
          stored: '12',
          counted: 15,
          cappedAt: null,
          cap: 2000000,
          raw: 20_000_400,
          rawCappedAt: '2026-10-18T09:00:00Z',
          rawCap: 20_000_000,
        },
      }),
    );
    expect(await getBotConnections('b1')).toEqual({
      connections: [{ id: 'c1', kind: 'vercel_drain', createdAt: 't0', lastEventAt: null }],
      usage: {
        month: '2026-10-01',
        stored: 12,
        counted: 15,
        cappedAt: null,
        cap: 2000000,
        raw: 20_000_400,
        rawCappedAt: '2026-10-18T09:00:00Z',
        rawCap: 20_000_000,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/bots/connections/b1', {
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('makes a connection, and says when the plan has no bot report', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          connection: {
            id: 'c2',
            kind: 'cloudflare_worker',
            created_at: 't1',
            last_event_at: null,
          },
          secret: 'getcito_bot_x',
          endpoint: 'https://api.test/bots/ingest',
          workerScript: '// worker',
          workerSecretName: 'GETCITO_BOT_SECRET',
          logpushJob: null,
          vercelDrain: null,
        },
        201,
      ),
    );
    const made = await createBotConnection('b1', 'cloudflare_worker');
    expect(made).toMatchObject({
      secret: 'getcito_bot_x',
      workerScript: '// worker',
      workerSecretName: 'GETCITO_BOT_SECRET',
      connection: { id: 'c2' },
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ kind: 'cloudflare_worker' }),
    });

    fetchMock.mockResolvedValue(json({ error: 'plan_limit', message: 'Growth plan' }, 403));
    expect(await createBotConnection('b1', 'cloudflare_worker')).toEqual({
      error: 'Growth plan',
      code: 'plan_limit',
    });
  });

  it('revokes one, and fails without a session', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await revokeBotConnection('b1', 'c2')).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/bots/connections/b1/c2');

    session = null;
    expect(await getBotConnections('b1')).toEqual({ error: 'Not authenticated' });
  });
});
