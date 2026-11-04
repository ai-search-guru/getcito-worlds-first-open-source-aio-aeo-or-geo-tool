import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Send to CMS › Wix (#1331, phase 2; 00372): a brand's connection from the browser, through the API's proxy. */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}));

const { connectWix, disconnectWix, readWix } = await import('./wixClient');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const BASE = '/api/aeo/api/cms/brands/b1/wix';
const input = { siteId: '2f8a1c3e-1111-4222-8333-944455556666', apiKey: 'IST.fake-key-1234567890' };

describe('wix-client', () => {
  it('reads the connection, sends the key once in the body, and disconnects', async () => {
    answer(200, { configured: true, connection: null });
    expect(await readWix('b1')).toEqual({ ok: true, configured: true, connection: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    // The Wix card's read gives up in time, as the other integration cards' do.
    expect(init.signal).toBeInstanceOf(AbortSignal);

    answer(200, { connection: { status: 'connected' } });
    expect(await connectWix('b1', input)).toEqual({
      ok: true,
      connection: { status: 'connected' },
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    });

    answer(200, { success: true });
    expect(await disconnectWix('b1')).toEqual({ ok: true, success: true });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
  });

  it("names the API's reasons, and the general ones", async () => {
    for (const code of [
      'no_blog',
      'no_member',
      'auth_failed',
      'no_access',
      'no_ricos_permission',
    ]) {
      answer(409, { code, error: 'x' });
      expect(await connectWix('b1', input)).toEqual({ ok: false, code });
    }
    answer(401, { error: 'Unauthorized' });
    expect(await readWix('b1')).toEqual({ ok: false, code: 'session' });
    // A read-only workspace: the upgrade dialog's, not a message.
    answer(402, { code: 'subscription_inactive', error: 'x' });
    expect(await connectWix('b1', input)).toEqual({ ok: false, code: 'subscription' });
    answer(500, { code: 'something_else' });
    expect(await readWix('b1')).toEqual({ ok: false, code: 'failed' });
  });
});
