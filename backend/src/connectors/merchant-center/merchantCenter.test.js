import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The plumbing reaches the Supabase admin client at import time, whose config
// exits without its env (as in CI). Every connector test starts like this.
vi.mock('../../config/supabase.js', () => ({ default: {} }));
// The brand's Merchant Center sign-in (BRAND-ACCESS PR 16): none, so the workspace's entity.
vi.mock('../../lib/brandIntegrations.js', () => ({ brandConnection: async () => null }));

import { signInRequest } from '../../lib/catalog/signIn.js';
import { logger } from '../../lib/logger.js';
import { ConnectError } from '../errors.js';
import { runSync } from '../testing.js';
import merchantCenter, {
  API,
  MAX_ACCOUNTS,
  MAX_ISSUES,
  MAX_LISTING_ISSUES,
  MAX_PAGES,
  MAX_PARENTS,
  PAGE_SIZE,
  accountId,
  moneyText,
} from './index.js';

/**
 * The Merchant Center connector (#1270) against a fake of the Merchant API,
 * answered as Composio's proxy would, through the real sign-in request
 * (lib/catalog/signIn.js).
 */

const page = (n) =>
  JSON.parse(
    readFileSync(new URL(`./__fixtures__/products-page-${n}.json`, import.meta.url), 'utf8'),
  );

const ACCOUNT = '123456789';
const PRODUCTS = `${API}/products/v1/accounts/${ACCOUNT}/products`;
const ok = (data) => ({ status: 200, headers: {}, data });

/** The workspace's Google sign-in: the proxy answers by endpoint; no route is a 404. */
function google(routes, { connected = true } = {}) {
  const proxy = vi.fn(async (_accountId, { endpoint, query }) => {
    const route = routes[endpoint];
    return route
      ? route(query ?? {})
      : { status: 404, headers: {}, data: { error: { code: 404 } } };
  });
  const active = vi.fn(async () => (connected ? { id: 'ca_1' } : null));
  const factory = vi.fn((provider, entityId, options) =>
    signInRequest(provider, entityId, { ...options, active, proxy, wait: async () => {} }),
  );
  return { factory, proxy, active };
}

/** The request the plumbing gives the connector, with the connector's own hosts. */
const signedIn = (factory) =>
  factory(merchantCenter.signIn, 'org_org-1', { hosts: merchantCenter.hosts });

const products = () => ({
  [PRODUCTS]: (query) => ok(query.pageToken === 'page-2' ? page(2) : page(1)),
});

beforeEach(() => {
  // The server's Merchant Center sign-in is set up (composio.js isComposioConfigured).
  vi.stubEnv('COMPOSIO_API_KEY', 'test-composio-key');
  vi.stubEnv('COMPOSIO_GMC_AUTH_CONFIG_ID', 'ac_gmc');
  // A refused sign-in is logged as a warning (signIn.js): kept out of the run's output.
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('moneyText', () => {
  it("writes the API's micros as the feeds write a price", () => {
    expect(moneyText({ amountMicros: '129990000', currencyCode: 'USD' })).toBe('129.99 USD');
    expect(moneyText({ amountMicros: '1234500000', currencyCode: 'EUR' })).toBe('1234.50 EUR');
    // Three decimals would read as thousands: six are written.
    expect(moneyText({ amountMicros: '12345000', currencyCode: 'KWD' })).toBe('12.345000 KWD');
    expect(moneyText(undefined)).toBeUndefined();
    expect(moneyText({ amountMicros: '-1' })).toBeUndefined();
  });
});

describe('accountId', () => {
  it('reads an id as a person or the API gives it', () => {
    expect(accountId('accounts/123456789')).toBe('123456789');
    expect(accountId(' 123456789 ')).toBe('123456789');
    expect(accountId('my-shop')).toBeNull();
  });
});

describe('readCatalog, through the real plumbing', () => {
  it("reads every page into the catalog, with each item's issues", async () => {
    const { factory, proxy } = google(products());
    const {
      outcome,
      products: rows,
      variants,
      issues,
    } = await runSync(merchantCenter, { account: ACCOUNT }, { signInRequest: factory });

    // The workspace's Merchant Center sign-in, a page at a time, at the API's largest page.
    expect(factory).toHaveBeenCalledWith(
      'google-merchant-center',
      { entityId: 'org_org-1', accountId: null },
      {
        hosts: ['merchantapi.googleapis.com'],
      },
    );
    expect(proxy.mock.calls.map(([, call]) => call.query)).toEqual([
      { pageSize: PAGE_SIZE, pageToken: undefined },
      { pageSize: PAGE_SIZE, pageToken: 'page-2' },
    ]);

    expect(outcome).toMatchObject({
      status: 'ok',
      counts: {
        format: 'merchant_center',
        items: 2,
        // A product with no price; the German listing of an offer read already is counted apart.
        skipped: 1,
        repeated: 1,
        issues: { items: 2, disapproved: 2, demoted: 1, not_impacted: 1 },
      },
    });
    expect(outcome.counts.errors).toEqual(['Item 4: price is missing.']);

    // Colors of one item group are one product.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      external_id: 'TB',
      product_brand: 'Acme',
      product_type: 'Shoes > Boots',
    });
    const brown = variants.find((v) => v.external_id === 'TB-42-BRN');
    expect(brown).toMatchObject({
      gtin: '00012345678905',
      mpn: 'TB-42',
      price: 129.99,
      sale_price: 99,
      currency: 'USD',
      availability: 'in_stock',
      condition: 'new',
      attributes: { color: 'Brown', size: '42', material: 'Leather' },
    });
    expect(variants.find((v) => v.external_id === 'TB-43-BLK')).toMatchObject({
      availability: 'out_of_stock',
    });

    // An item with no issues has none; one the catalog can't keep still has its own; and the
    // German listing's are the item's too: the same issue once, with both listings' countries.
    expect(issues.map((i) => [i.external_id, i.code, i.severity, i.reporting_context])).toEqual([
      ['TB-42-BRN', 'image_too_small', 'demoted', 'SHOPPING_ADS'],
      ['TB-42-BRN', 'image_too_small', 'not_impacted', 'FREE_LISTINGS'],
      ['TB-42-BRN', 'landing_page_error', 'disapproved', 'SHOPPING_ADS'],
      ['SOCK-1', 'missing_price', 'disapproved', 'SHOPPING_ADS'],
    ]);
    expect(issues[0]).toMatchObject({
      brand_id: 'brand-1',
      attribute: 'image link',
      description: 'Image too small',
      detail: 'Use an image of at least 100 x 100 pixels',
      resolution: 'merchant_action',
      countries: ['US', 'CA', 'DE'],
    });
  });

  it('asks to reconnect when the workspace has no active Google sign-in, and reads nothing', async () => {
    const { factory, proxy } = google(products(), { connected: false });
    const {
      outcome,
      products: rows,
      issues,
    } = await runSync(merchantCenter, { account: ACCOUNT }, { signInRequest: factory });
    expect(proxy).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'auth_failed',
      error:
        "The Google sign-in can't open this Google Merchant Center account anymore. Reconnect it in Settings › Integrations.",
    });
    expect(rows).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });

  it("says so, and calls nothing, when this server hasn't the sign-in set up", async () => {
    vi.stubEnv('COMPOSIO_GMC_AUTH_CONFIG_ID', '');
    const { factory } = google(products());
    const { outcome } = await runSync(
      merchantCenter,
      { account: ACCOUNT },
      { signInRequest: factory },
    );
    expect(factory).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'failed',
      error: "Google Merchant Center isn't set up on this server.",
    });
  });

  it('asks to reconnect when Google refuses the sign-in', async () => {
    const { factory } = google({
      [PRODUCTS]: () => ({
        status: 401,
        headers: {},
        data: { error: { status: 'UNAUTHENTICATED' } },
      }),
    });
    const { outcome } = await runSync(
      merchantCenter,
      { account: ACCOUNT },
      { signInRequest: factory },
    );
    expect(outcome.status).toBe('auth_failed');
  });

  it('waits on a 429 and reads on', async () => {
    let calls = 0;
    const { factory } = google({
      [PRODUCTS]: () => {
        calls += 1;
        return calls === 1
          ? { status: 429, headers: { 'Retry-After': '2' }, data: null }
          : ok({ products: page(1).products });
      },
    });
    const { outcome } = await runSync(
      merchantCenter,
      { account: ACCOUNT },
      { signInRequest: factory },
    );
    expect(calls).toBe(2);
    expect(outcome).toMatchObject({ status: 'ok', counts: { items: 2 } });
  });
});

describe('readCatalog, an offer listed again', () => {
  /** One listing of an offer, under a language and a feed label, with an issue in its countries. */
  const listing = (
    offerId,
    contentLanguage,
    feedLabel,
    countries,
    { disapproved = false } = {},
  ) => ({
    offerId,
    contentLanguage,
    feedLabel,
    productAttributes: {
      title: `Boot ${contentLanguage}-${feedLabel}`,
      link: `https://shop.example/${contentLanguage}/boot`,
      price: { amountMicros: '10000000', currencyCode: 'USD' },
      availability: 'IN_STOCK',
    },
    productStatus: {
      itemLevelIssues: [
        {
          code: 'image_too_small',
          severity: 'DEMOTED',
          attribute: 'image link',
          reportingContext: 'SHOPPING_ADS',
          description: `Words of ${contentLanguage}-${feedLabel}`,
          applicableCountries: countries,
        },
        ...(disapproved
          ? [
              {
                code: 'landing_page_error',
                severity: 'DISAPPROVED',
                attribute: 'link',
                reportingContext: 'SHOPPING_ADS',
                applicableCountries: countries,
              },
            ]
          : []),
      ],
    },
  });

  /** The API, its products in pages of `size`, paged by the page's index. */
  const paged = (all, size) =>
    vi.fn(async (_url, { query }) => {
      const at = Number(query.pageToken ?? 0);
      const next = at + 1;
      return {
        status: 200,
        headers: {},
        data: {
          products: all.slice(at * size, next * size),
          nextPageToken: next * size < all.length ? String(next) : undefined,
        },
      };
    });

  const permutations = (list) =>
    list.length <= 1
      ? [list]
      : list.flatMap((first, i) =>
          permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [first, ...rest]),
        );

  it('keeps the same listing, and the same issues, whatever order the API pages them in', async () => {
    const listings = [
      // First by feed label, but disapproved: a listing that isn't comes first.
      listing('BOOT', 'de', 'AT', ['AT'], { disapproved: true }),
      listing('BOOT', 'en', 'US', ['US']),
      listing('BOOT', 'fr', 'EU', ['FR', 'BE']),
      // The same feed label as the French: the first language.
      listing('BOOT', 'de', 'EU', ['DE', 'AT']),
    ];
    for (const order of permutations(listings)) {
      const read = await merchantCenter.readCatalog(
        { account: ACCOUNT },
        { request: paged(order, 2) },
      );
      expect(read.items.map((item) => item.title)).toEqual(['Boot de-EU']);
      expect(read.errors).toEqual([]);
      expect(read.repeated).toBe(3);
      expect(read.issues).toEqual([
        expect.objectContaining({
          externalId: 'BOOT',
          code: 'image_too_small',
          severity: 'demoted',
          description: 'Words of de-EU',
          countries: ['DE', 'AT', 'FR', 'BE', 'US'],
        }),
        expect.objectContaining({
          externalId: 'BOOT',
          code: 'landing_page_error',
          severity: 'disapproved',
          countries: ['AT'],
        }),
      ]);
    }
  });

  it('says so, first, when it stops at MAX_PAGES', async () => {
    const request = vi.fn(async (_url, { query }) => {
      const n = Number(query.pageToken ?? 0);
      return {
        status: 200,
        headers: {},
        data: { products: [listing(`O-${n}`, 'en', 'US', ['US'])], nextPageToken: String(n + 1) },
      };
    });
    const read = await merchantCenter.readCatalog({ account: ACCOUNT }, { request });
    expect(request).toHaveBeenCalledTimes(MAX_PAGES);
    expect(read.items).toHaveLength(MAX_PAGES);
    expect(read.errors.map((e) => e.message)).toEqual([
      "Only the first 50,000 products were read: the rest aren't in the catalog.",
    ]);
  });

  it('keeps MAX_LISTING_ISSUES of a listing, and MAX_ISSUES of a read, and says how many it left', async () => {
    const withIssues = (offerId, count) => ({
      ...listing(offerId, 'en', 'US', ['US']),
      productStatus: {
        itemLevelIssues: Array.from({ length: count }, (_, i) => ({
          code: `issue_${i}`,
          severity: 'DEMOTED',
          applicableCountries: ['US'],
        })),
      },
    });
    const one = await merchantCenter.readCatalog(
      { account: ACCOUNT },
      { request: async () => ok({ products: [withIssues('BOOT', 500)] }) },
    );
    expect(one.issues).toHaveLength(MAX_LISTING_ISSUES);
    expect(one.errors).toEqual([]);
    // Each listing at its most: the read stops keeping them at MAX_ISSUES.
    const listings = MAX_ISSUES / MAX_LISTING_ISSUES + 10;
    const request = vi.fn(async (_url, { query }) => {
      const n = Number(query.pageToken ?? 0);
      const products = Array.from({ length: PAGE_SIZE }, (_, i) =>
        withIssues(`O-${n * PAGE_SIZE + i}`, MAX_LISTING_ISSUES),
      ).slice(0, Math.max(0, listings - n * PAGE_SIZE));
      const more = (n + 1) * PAGE_SIZE < listings;
      return ok({ products, nextPageToken: more ? String(n + 1) : '' });
    });
    const many = await merchantCenter.readCatalog({ account: ACCOUNT }, { request });
    expect(many.issues).toHaveLength(MAX_ISSUES);
    expect(many.errors.map((e) => e.message)).toEqual([
      `Only the first 100,000 issues were kept: ${(10 * MAX_LISTING_ISSUES).toLocaleString('en-US')} more weren't.`,
    ]);
  });

  it("reads an answer that isn't a product list as a failed read, not an empty account", async () => {
    for (const data of ['<html>', null, [], { products: 'none' }]) {
      await expect(
        merchantCenter.readCatalog({ account: ACCOUNT }, { request: async () => ok(data) }),
      ).rejects.toMatchObject({ code: 'bad_response' });
    }
    // No products at all: Google leaves the list out.
    const none = await merchantCenter.readCatalog(
      { account: ACCOUNT },
      { request: async () => ok({}) },
    );
    expect(none.items).toEqual([]);
  });
});

describe('listAccounts', () => {
  it("lists the accounts the sign-in opens, and an advanced account's sub-accounts", async () => {
    const { factory } = google({
      [`${API}/accounts/v1/accounts`]: () =>
        ok({
          accounts: [
            { name: 'accounts/100', accountId: '100', accountName: 'Acme (advanced)' },
            { name: 'accounts/200', accountId: '200', accountName: 'Other shop' },
          ],
        }),
      [`${API}/accounts/v1/accounts/100:listSubaccounts`]: () =>
        ok({ accounts: [{ name: 'accounts/101', accountId: '101', accountName: 'Acme US' }] }),
      // A standalone account has no sub-accounts to list.
      [`${API}/accounts/v1/accounts/200:listSubaccounts`]: () => ({
        status: 403,
        headers: {},
        data: null,
      }),
    });
    const request = signedIn(factory);
    await expect(merchantCenter.listAccounts({ request })).resolves.toEqual([
      { id: '100', name: 'Acme (advanced)' },
      { id: '200', name: 'Other shop' },
      { id: '101', name: 'Acme US' },
    ]);
  });

  it('says the sign-in is gone when the workspace has none', async () => {
    const { factory } = google({}, { connected: false });
    const request = signedIn(factory);
    await expect(merchantCenter.listAccounts({ request })).rejects.toMatchObject({ code: 'auth' });
  });

  const ACCOUNTS = `${API}/accounts/v1/accounts`;
  const subCalls = (proxy) =>
    proxy.mock.calls.filter(([, call]) => call.endpoint.endsWith(':listSubaccounts'));
  const many = (n, from = 1000) =>
    Array.from({ length: n }, (_, i) => ({ accountId: String(from + i), accountName: null }));

  it('reads every page of the list', async () => {
    const { factory, proxy } = google({
      [ACCOUNTS]: (query) =>
        query.pageToken === 'p2'
          ? ok({ accounts: [{ accountId: '200', accountName: 'B' }] })
          : ok({ accounts: [{ accountId: '100', accountName: 'A' }], nextPageToken: 'p2' }),
    });
    await expect(merchantCenter.listAccounts({ request: signedIn(factory) })).resolves.toEqual([
      { id: '100', name: 'A' },
      { id: '200', name: 'B' },
    ]);
    expect(
      proxy.mock.calls.filter(([, call]) => call.endpoint === ACCOUNTS).map(([, c]) => c.query),
    ).toEqual([
      { pageSize: 500, pageToken: undefined },
      { pageSize: 500, pageToken: 'p2' },
    ]);
  });

  it('lists MAX_ACCOUNTS at most, and the sub-accounts of MAX_PARENTS', async () => {
    const full = google({
      [ACCOUNTS]: () => ok({ accounts: many(MAX_ACCOUNTS), nextPageToken: 'more' }),
    });
    await expect(
      merchantCenter.listAccounts({ request: signedIn(full.factory) }),
    ).resolves.toHaveLength(MAX_ACCOUNTS);
    // No second page, and no sub-accounts: the list is full.
    expect(full.proxy).toHaveBeenCalledTimes(1);

    const parents = google({ [ACCOUNTS]: () => ok({ accounts: many(MAX_PARENTS + 10) }) });
    await merchantCenter.listAccounts({ request: signedIn(parents.factory) });
    expect(subCalls(parents.proxy)).toHaveLength(MAX_PARENTS);
  });

  it('stops when the sign-in goes, or Google asks to wait, while it lists sub-accounts', async () => {
    const gone = google({
      [ACCOUNTS]: () => ok({ accounts: many(3) }),
      [`${ACCOUNTS}/1000:listSubaccounts`]: () => {
        throw new Error('Connected account is expired');
      },
    });
    await expect(
      merchantCenter.listAccounts({ request: signedIn(gone.factory) }),
    ).rejects.toMatchObject({ code: 'auth', status: undefined });
    expect(subCalls(gone.proxy)).toHaveLength(1);

    const waiting = google({
      [ACCOUNTS]: () => ok({ accounts: many(3) }),
      [`${ACCOUNTS}/1000:listSubaccounts`]: () => ({ status: 429, headers: {}, data: null }),
    });
    await expect(
      merchantCenter.listAccounts({ request: signedIn(waiting.factory) }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    // The first account's call and its three tries again; none for the next accounts.
    expect(subCalls(waiting.proxy).map(([, call]) => call.endpoint)).toEqual(
      Array(4).fill(`${ACCOUNTS}/1000:listSubaccounts`),
    );
  });
});

describe('checkAccount', () => {
  const routes = {
    [`${API}/accounts/v1/accounts/${ACCOUNT}`]: () =>
      ok({ name: `accounts/${ACCOUNT}`, accountId: ACCOUNT, accountName: 'Acme Outdoor' }),
  };

  it('confirms the account the person picked, with its name', async () => {
    const request = signedIn(google(routes).factory);
    await expect(merchantCenter.checkAccount(`accounts/${ACCOUNT}`, { request })).resolves.toEqual({
      account: ACCOUNT,
      label: 'Acme Outdoor',
      url: `https://merchants.google.com/mc/overview?a=${ACCOUNT}`,
    });
  });

  it("says so in plain words when the sign-in can't open it, or it isn't an id", async () => {
    const request = signedIn(google(routes).factory);
    await expect(merchantCenter.checkAccount('987654321', { request })).rejects.toThrow(
      new ConnectError("This Google sign-in can't open that Merchant Center account."),
    );
    await expect(merchantCenter.checkAccount('my-shop', { request })).rejects.toBeInstanceOf(
      ConnectError,
    );
  });
});

describe('syncOrders', () => {
  it('has none: Merchant Center has no orders', async () => {
    await expect(merchantCenter.syncOrders()).resolves.toEqual({ orders: [] });
  });
});
