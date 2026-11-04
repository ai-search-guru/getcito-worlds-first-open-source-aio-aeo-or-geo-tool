import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Site Audit hub's reads in two requests (getAuditHub, getAuditHubExtras):
 * each one's reads run side by side, and a part the page can do without
 * comes back null instead of failing the rest.
 */

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  })),
}));

const { getAuditHub, getAuditHubExtras } = await import('./audits');

const BRAND = '33333333-3333-3333-3333-333333333333';

let replies: Record<string, { status?: number; body: unknown }>;
let started: string[];
let release: () => void;

beforeEach(() => {
  started = [];
  // Every request waits until the test lets them all answer.
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  replies = {
    '/api/audits/pages': { body: { pages: [], total: 0, primaryHost: 'acme.com' } },
    '/api/audits/quota': { body: { quota: { used: 1, running: 0, limit: 100, remaining: 99 } } },
    '/api/audits/trend': { body: { primaryDomain: 'acme.com', points: [] } },
    '/api/audits/overview': { body: { overview: { pages: 0 } } },
    '/api/audits/opportunities': { body: { opportunities: [], excluded: [], staleDays: 90 } },
    '/api/audits/auto-runs/latest': { body: { run: { id: 'run-1' } } },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const { pathname } = new URL(url);
      started.push(pathname);
      await gate;
      const reply = replies[pathname];
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Lets every request already called reach the gate. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('getAuditHub', () => {
  it('asks for the pages, quota, trend and cards at once', async () => {
    const hub = getAuditHub(BRAND);
    await settle();
    expect(started.sort()).toEqual([
      '/api/audits/overview',
      '/api/audits/pages',
      '/api/audits/quota',
      '/api/audits/trend',
    ]);
    release();
    expect(await hub).toEqual({
      pages: { pages: [], total: 0, primaryHost: 'acme.com' },
      quota: { used: 1, running: 0, limit: 100, remaining: 99 },
      trend: { primaryDomain: 'acme.com', points: [] },
      overview: { pages: 0 },
    });
  });

  it('leaves the cards out when they fail, but fails without the pages', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    replies['/api/audits/overview'] = { status: 500, body: { message: 'down' } };
    release();
    expect((await getAuditHub(BRAND)).overview).toBeNull();

    replies['/api/audits/pages'] = { status: 500, body: { message: 'pages down' } };
    await expect(getAuditHub(BRAND)).rejects.toThrow('pages down');
  });
});

describe('getAuditHubExtras', () => {
  it('asks for the inbox and the latest run at once, each null when it fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    replies['/api/audits/opportunities'] = { status: 500, body: { message: 'slow' } };
    const extras = getAuditHubExtras(BRAND);
    await settle();
    expect(started.sort()).toEqual(['/api/audits/auto-runs/latest', '/api/audits/opportunities']);
    release();
    expect(await extras).toEqual({ opportunities: null, latestRun: { id: 'run-1' } });
  });
});
