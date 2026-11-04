import { afterEach, describe, expect, it, vi } from 'vitest';

let session: { access_token: string } | null = { access_token: 'token' };
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'https://api.example' }));

const { regenerateActionTasks } = await import('./actionTaskWriter');

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
  session = { access_token: 'token' };
});

describe('regenerateActionTasks', () => {
  it('posts as the user and returns what was written and kept', async () => {
    const fetch = respond(200, { written: 5, kept: 2, reviews: 1 });
    vi.stubGlobal('fetch', fetch);
    // With how many wait in Needs review (AC-010).
    expect(await regenerateActionTasks('a1')).toEqual({ written: 5, kept: 2, reviews: 1 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/api/action-center/actions/a1/tasks/regenerate');
    expect(init.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it("returns the server's reason rather than throwing", async () => {
    vi.stubGlobal('fetch', respond(429, { error: 'Budget used up', code: 'budget' }));
    expect(await regenerateActionTasks('a1')).toEqual({
      error: 'server',
      code: 'budget',
      message: 'Budget used up',
    });
  });

  it('tells a timeout from a server it could not reach', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('slow'), { name: 'TimeoutError' });
      }),
    );
    expect(await regenerateActionTasks('a1')).toEqual({ error: 'timeout' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await regenerateActionTasks('a1')).toEqual({ error: 'unreachable' });
  });

  it('asks for a session first', async () => {
    session = null;
    expect(await regenerateActionTasks('a1')).toEqual({ error: 'unauthenticated' });
  });
});
