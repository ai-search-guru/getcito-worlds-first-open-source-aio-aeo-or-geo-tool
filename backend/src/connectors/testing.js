import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { fakeDb } from '../lib/catalog/__fixtures__/fakeDb.js';
import { saveCredentials } from '../lib/catalog/credentials.js';
import { syncSource } from '../lib/catalog/sources.js';
import { publicOnlyLookup } from '../lib/safeFetch.js';
import { requestJson } from './http.js';

/**
 * The test harness for connectors (#1263, CONNECTORS.md): a connector's
 * tests run in `npm test` against a fake of its platform's API, with no
 * account and no network.
 *
 *   - `startFakeApi(routes)` serves the routes on a local port, as
 *     `http://store.test:<port>`, and gives the `request` to hand the
 *     connector: the real HTTP client (./http.js), reaching only that fake
 *     host, with its waits recorded instead of slept.
 *   - `runSync(connector, source, { credentials, request })` syncs a source
 *     through the real plumbing (lib/catalog/sources.js) into an in-memory
 *     catalog, and returns the outcome and the rows written. A connector
 *     read with the workspace's sign-in (`signIn`, #1270) gets
 *     `signInRequest` instead: a stand-in for lib/catalog/signIn.js's,
 *     `(provider, entityId, { hosts }) => request`.
 *
 * A test file that uses it mocks the Supabase admin client first, which
 * exits without its env (see connectors/__example__/example.test.js).
 */

export const FAKE_HOST = 'store.test';

/**
 * @typedef {{ method: string, path: string, query: Record<string, string>, headers: Record<string, string|string[]|undefined>, body: unknown }} FakeRequest
 * @typedef {{ status?: number, headers?: Record<string, string>, json?: unknown, text?: string }} FakeResponse
 * @param {Record<string, (req: FakeRequest) => FakeResponse | Promise<FakeResponse>>} routes
 *   by "METHOD /path" (no query); any other request answers 404
 */
export async function startFakeApi(routes) {
  const calls = [];
  const waits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://local');
      const text = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      const call = {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
      };
      calls.push(call);
      const handler = routes[`${req.method} ${url.pathname}`];
      const out = handler ? await handler(call) : { status: 404, json: { error: 'not found' } };
      const payload = out.text ?? (out.json === undefined ? '' : JSON.stringify(out.json));
      res.writeHead(out.status ?? 200, {
        'content-type': out.text !== undefined ? 'text/plain' : 'application/json',
        ...out.headers,
      });
      res.end(payload);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = String(server.address().port);
  const origin = `http://${FAKE_HOST}:${port}`;

  // The fake host is the local server; every other name goes through the real check.
  const lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const all = typeof options === 'object' && options.all;
    if (hostname !== FAKE_HOST) return publicOnlyLookup(hostname, options, callback);
    return all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4);
  };
  // The fake serves plain http on its port; the real client calls https only.
  const request = (address, opts = {}) =>
    requestJson(address, {
      ...opts,
      lookup,
      ports: ['', '80', '443', port],
      allowHttp: true,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

  return {
    origin,
    request,
    calls,
    waits,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Syncs `source` with `connector` into an in-memory catalog, as the daily
 * run does. A store's `credentials` are saved for it first, encrypted, as
 * connecting it would.
 *
 * @returns {Promise<{ outcome: object, products: object[], variants: object[], images: object[], categories: object[], issues: object[], fake: ReturnType<typeof fakeDb> }>}
 */
export async function runSync(
  connector,
  source,
  { credentials, request, signInRequest, now = new Date() } = {},
) {
  // A key for this run, when the test has none: nothing outlives it.
  process.env.CONNECTOR_CREDENTIALS_KEY ??= randomBytes(32).toString('base64');
  const fake = fakeDb();
  const row = {
    id: randomUUID(),
    brand_id: 'brand-1',
    kind: connector.kind,
    format: 'auto',
    url: null,
    account: null,
    ...source,
  };
  fake.rows('catalog_sources').push({ last_orders_synced_at: null, ...row, last_synced_at: null });
  // The brand's workspace, whose sign-in a `signIn` connector reads with.
  fake.rows('brands').push({ id: row.brand_id, organization_id: 'org-1' });
  if (credentials) await saveCredentials(row.id, credentials, { db: fake.db });
  const outcome = await syncSource(row, {
    db: fake.db,
    now,
    request,
    ...(signInRequest ? { signInRequest } : {}),
    connectors: { [connector.kind]: connector },
  });
  return {
    outcome,
    products: fake.rows('catalog_products'),
    variants: fake.rows('catalog_variants'),
    images: fake.rows('catalog_images'),
    categories: fake.rows('catalog_categories'),
    issues: fake.rows('catalog_item_issues'),
    fake,
  };
}
