import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
const brandConnection = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../brandIntegrations.js', () => ({ brandConnection }));

import { ConnectorHttpError } from '../../connectors/http.js';
import { logger } from '../logger.js';
import { fakeDb } from './__fixtures__/fakeDb.js';
import { brandSignIn, signInRequest, workspaceEntity } from './signIn.js';

const HOST = 'merchantapi.googleapis.com';
const URL_ = `https://${HOST}/products/v1/accounts/1/products`;

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(answers, { active = async () => ({ id: 'ca_1' }), hosts = [HOST], wait } = {}) {
  const queue = [...answers];
  const proxy = vi.fn(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const waits = vi.fn(wait ?? (async () => {}));
  const request = signInRequest('google-merchant-center', 'org_1', {
    hosts,
    active: vi.fn(active),
    proxy,
    wait: waits,
  });
  return { request, proxy, wait: waits };
}

const answer = (status, headers = {}, data = status < 300 ? { ok: true } : null) => ({
  status,
  headers,
  data,
});

/** An error as Composio's client throws its own refusals: its name, its status, its body in the message. */
const composioError = (name, status, message) =>
  Object.assign(new Error(`${status} ${message}`), { name, status });

describe('signInRequest', () => {
  it('calls the API through the active connection, looked up once', async () => {
    const active = vi.fn(async () => ({ id: 'ca_1' }));
    const proxy = vi.fn(async () => answer(200));
    const request = signInRequest('google-merchant-center', 'org_1', {
      hosts: [HOST],
      active,
      proxy,
    });
    await request(URL_, { query: { pageSize: 1000 } });
    await request(URL_);
    expect(active).toHaveBeenCalledTimes(1);
    // No account named: the entity's active one, as before.
    expect(active).toHaveBeenCalledWith('google-merchant-center', 'org_1', null);
    expect(proxy).toHaveBeenCalledWith('ca_1', {
      endpoint: URL_,
      query: { pageSize: 1000 },
      signal: undefined,
    });
  });

  it("says the sign-in is gone when there's no active connection, Composio says it expired, or Google refuses it", async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(setup([], { active: async () => null }).request(URL_)).rejects.toMatchObject({
      code: 'auth',
    });
    await expect(setup([answer(401)]).request(URL_)).rejects.toMatchObject({
      code: 'auth',
      status: 401,
    });
    // Composio refusing an expired or revoked connection is the same, with no status of Google's.
    const expired = await setup([new Error('Connected account is expired')])
      .request(URL_)
      .catch((e) => e);
    expect(expired).toMatchObject({ code: 'auth', status: undefined });
    await expect(
      setup([
        composioError('BadRequestError', 400, '{"error":{"slug":"ConnectedAccountRevoked"}}'),
      ]).request(URL_),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it("says this server's setup is refused, not the sign-in, on Composio's own 401 or 403 and Google's 403", async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    // Composio refusing the server's API key, or a key without the "Proxy execute" permission.
    const badKey = await setup([
      composioError('AuthenticationError', 401, '{"error":{"message":"Unauthorized"}}'),
    ])
      .request(URL_)
      .catch((e) => e);
    expect(badKey).toMatchObject({ code: 'not_set_up', status: undefined });
    await expect(
      setup([
        composioError('PermissionDeniedError', 403, '{"error":{"message":"No permission"}}'),
      ]).request(URL_),
    ).rejects.toMatchObject({ code: 'not_set_up', status: undefined });

    // Google: a scope missing, or the Cloud project not registered with Merchant Center.
    const scope = {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        message: 'Request had insufficient authentication scopes.',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
          },
        ],
      },
    };
    await expect(setup([answer(403, {}, scope)]).request(URL_)).rejects.toMatchObject({
      code: 'not_set_up',
      status: 403,
    });
    const unregistered = {
      error: {
        code: 401,
        status: 'UNAUTHENTICATED',
        message: 'GCP project with id p-1 is not registered with the merchant account.',
      },
    };
    await expect(setup([answer(401, {}, unregistered)]).request(URL_)).rejects.toMatchObject({
      code: 'not_set_up',
      status: 401,
    });

    // Each is logged: its name and status, Google's own status and reason; never the query.
    expect(warn.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({
        code: 'not_set_up',
        host: HOST,
        path: '/products/v1/accounts/:id/products',
        err: { name: 'AuthenticationError', status: 401 },
      }),
      expect.objectContaining({
        code: 'not_set_up',
        err: { name: 'PermissionDeniedError', status: 403 },
      }),
      expect.objectContaining({
        code: 'not_set_up',
        err: { name: undefined, status: 403 },
        google: { status: 'PERMISSION_DENIED', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' },
      }),
      expect.objectContaining({
        code: 'not_set_up',
        err: { name: undefined, status: 401 },
        google: { status: 'UNAUTHENTICATED', reason: undefined },
      }),
    ]);
  });

  it('logs a sign-in refused, without the query', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await setup([answer(401, {}, { error: { status: 'UNAUTHENTICATED' } })])
      .request(URL_, { query: { pageToken: 'secret-ish' } })
      .catch(() => {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      provider: 'google-merchant-center',
      code: 'auth',
      err: { status: 401 },
      google: { status: 'UNAUTHENTICATED' },
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-ish');
  });

  it('waits as Retry-After says on a 429, then 1, 2, 4 seconds, and gives up after three', async () => {
    const { request, wait } = setup([
      answer(429, { 'Retry-After': '3' }),
      answer(503),
      answer(200),
    ]);
    await expect(request(URL_)).resolves.toMatchObject({ status: 200 });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([3000, 2000]);

    const stuck = setup([answer(429), answer(429), answer(429), answer(429)]);
    await expect(stuck.request(URL_)).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(stuck.wait).toHaveBeenCalledTimes(3);
  });

  it('gives up at once when Retry-After asks for more than a minute', async () => {
    const limited = setup([answer(429, { 'retry-after': '120' }), answer(200)]);
    await expect(limited.request(URL_)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
    expect(limited.wait).not.toHaveBeenCalled();
    expect(limited.proxy).toHaveBeenCalledTimes(1);

    const down = setup([answer(503, { 'Retry-After': '61' }), answer(200)]);
    await expect(down.request(URL_)).rejects.toMatchObject({ code: 'http_error', status: 503 });
    expect(down.wait).not.toHaveBeenCalled();
  });

  it('calls only the hosts it was given, over https', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    for (const address of [
      'https://evil.example/products/v1/accounts/1/products',
      `http://${HOST}/products/v1/accounts/1/products`,
      `https://${HOST}:8443/products/v1/accounts/1/products`,
    ]) {
      const { request, proxy } = setup([answer(200)]);
      await expect(request(address)).rejects.toMatchObject({ code: 'blocked' });
      expect(proxy).not.toHaveBeenCalled();
    }
    // A connector that names no host calls none.
    const proxy = vi.fn(async () => answer(200));
    const unnamed = signInRequest('google-merchant-center', 'org_1', {
      active: async () => ({ id: 'ca_1' }),
      proxy,
    });
    await expect(unnamed(URL_)).rejects.toMatchObject({ code: 'blocked' });
    expect(proxy).not.toHaveBeenCalled();
    await expect(setup([answer(200)]).request('/products')).rejects.toMatchObject({
      code: 'invalid_url',
    });
    expect(errorLog).toHaveBeenCalledWith(
      { provider: 'google-merchant-center', host: 'evil.example' },
      '[catalog] sign-in call to a host not allowed',
    );
  });

  it('names the host and path only, never the query', async () => {
    const err = await setup([answer(400)])
      .request(URL_, { query: { pageToken: 'secret-ish' } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorHttpError);
    expect(err).toMatchObject({ code: 'http_error', status: 400 });
    expect(err.message).toBe(
      'GET merchantapi.googleapis.com/products/v1/accounts/1/products answered 400',
    );
  });

  it("says Composio couldn't be reached, or took too long", async () => {
    await expect(
      setup([], {
        active: async () => {
          throw new Error('ECONNRESET');
        },
      }).request(URL_),
    ).rejects.toMatchObject({ code: 'unreachable' });
    await expect(setup([new Error('socket hang up')]).request(URL_)).rejects.toMatchObject({
      code: 'unreachable',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      setup([new Error('aborted')]).request(URL_, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('stops waiting for a Retry-After when its deadline comes', async () => {
    // The real wait: 50 s asked, the deadline 20 ms away.
    const queue = [answer(429, { 'Retry-After': '50' }), answer(200)];
    const request = signInRequest('google-merchant-center', 'org_1', {
      hosts: [HOST],
      active: async () => ({ id: 'ca_1' }),
      proxy: async () => queue.shift(),
    });
    const started = Date.now();
    await expect(request(URL_, { signal: AbortSignal.timeout(20) })).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('workspaceEntity', () => {
  it("is the brand's workspace's Composio entity", async () => {
    const fake = fakeDb();
    fake.rows('brands').push({ id: 'brand-1', organization_id: 'org-9' });
    await expect(workspaceEntity('brand-1', { db: fake.db })).resolves.toBe('org_org-9');
    await expect(workspaceEntity('brand-2', { db: fake.db })).rejects.toThrow();
  });
});

describe('brandSignIn (BRAND-ACCESS PR 16)', () => {
  it('names the Merchant Center account the brand uses', async () => {
    brandConnection.mockResolvedValueOnce({ entityId: 'org_org-9', composioAccountId: 'ca_gmc' });
    await expect(brandSignIn('brand-1', 'google-merchant-center')).resolves.toEqual({
      entityId: 'org_org-9',
      accountId: 'ca_gmc',
    });
    expect(brandConnection).toHaveBeenCalledWith('brand-1', 'google-merchant-center');
  });

  it('falls back to the workspace’s entity with no sign-in, as before', async () => {
    const fake = fakeDb();
    fake.rows('brands').push({ id: 'brand-1', organization_id: 'org-9' });
    await expect(
      brandSignIn('brand-1', 'google-merchant-center', { db: fake.db }),
    ).resolves.toEqual({ entityId: 'org_org-9', accountId: null });
  });
});

describe('signInRequest with a named account', () => {
  it('uses the account the brand’s sign-in names, not the entity’s first', async () => {
    const active = vi.fn(async () => ({ id: 'ca_gmc' }));
    const proxy = vi.fn(async () => ({ status: 200, headers: {}, data: {} }));
    const request = signInRequest(
      'google-merchant-center',
      { entityId: 'org_org-9', accountId: 'ca_gmc' },
      { hosts: ['merchantapi.googleapis.com'], active, proxy },
    );
    await request('https://merchantapi.googleapis.com/accounts');
    expect(active).toHaveBeenCalledWith('google-merchant-center', 'org_org-9', 'ca_gmc');
    expect(proxy.mock.calls[0][0]).toBe('ca_gmc');
  });
});
