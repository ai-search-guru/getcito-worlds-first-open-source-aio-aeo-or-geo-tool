import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** AI Traffic's Check again from the browser (00433). */

let session: { access_token: string } | null = { access_token: 'tok' };
vi.mock('@/config/api', () => ({ BROWSER_API_BASE_URL: '/api-proxy' }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));

const { checkTrackingSnippet } = await import('./trafficSnippetClient');

const fetchMock = vi.fn();
beforeEach(() => {
  session = { access_token: 'tok' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('checkTrackingSnippet', () => {
  it('posts the check for the brand and reads what it found', async () => {
    answer(200, {
      status: 'not_found',
      domain: 'getcito.com',
      checkedAt: '2026-11-01T10:00:00.000Z',
      foundAt: null,
    });
    expect(await checkTrackingSnippet('b1')).toEqual({
      ok: true,
      status: 'not_found',
      domain: 'getcito.com',
      checkedAt: '2026-11-01T10:00:00.000Z',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api-proxy/api/brands/b1/tracking-snippet/check');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tok' } });
  });

  it('reads a brand without a domain as such', async () => {
    answer(200, { status: 'no_domain', domain: null, checkedAt: null, foundAt: null });
    expect(await checkTrackingSnippet('b1')).toMatchObject({ ok: true, status: 'no_domain' });
  });

  it('fails on an error, an unknown answer, a network failure or no session', async () => {
    answer(500, { error: 'Failed to check the tracking snippet.' });
    expect(await checkTrackingSnippet('b1')).toEqual({ ok: false });
    answer(200, { status: 'maybe' });
    expect(await checkTrackingSnippet('b1')).toEqual({ ok: false });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await checkTrackingSnippet('b1')).toEqual({ ok: false });
    session = null;
    expect(await checkTrackingSnippet('b1')).toEqual({ ok: false });
  });
});
