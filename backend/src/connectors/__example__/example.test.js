import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The plumbing reaches the Supabase admin client at import time, whose config
// exits without its env (as in CI). Every connector test starts like this.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { logger } from '../../lib/logger.js';
import { ConnectError } from '../errors.js';
import { runSync, startFakeApi } from '../testing.js';
import example from './index.js';

/**
 * The example connector against a fake of its API: how a connector's tests
 * look (CONNECTORS.md), and the harness's own test.
 */

const KEY = 'ex_live_0123456789abcdef';

const product = (id, overrides = {}) => ({
  id,
  title: `Trail Boot ${id}`,
  description: 'Waterproof leather boot.',
  url: `https://shop.example/products/boot-${id}`,
  images: [`https://shop.example/img/${id}.jpg`],
  vendor: 'Acme',
  currency: 'USD',
  category: 'Footwear',
  variants: [
    {
      id: `${id}-42`,
      title: 'Brown / 42',
      price: '129.00',
      in_stock: true,
      options: { color: 'Brown', size: '42' },
    },
    {
      id: `${id}-43`,
      title: 'Brown / 43',
      price: '129.00',
      in_stock: false,
      options: { color: 'Brown', size: '43' },
    },
  ],
  ...overrides,
});

let api;
let catalog;
afterEach(async () => {
  await api?.close();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  catalog = { 1: [product('p1'), product('p2')], 2: [product('p3')] };
  api = await startFakeApi({
    'GET /api/shop': (req) =>
      req.headers.authorization === `Bearer ${KEY}`
        ? { json: { domain: 'shop.example', name: 'Acme Outdoor' } }
        : { status: 401, json: { error: 'bad key' } },
    'GET /api/products': (req) => {
      if (req.headers.authorization !== `Bearer ${KEY}`) return { status: 401 };
      const page = Number(req.query.page ?? 1);
      const headers = catalog[page + 1]
        ? { link: `<${api.origin}/api/products?per_page=100&page=${page + 1}>; rel="next"` }
        : {};
      return { headers, json: { products: catalog[page] ?? [] } };
    },
  });
});

describe('connect', () => {
  it('checks the key with the store and keeps it, naming the store by its domain', async () => {
    const out = await example.connect(
      { url: `${api.origin}/admin`, apiKey: KEY },
      { request: api.request },
    );
    expect(out).toEqual({
      account: 'shop.example',
      url: api.origin,
      label: 'Acme Outdoor',
      credentials: { apiKey: KEY },
    });
    // The key goes in a header, never in the address.
    expect(api.calls[0]).toMatchObject({ path: '/api/shop', query: {} });
  });

  it('says what to fix, in words', async () => {
    await expect(
      example.connect({ url: 'shop', apiKey: KEY }, { request: api.request }),
    ).rejects.toThrow(ConnectError);
    await expect(
      example.connect({ url: api.origin, apiKey: '' }, { request: api.request }),
    ).rejects.toThrow('Paste the API key.');
  });

  it("lets the store's refusal through, for the plumbing to name", async () => {
    await expect(
      example.connect({ url: api.origin, apiKey: 'wrong' }, { request: api.request }),
    ).rejects.toMatchObject({ code: 'auth', status: 401 });
  });
});

describe('a sync through the harness', () => {
  const source = () => ({ url: api.origin, account: 'shop.example' });

  it('reads every page into the catalog, one item per variant under its product', async () => {
    const { outcome, products, variants } = await runSync(example, source(), {
      credentials: { apiKey: KEY },
      request: api.request,
    });
    expect(outcome).toMatchObject({
      status: 'ok',
      counts: {
        format: 'example_store',
        items: 6,
        skipped: 0,
        products: { added: 3, removed: 0 },
        variants: { added: 6, removed: 0 },
      },
    });
    expect(products.map((p) => p.title).sort()).toEqual([
      'Trail Boot p1',
      'Trail Boot p2',
      'Trail Boot p3',
    ]);
    expect(variants.find((v) => v.external_id === 'p1-42')).toMatchObject({
      price: 129,
      currency: 'USD',
      availability: 'in_stock',
      attributes: { color: 'Brown', size: '42' },
    });
    expect(api.calls.filter((c) => c.path === '/api/products').map((c) => c.query.page)).toEqual([
      undefined,
      '2',
    ]);
  });

  it('waits as the store asks on a 429, and tries again', async () => {
    let first = true;
    const limited = await startFakeApi({
      'GET /api/products': () => {
        if (first) {
          first = false;
          return { status: 429, headers: { 'retry-after': '2' } };
        }
        return { json: { products: [product('p1')] } };
      },
    });
    try {
      const { outcome } = await runSync(
        example,
        { url: limited.origin },
        {
          credentials: { apiKey: KEY },
          request: limited.request,
        },
      );
      expect(outcome.status).toBe('ok');
      expect(limited.waits).toHaveLength(1);
      expect(limited.waits[0]).toBeGreaterThanOrEqual(2000);
    } finally {
      await limited.close();
    }
  });

  it('records a refused key as a sign-in to update, without logging it', async () => {
    const error = vi.spyOn(logger, 'error');
    const { outcome } = await runSync(example, source(), {
      credentials: { apiKey: 'revoked-key-value' },
      request: api.request,
    });
    expect(outcome).toMatchObject({ status: 'auth_failed' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('revoked-key-value');
  });

  it("names the store's address, not its key, when a product can't be kept", async () => {
    catalog[1] = [product('p1', { variants: [{ id: 'p1-x', price: null, in_stock: true }] })];
    catalog[2] = [];
    const { outcome } = await runSync(example, source(), {
      credentials: { apiKey: KEY },
      request: api.request,
    });
    expect(outcome).toMatchObject({ status: 'ok', counts: { items: 0, skipped: 1 } });
    expect(outcome.counts.errors[0]).toBe('Item 1: price is missing.');
  });
});
