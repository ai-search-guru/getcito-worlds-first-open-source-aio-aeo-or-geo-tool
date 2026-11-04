import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
// The brand's Merchant Center sign-in (BRAND-ACCESS PR 16, 00470); none: the workspace's entity.
const brandConnection = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../brandIntegrations.js', () => ({ brandConnection }));

import example from '../../connectors/__example__/index.js';
import { ConnectError } from '../../connectors/errors.js';
import { ConnectorHttpError } from '../../connectors/http.js';
import { startFakeApi } from '../../connectors/testing.js';
import { logger } from '../logger.js';
import { fakeDb } from './__fixtures__/fakeDb.js';
import { readCredentials } from './credentials.js';
import {
  SIGN_IN_CALLS_MS,
  StoreError,
  connectSignInSource,
  connectStore,
  disconnectStore,
  listSignInAccounts,
  readInput,
  reconnectStore,
} from './stores.js';

/** Connecting a store, replacing its sign-in and removing it (#1263, 00282). */

const BRAND = 'brand-1';
const KEY = 'ex_live_0123456789abcdef';
const connectors = { example_store: example };

let api;
let fake;
let saved;
beforeEach(async () => {
  saved = process.env.CONNECTOR_CREDENTIALS_KEY;
  process.env.CONNECTOR_CREDENTIALS_KEY = randomBytes(32).toString('base64');
  fake = fakeDb();
  api = await startFakeApi({
    'GET /api/shop': (req) =>
      req.headers.authorization === `Bearer ${KEY}` ||
      req.headers.authorization === 'Bearer ex_new_key'
        ? { json: { domain: 'shop.example', name: 'Acme Outdoor' } }
        : { status: 401 },
  });
});
afterEach(async () => {
  await api.close();
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.CONNECTOR_CREDENTIALS_KEY;
  else process.env.CONNECTOR_CREDENTIALS_KEY = saved;
});

const opts = () => ({ db: fake.db, connectors, request: api.request });
const connect = (input = { url: api.origin, apiKey: KEY }) =>
  connectStore({ brandId: BRAND, kind: 'example_store', input, userId: 'user-1' }, opts());

describe('readInput', () => {
  it("keeps the connector's fields only, as strings", () => {
    expect(readInput(example, { url: 'https://s.example', apiKey: 'k', other: 'x' })).toEqual({
      url: 'https://s.example',
      apiKey: 'k',
    });
    expect(readInput(example, {})).toEqual({ url: '', apiKey: '' });
    expect(() => readInput(example, { apiKey: 'x'.repeat(2001) })).toThrow(StoreError);
    expect(() => readInput(example, null)).toThrow(StoreError);
  });
});

describe('connectStore', () => {
  it('makes the source with its account, and keeps the sign-in sealed', async () => {
    const source = await connect();
    expect(source).toMatchObject({
      brand_id: BRAND,
      kind: 'example_store',
      account: 'shop.example',
      url: api.origin,
      label: 'Acme Outdoor',
    });
    expect(fake.rows('catalog_sources')[0]).toMatchObject({ created_by: 'user-1' });
    const [row] = fake.rows('catalog_source_credentials');
    expect(row).toMatchObject({ source_id: source.id, set_by: 'user-1' });
    expect(row.secret).not.toContain(KEY);
    await expect(readCredentials(source.id, { db: fake.db })).resolves.toEqual({ apiKey: KEY });
  });

  it('says why it connected nothing', async () => {
    const cases = [
      [() => connect({ url: 'nope', apiKey: KEY }), 400, 'connect_failed'],
      [() => connect({ url: api.origin, apiKey: 'wrong' }), 400, 'auth_failed'],
      [() => connect({ url: 'http://127.0.0.1/', apiKey: KEY }), 400, 'connect_failed'],
      [
        () =>
          connectStore({ brandId: BRAND, kind: 'feed_url', input: {}, userId: 'user-1' }, opts()),
        404,
        'not_found',
      ],
    ];
    for (const [run, status, code] of cases) {
      await expect(run()).rejects.toMatchObject({ status, code });
    }
    expect(fake.rows('catalog_sources')).toEqual([]);
    expect(fake.rows('catalog_source_credentials')).toEqual([]);
  });

  it('connects nothing on a server that has no key for sign-ins', async () => {
    delete process.env.CONNECTOR_CREDENTIALS_KEY;
    await expect(connect()).rejects.toMatchObject({ status: 503, code: 'not_configured' });
    expect(api.calls).toEqual([]);
  });

  it('connects a store once a brand', async () => {
    await connect();
    await expect(connect()).rejects.toMatchObject({ status: 409, code: 'duplicate' });
    expect(fake.rows('catalog_sources')).toHaveLength(1);
  });

  it("logs only a broken connector's error name, never what the person typed", async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const broken = {
      ...example,
      connect: async (input) => {
        throw new TypeError(`cannot read ${input.apiKey}`);
      },
    };
    await expect(
      connectStore(
        {
          brandId: BRAND,
          kind: 'example_store',
          input: { url: api.origin, apiKey: KEY },
          userId: 'u',
        },
        { ...opts(), connectors: { example_store: broken } },
      ),
    ).rejects.toMatchObject({ status: 502, code: 'unreachable' });
    expect(JSON.stringify(error.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(error.mock.calls)).toContain('TypeError');
  });
});

describe('reconnectStore', () => {
  it('replaces the sign-in of the same store, and clears the last refusal', async () => {
    const source = await connect();
    fake.rows('catalog_sources')[0].last_status = 'auth_failed';
    await reconnectStore(
      { source, input: { url: api.origin, apiKey: 'ex_new_key' }, userId: 'user-2' },
      opts(),
    );
    await expect(readCredentials(source.id, { db: fake.db })).resolves.toEqual({
      apiKey: 'ex_new_key',
    });
    expect(fake.rows('catalog_sources')[0]).toMatchObject({ last_status: null, last_error: null });
    expect(fake.rows('catalog_source_credentials')[0]).toMatchObject({ set_by: 'user-2' });
  });

  it("won't swap one store for another under the same source", async () => {
    const source = await connect();
    await expect(
      reconnectStore(
        {
          source: { ...source, account: 'other.example' },
          input: { url: api.origin, apiKey: KEY },
        },
        opts(),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'other_account' });
  });
});

describe('disconnectStore', () => {
  it('revokes the sign-in at the store, best effort, then removes the source', async () => {
    const source = await connect();
    const disconnect = vi.fn().mockRejectedValue(new Error('store down'));
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await disconnectStore(source, {
      ...opts(),
      connectors: { example_store: { ...example, disconnect } },
    });
    expect(disconnect).toHaveBeenCalledWith(source, {
      request: api.request,
      credentials: { apiKey: KEY },
    });
    expect(fake.rows('catalog_sources')).toEqual([]);
  });
});

describe('a platform read with the workspace sign-in (#1270)', () => {
  const gmc = {
    kind: 'merchant_center',
    label: 'Google Merchant Center',
    signIn: 'google-merchant-center',
    hosts: ['merchantapi.googleapis.com'],
    listAccounts: vi.fn(async () => [{ id: '123', name: 'Acme' }]),
    checkAccount: vi.fn(async (value) => {
      if (value !== '123')
        throw new ConnectError("This Google sign-in can't open that Merchant Center account.");
      return {
        account: '123',
        label: 'Acme',
        url: 'https://merchants.google.com/mc/overview?a=123',
      };
    }),
    readCatalog: vi.fn(),
  };
  const request = vi.fn();
  const signInRequest = vi.fn(() => request);
  const signInOpts = () => ({ db: fake.db, connectors: { merchant_center: gmc }, signInRequest });
  const connectGmc = (account = '123') =>
    connectSignInSource(
      { brandId: BRAND, kind: 'merchant_center', input: { account }, userId: 'user-1' },
      signInOpts(),
    );

  beforeEach(() => {
    vi.stubEnv('COMPOSIO_API_KEY', 'test-composio-key');
    vi.stubEnv('COMPOSIO_GMC_AUTH_CONFIG_ID', 'ac_gmc');
    fake.rows('brands').push({ id: BRAND, organization_id: 'org-1' });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists the accounts the workspace's sign-in opens", async () => {
    await expect(
      listSignInAccounts({ brandId: BRAND, kind: 'merchant_center' }, signInOpts()),
    ).resolves.toEqual([{ id: '123', name: 'Acme' }]);
    expect(signInRequest).toHaveBeenCalledWith(
      'google-merchant-center',
      { entityId: 'org_org-1', accountId: null },
      {
        hosts: ['merchantapi.googleapis.com'],
      },
    );
    expect(gmc.listAccounts).toHaveBeenCalledWith({ request: expect.any(Function) });
  });

  it('lists them with the Merchant Center sign-in the brand uses, by its account', async () => {
    brandConnection.mockResolvedValueOnce({ entityId: 'org_org-1', composioAccountId: 'ca_gmc' });
    await listSignInAccounts({ brandId: BRAND, kind: 'merchant_center' }, signInOpts());
    expect(brandConnection).toHaveBeenCalledWith(BRAND, 'google-merchant-center');
    expect(signInRequest).toHaveBeenLastCalledWith(
      'google-merchant-center',
      { entityId: 'org_org-1', accountId: 'ca_gmc' },
      { hosts: ['merchantapi.googleapis.com'] },
    );
  });

  it('stops every call of a listing at one deadline, 30 seconds by default', async () => {
    expect(SIGN_IN_CALLS_MS).toBe(30_000);
    const signals = [];
    const slow = vi.fn(async (_address, { signal } = {}) => {
      signals.push(signal);
      if (signals.length === 1) return { status: 200, headers: {}, data: {} };
      // The second call answers only when its deadline stops it.
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new ConnectorHttpError('timeout', 'GET took too long')),
        );
      });
    });
    gmc.listAccounts.mockImplementationOnce(async ({ request: call }) => {
      await call('https://merchantapi.googleapis.com/accounts/v1/accounts');
      await call('https://merchantapi.googleapis.com/accounts/v1/accounts/1:listSubaccounts');
      return [];
    });
    await expect(
      listSignInAccounts(
        { brandId: BRAND, kind: 'merchant_center' },
        { ...signInOpts(), signInRequest: () => slow, callsMs: 20 },
      ),
    ).rejects.toMatchObject({ status: 502, code: 'unreachable' });
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBe(signals[0]);
    expect(signals[0].aborted).toBe(true);
  });

  it("says the server isn't set up when its own setup is refused, not to reconnect", async () => {
    gmc.listAccounts.mockRejectedValueOnce(
      new ConnectorHttpError('not_set_up', 'Composio refused this server'),
    );
    await expect(
      listSignInAccounts({ brandId: BRAND, kind: 'merchant_center' }, signInOpts()),
    ).rejects.toMatchObject({
      status: 503,
      code: 'not_configured',
      message: "Google Merchant Center isn't set up correctly on this server yet. Try again later.",
    });
  });

  it('makes the source for the picked account, with no sign-in of its own', async () => {
    const source = await connectGmc();
    expect(source).toMatchObject({
      brand_id: BRAND,
      kind: 'merchant_center',
      account: '123',
      label: 'Acme',
      url: 'https://merchants.google.com/mc/overview?a=123',
    });
    expect(fake.rows('catalog_source_credentials')).toEqual([]);
    await expect(connectGmc()).rejects.toMatchObject({ status: 409, code: 'duplicate' });
  });

  it("says why in plain words when it can't", async () => {
    await expect(connectGmc('999')).rejects.toMatchObject({ status: 400, code: 'connect_failed' });
    await expect(connectGmc(' ')).rejects.toMatchObject({ status: 400, code: 'invalid' });

    gmc.listAccounts.mockRejectedValueOnce(new ConnectorHttpError('auth', 'no active sign-in'));
    await expect(
      listSignInAccounts({ brandId: BRAND, kind: 'merchant_center' }, signInOpts()),
    ).rejects.toMatchObject({
      status: 409,
      code: 'not_connected',
      message: 'Connect Google Merchant Center with Google in Settings › Integrations first.',
    });

    vi.stubEnv('COMPOSIO_GMC_AUTH_CONFIG_ID', '');
    await expect(connectGmc()).rejects.toMatchObject({ status: 503, code: 'not_configured' });
    expect(fake.rows('catalog_sources')).toEqual([]);
  });

  it("isn't a store: no typed sign-in to connect or replace", async () => {
    await expect(
      connectStore(
        { brandId: BRAND, kind: 'merchant_center', input: {}, userId: 'user-1' },
        signInOpts(),
      ),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});
