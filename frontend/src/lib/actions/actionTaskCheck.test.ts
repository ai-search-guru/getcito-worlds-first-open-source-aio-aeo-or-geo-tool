import { afterEach, describe, expect, it, vi } from 'vitest';

/** Check a task now (AC-010): the server's check, or why there's none. */

let session: { access_token: string } | null = { access_token: 'token' };
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'https://api.example' }));

const { checkActionTask } = await import('./actionTaskCheck');

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
  session = { access_token: 'token' };
});

describe('checkActionTask', () => {
  it('posts as the user and returns the check kept on the task', async () => {
    const fetch = respond(200, {
      checked: { at: '2026-10-27T03:00:00Z', passed: false, missing: ['page_error'] },
    });
    vi.stubGlobal('fetch', fetch);
    expect(await checkActionTask('t1')).toEqual({
      checked: { at: '2026-10-27T03:00:00Z', passed: false, missing: ['page_error'] },
      reason: null,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/api/action-center/tasks/t1/check');
    expect(init.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('says why nothing was checked, and returns the server’s error rather than throwing', async () => {
    vi.stubGlobal('fetch', respond(200, { checked: null, reason: 'not_checkable' }));
    expect(await checkActionTask('t1')).toEqual({ checked: null, reason: 'not_checkable' });
    // A shopping links task whose draft has no path left (shopping path, part 7).
    vi.stubGlobal('fetch', respond(200, { checked: null, reason: 'no_shopping_path' }));
    expect(await checkActionTask('t1')).toEqual({ checked: null, reason: 'no_shopping_path' });
    vi.stubGlobal('fetch', respond(200, { checked: null, reason: 'something new' }));
    expect(await checkActionTask('t1')).toEqual({ checked: null, reason: 'no_answer' });
    vi.stubGlobal('fetch', respond(404, { error: 'Task not found', code: 'not_found' }));
    expect(await checkActionTask('t1')).toEqual({
      error: 'server',
      code: 'not_found',
      message: 'Task not found',
    });
    session = null;
    expect(await checkActionTask('t1')).toEqual({ error: 'unauthenticated' });
  });
});
