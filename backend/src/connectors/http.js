import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream';
import zlib from 'node:zlib';
import { PageFetchError, checkPageUrl, publicOnlyLookup } from '../lib/safeFetch.js';

/**
 * The HTTP client a store connector calls its platform's API with (#1263).
 *
 * A store's address is often the brand's own (a WooCommerce site), so it is
 * reached like any address a person gives (lib/safeFetch.js): on the
 * standard ports, every resolved address public, checked in the
 * connection's own lookup. Only https: the sign-in never crosses the network
 * in the clear. Redirects aren't followed: an API that redirects would carry
 * the sign-in to another host.
 *
 * It waits and tries again on 429, and, for a call that changes nothing
 * (GET, HEAD, PUT, DELETE), on 502, 503 and 504 and on a dropped connection:
 * as long as the API's Retry-After says, else 1, 2, 4 seconds (with a little
 * jitter), RETRIES times. A wait longer than MAX_WAIT_MS ends the call
 * ('rate_limited'), and the daily run tries the source again later.
 *
 * Errors name the method, host and path only: never the query (some APIs
 * take a key there), the headers or the body.
 */

export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_BODY_BYTES = 20 * 1024 * 1024;
export const RETRIES = 3;
export const MAX_WAIT_MS = 60_000;

const USER_AGENT = 'GetCitoCatalog/1.0 (+https://getcito.com)';
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const RETRY_ERRNOS = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN']);

export class ConnectorHttpError extends Error {
  /**
   * @param {'invalid_url'|'blocked'|'unreachable'|'timeout'|'too_large'|'http_error'|'auth'|'rate_limited'|'bad_response'|'not_set_up'} code
   *   'auth': the API refused the sign-in (401, 403);
   *   'not_set_up': this server's own setup was refused, not the sign-in
   *   (lib/catalog/signIn.js only)
   * @param {string} message
   * @param {{ status?: number }} [extra]
   */
  constructor(code, message, { status } = {}) {
    super(message);
    this.name = 'ConnectorHttpError';
    this.code = code;
    this.status = status;
  }
}

/** How long a response asks to wait, from its Retry-After (seconds or a date), or null. */
export function retryAfterMs(headers, now = Date.now()) {
  const value = headers?.['retry-after'];
  if (value == null || value === '') return null;
  if (/^\s*\d+(\.\d+)?\s*$/.test(value)) return Math.round(Number(value) * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** The `rel="next"` address of a Link header (RFC 8288), as many APIs page with, or null. */
export function nextLink(headers) {
  const value = headers?.link;
  if (!value) return null;
  for (const part of String(value).split(/,(?=\s*<)/)) {
    const match = /^\s*<([^>]*)>(.*)$/.exec(part);
    if (!match) continue;
    for (const param of match[2].split(';')) {
      const [name, raw = ''] = param.split('=');
      if (name.trim().toLowerCase() !== 'rel') continue;
      const rels = raw.trim().replace(/^"|"$/g, '').toLowerCase().split(/\s+/);
      if (rels.includes('next')) return match[1];
    }
  }
  return null;
}

const where = (method, url) => `${method} ${url.host}${url.pathname}`;

function once(url, { method, headers, body, lookup, signal, maxBytes }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method,
        agent: false,
        lookup,
        signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate, br',
          ...(body != null ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
      },
      (res) => {
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
        let decoder = null;
        if (encoding === 'gzip' || encoding === 'x-gzip') decoder = zlib.createGunzip();
        else if (encoding === 'deflate') decoder = zlib.createInflate();
        else if (encoding === 'br') decoder = zlib.createBrotliDecompress();
        // pipeline, not pipe: an answer cut off part way fails the call
        // instead of leaving its decoder waiting for an end that never comes.
        if (decoder) pipeline(res, decoder, (err) => err && reject(err));
        const stream = decoder ?? res;
        res.on('close', () => {
          if (!res.complete) {
            reject(new ConnectorHttpError('unreachable', `${where(method, url)} stopped part way`));
          }
        });
        const chunks = [];
        let size = 0;
        stream.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new ConnectorHttpError('too_large', `${where(method, url)} answered too much`));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        stream.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

/**
 * Calls a JSON API (see above).
 *
 * @param {string} address
 * @param {{ method?: string, headers?: Record<string, string>, query?: Record<string, string|number>, body?: unknown, timeoutMs?: number, maxBytes?: number, retries?: number, maxWaitMs?: number, lookup?: Function, ports?: string[], allowHttp?: boolean, sleep?: (ms: number) => Promise<void>, signal?: AbortSignal }} [opts]
 *   `body` is sent as JSON. Only https is called: a sign-in never crosses
 *   the network in the clear. `lookup`, `ports` and `allowHttp` replace the
 *   public-only lookup, the web ports and https, and `sleep` the waits;
 *   tests use them.
 * @returns {Promise<{ status: number, headers: object, data: unknown }>} data: the parsed body, or null when empty
 */
export async function requestJson(address, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    query,
    body,
    timeoutMs = REQUEST_TIMEOUT_MS,
    maxBytes = MAX_BODY_BYTES,
    retries = RETRIES,
    maxWaitMs = MAX_WAIT_MS,
    lookup = publicOnlyLookup,
    ports,
    allowHttp = false,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    signal: outer = null,
  } = opts;
  let url;
  try {
    url = checkPageUrl(address, ports);
  } catch (err) {
    throw new ConnectorHttpError(err.code ?? 'invalid_url', err.message);
  }
  if (url.protocol !== 'https:' && !allowHttp) {
    throw new ConnectorHttpError('invalid_url', `${url.host} isn't an https address`);
  }
  // A call that changes something is tried again only when the API said it
  // didn't take it (429): after a 5xx or a dropped connection it may have.
  const idempotent = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method.toUpperCase());
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value != null) url.searchParams.set(name, String(value));
  }
  const payload = body == null ? null : JSON.stringify(body);

  for (let attempt = 0; ; attempt += 1) {
    const signal = outer
      ? AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    let res;
    let wait = null;
    try {
      res = await once(url, { method, headers, body: payload, lookup, signal, maxBytes });
    } catch (err) {
      if (err instanceof ConnectorHttpError) throw err;
      if (err instanceof PageFetchError || err?.cause instanceof PageFetchError) {
        throw new ConnectorHttpError('blocked', `${url.host} is not a public address`);
      }
      if (outer?.aborted)
        throw new ConnectorHttpError('timeout', `${where(method, url)} was stopped`);
      const retriable = idempotent && (signal.aborted || RETRY_ERRNOS.has(err?.code));
      if (!retriable || attempt >= retries) {
        throw signal.aborted
          ? new ConnectorHttpError('timeout', `${where(method, url)} took too long to answer`)
          : new ConnectorHttpError(
              'unreachable',
              `${where(method, url)} couldn't be reached (${err?.code ?? 'network error'})`,
            );
      }
      wait = 1000 * 2 ** attempt;
    }

    if (res) {
      const { status } = res;
      if (status >= 200 && status < 300) {
        if (!res.text.trim()) return { status, headers: res.headers, data: null };
        try {
          return { status, headers: res.headers, data: JSON.parse(res.text) };
        } catch {
          throw new ConnectorHttpError('bad_response', `${where(method, url)} didn't answer JSON`, {
            status,
          });
        }
      }
      if (status === 401 || status === 403) {
        throw new ConnectorHttpError(
          'auth',
          `${where(method, url)} refused the sign-in (${status})`,
          {
            status,
          },
        );
      }
      const retriable = RETRY_STATUSES.has(status) && (idempotent || status === 429);
      if (!retriable || attempt >= retries) {
        throw new ConnectorHttpError(
          status === 429 ? 'rate_limited' : 'http_error',
          `${where(method, url)} answered ${status}`,
          { status },
        );
      }
      wait = retryAfterMs(res.headers) ?? 1000 * 2 ** attempt;
      if (wait > maxWaitMs) {
        throw new ConnectorHttpError(
          'rate_limited',
          `${where(method, url)} asked to wait ${Math.ceil(wait / 1000)} s`,
          { status },
        );
      }
    }
    await sleep(wait + Math.floor(Math.random() * 250));
  }
}
