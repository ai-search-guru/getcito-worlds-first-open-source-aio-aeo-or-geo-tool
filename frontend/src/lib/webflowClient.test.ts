import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Send to CMS › Webflow (#1331, phase 2): a brand's connection from the browser, through the API's proxy. */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}));

const { connectWebflow, readWebflowCollection, saveWebflowSettings, disconnectWebflow } =
  await import('./webflowClient');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const BASE = '/api/aeo/api/cms/brands/b1/webflow';

describe('webflow-client', () => {
  it('sends the token once, in the body, with the session', async () => {
    answer(200, { connection: { status: 'connected' }, sites: [{ id: 's1', name: 'Acme' }] });
    expect(await connectWebflow('b1', 'wf-token')).toEqual({
      ok: true,
      connection: { status: 'connected' },
      sites: [{ id: 's1', name: 'Acme' }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ token: 'wf-token' }),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    });
  });

  it('asks for a collection on a named site, and saves the settings', async () => {
    answer(200, { id: 'c1', name: 'Blog', fields: [], suggested: {} });
    await readWebflowCollection('b1', 'c1', 's2');
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/collections/c1?siteId=s2`);

    answer(200, { connection: { collectionId: 'c1' } });
    await saveWebflowSettings('b1', {
      siteId: 's1',
      collectionId: 'c1',
      fieldMap: { body: 'post-body' },
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ siteId: 's1', collectionId: 'c1', fieldMap: { body: 'post-body' } }),
    });
  });

  it("names the API's reasons with the problems, and the general ones", async () => {
    answer(400, {
      code: 'invalid_map',
      problems: ['body: Post Summary is PlainText, not RichText'],
    });
    expect(
      await saveWebflowSettings('b1', { siteId: 's1', collectionId: 'c1', fieldMap: {} }),
    ).toEqual({
      ok: false,
      code: 'invalid_map',
      problems: ['body: Post Summary is PlainText, not RichText'],
    });
    answer(409, { code: 'auth_failed' });
    expect(await connectWebflow('b1', 'x')).toEqual({ ok: false, code: 'auth_failed' });
    answer(403, { code: 'not_in_workspace' });
    expect(await disconnectWebflow('b1')).toEqual({ ok: false, code: 'workspace' });
    answer(429, { message: 'Too many requests' });
    expect(await disconnectWebflow('b1')).toEqual({ ok: false, code: 'busy' });
    // A read-only workspace (plan not active): the upgrade dialog's.
    answer(402, { error: 'plan_limit', code: 'subscription_inactive' });
    expect(await disconnectWebflow('b1')).toEqual({ ok: false, code: 'subscription' });
    answer(500, { code: 'something_else' });
    expect(await disconnectWebflow('b1')).toEqual({ ok: false, code: 'failed' });
    fetchMock.mockRejectedValue(new TypeError('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await disconnectWebflow('b1')).toEqual({ ok: false, code: 'failed' });
  });
});
