import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings › Integrations' Google reads and Connect, from the browser through
 * the API's proxy: never a server action, which Next would run one at a time,
 * and each call giving up after its timeout.
 */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}));

const {
  readGscProperties,
  readIntegrationStatus,
  readIntegrationsConfig,
  startIntegrationConnect,
  withReadTimeout,
} = await import('./integrationsClient');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const BASE = '/api/aeo/api/integrations';
const timedOut = () =>
  fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

describe('integrations-client', () => {
  it("reads a provider's status with the session, and gives up after a timeout", async () => {
    answer(200, { configured: true, status: 'connected', accountId: 'ca_1' });
    expect(await readIntegrationStatus('google-analytics')).toEqual({
      ok: true,
      value: 'connected',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/google-analytics/status`);
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('says a read that took too long timed out, and one the API refused failed', async () => {
    timedOut();
    expect(await readIntegrationStatus('google-search-console')).toEqual({
      ok: false,
      reason: 'timeout',
    });
    // The proxy's 502 while the API is down, and a network error.
    answer(502, { error: 'API server is unreachable' });
    expect(await readIntegrationStatus('google-search-console')).toEqual({
      ok: false,
      reason: 'failed',
      error: 'API server is unreachable',
    });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await readIntegrationStatus('google-search-console')).toEqual({
      ok: false,
      reason: 'failed',
    });
    // An answer without a status it knows isn't one.
    answer(200, { status: 'weird' });
    expect((await readIntegrationStatus('google-search-console')).ok).toBe(false);
  });

  it("reads the server's config, and offers nothing when an older API has none", async () => {
    const config = {
      googleSearchConsole: true,
      googleAnalytics: true,
      googleMerchantCenter: false,
      dataForSeo: false,
    };
    answer(200, config);
    expect(await readIntegrationsConfig()).toEqual(config);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/config`);
    answer(404, { error: 'Not found' });
    expect(await readIntegrationsConfig()).toBeNull();
    timedOut();
    expect(await readIntegrationsConfig()).toBeNull();
  });

  it('starts a connection with the callback, and says why one could not start', async () => {
    answer(200, { redirectUrl: 'https://oauth.example/start' });
    expect(
      await startIntegrationConnect('google-search-console', 'https://app.example/back'),
    ).toEqual({ ok: true, value: 'https://oauth.example/start' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/google-search-console/connect`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ callbackUrl: 'https://app.example/back' });
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok',
    });

    answer(403, { error: 'Only admins and managers can connect integrations.' });
    expect((await startIntegrationConnect('google-search-console', 'https://a.b/')).ok).toBe(false);
    expect(await startIntegrationConnect('google-search-console', 'https://a.b/')).toMatchObject({
      reason: 'forbidden',
    });
    answer(402, { error: 'Subscription inactive', code: 'subscription_inactive' });
    expect(await startIntegrationConnect('google-search-console', 'https://a.b/')).toMatchObject({
      reason: 'subscription',
    });
    answer(500, { error: 'Composio is down' });
    expect(await startIntegrationConnect('google-search-console', 'https://a.b/')).toEqual({
      ok: false,
      reason: 'failed',
      error: 'Composio is down',
    });
    // An answer without an address to open can't start one.
    answer(200, {});
    expect(await startIntegrationConnect('google-search-console', 'https://a.b/')).toMatchObject({
      reason: 'failed',
    });
    timedOut();
    expect(await startIntegrationConnect('google-search-console', 'https://a.b/')).toEqual({
      ok: false,
      reason: 'timeout',
    });
  });

  it("reads the connected account's properties", async () => {
    answer(200, { properties: [{ siteUrl: 'https://acme.com/', permissionLevel: 'siteOwner' }] });
    expect(await readGscProperties()).toEqual({
      ok: true,
      value: [{ siteUrl: 'https://acme.com/', permissionLevel: 'siteOwner' }],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/google-search-console/properties`);
  });

  it("stops waiting for a server action after the timeout, and passes on one that's in time", async () => {
    vi.useFakeTimers();
    const late = withReadTimeout(new Promise(() => {}), 1000);
    const settled = late.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await settled).toMatchObject({ name: 'TimeoutError' });

    await expect(withReadTimeout(Promise.resolve('sources'), 1000)).resolves.toBe('sources');
    await expect(withReadTimeout(Promise.reject(new Error('denied')), 1000)).rejects.toThrow(
      'denied',
    );
  });
});
