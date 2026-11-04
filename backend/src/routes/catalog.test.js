import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * A brand's catalog sources (#1263): a feed or a store synced now, a file
 * uploaded, a store connected, its sign-in replaced, a store removed;
 * admins and managers only, a brand of their own workspace only.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const SOURCE = '0b8d6a1e-2a3c-4d5e-8f90-123456789abc';
let role;
let sources;
let inserted;
const assertBrandAccess = vi.fn();
const syncSource = vi.fn();
const connectStore = vi.fn();
const reconnectStore = vi.fn();
const disconnectStore = vi.fn();
const connectSignInSource = vi.fn();
const categoryPages = vi.fn();
const setCategoryPage = vi.fn();
const listSignInAccounts = vi.fn();
const matchBrandLater = vi.fn();
let configured;
let googleConfigured;

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const filters = {};
      const chain = {
        select: () => chain,
        eq: (column, value) => {
          filters[column] = value;
          return chain;
        },
        single: async () =>
          table === 'profiles'
            ? { data: { role }, error: null }
            : { data: inserted, error: inserted ? null : { message: 'no' } },
        maybeSingle: async () => ({
          data: sources.find((s) => Object.entries(filters).every(([k, v]) => s[k] === v)) ?? null,
          error: null,
        }),
        insert: (row) => {
          inserted = { id: 'new-upload', url: null, ...row };
          sources.push(inserted);
          return chain;
        },
        update: (values) => {
          chain.then = (onFulfilled) => {
            const row = sources.find((s) => s.id === filters.id);
            if (row) Object.assign(row, values);
            return Promise.resolve({ error: null }).then(onFulfilled);
          };
          return chain;
        },
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => assertBrandAccess(...args),
}));
vi.mock('../lib/catalog/sources.js', () => ({
  syncSource: (...args) => syncSource(...args),
}));
vi.mock('../lib/catalog/cardMatch.js', () => ({
  matchBrandLater: (...args) => matchBrandLater(...args),
}));
// The limiters' buckets would end this file's run part way: each request
// notes the bucket it took instead.
const buckets = [];
vi.mock('../middleware/rateLimiter.js', () => ({
  catalogLimiter: (_req, _res, next) => {
    buckets.push('catalog');
    next();
  },
  catalogCategoryLimiter: (_req, _res, next) => {
    buckets.push('categories');
    next();
  },
}));
vi.mock('../lib/catalog/credentials.js', () => ({
  credentialsConfigured: () => configured,
}));
vi.mock('../lib/catalog/stores.js', async () => {
  class StoreError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    StoreError,
    connectStore: (...args) => connectStore(...args),
    reconnectStore: (...args) => reconnectStore(...args),
    disconnectStore: (...args) => disconnectStore(...args),
    connectSignInSource: (...args) => connectSignInSource(...args),
    listSignInAccounts: (...args) => listSignInAccounts(...args),
  };
});
vi.mock('../connectors/index.js', () => ({
  storeConnectors: () => [
    {
      kind: 'acme_store',
      label: 'Acme Store',
      fields: [{ name: 'apiKey', label: 'API key', secret: true }],
    },
  ],
  signInConnectors: () => [
    {
      kind: 'merchant_center',
      label: 'Google Merchant Center',
      provider: 'google-merchant-center',
    },
  ],
  connectorFor: (kind) =>
    kind === 'merchant_center' ? { kind, signIn: 'google-merchant-center' } : { kind },
  isSignIn: (connector) => typeof connector?.signIn === 'string',
}));
vi.mock('../lib/catalog/categoryPages.js', () => {
  class CategoryPageError extends Error {
    constructor(code, message, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    CategoryPageError,
    categoryPages: (...args) => categoryPages(...args),
    setCategoryPage: (...args) => setCategoryPage(...args),
  };
});
vi.mock('../lib/composio.js', () => ({
  isComposioConfigured: (provider) => provider === 'google-merchant-center' && googleConfigured,
}));

const { default: router } = await import('./catalog.js');
const { StoreError } = await import('../lib/catalog/stores.js');

let server;
let base;
beforeEach(async () => {
  role = 'admin';
  inserted = null;
  sources = [
    {
      id: SOURCE,
      brand_id: BRAND,
      kind: 'feed_url',
      format: 'auto',
      url: 'https://shop.example/feed.xml',
      last_synced_at: null,
    },
  ];
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'org-1' });
  buckets.length = 0;
  syncSource.mockReset().mockResolvedValue({ status: 'ok', counts: { items: 4 } });
  matchBrandLater.mockReset().mockResolvedValue(undefined);
  googleConfigured = true;
  categoryPages.mockReset().mockResolvedValue([
    {
      name: 'Hiking Boots',
      products: 24,
      inStock: 18,
      page: { url: 'https://shop.example/collections/hiking-boots', title: 'Hiking boots' },
      how: 'address',
    },
  ]);
  setCategoryPage.mockReset().mockResolvedValue(undefined);
  connectSignInSource.mockReset().mockResolvedValue({
    id: 'gmc-1',
    brand_id: BRAND,
    kind: 'merchant_center',
    account: '123456789',
  });
  listSignInAccounts.mockReset().mockResolvedValue([{ id: '123456789', name: 'Acme' }]);
  connectStore.mockReset().mockResolvedValue({
    id: 'store-1',
    brand_id: BRAND,
    kind: 'acme_store',
    account: 'shop.example',
  });
  reconnectStore.mockReset().mockResolvedValue(undefined);
  disconnectStore.mockReset().mockResolvedValue(undefined);
  configured = true;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/catalog', router);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/catalog`;
});
afterEach(() => new Promise((resolve) => server.close(resolve)));

const sync = (id = SOURCE) => fetch(`${base}/sources/${id}/sync`, { method: 'POST' });
const send = (method, path, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const STORE = '5c8d6a1e-2a3c-4d5e-8f90-123456789abc';
const addStore = () =>
  sources.push({
    id: STORE,
    brand_id: BRAND,
    kind: 'acme_store',
    format: 'auto',
    url: null,
    account: 'shop.example',
    last_synced_at: null,
  });
const upload = (body, query = `brandId=${BRAND}`) =>
  fetch(`${base}/upload?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'text/csv' },
    body,
  });

describe('POST /api/catalog/sources/:id/sync', () => {
  it("syncs a feed for an admin or a manager of the brand's workspace", async () => {
    const res = await sync();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', error: null, counts: { items: 4 } });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'user-1');
    expect(syncSource).toHaveBeenCalledWith(expect.objectContaining({ id: SOURCE }));
  });

  it('syncs a store too', async () => {
    addStore();
    expect((await sync(STORE)).status).toBe(200);
    expect(syncSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: STORE, kind: 'acme_store' }),
    );
  });

  it('refuses an analyst, another workspace, an upload source and a bad id', async () => {
    role = 'analyst';
    expect((await sync()).status).toBe(403);
    role = 'manager';
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error("This brand isn't in your workspace"), {
        status: 403,
        code: 'not_in_workspace',
      }),
    );
    const other = await sync();
    expect(other.status).toBe(403);
    expect((await other.json()).code).toBe('not_in_workspace');
    sources[0].kind = 'upload';
    expect((await sync()).status).toBe(404);
    expect((await sync('nope')).status).toBe(400);
    expect(syncSource).not.toHaveBeenCalled();
  });

  it('says a feed synced a moment ago is fresh, without reading it again', async () => {
    sources[0].last_synced_at = new Date(Date.now() - 30_000).toISOString();
    const res = await sync();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('recent');
    expect(syncSource).not.toHaveBeenCalled();
    expect(matchBrandLater).not.toHaveBeenCalled();
  });

  it("matches the brand's shopping cards to the catalog it read, not after a failed read", async () => {
    expect((await sync()).status).toBe(200);
    expect(matchBrandLater).toHaveBeenCalledExactlyOnceWith(BRAND);
    matchBrandLater.mockClear();
    syncSource.mockResolvedValueOnce({ status: 'failed', error: 'The feed took too long.' });
    expect((await sync()).status).toBe(200);
    expect(matchBrandLater).not.toHaveBeenCalled();
  });
});

describe('POST /api/catalog/upload', () => {
  it("makes the brand's upload source on its first upload, and imports the file's text", async () => {
    const res = await upload('id,title\n1,Boot');
    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({
      brand_id: BRAND,
      kind: 'upload',
      format: 'auto',
      created_by: 'user-1',
    });
    expect(syncSource).toHaveBeenCalledWith(expect.objectContaining({ kind: 'upload' }), {
      text: 'id,title\n1,Boot',
    });
  });

  it("matches the brand's shopping cards once the file is in the catalog", async () => {
    await upload('id,title\n1,Boot');
    expect(matchBrandLater).toHaveBeenCalledExactlyOnceWith(BRAND);
    matchBrandLater.mockClear();
    syncSource.mockResolvedValueOnce({ status: 'format_error', error: 'Not a feed.' });
    await upload('name\nAda');
    expect(matchBrandLater).not.toHaveBeenCalled();
  });

  it('keeps one upload source a brand, with the format asked for', async () => {
    sources.push({ id: 'up-1', brand_id: BRAND, kind: 'upload', format: 'auto', url: null });
    await upload('<rss/>', `brandId=${BRAND}&format=google_xml`);
    expect(inserted).toBeNull();
    expect(sources.find((s) => s.id === 'up-1').format).toBe('google_xml');
    expect(syncSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'up-1', format: 'google_xml' }),
      { text: '<rss/>' },
    );
  });

  it('refuses an analyst, an empty body, a bad brand or format, and a file over 4 MB', async () => {
    role = 'analyst';
    expect((await upload('id\n1')).status).toBe(403);
    role = 'admin';
    expect((await upload('  ')).status).toBe(400);
    expect((await upload('id\n1', 'brandId=nope')).status).toBe(400);
    expect((await upload('id\n1', `brandId=${BRAND}&format=xlsx`)).status).toBe(400);
    const big = await upload('x'.repeat(4 * 1024 * 1024 + 10));
    expect(big.status).toBe(413);
    expect((await big.json()).code).toBe('too_large');
    expect(syncSource).not.toHaveBeenCalled();
  });
});

describe('GET /api/catalog/connectors', () => {
  it('lists the stores a person can connect, and whether the server can keep a sign-in', async () => {
    configured = false;
    const res = await fetch(`${base}/connectors`);
    expect(await res.json()).toEqual({
      connectors: [
        {
          kind: 'acme_store',
          label: 'Acme Store',
          fields: [{ name: 'apiKey', label: 'API key', secret: true }],
        },
      ],
      ready: false,
      signIns: [
        {
          kind: 'merchant_center',
          label: 'Google Merchant Center',
          provider: 'google-merchant-center',
          configured: true,
        },
      ],
    });
  });
});

describe('GET /api/catalog/accounts (#1270)', () => {
  const query = `brandId=${BRAND}&kind=merchant_center`;

  it("lists the accounts the workspace's sign-in opens, for an admin or a manager", async () => {
    const res = await fetch(`${base}/accounts?${query}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [{ id: '123456789', name: 'Acme' }] });
    expect(listSignInAccounts).toHaveBeenCalledWith({ brandId: BRAND, kind: 'merchant_center' });

    role = 'analyst';
    expect((await fetch(`${base}/accounts?${query}`)).status).toBe(403);
    expect((await fetch(`${base}/accounts?brandId=nope&kind=merchant_center`)).status).toBe(400);
  });

  it("refuses a brand of another workspace, or one that doesn't exist, and lists nothing", async () => {
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error("This brand isn't in your workspace"), {
        status: 403,
        code: 'not_in_workspace',
      }),
    );
    const other = await fetch(`${base}/accounts?${query}`);
    expect(other.status).toBe(403);
    expect((await other.json()).code).toBe('not_in_workspace');

    // A brand of the workspace not given to the caller keeps its own code, not a role's.
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error("You don't have access to this brand"), {
        status: 403,
        code: 'no_brand_access',
      }),
    );
    const notGiven = await fetch(`${base}/accounts?${query}`);
    expect(notGiven.status).toBe(403);
    expect((await notGiven.json()).code).toBe('no_brand_access');

    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error('Brand not found'), { status: 404 }),
    );
    const missing = await fetch(`${base}/accounts?${query}`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('not_found');
    expect(listSignInAccounts).not.toHaveBeenCalled();
  });

  it('says when the workspace must connect Google first', async () => {
    listSignInAccounts.mockRejectedValueOnce(
      new StoreError(409, 'not_connected', 'Connect Google Merchant Center with Google first.'),
    );
    const res = await fetch(`${base}/accounts?${query}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Connect Google Merchant Center with Google first.',
      code: 'not_connected',
    });
  });
});

describe('POST /api/catalog/sources', () => {
  const body = { brandId: BRAND, kind: 'acme_store', input: { apiKey: 'sk_secret' } };

  it("connects a sign-in platform's account the person picked, then reads it", async () => {
    const res = await send('POST', '/sources', {
      brandId: BRAND,
      kind: 'merchant_center',
      input: { account: '123456789' },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'gmc-1', account: '123456789' });
    expect(connectSignInSource).toHaveBeenCalledWith({
      brandId: BRAND,
      kind: 'merchant_center',
      input: { account: '123456789' },
      userId: 'user-1',
    });
    expect(connectStore).not.toHaveBeenCalled();
    expect(syncSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'gmc-1' }));
  });

  it('connects a store for an admin or a manager, then reads it without waiting', async () => {
    role = 'manager';
    const res = await send('POST', '/sources', body);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'store-1', account: 'shop.example' });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'user-1');
    expect(connectStore).toHaveBeenCalledWith({
      brandId: BRAND,
      kind: 'acme_store',
      input: { apiKey: 'sk_secret' },
      userId: 'user-1',
    });
    expect(syncSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'store-1' }));
    // Its cards are matched once its first read is in.
    await vi.waitFor(() => expect(matchBrandLater).toHaveBeenCalledExactlyOnceWith(BRAND));
  });

  it("answers the store's refusal in the person's words, and connects nothing for an analyst", async () => {
    connectStore.mockRejectedValueOnce(
      new StoreError(400, 'auth_failed', 'The store refused this sign-in. Check it and try again.'),
    );
    const refused = await send('POST', '/sources', body);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: 'The store refused this sign-in. Check it and try again.',
      code: 'auth_failed',
    });
    role = 'analyst';
    expect((await send('POST', '/sources', body)).status).toBe(403);
    expect((await send('POST', '/sources', { ...body, kind: 'Acme Store' })).status).toBe(400);
    expect((await send('POST', '/sources', { ...body, input: { apiKey: 42 } })).status).toBe(400);
    expect(connectStore).toHaveBeenCalledTimes(1);
    expect(syncSource).not.toHaveBeenCalled();
  });
});

describe('PUT /api/catalog/sources/:id/credentials', () => {
  it("replaces a store's sign-in, then reads it again", async () => {
    addStore();
    const res = await send('PUT', `/sources/${STORE}/credentials`, { input: { apiKey: 'sk_new' } });
    expect(res.status).toBe(200);
    expect(reconnectStore).toHaveBeenCalledWith({
      source: expect.objectContaining({ id: STORE, account: 'shop.example' }),
      input: { apiKey: 'sk_new' },
      userId: 'user-1',
    });
    expect(syncSource).toHaveBeenCalledTimes(1);
  });

  it('has no sign-in for a feed, and none to change for an analyst', async () => {
    expect((await send('PUT', `/sources/${SOURCE}/credentials`, { input: {} })).status).toBe(404);
    addStore();
    role = 'analyst';
    expect((await send('PUT', `/sources/${STORE}/credentials`, { input: {} })).status).toBe(403);
    expect(reconnectStore).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/catalog/sources/:id', () => {
  it('removes a store for an admin or a manager', async () => {
    addStore();
    expect((await send('DELETE', `/sources/${STORE}`)).status).toBe(200);
    expect(disconnectStore).toHaveBeenCalledWith(expect.objectContaining({ id: STORE }));
  });

  it("leaves feeds to the person's own removal, and stores to their admins and managers", async () => {
    expect((await send('DELETE', `/sources/${SOURCE}`)).status).toBe(404);
    addStore();
    role = 'analyst';
    expect((await send('DELETE', `/sources/${STORE}`)).status).toBe(403);
    expect((await send('DELETE', '/sources/nope')).status).toBe(404);
    expect(disconnectStore).not.toHaveBeenCalled();
  });
});

describe('category pages (shopping path)', () => {
  it("lists the brand's categories and their pages to any member", async () => {
    role = 'analyst';
    const res = await fetch(`${base}/categories?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect((await res.json()).categories[0]).toMatchObject({
      name: 'Hiking Boots',
      how: 'address',
    });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'user-1');
    expect(categoryPages).toHaveBeenCalledWith(BRAND);
    expect((await fetch(`${base}/categories?brandId=nope`)).status).toBe(400);
  });

  it("sets a category's page, or none, for an admin or a manager only", async () => {
    role = 'manager';
    const body = { brandId: BRAND, category: 'Socks', url: 'https://shop.example/c/socks' };
    expect((await send('PUT', '/categories', body)).status).toBe(200);
    expect(setCategoryPage).toHaveBeenCalledWith({ ...body, userId: 'user-1' });
    expect((await send('PUT', '/categories', { ...body, url: null })).status).toBe(200);
    expect(setCategoryPage).toHaveBeenLastCalledWith({ ...body, url: null, userId: 'user-1' });

    role = 'analyst';
    expect((await send('PUT', '/categories', body)).status).toBe(403);
    expect(setCategoryPage).toHaveBeenCalledTimes(2);
  });

  it("says why a page can't be set, and puts a category back to its match", async () => {
    setCategoryPage.mockRejectedValueOnce(
      new (await import('../lib/catalog/categoryPages.js')).CategoryPageError(
        'off_site',
        "The page must be on the brand's own site.",
      ),
    );
    const refused = await send('PUT', '/categories', {
      brandId: BRAND,
      category: 'Socks',
      url: 'https://elsewhere.example/socks',
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: "The page must be on the brand's own site.",
      code: 'off_site',
    });

    const back = await fetch(`${base}/categories?brandId=${BRAND}&category=Socks`, {
      method: 'DELETE',
    });
    expect(back.status).toBe(200);
    expect(setCategoryPage).toHaveBeenLastCalledWith({
      brandId: BRAND,
      category: 'Socks',
      url: undefined,
      userId: 'user-1',
    });
  });

  it("reads under the API's limit, and writes from a bucket apart from the syncs'", async () => {
    await fetch(`${base}/categories?brandId=${BRAND}`);
    expect(buckets).toEqual([]);
    await send('PUT', '/categories', { brandId: BRAND, category: 'Socks', url: null });
    await fetch(`${base}/categories?brandId=${BRAND}&category=Socks`, { method: 'DELETE' });
    expect(buckets).toEqual(['categories', 'categories']);
  });

  it("refuses another workspace's brand, and a body without its address", async () => {
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error("This brand isn't in your workspace"), {
        status: 403,
        code: 'not_in_workspace',
      }),
    );
    const other = await fetch(`${base}/categories?brandId=${BRAND}`);
    expect(other.status).toBe(403);
    expect((await other.json()).code).toBe('not_in_workspace');
    expect(categoryPages).not.toHaveBeenCalled();

    const missing = await send('PUT', '/categories', { brandId: BRAND, category: 'Socks' });
    expect(missing.status).toBe(400);
    expect(setCategoryPage).not.toHaveBeenCalled();
  });

  it('lets only an admin or a manager put a category back to its match', async () => {
    role = 'analyst';
    const refused = await fetch(`${base}/categories?brandId=${BRAND}&category=Socks`, {
      method: 'DELETE',
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: "Only admins and managers can change the catalog's category pages.",
      code: 'forbidden',
    });
    expect(setCategoryPage).not.toHaveBeenCalled();
  });

  it("says a category isn't in the catalog, and what failed in these routes' words", async () => {
    setCategoryPage.mockRejectedValueOnce(
      new (await import('../lib/catalog/categoryPages.js')).CategoryPageError(
        'not_found',
        "That category isn't in the brand's catalog.",
        404,
      ),
    );
    const gone = await send('PUT', '/categories', { brandId: BRAND, category: 'Tents', url: null });
    expect(gone.status).toBe(404);
    expect((await gone.json()).code).toBe('not_found');

    setCategoryPage.mockRejectedValueOnce(new Error('catalog_category_pages write: down'));
    const failed = await send('PUT', '/categories', {
      brandId: BRAND,
      category: 'Socks',
      url: null,
    });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to change the catalog's category pages",
      code: 'failed',
    });

    categoryPages.mockRejectedValueOnce(new Error('site pages read: down'));
    const unread = await fetch(`${base}/categories?brandId=${BRAND}`);
    expect(unread.status).toBe(500);
    expect((await unread.json()).error).toBe("Failed to read the catalog's category pages");
  });
});
