import http from 'node:http';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The harness reaches the Supabase admin client at import time.
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { ConnectorHttpError, nextLink, requestJson, retryAfterMs } from './http.js';
import { startFakeApi } from './testing.js';

/** The HTTP client store connectors call their platform with (#1263). */

let api;
afterEach(async () => {
  await api?.close();
  api = null;
});

describe('retryAfterMs', () => {
  it('reads seconds or a date, else nothing', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    expect(retryAfterMs({ 'retry-after': '3' }, now)).toBe(3000);
    expect(retryAfterMs({ 'retry-after': 'Sun, 25 Oct 2026 12:00:10 GMT' }, now)).toBe(10_000);
    expect(retryAfterMs({ 'retry-after': 'Sun, 25 Oct 2026 11:00:00 GMT' }, now)).toBe(0);
    expect(retryAfterMs({ 'retry-after': 'soon' }, now)).toBeNull();
    expect(retryAfterMs({}, now)).toBeNull();
  });
});

describe('nextLink', () => {
  it("finds the next page among a Link header's", () => {
    expect(
      nextLink({
        link: '<https://s.example/p?page=1>; rel="prev", <https://s.example/p?page=3>; rel="next"',
      }),
    ).toBe('https://s.example/p?page=3');
    expect(nextLink({ link: '<https://s.example/p?page=2>; rel="last next"' })).toBe(
      'https://s.example/p?page=2',
    );
    expect(nextLink({ link: '<https://s.example/p?page=1>; rel="previous"' })).toBeNull();
    expect(nextLink({})).toBeNull();
  });
});

describe('requestJson against a fake API', () => {
  it('sends JSON, and reads JSON back', async () => {
    api = await startFakeApi({
      'POST /echo': (req) => ({ json: { got: req.body, auth: req.headers.authorization } }),
      'GET /empty': () => ({ status: 204 }),
    });
    await expect(
      api.request(`${api.origin}/echo`, {
        method: 'POST',
        headers: { authorization: 'Bearer k' },
        body: { a: 1 },
      }),
    ).resolves.toMatchObject({ status: 200, data: { got: { a: 1 }, auth: 'Bearer k' } });
    await expect(api.request(`${api.origin}/empty`)).resolves.toMatchObject({
      status: 204,
      data: null,
    });
  });

  it('adds the query, and never names it in an error', async () => {
    api = await startFakeApi({
      'GET /items': (req) => ({ status: 500, json: { query: req.query } }),
    });
    const err = await api
      .request(`${api.origin}/items`, { query: { consumer_key: 'ck_secret', page: 2 }, retries: 0 })
      .catch((e) => e);
    expect(api.calls[0].query).toEqual({ consumer_key: 'ck_secret', page: '2' });
    expect(err).toBeInstanceOf(ConnectorHttpError);
    expect(err).toMatchObject({ code: 'http_error', status: 500 });
    expect(err.message).toBe(`GET store.test:${api.origin.split(':').pop()}/items answered 500`);
    expect(err.message).not.toContain('ck_secret');
  });

  it('tries again on 429 and 5xx, as long as Retry-After says, and stops past the limit', async () => {
    let n = 0;
    api = await startFakeApi({
      'GET /flaky': () => {
        n += 1;
        if (n === 1) return { status: 503 };
        if (n === 2) return { status: 429, headers: { 'retry-after': '5' } };
        return { json: { ok: true } };
      },
      'GET /busy': () => ({ status: 429, headers: { 'retry-after': '3600' } }),
      'GET /down': () => ({ status: 502 }),
    });
    await expect(api.request(`${api.origin}/flaky`)).resolves.toMatchObject({ data: { ok: true } });
    expect(api.waits[0]).toBeGreaterThanOrEqual(1000);
    expect(api.waits[0]).toBeLessThan(1250);
    expect(api.waits[1]).toBeGreaterThanOrEqual(5000);
    await expect(api.request(`${api.origin}/busy`)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
    await expect(api.request(`${api.origin}/down`, { retries: 2 })).rejects.toMatchObject({
      code: 'http_error',
      status: 502,
    });
    expect(api.calls.filter((c) => c.path === '/down')).toHaveLength(3);
  });

  it("names a refused sign-in, an answer that isn't JSON and a redirect, without retrying", async () => {
    api = await startFakeApi({
      'GET /private': () => ({ status: 401 }),
      'GET /html': () => ({ text: '<html>' }),
      'GET /moved': () => ({ status: 301, headers: { location: 'https://elsewhere.example/' } }),
    });
    await expect(api.request(`${api.origin}/private`)).rejects.toMatchObject({
      code: 'auth',
      status: 401,
    });
    await expect(api.request(`${api.origin}/html`)).rejects.toMatchObject({ code: 'bad_response' });
    await expect(api.request(`${api.origin}/moved`)).rejects.toMatchObject({
      code: 'http_error',
      status: 301,
    });
    expect(api.calls).toHaveLength(3);
  });

  it('stops at its size limit', async () => {
    api = await startFakeApi({ 'GET /big': () => ({ json: { s: 'x'.repeat(5000) } }) });
    await expect(api.request(`${api.origin}/big`, { maxBytes: 1000 })).rejects.toMatchObject({
      code: 'too_large',
    });
  });

  it("tries a call that changes something again only when the API said it didn't take it", async () => {
    let n = 0;
    api = await startFakeApi({
      'POST /orders': () => {
        n += 1;
        return n === 1 ? { status: 429 } : { status: 503 };
      },
    });
    await expect(
      api.request(`${api.origin}/orders`, { method: 'POST', body: {} }),
    ).rejects.toMatchObject({ code: 'http_error', status: 503 });
    // Once after the 429; the 503 may have been taken, so not again.
    expect(api.calls).toHaveLength(2);
  });
});

describe('requestJson on a connection cut part way', () => {
  it('fails a compressed answer cut off, instead of waiting for it forever', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.write(zlib.gzipSync(JSON.stringify({ s: 'x'.repeat(10_000) })).subarray(0, 40));
      setTimeout(() => res.socket.destroy(), 10);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = String(server.address().port);
    const lookup = (hostname, options, callback) =>
      (typeof options === 'function' ? options : callback)(null, [
        { address: '127.0.0.1', family: 4 },
      ]);
    try {
      await expect(
        requestJson(`http://cut.test:${port}/`, {
          lookup,
          ports: [port],
          allowHttp: true,
          retries: 0,
          timeoutMs: 5000,
        }),
      ).rejects.toMatchObject({ code: 'unreachable' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('requestJson on the public-only lookup', () => {
  it('never reaches a private address', async () => {
    for (const address of ['https://127.0.0.1/api', 'https://localhost/api', 'https://[::1]/api']) {
      await expect(requestJson(address, { retries: 0 }), address).rejects.toMatchObject({
        code: 'blocked',
      });
    }
    await expect(requestJson('ftp://shop.example/')).rejects.toMatchObject({ code: 'invalid_url' });
    await expect(requestJson('https://shop.example:8443/')).rejects.toMatchObject({
      code: 'invalid_url',
    });
  });

  it('calls https only: a sign-in never goes in the clear', async () => {
    await expect(requestJson('http://shop.example/api')).rejects.toMatchObject({
      code: 'invalid_url',
      message: "shop.example isn't an https address",
    });
  });
});
