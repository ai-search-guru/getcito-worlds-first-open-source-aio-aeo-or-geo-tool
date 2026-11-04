import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../../config/supabase.js', () => ({ default: {} }));
// The brand's Merchant Center sign-in (BRAND-ACCESS PR 16, 00470); none: the workspace's entity.
const brandConnection = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../brandIntegrations.js', () => ({ brandConnection }));
// The plan's product cap (ECOM-019): none unless a test sets one.
const getCatalogProductCap = vi.hoisted(() => vi.fn(async () => -1));
vi.mock('../planGuard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCatalogProductCap,
}));

import { ConnectorHttpError } from '../../connectors/http.js';
import { logger } from '../logger.js';
import { PageFetchError } from '../safeFetch.js';
import { fakeDb } from './__fixtures__/fakeDb.js';
import { saveCredentials } from './credentials.js';
import feedUrl, { FEED_MAX_BYTES, FEED_TYPES } from '../../connectors/feed-url/index.js';
import { PlanLimitError } from '../planGuard.js';
import {
  failureOf,
  inLine,
  productRoom,
  redact,
  sourceKey,
  sweepCatalogSources,
  syncSource,
} from './sources.js';

const fixture = (name) =>
  readFileSync(new URL(`../feeds/__fixtures__/${name}`, import.meta.url), 'utf8');

const SOURCE_ID = '0b8d6a1e-2a3c-4d5e-8f90-123456789abc';
const NOW = new Date('2026-10-25T09:00:00Z');

let fake;
let source;
beforeEach(() => {
  fake = fakeDb();
  source = {
    id: SOURCE_ID,
    brand_id: 'brand-1',
    kind: 'feed_url',
    format: 'auto',
    url: 'https://shop.example/feed.xml',
  };
  fake
    .rows('catalog_sources')
    .push({ ...source, last_synced_at: null, brands: { is_demo: false } });
});
afterEach(() => {
  delete process.env.IS_CLOUD;
  vi.restoreAllMocks();
});

const kept = () => fake.rows('catalog_sources').find((s) => s.id === SOURCE_ID);

describe('sourceKey', () => {
  it("is the catalog's source: src_ and the id without dashes, as 00279 keys it", () => {
    expect(sourceKey(SOURCE_ID)).toBe('src_0b8d6a1e2a3c4d5e8f90123456789abc');
    expect(sourceKey(SOURCE_ID)).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
  });
});

describe('syncSource', () => {
  it('reads a feed through its connector, safely, and records how it went', async () => {
    const fetch = vi.fn().mockResolvedValue({ html: fixture('google-feed.xml') });
    const outcome = await syncSource(source, { db: fake.db, now: NOW, fetch });
    expect(fetch).toHaveBeenCalledWith('https://shop.example/feed.xml', {
      timeoutMs: 60_000,
      maxBytes: FEED_MAX_BYTES,
      types: FEED_TYPES,
      accept: expect.stringContaining('application/xml'),
    });
    expect(outcome).toMatchObject({
      status: 'ok',
      counts: {
        format: 'google_xml',
        items: 4,
        skipped: 0,
        products: { added: 2 },
        variants: { added: 4 },
      },
    });
    expect(kept()).toMatchObject({
      last_synced_at: NOW.toISOString(),
      last_status: 'ok',
      last_error: null,
    });
    // Its products are kept under its own key.
    expect(new Set(fake.rows('catalog_products').map((p) => p.source))).toEqual(
      new Set([sourceKey(SOURCE_ID)]),
    );
  });

  it("imports an upload's text, with the products it skipped and why", async () => {
    const outcome = await syncSource(
      { ...source, kind: 'upload', url: null },
      { db: fake.db, now: NOW, text: fixture('store-export.csv') },
    );
    expect(outcome.counts).toMatchObject({
      format: 'csv',
      items: 2,
      skipped: 1,
      errors: ['Row 3: price is missing.'],
    });
  });

  it("records a feed that couldn't be fetched, in plain words, and writes no product", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(
        new PageFetchError('http_error', 'The page answered 404', { status: 404 }),
      );
    const outcome = await syncSource(source, { db: fake.db, now: NOW, fetch });
    expect(outcome).toEqual({ status: 'failed', error: "The feed's address answered 404." });
    expect(kept()).toMatchObject({ last_status: 'failed', last_counts: null });
    expect(fake.rows('catalog_products')).toEqual([]);
  });

  it("records a file that isn't a feed as a format error, and keeps the products it had", async () => {
    await syncSource(source, {
      db: fake.db,
      now: NOW,
      fetch: async () => ({ html: fixture('google-feed.xml') }),
    });
    const outcome = await syncSource(source, {
      db: fake.db,
      now: NOW,
      fetch: async () => ({ html: 'name,email\nAda,ada@example.com' }),
    });
    expect(outcome.status).toBe('format_error');
    expect(outcome.error).toMatch(/no id, link, price, availability column/);
    // A broken feed doesn't mark the catalog removed.
    expect(fake.rows('catalog_products').every((p) => p.removed_at === null)).toBe(true);
  });

  it("checks the brand's pages' shopping links after a sync that read the catalog, only then", async () => {
    const afterSync = vi.fn();
    await syncSource(source, {
      db: fake.db,
      now: NOW,
      fetch: async () => ({ html: fixture('google-feed.xml') }),
      afterSync,
    });
    expect(afterSync).toHaveBeenCalledWith('brand-1', { db: fake.db });
    afterSync.mockClear();
    await syncSource(source, {
      db: fake.db,
      now: NOW,
      fetch: async () => ({ html: 'name,email\nAda,ada@example.com' }),
      afterSync,
    });
    expect(afterSync).not.toHaveBeenCalled();
  });
});

describe('syncSource for a store (00282)', () => {
  const STORE_ID = '2c8d6a1e-2a3c-4d5e-8f90-123456789abc';
  const KEY = 'sk_live_store_secret';
  let store;
  let saved;
  const item = {
    id: 'v1',
    itemGroupId: 'p1',
    title: 'Trail Boot',
    description: null,
    link: 'https://shop.example/boot',
    imageLink: null,
    additionalImageLinks: [],
    brand: null,
    gtin: null,
    mpn: null,
    price: { amount: 129, currency: 'USD' },
    salePrice: null,
    availability: 'in_stock',
    condition: null,
    color: null,
    size: null,
    material: null,
    productType: null,
  };
  const connector = (readCatalog) => ({
    kind: 'acme_store',
    label: 'Acme Store',
    fields: [],
    connect: vi.fn(),
    readCatalog: vi.fn(readCatalog),
  });

  beforeEach(() => {
    saved = process.env.CONNECTOR_CREDENTIALS_KEY;
    process.env.CONNECTOR_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    store = { id: STORE_ID, brand_id: 'brand-1', kind: 'acme_store', format: 'auto', url: null };
    fake.rows('catalog_sources').push({ ...store, last_synced_at: null });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CONNECTOR_CREDENTIALS_KEY;
    else process.env.CONNECTOR_CREDENTIALS_KEY = saved;
  });
  const row = () => fake.rows('catalog_sources').find((s) => s.id === STORE_ID);

  it('reads a store with its saved sign-in', async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    const acme = connector(async (_source, ctx) => {
      await ctx.request('https://shop.example/api/products');
      return { items: [item], errors: [], format: 'acme_store' };
    });
    const request = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: null });
    const outcome = await syncSource(store, {
      db: fake.db,
      now: NOW,
      request,
      connectors: { acme_store: acme },
    });
    expect(acme.readCatalog).toHaveBeenCalledWith(store, {
      request: expect.any(Function),
      credentials: { apiKey: KEY },
    });
    // Every call the read makes carries its deadline.
    expect(request).toHaveBeenCalledWith('https://shop.example/api/products', {
      signal: expect.any(AbortSignal),
    });
    expect(outcome).toMatchObject({ status: 'ok', counts: { format: 'acme_store', items: 1 } });
    expect(fake.rows('catalog_products')).toHaveLength(1);
  });

  it("stops a store's calls at the read's deadline", async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    let signal;
    const acme = connector(async (_source, ctx) => {
      await ctx.request('https://shop.example/api/products');
      return { items: [], errors: [], format: 'acme_store' };
    });
    const request = vi.fn(async (_address, opts) => {
      signal = opts.signal;
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (opts.signal.aborted) {
        throw new ConnectorHttpError('timeout', 'GET shop.example/api/products was stopped');
      }
      return { status: 200, headers: {}, data: null };
    });
    const outcome = await syncSource(store, {
      db: fake.db,
      now: NOW,
      request,
      readMs: 5,
      connectors: { acme_store: acme },
    });
    expect(signal.aborted).toBe(true);
    expect(outcome).toEqual({ status: 'failed', error: 'The store took too long to answer.' });
  });

  it("gives a store's order read its own deadline, not what the catalog read left", async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    const slowCall = async (_address, opts) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (opts.signal.aborted) throw new ConnectorHttpError('timeout', 'GET x was stopped');
      return { status: 200, headers: {}, data: null };
    };
    const acme = {
      ...connector(async (_source, ctx) => {
        await ctx.request('https://shop.example/api/products');
        return { items: [item], errors: [], format: 'acme_store' };
      }),
      syncOrders: vi.fn(async (_source, ctx) => {
        await ctx.request('https://shop.example/api/orders');
        return { orders: [], skipped: 0, truncated: false };
      }),
    };
    // Each read alone fits the deadline; the two together don't.
    const outcome = await syncSource(store, {
      db: fake.db,
      now: NOW,
      request: vi.fn(slowCall),
      readMs: 60,
      connectors: { acme_store: acme },
    });
    expect(outcome.status).toBe('ok');
    expect(acme.syncOrders).toHaveBeenCalledTimes(1);
    expect(outcome.counts.orders).not.toHaveProperty('failed');
    expect(outcome.counts.orders).toMatchObject({ items: 0, truncated: false });
    expect(row().last_orders_synced_at).toBe(NOW.toISOString());
  });

  it("records an order read that ran out of time, and keeps the catalog's outcome", async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const request = vi.fn(async (address, opts) => {
      if (!address.endsWith('/orders')) return { status: 200, headers: {}, data: null };
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () =>
          reject(new ConnectorHttpError('timeout', 'GET x was stopped')),
        );
      });
    });
    const acme = {
      ...connector(async () => ({ items: [item], errors: [], format: 'acme_store' })),
      syncOrders: vi.fn(async (_source, ctx) => {
        await ctx.request('https://shop.example/api/orders');
        return { orders: [], skipped: 0, truncated: false };
      }),
    };
    const outcome = await syncSource(store, {
      db: fake.db,
      now: NOW,
      request,
      readMs: 20,
      connectors: { acme_store: acme },
    });
    const orders = {
      failed: true,
      timedOut: true,
      error: 'The store took too long to answer.',
    };
    expect(outcome).toMatchObject({ status: 'ok', counts: { items: 1, orders } });
    expect(row()).toMatchObject({ last_status: 'ok', last_counts: { orders } });
    expect(row().last_orders_synced_at ?? null).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      { err: { name: 'ConnectorHttpError', code: 'timeout' }, sourceId: STORE_ID },
      expect.stringContaining('order sync failed'),
    );
  });

  it("doesn't read a source twice at once", async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    let release;
    const acme = connector(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ items: [], errors: [], format: 'acme_store' });
        }),
    );
    const options = { db: fake.db, now: NOW, connectors: { acme_store: acme } };
    const first = syncSource(store, options);
    await vi.waitFor(() => expect(release).toBeDefined());
    await expect(syncSource(store, options)).resolves.toEqual({
      status: 'failed',
      error: 'This source is being read right now. Try again in a minute.',
    });
    release();
    await expect(first).resolves.toMatchObject({ status: 'ok' });
    expect(acme.readCatalog).toHaveBeenCalledTimes(1);
  });

  it("asks for the sign-in again when there's none it can open, and reads nothing", async () => {
    const acme = connector(async () => ({ items: [item], errors: [], format: 'acme_store' }));
    const outcome = await syncSource(store, {
      db: fake.db,
      now: NOW,
      connectors: { acme_store: acme },
    });
    expect(outcome).toEqual({
      status: 'auth_failed',
      error: "The store's saved sign-in can't be read. Update it in Settings › Integrations.",
    });
    expect(acme.readCatalog).not.toHaveBeenCalled();
    expect(row()).toMatchObject({ last_status: 'auth_failed' });
  });

  it("records the store's refusal, its wait and its errors in plain words", async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    const cases = [
      [
        new ConnectorHttpError('auth', 'GET x/api refused the sign-in (401)', { status: 401 }),
        'auth_failed',
        /refused the saved sign-in/,
      ],
      [
        new ConnectorHttpError('rate_limited', 'GET x/api asked to wait', { status: 429 }),
        'failed',
        /asked to wait/,
      ],
      [
        new ConnectorHttpError('http_error', 'GET x/api answered 500', { status: 500 }),
        'failed',
        /answered 500/,
      ],
    ];
    for (const [err, status, words] of cases) {
      const acme = connector(async () => {
        throw err;
      });
      const outcome = await syncSource(store, {
        db: fake.db,
        now: NOW,
        connectors: { acme_store: acme },
      });
      expect(outcome.status).toBe(status);
      expect(outcome.error).toMatch(words);
    }
  });

  it('keeps the sign-in out of the log when a connector fails on its own', async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const acme = connector(async () => {
      throw new Error(`unexpected answer for key ${KEY}`);
    });
    const outcome = await syncSource(store, {
      db: fake.db,
      now: NOW,
      connectors: { acme_store: acme },
    });
    expect(outcome).toEqual({
      status: 'failed',
      error: "The source couldn't be synced. Try again later.",
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(error.mock.calls)).toContain('[redacted]');
  });

  it('records a kind this server has no connector for', async () => {
    const outcome = await syncSource(store, { db: fake.db, now: NOW, connectors: {} });
    expect(outcome).toEqual({
      status: 'failed',
      error: "This server can't read this kind of source.",
    });
  });
});

describe('syncSource with the workspace sign-in (#1270)', () => {
  const GMC_ID = '3c8d6a1e-2a3c-4d5e-8f90-123456789abc';
  const PRODUCTS = 'https://merchantapi.googleapis.com/products/v1/accounts/123/products';
  let gmcSource;
  const platform = (readCatalog) => ({
    kind: 'merchant_center',
    label: 'Google Merchant Center',
    signIn: 'google-merchant-center',
    hosts: ['merchantapi.googleapis.com'],
    readCatalog: vi.fn(readCatalog),
  });

  beforeEach(() => {
    vi.stubEnv('COMPOSIO_API_KEY', 'test-composio-key');
    vi.stubEnv('COMPOSIO_GMC_AUTH_CONFIG_ID', 'ac_gmc');
    fake.rows('brands').push({ id: 'brand-1', organization_id: 'org-1' });
    gmcSource = {
      id: GMC_ID,
      brand_id: 'brand-1',
      kind: 'merchant_center',
      format: 'auto',
      url: null,
      account: '123',
    };
    fake.rows('catalog_sources').push({ ...gmcSource, last_synced_at: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stops every call of the read at one deadline, through the workspace's sign-in", async () => {
    const signals = [];
    const signedIn = vi.fn(async (_address, { signal } = {}) => {
      signals.push(signal);
      if (signals.length === 1) return { status: 200, headers: {}, data: null };
      // The second page answers only when the read's deadline stops it.
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new ConnectorHttpError('timeout', 'GET took too long')),
        );
      });
    });
    const signInRequest = vi.fn(() => signedIn);
    const gmc = platform(async (_source, ctx) => {
      await ctx.request(PRODUCTS);
      await ctx.request(PRODUCTS, { query: { pageToken: 'p2' } });
      return { items: [], errors: [], format: 'merchant_center' };
    });
    const outcome = await syncSource(gmcSource, {
      db: fake.db,
      now: NOW,
      signInRequest,
      readMs: 20,
      connectors: { merchant_center: gmc },
    });
    expect(signInRequest).toHaveBeenCalledWith(
      'google-merchant-center',
      { entityId: 'org_org-1', accountId: null },
      {
        hosts: ['merchantapi.googleapis.com'],
      },
    );
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBe(signals[0]);
    expect(signals[0].aborted).toBe(true);
    expect(outcome).toEqual({
      status: 'failed',
      error: "Google Merchant Center couldn't be read just now. The next daily run tries again.",
    });
  });
});

describe('failureOf, for a platform read with the workspace sign-in', () => {
  const gmc = {
    kind: 'merchant_center',
    label: 'Google Merchant Center',
    signIn: 'google-merchant-center',
  };
  const of = (code, status) => failureOf(new ConnectorHttpError(code, 'GET x', { status }), gmc);

  it('says what to do: reconnect, ask for the setup, or wait for the next run', () => {
    expect(of('auth', 401)).toEqual({
      status: 'auth_failed',
      error:
        "The Google sign-in can't open this Google Merchant Center account anymore. Reconnect it in Settings › Integrations.",
    });
    const notSetUp = {
      status: 'failed',
      error:
        "Google Merchant Center isn't set up correctly on this server, or the Google account connected in Settings › Integrations can't open this account. The next daily run tries again.",
    };
    expect(of('not_set_up')).toEqual(notSetUp);
    expect(of('not_set_up', 403)).toEqual(notSetUp);
    expect(of('rate_limited', 429)).toEqual({
      status: 'failed',
      error: 'Google Merchant Center asked to wait. The next daily run tries again.',
    });
    for (const code of ['http_error', 'unreachable', 'timeout', 'blocked', 'bad_response']) {
      expect(of(code)).toEqual({
        status: 'failed',
        error: "Google Merchant Center couldn't be read just now. The next daily run tries again.",
      });
    }
    // A store's are a store's words.
    const store = { kind: 'acme_store', label: 'Acme Store', connect() {} };
    expect(failureOf(new ConnectorHttpError('rate_limited', 'GET x'), store)).toEqual({
      status: 'failed',
      error: 'The store asked to wait. The next daily run tries again.',
    });
  });
});

describe('redact', () => {
  it('takes every credential value out of a message, but not short ones', () => {
    expect(
      redact('key abcd1234 and secret s3cr3t!', { a: 'abcd1234', b: 's3cr3t!', c: 'ab' }),
    ).toBe('key [redacted] and secret [redacted]');
    expect(redact(undefined, null)).toBe('');
  });
});

describe('sweepCatalogSources', () => {
  it("syncs the due feeds, and records that an inactive workspace's were not read", async () => {
    process.env.IS_CLOUD = 'true';
    const [first] = fake.rows('catalog_sources');
    first.brands = { is_demo: false, organizations: { subscription_status: 'active' } };
    fake.rows('catalog_sources').push({
      id: '1b8d6a1e-2a3c-4d5e-8f90-123456789abc',
      brand_id: 'brand-2',
      kind: 'feed_url',
      format: 'auto',
      url: 'https://other.example/feed.xml',
      last_synced_at: null,
      brands: { is_demo: false, organizations: { subscription_status: 'canceled' } },
    });
    const fetch = vi.fn().mockResolvedValue({ html: fixture('google-feed.xml') });
    const result = await sweepCatalogSources({ db: fake.db, now: NOW, fetch });
    expect(result).toEqual({ due: 2, synced: 1, inactive: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://shop.example/feed.xml');
    // Not read, and said so: it goes to the back of the line instead of
    // staying first every day.
    expect(fake.rows('catalog_sources').find((s) => s.brand_id === 'brand-2')).toMatchObject({
      last_synced_at: NOW.toISOString(),
      last_status: 'failed',
      last_error: "Not read: this workspace's subscription isn't active.",
      last_counts: null,
    });
    expect(fake.rows('catalog_products').every((p) => p.brand_id === 'brand-1')).toBe(true);
  });

  it("keeps a workspace's own catalog for when its subscription is active again", async () => {
    // The feed was read while the workspace was active.
    await syncSource(source, {
      db: fake.db,
      now: NOW,
      fetch: async () => ({ html: fixture('google-feed.xml') }),
    });
    const before = fake.rows('catalog_products').map((p) => ({ ...p }));
    expect(before.length).toBeGreaterThan(0);

    process.env.IS_CLOUD = 'true';
    const [first] = fake.rows('catalog_sources');
    first.brands = { is_demo: false, organizations: { subscription_status: 'past_due' } };
    first.last_synced_at = null;
    fake.writes.length = 0;
    const fetch = vi.fn();
    await sweepCatalogSources({ db: fake.db, now: NOW, fetch });
    expect(fetch).not.toHaveBeenCalled();
    // Recorded as not read; its products are left as they were, not marked removed.
    expect(fake.writes.filter((w) => w.table !== 'catalog_sources')).toEqual([]);
    expect(fake.rows('catalog_products')).toEqual(before);
    expect(fake.rows('catalog_products').every((p) => p.removed_at === null)).toBe(true);
  });

  it('reads stores too, and never an upload', async () => {
    fake.rows('catalog_sources').push(
      {
        id: '3b8d6a1e-2a3c-4d5e-8f90-123456789abc',
        brand_id: 'brand-1',
        kind: 'upload',
        format: 'auto',
        url: null,
        last_synced_at: null,
        brands: { is_demo: false },
      },
      {
        id: '4b8d6a1e-2a3c-4d5e-8f90-123456789abc',
        brand_id: 'brand-1',
        kind: 'acme_store',
        format: 'auto',
        url: null,
        last_synced_at: null,
        brands: { is_demo: false },
      },
    );
    const fetch = vi.fn().mockResolvedValue({ html: fixture('google-feed.xml') });
    const result = await sweepCatalogSources({
      db: fake.db,
      now: NOW,
      fetch,
      connectors: { feed_url: feedUrl },
    });
    expect(result).toEqual({ due: 2, synced: 2, inactive: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const tried = fake.rows('catalog_sources').filter((s) => s.last_status);
    expect(tried.map((s) => [s.kind, s.last_status]).sort()).toEqual([
      ['acme_store', 'failed'],
      ['feed_url', 'ok'],
    ]);
  });

  it("never reads a demo brand's sources (00380), nor lets them hold the line", async () => {
    fake.rows('catalog_sources')[0].brands = { is_demo: true };
    const fetch = vi.fn();
    expect(await sweepCatalogSources({ db: fake.db, now: NOW, fetch })).toEqual({
      due: 0,
      synced: 0,
      inactive: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(kept().last_synced_at).toBeNull();
  });
});

describe("the plan's product cap (ECOM-019)", () => {
  const OTHER = sourceKey('9b8d6a1e-2a3c-4d5e-8f90-123456789abc');
  beforeEach(() => {
    getCatalogProductCap.mockReset().mockResolvedValue(3);
    fake
      .rows('brands')
      .push(
        { id: 'brand-1', organization_id: 'org-1', is_demo: false },
        { id: 'brand-2', organization_id: 'org-1', is_demo: false },
        { id: 'brand-demo', organization_id: 'org-1', is_demo: true },
        { id: 'brand-x', organization_id: 'org-2', is_demo: false },
      );
    fake.rows('catalog_products').push(
      // The workspace's other brand: one live, one removed.
      { id: 'p1', brand_id: 'brand-2', source: OTHER, external_id: 'X1', removed_at: null },
      { id: 'p2', brand_id: 'brand-2', source: OTHER, external_id: 'X2', removed_at: NOW },
      // The workspace's demo brand's sample catalog (00380): never counts.
      { id: 'pd', brand_id: 'brand-demo', source: OTHER, external_id: 'D1', removed_at: null },
      // Another workspace's, and this source's own: neither counts.
      { id: 'p3', brand_id: 'brand-x', source: OTHER, external_id: 'X3', removed_at: null },
      {
        id: 'p4',
        brand_id: 'brand-1',
        source: sourceKey(SOURCE_ID),
        external_id: 'OLD',
        removed_at: null,
      },
    );
  });

  it("leaves a source the workspace's cap less its other live products, on the cloud only", async () => {
    expect(await productRoom(source, { db: fake.db })).toEqual({ room: Infinity, cap: -1 });
    process.env.IS_CLOUD = 'true';
    expect(await productRoom(source, { db: fake.db })).toEqual({ room: 2, cap: 3 });
    expect(getCatalogProductCap).toHaveBeenCalledWith('org-1');
    getCatalogProductCap.mockResolvedValue(-1);
    expect(await productRoom(source, { db: fake.db })).toEqual({ room: Infinity, cap: -1 });
  });

  it('keeps what there is room for, and records how many it could not, with the cap', async () => {
    process.env.IS_CLOUD = 'true';
    getCatalogProductCap.mockResolvedValue(2);
    const fetch = vi.fn().mockResolvedValue({ html: fixture('google-feed.xml') });
    const outcome = await syncSource(source, { db: fake.db, now: NOW, fetch });
    expect(outcome).toMatchObject({
      status: 'ok',
      counts: { products: { added: 1 }, overLimit: 1, limit: 2 },
    });
    expect(kept().last_counts).toMatchObject({ overLimit: 1, limit: 2 });
  });

  it("caps a Google Merchant Center account's products too, read with the workspace sign-in", async () => {
    process.env.IS_CLOUD = 'true';
    vi.stubEnv('COMPOSIO_API_KEY', 'test-composio-key');
    vi.stubEnv('COMPOSIO_GMC_AUTH_CONFIG_ID', 'ac_gmc');
    try {
      const gmcSource = {
        id: '3c8d6a1e-2a3c-4d5e-8f90-123456789abc',
        brand_id: 'brand-1',
        kind: 'merchant_center',
        format: 'auto',
        url: null,
        account: '123',
      };
      fake.rows('catalog_sources').push({ ...gmcSource, last_synced_at: null });
      // The feed fixture's two products, as the account's.
      const gmc = {
        kind: 'merchant_center',
        label: 'Google Merchant Center',
        signIn: 'google-merchant-center',
        hosts: ['merchantapi.googleapis.com'],
        readCatalog: vi.fn(async (_source, { request }) => {
          await request('https://merchantapi.googleapis.com/products/v1/accounts/123/products');
          return feedUrl.readCatalog(source, {
            fetch: vi.fn().mockResolvedValue({ html: fixture('google-feed.xml') }),
          });
        }),
      };
      const outcome = await syncSource(gmcSource, {
        db: fake.db,
        now: NOW,
        signInRequest: () => vi.fn(async () => ({ status: 200, headers: {}, data: null })),
        connectors: { merchant_center: gmc },
      });
      // A cap of 3, less the workspace's two other live products (p1, p4).
      expect(outcome).toMatchObject({
        status: 'ok',
        counts: { products: { added: 1 }, overLimit: 1, limit: 3 },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps a workspace's cap when two of its sources sync at once", async () => {
    process.env.IS_CLOUD = 'true';
    // A cap of 4, less brand-2's live product (p1): room for 3 between the two.
    getCatalogProductCap.mockResolvedValue(4);
    const second = { ...source, id: '7c8d6a1e-2a3c-4d5e-8f90-123456789abc', brand_id: 'brand-2' };
    fake.rows('catalog_sources').push({ ...second, last_synced_at: null });
    const fetch = vi.fn().mockResolvedValue({ html: fixture('google-feed.xml') });
    const [one, two] = await Promise.all([
      syncSource(source, { db: fake.db, now: NOW, fetch }),
      syncSource(second, { db: fake.db, now: NOW, fetch }),
    ]);
    // The first keeps the feed's two products (OLD left it); the second, what's left.
    expect(one.counts).toMatchObject({ products: { added: 2, removed: 1 } });
    expect(one.counts.overLimit).toBeUndefined();
    expect(two.counts).toMatchObject({ products: { added: 1 }, overLimit: 1, limit: 4 });
    const live = fake
      .rows('catalog_products')
      .filter((p) => ['brand-1', 'brand-2'].includes(p.brand_id) && !p.removed_at);
    expect(live).toHaveLength(4);
  });

  it('makes only a capped workspace wait in its line, and recounts its room on its turn', async () => {
    process.env.IS_CLOUD = 'true';
    const fetch = vi.fn().mockResolvedValue({ html: fixture('google-feed.xml') });
    // Another write of the workspace holds its line.
    let release;
    const holding = inLine(
      'org-1',
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    try {
      // A plan without a cap writes at once.
      getCatalogProductCap.mockResolvedValue(-1);
      const uncapped = await syncSource(source, { db: fake.db, now: NOW, fetch });
      expect(uncapped).toMatchObject({ status: 'ok', counts: { products: { added: 2 } } });
      expect(uncapped.counts.limit).toBeUndefined();

      // A capped one waits for its turn.
      getCatalogProductCap.mockResolvedValue(4);
      let done = false;
      const capped = syncSource(source, { db: fake.db, now: NOW, fetch }).then((outcome) => {
        done = true;
        return outcome;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(done).toBe(false);
      // The room is counted when its turn comes: a cap of 2 by then.
      getCatalogProductCap.mockResolvedValue(2);
      release();
      expect(await capped).toMatchObject({ status: 'ok', counts: { limit: 2 } });
    } finally {
      release();
      await holding;
    }
  });

  it("records a workspace without an active subscription in the plan's words", () => {
    expect(failureOf(new PlanLimitError('An active subscription is required.', 402))).toEqual({
      status: 'failed',
      error: 'An active subscription is required.',
    });
  });
});

describe('inLine', () => {
  it("runs a key's work one at a time, in order, past a failure, and forgets an empty line", async () => {
    const lines = new Map();
    const ran = [];
    let release;
    const first = inLine(
      'org-1',
      () =>
        new Promise((resolve) => {
          ran.push('first');
          release = resolve;
        }),
      lines,
    );
    const failing = inLine(
      'org-1',
      async () => {
        ran.push('failing');
        throw new Error('write failed');
      },
      lines,
    );
    const third = inLine('org-1', async () => ran.push('third') && 'done', lines);
    // Another workspace doesn't wait.
    await inLine('org-2', async () => ran.push('other'), lines);
    expect(ran).toEqual(['first', 'other']);
    release('kept');
    await expect(first).resolves.toBe('kept');
    await expect(failing).rejects.toThrow('write failed');
    await expect(third).resolves.toBe('done');
    expect(ran).toEqual(['first', 'other', 'failing', 'third']);
    await new Promise((resolve) => setImmediate(resolve));
    expect(lines.size).toBe(0);
  });

  it('stops waiting for work stuck past the wait, and keeps the line in order after it', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const lines = new Map();
    const ran = [];
    let release;
    const stuck = inLine(
      'org-1',
      () =>
        new Promise((resolve) => {
          ran.push('stuck');
          release = resolve;
        }),
      lines,
      20,
    );
    const next = inLine('org-1', async () => ran.push('next') && 'written', lines, 20);
    // Waits its whole time (LINE_WAIT_MS) for the work before it, which ends.
    const after = inLine('org-1', async () => ran.push('after'), lines);
    await expect(next).resolves.toBe('written');
    await after;
    // The stuck work is still running: the line went on without it, in order.
    expect(ran).toEqual(['stuck', 'next', 'after']);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { line: 'org-1', waitMs: 20 },
      '[catalog] capped write stopped waiting in line',
    );
    release('late');
    await expect(stuck).resolves.toBe('late');
    await new Promise((resolve) => setImmediate(resolve));
    expect(lines.size).toBe(0);
  });
});
