import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The catalog harness imports the Supabase admin client before a test calls runSync.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { ConnectError } from '../errors.js';
import { runSync, startFakeApi } from '../testing.js';
import wooCommerce, { MAX_PAGES, ORDER_MAX_PAGES, verifyWebhookSignature } from './index.js';

const CONSUMER_KEY = 'ck_test_woocommerce_readonly';
const CONSUMER_SECRET = 'cs_test_woocommerce_secret';
const AUTHORIZATION = `Basic ${Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')}`;

const simple = (id, overrides = {}) => ({
  id,
  type: 'simple',
  name: `Merino Sock ${id}`,
  description: '<p>Soft <strong>merino</strong> wool.</p>',
  permalink: `https://shop.example/product/sock-${id}`,
  sku: `SOCK-${id}`,
  global_unique_id: `00000000000${id}`,
  price: '19.00',
  regular_price: '19.00',
  sale_price: '',
  stock_status: 'instock',
  images: [
    { src: `https://shop.example/wp-content/uploads/${id}.jpg` },
    { src: `https://shop.example/wp-content/uploads/${id}-back.jpg` },
  ],
  categories: [
    { id: 2, name: 'Boots' },
    { id: 3, name: 'Accessories' },
  ],
  attributes: [{ name: 'Brand', options: ['Acme'] }],
  meta_data: [],
  ...overrides,
});

const variable = {
  id: 202,
  type: 'variable',
  name: 'Trail Boot',
  description: '<p>Waterproof <em>leather</em> hiking boot.</p>',
  permalink: 'https://shop.example/product/trail-boot',
  sku: 'BOOT-PARENT',
  price: '',
  regular_price: '',
  sale_price: '',
  stock_status: 'instock',
  images: [{ src: 'https://shop.example/wp-content/uploads/trail-boot.jpg' }],
  categories: [{ id: 2, name: 'Boots' }],
  attributes: [{ name: 'Material', options: ['Leather'] }],
  meta_data: [],
};

const variation = (id, color, size, overrides = {}) => ({
  id,
  sku: `BOOT-${color.toUpperCase()}-${size}`,
  global_unique_id: `90000000000${id}`,
  price: '129.00',
  regular_price: '129.00',
  sale_price: color === 'Red' ? '99.00' : '',
  stock_status: color === 'Red' ? 'instock' : 'outofstock',
  permalink: '',
  image: { src: `https://shop.example/wp-content/uploads/boot-${color.toLowerCase()}.jpg` },
  attributes: [
    { name: 'Color', option: color },
    { name: 'Size', option: size },
    { name: 'Material', option: 'Leather' },
  ],
  meta_data: [],
  ...overrides,
});

let api;
let productPages;
let variationPages;

function authorized(req) {
  return req.headers.authorization === AUTHORIZATION;
}

beforeEach(async () => {
  productPages = {
    1: [simple(101), variable],
    2: [
      simple(303, {
        name: 'Leather Belt',
        description: '<p>Everyday belt.</p>',
        sku: 'BELT-303',
        regular_price: '35.00',
        price: '35.00',
        stock_status: 'outofstock',
        categories: [{ id: 3, name: 'Accessories' }],
      }),
      simple(404, { regular_price: '', price: '', name: 'Missing price product' }),
    ],
  };
  variationPages = {
    1: [variation(2011, 'Red', '42'), variation(2012, 'Blue', '43')],
  };

  api = await startFakeApi({
    'GET /wp-json/wc/store/v1/products': () => ({
      json: [{ id: 101, prices: { currency_code: 'USD' } }],
    }),
    'GET /wp-json/wc/v3/products': (req) => {
      if (!authorized(req)) return { status: 401, json: { message: 'Unauthorized' } };
      if (req.query.per_page === '1' && !req.query.page) {
        return { headers: { 'x-wp-totalpages': '1' }, json: [simple(101)] };
      }
      const page = Number(req.query.page ?? 1);
      return {
        headers: { 'x-wp-totalpages': '2' },
        json: productPages[page] ?? [],
      };
    },
    'GET /wp-json/wc/v3/products/categories': (req) => {
      if (!authorized(req)) return { status: 401, json: { message: 'Unauthorized' } };
      const page = Number(req.query.page ?? 1);
      return page === 1
        ? {
            headers: { 'x-wp-totalpages': '2' },
            json: [
              { id: 1, name: 'Footwear', parent: 0 },
              { id: 3, name: 'Accessories', parent: 0 },
            ],
          }
        : {
            headers: { 'x-wp-totalpages': '2' },
            json: [{ id: 2, name: 'Boots', parent: 1 }],
          };
    },
    'GET /wp-json/wc/v3/products/202/variations': (req) => {
      if (!authorized(req)) return { status: 401, json: { message: 'Unauthorized' } };
      const page = Number(req.query.page ?? 1);
      return {
        headers: { 'x-wp-totalpages': '1' },
        json: variationPages[page] ?? [],
      };
    },
    'GET /wp-json/wc/v3/orders': (req) => {
      if (!authorized(req)) return { status: 401, json: { message: 'Unauthorized' } };
      const page = Number(req.query.page ?? 1);
      return {
        headers: { 'x-wp-totalpages': '1' },
        json:
          page === 1
            ? [
                {
                  id: 7001,
                  date_created_gmt: '2026-10-20T10:00:00',
                  date_modified_gmt: '2026-10-22T09:00:00',
                  status: 'completed',
                  total: '250.00',
                  created_via: 'checkout',
                  refunds: [{ id: 801, reason: 'private refund note', total: '-25.00' }],
                  billing: { first_name: 'PRIVATE BUYER', email: 'private@example.invalid' },
                  shipping: { address_1: 'PRIVATE ADDRESS' },
                  customer_id: 9876,
                  line_items: [
                    {
                      id: 9101,
                      product_id: 202,
                      variation_id: 2011,
                      quantity: 2,
                      total: '225.00',
                      name: 'Buyer-supplied product name is not stored',
                    },
                  ],
                },
              ]
            : [],
      };
    },
  });
});

afterEach(async () => {
  await api?.close();
  vi.restoreAllMocks();
});

describe('connect', () => {
  it('checks the HTTPS store with read-only keys and keeps credentials for encrypted storage', async () => {
    const out = await wooCommerce.connect(
      {
        url: `https://${new URL(api.origin).host}/`,
        consumerKey: CONSUMER_KEY,
        consumerSecret: CONSUMER_SECRET,
      },
      {
        request: (address, options) => api.request(address.replace(/^https:/, 'http:'), options),
      },
    );

    expect(out).toEqual({
      account: new URL(api.origin).host,
      url: `https://${new URL(api.origin).host}`,
      label: 'store.test',
      credentials: { consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET },
    });
    expect(api.calls[0]).toMatchObject({
      path: '/wp-json/wc/v3/products',
      query: { per_page: '1' },
      headers: { authorization: AUTHORIZATION },
    });
    expect(JSON.stringify(api.calls[0].query)).not.toContain(CONSUMER_KEY);
    expect(JSON.stringify(api.calls[0].query)).not.toContain(CONSUMER_SECRET);
  });

  it('rejects insecure or malformed store addresses and missing keys', async () => {
    await expect(
      wooCommerce.connect(
        { url: api.origin, consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET },
        { request: api.request },
      ),
    ).rejects.toThrow(ConnectError);
    await expect(
      wooCommerce.connect(
        { url: 'https://shop.example', consumerKey: '', consumerSecret: CONSUMER_SECRET },
        { request: api.request },
      ),
    ).rejects.toThrow('Paste the WooCommerce consumer key.');
    await expect(
      wooCommerce.connect(
        { url: 'https://shop.example', consumerKey: CONSUMER_KEY, consumerSecret: '' },
        { request: api.request },
      ),
    ).rejects.toThrow('Paste the WooCommerce consumer secret.');
  });

  it('lets an invalid key be reported as a sign-in failure without exposing it in the request URL', async () => {
    const badKey = 'ck_invalid_private_value';
    await expect(
      wooCommerce.connect(
        {
          url: `https://${new URL(api.origin).host}`,
          consumerKey: badKey,
          consumerSecret: 'cs_invalid_private_value',
        },
        {
          request: (address, options) => api.request(address.replace(/^https:/, 'http:'), options),
        },
      ),
    ).rejects.toMatchObject({ code: 'auth', status: 401 });
    expect(api.calls[0].path).not.toContain(badKey);
    expect(JSON.stringify(api.calls[0].query)).not.toContain(badKey);
  });
});

describe('readCatalog through the connector harness', () => {
  const source = () => ({ url: api.origin, account: new URL(api.origin).host });

  it('reads pages, categories, simple products and variable variations into the shared catalog', async () => {
    const { outcome, products, variants, images, categories, fake } = await runSync(
      wooCommerce,
      source(),
      {
        credentials: { consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET },
        request: api.request,
      },
    );

    expect(outcome).toMatchObject({
      status: 'ok',
      counts: {
        format: 'woocommerce',
        items: 4,
        skipped: 1,
        products: { added: 3, removed: 0 },
        variants: { added: 4, removed: 0 },
      },
    });
    expect(outcome.counts.errors[0]).toBe('Item 5: price is missing.');

    expect(products.map((p) => p.external_id).sort()).toEqual(['101', '202', '303']);
    expect(products.find((p) => p.external_id === '202')?.title).toBe('Trail Boot');
    expect(variants).toHaveLength(4);
    expect(variants.find((v) => v.external_id === '2011')).toMatchObject({
      product_id: products.find((p) => p.external_id === '202')?.id,
      sku: 'BOOT-RED-42',
      gtin: '900000000002011',
      price: 129,
      sale_price: 99,
      availability: 'in_stock',
      attributes: { color: 'Red', size: '42', material: 'Leather' },
    });
    expect(variants.find((v) => v.external_id === '2012')).toMatchObject({
      availability: 'out_of_stock',
      attributes: { color: 'Blue', size: '43' },
    });
    expect(variants.find((v) => v.external_id === '101')).toMatchObject({
      sku: 'SOCK-101',
      gtin: '00000000000101',
      price: 19,
    });

    expect(products.find((p) => p.external_id === '101')?.description).toBe('Soft merino wool.');
    expect(images).toHaveLength(8);
    expect(categories.map((c) => c.name).sort()).toEqual(['Accessories', 'Footwear > Boots']);
    const sockProductId = products.find((p) => p.external_id === '101')?.id;
    const sockCategories = fake
      .rows('catalog_product_categories')
      .filter((link) => link.product_id === sockProductId)
      .map((link) => categories.find((category) => category.id === link.category_id)?.name)
      .sort();
    expect(sockCategories).toEqual(['Accessories', 'Footwear > Boots']);

    const currencyLookup = api.calls.find((call) => call.path === '/wp-json/wc/store/v1/products');
    expect(currencyLookup?.query).toMatchObject({ per_page: '1', page: '1' });
    expect(currencyLookup?.headers.authorization).toBeUndefined();

    const productPagesRead = api.calls.filter(
      (call) => call.path === '/wp-json/wc/v3/products' && call.query.per_page === '100',
    );
    expect(productPagesRead.map((call) => call.query.page)).toEqual(['1', '2']);
    expect(
      api.calls
        .filter((call) => call.path === '/wp-json/wc/v3/products/categories')
        .map((call) => call.query.page),
    ).toEqual(['1', '2']);
    expect(
      api.calls
        .filter((call) => call.path === '/wp-json/wc/v3/products/202/variations')
        .map((call) => call.query.page),
    ).toEqual(['1']);
    expect(
      api.calls
        .filter((call) => call.path === '/wp-json/wc/v3/orders')
        .map((call) => call.query.page),
    ).toEqual(['1']);
    expect(api.calls.every((call) => !JSON.stringify(call.query).includes(CONSUMER_SECRET))).toBe(
      true,
    );
    expect(outcome.counts.orders).toMatchObject({
      added: 1,
      items: 1,
      skippedFromApi: 0,
      truncated: false,
    });
    const [order] = fake.rows('catalog_orders');
    expect(order).toMatchObject({
      external_id: '7001',
      status: 'completed',
      channel: 'checkout',
      total: 250,
      refunded_total: 25,
    });
    expect(JSON.stringify(order)).not.toContain('PRIVATE BUYER');
    expect(JSON.stringify(order)).not.toContain('private@example.invalid');
    expect(JSON.stringify(order)).not.toContain('PRIVATE ADDRESS');
    expect(JSON.stringify(order)).not.toContain('private refund note');
    expect(order).not.toHaveProperty('billing');
    expect(order).not.toHaveProperty('shipping');
    expect(order).not.toHaveProperty('customer_id');
    expect(fake.rows('catalog_order_items')).toEqual([
      expect.objectContaining({
        external_line_id: '9101',
        external_product_id: '202',
        external_variation_id: '2011',
        quantity: 2,
        revenue: 225,
      }),
    ]);
    expect(fake.rows('catalog_order_items')[0]).not.toHaveProperty('name');
    expect(fake.rows('catalog_sources')[0].last_orders_synced_at).toBeTruthy();
  });

  it('keeps only published products and enabled variations', async () => {
    await api.close();
    const listed = [
      simple(101, { status: 'publish' }),
      simple(102, { status: 'draft' }),
      simple(103, { status: 'pending' }),
      simple(104, { status: 'private' }),
      { ...variable, status: 'publish' },
    ];
    api = await startFakeApi({
      'GET /wp-json/wc/store/v1/products': () => ({
        json: [{ id: 101, prices: { currency_code: 'USD' } }],
      }),
      'GET /wp-json/wc/v3/products/categories': () => ({
        headers: { 'x-wp-totalpages': '1' },
        json: [],
      }),
      // Answers like WooCommerce: `status` filters, and its default is `any`.
      'GET /wp-json/wc/v3/products': (req) => ({
        headers: { 'x-wp-totalpages': '1' },
        json: listed.filter(
          (p) => (req.query.status ?? 'any') === 'any' || p.status === req.query.status,
        ),
      }),
      'GET /wp-json/wc/v3/products/202/variations': () => ({
        headers: { 'x-wp-totalpages': '1' },
        json: [
          variation(2011, 'Red', '42', { status: 'publish' }),
          variation(2012, 'Blue', '43', { status: 'private' }),
        ],
      }),
      'GET /wp-json/wc/v3/orders': () => ({ headers: { 'x-wp-totalpages': '1' }, json: [] }),
    });

    const { outcome, products, variants } = await runSync(wooCommerce, source(), {
      credentials: { consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET },
      request: api.request,
    });

    expect(outcome).toMatchObject({ status: 'ok', counts: { items: 2, skipped: 0 } });
    expect(products.map((p) => p.external_id).sort()).toEqual(['101', '202']);
    expect(variants.map((v) => v.external_id).sort()).toEqual(['101', '2011']);
    expect(
      api.calls
        .filter((call) => call.path === '/wp-json/wc/v3/products' && call.query.page)
        .map((call) => call.query.status),
    ).toEqual(['publish']);
  });

  it('fails closed when the product pagination cap would make the snapshot incomplete', async () => {
    await api.close();
    api = await startFakeApi({
      'GET /wp-json/wc/store/v1/products': () => ({
        json: [{ id: 101, prices: { currency_code: 'USD' } }],
      }),
      'GET /wp-json/wc/v3/products/categories': () => ({
        headers: { 'x-wp-totalpages': '1' },
        json: [],
      }),
      'GET /wp-json/wc/v3/products': () => ({
        headers: { 'x-wp-totalpages': String(MAX_PAGES + 1) },
        json: [simple(999)],
      }),
    });

    const { outcome, products, variants } = await runSync(wooCommerce, source(), {
      credentials: { consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET },
      request: api.request,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBeTruthy();
    expect(api.calls.filter((call) => call.path === '/wp-json/wc/v3/products')).toHaveLength(
      MAX_PAGES,
    );
    expect(products).toEqual([]);
    expect(variants).toEqual([]);
  });

  it('overlaps the modified-after cursor to avoid misses from second-precision timestamps', async () => {
    const { orders } = await wooCommerce.syncOrders(source(), {
      credentials: { consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET },
      request: api.request,
      since: '2026-10-22T09:00:30.500Z',
    });

    expect(orders.length).toBeGreaterThan(0);
    expect(api.calls.find((call) => call.path === '/wp-json/wc/v3/orders')?.query).toMatchObject({
      modified_after: '2026-10-22T08:55:30.500Z',
      status: 'any',
      orderby: 'modified',
      order: 'asc',
      dates_are_gmt: 'true',
    });
  });

  it('moves the order cursor to the last change read when the order pages hit their cap', async () => {
    await api.close();
    api = await startFakeApi({
      'GET /wp-json/wc/v3/products/categories': () => ({
        headers: { 'x-wp-totalpages': '1' },
        json: [],
      }),
      'GET /wp-json/wc/v3/products': () => ({ headers: { 'x-wp-totalpages': '1' }, json: [] }),
      'GET /wp-json/wc/v3/orders': (req) => {
        const page = Number(req.query.page);
        const minute = String(page % 60).padStart(2, '0');
        return {
          headers: { 'x-wp-totalpages': String(ORDER_MAX_PAGES + 50) },
          json: [
            {
              id: 5000 + page,
              date_created_gmt: '2026-01-01T10:00:00',
              date_modified_gmt: `2026-01-${String(1 + Math.floor(page / 60)).padStart(2, '0')}T11:${minute}:00`,
              status: 'completed',
              total: '10.00',
              billing: { email: 'private@example.invalid' },
              line_items: [],
            },
          ],
        };
      },
    });

    const { outcome, fake } = await runSync(
      wooCommerce,
      { ...source(), last_orders_synced_at: '2025-12-31T00:00:00.000Z' },
      {
        credentials: { consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET },
        request: api.request,
        now: new Date('2026-10-29T12:00:00.000Z'),
      },
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.counts.orders).toMatchObject({ added: ORDER_MAX_PAGES, truncated: true });
    expect(api.calls.filter((call) => call.path === '/wp-json/wc/v3/orders')).toHaveLength(
      ORDER_MAX_PAGES,
    );
    // Page 100 is the last read: 2026-01-02 11:40 GMT. Not the run's own time,
    // and not left where it was, so the next sync reads the next pages.
    expect(fake.rows('catalog_sources')[0].last_orders_synced_at).toBe('2026-01-02T11:40:00.000Z');
    expect(JSON.stringify(fake.rows('catalog_orders'))).not.toContain('private@example.invalid');
  });

  it("keeps the catalog's outcome and the order cursor when the order read fails", async () => {
    await api.close();
    api = await startFakeApi({
      'GET /wp-json/wc/v3/products/categories': () => ({
        headers: { 'x-wp-totalpages': '1' },
        json: [],
      }),
      'GET /wp-json/wc/v3/products': () => ({
        headers: { 'x-wp-totalpages': '1' },
        json: [simple(101)],
      }),
      'GET /wp-json/wc/v3/orders': () => ({ json: { message: 'not a list' } }),
    });

    const { outcome, products, fake } = await runSync(
      wooCommerce,
      { ...source(), last_orders_synced_at: '2026-10-01T00:00:00.000Z' },
      {
        credentials: { consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET },
        request: api.request,
      },
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.counts.orders).toEqual({
      failed: true,
      error: "The store's answer couldn't be read.",
    });
    expect(products).toHaveLength(1);
    expect(fake.rows('catalog_sources')[0].last_orders_synced_at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('retries a 429 according to Retry-After and then continues the sync', async () => {
    let limited = true;
    await api.close();
    api = await startFakeApi({
      'GET /wp-json/wc/v3/products/categories': () => {
        if (limited) {
          limited = false;
          return { status: 429, headers: { 'retry-after': '2' }, json: { message: 'wait' } };
        }
        return { headers: { 'x-wp-totalpages': '1' }, json: [] };
      },
      'GET /wp-json/wc/v3/products': () => ({
        headers: { 'x-wp-totalpages': '1' },
        json: [],
      }),
      'GET /wp-json/wc/v3/orders': () => ({
        headers: { 'x-wp-totalpages': '1' },
        json: [],
      }),
    });
    const { outcome } = await runSync(wooCommerce, source(), {
      credentials: { consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET },
      request: api.request,
    });
    expect(outcome.status).toBe('ok');
    expect(api.waits).toHaveLength(1);
    expect(api.waits[0]).toBeGreaterThanOrEqual(2000);
  });
});

describe('optional webhook verification', () => {
  it('accepts a valid order or product HMAC and returns only resource routing metadata', () => {
    const secret = 'test-webhook-secret';
    const rawBody = Buffer.from(
      JSON.stringify({ id: 7001, billing: { email: 'private@example.invalid' } }),
    );
    const signature = createHmac('sha256', secret).update(rawBody).digest('base64');

    expect(verifyWebhookSignature(rawBody, signature, secret)).toBe(true);
    expect(
      wooCommerce.handleWebhook({ rawBody, signature, secret, topic: 'order.updated' }),
    ).toEqual({
      id: '7001',
      resource: 'order',
    });
    expect(
      wooCommerce.handleWebhook({ rawBody, signature, secret, topic: 'product.updated' }),
    ).toEqual({
      id: '7001',
      resource: 'product',
    });
  });

  it('rejects a bad signature, invalid body, and unsupported topic', () => {
    const rawBody = Buffer.from('{"id":7001}');
    expect(verifyWebhookSignature(rawBody, 'not-a-signature', 'secret')).toBe(false);
    expect(() =>
      wooCommerce.handleWebhook({
        rawBody,
        signature: 'not-a-signature',
        secret: 'secret',
        topic: 'order.updated',
      }),
    ).toThrow(ConnectError);
    const signature = createHmac('sha256', 'secret').update(rawBody).digest('base64');
    expect(() =>
      wooCommerce.handleWebhook({
        rawBody,
        signature,
        secret: 'secret',
        topic: 'customer.updated',
      }),
    ).toThrow('unsupported webhook topic');
    expect(() =>
      wooCommerce.handleWebhook({
        rawBody: Buffer.from('broken'),
        signature: createHmac('sha256', 'secret').update('broken').digest('base64'),
        secret: 'secret',
        topic: 'order.updated',
      }),
    ).toThrow('unreadable webhook body');
  });
});
