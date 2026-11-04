import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Send to CMS › WordPress (#1331, phase 2): a brand's connection from the browser, through the API's proxy. */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}));

const { connectWordPress, disconnectWordPress, readWordPress } = await import('./wordpressClient');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const BASE = '/api/aeo/api/cms/brands/b1/wordpress';
const input = { siteUrl: 'blog.acme.example', username: 'editor', password: 'abcd efgh ijkl mnop' };

describe('wordpress-client', () => {
  it('reads the connection, and whether the server can keep a sign-in', async () => {
    answer(200, { configured: true, connection: null });
    expect(await readWordPress('b1')).toEqual({ ok: true, configured: true, connection: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('sends the sign-in once, in the body, with the session', async () => {
    answer(200, { connection: { status: 'connected' } });
    expect(await connectWordPress('b1', input)).toEqual({
      ok: true,
      connection: { status: 'connected' },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    });
  });

  it('says whether the password was revoked on disconnect', async () => {
    answer(200, { success: true, revoked: false });
    expect(await disconnectWordPress('b1')).toEqual({ ok: true, success: true, revoked: false });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it("names the API's reasons, and the general ones", async () => {
    for (const code of ['header_dropped', 'not_wordpress', 'auth_failed', 'redirect']) {
      answer(409, { code, error: 'x' });
      expect(await connectWordPress('b1', input)).toEqual({ ok: false, code });
    }
    answer(401, { error: 'Unauthorized' });
    expect(await readWordPress('b1')).toEqual({ ok: false, code: 'session' });
    // A read-only workspace: the upgrade dialog's, not a message.
    answer(402, { code: 'subscription_inactive', error: 'x' });
    expect(await connectWordPress('b1', input)).toEqual({ ok: false, code: 'subscription' });
    answer(500, { code: 'something_else' });
    expect(await readWordPress('b1')).toEqual({ ok: false, code: 'failed' });
    fetchMock.mockRejectedValue(new TypeError('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readWordPress('b1')).toEqual({ ok: false, code: 'failed' });
  });
});
