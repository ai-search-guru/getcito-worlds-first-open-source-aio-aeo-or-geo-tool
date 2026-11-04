/**
 * Fetching a web page a person names (Content Editor CE-003: optimize a page
 * by its URL) without letting the address reach anything private.
 *
 * The address is a user's, so it is checked like one:
 *   * http(s) only, on the standard ports, with no credentials in it;
 *   * every address its host resolves to must be public. The check runs in
 *     the connection's own DNS lookup, so the address connected to is the
 *     address checked: a name can't resolve to a public address for a check
 *     and a private one for the request (DNS rebinding);
 *   * redirects are followed by hand, at most MAX_REDIRECTS, each one checked
 *     the same way;
 *   * the whole fetch has a time limit, and the body a size limit;
 *   * a web page nested deeper than any browser keeps isn't handed on to be
 *     parsed (htmlDepth.js).
 *
 * Only HTML comes back, decoded as text. Failures carry a code the caller
 * can name to the person (PageFetchError.code).
 */

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { pipeline } from 'node:stream';
import { TextDecoder } from 'node:util';
import zlib from 'node:zlib';

import { nestsTooDeep } from './htmlDepth.js';

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_PAGE_BYTES = 3 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

/** The content types a web page comes as, and what a request asks for. */
const HTML_TYPES = /^\s*(text\/html|application\/xhtml\+xml)\b/i;
const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1';

const USER_AGENT = 'Mozilla/5.0 (compatible; GetCitoBot/1.0; +https://getcito.com)';

export class PageFetchError extends Error {
  /**
   * @param {'invalid_url'|'blocked'|'not_allowed'|'unreachable'|'timeout'|'too_large'|'too_deep'|'not_html'|'http_error'|'too_many_redirects'} code
   * @param {string} message
   * @param {{ status?: number, errno?: string }} [extra] errno: the network error's code
   *   (ENOTFOUND, ECONNREFUSED, a TLS one…) when the page couldn't be reached
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.status = extra.status;
    this.errno = extra.errno;
  }
}

// Private, local, shared, documentation and reserved ranges (RFC 6890 and
// friends), and the IPv6 forms that carry an IPv4 address inside. An
// IPv4-mapped address (::ffff:a.b.c.d) is checked against the IPv4 ranges by
// BlockList itself; a rule for ::ffff:0:0/96 would match every IPv4 address.
const BLOCKED = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  BLOCKED.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  // IPv4-compatible (::a.b.c.d) and IPv4-translated (::ffff:0:a.b.c.d) forms.
  ['::', 96],
  ['::ffff:0:0:0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  BLOCKED.addSubnet(address, prefix, 'ipv6');
}

/** Whether an IP address is one a public web page may live at. */
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return false;
  return !BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * A DNS lookup that refuses names resolving to any address that isn't
 * public, in the signature http.request's `lookup` option takes.
 */
export function publicOnlyLookup(hostname, options, callback) {
  const opts = typeof options === 'function' ? {} : options;
  const done = typeof options === 'function' ? options : callback;
  dns.lookup(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
    if (err) return done(err);
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return done(
        new PageFetchError('blocked', `${hostname} does not resolve to a public address`),
      );
    }
    if (opts.all) return done(null, addresses);
    return done(null, addresses[0].address, addresses[0].family);
  });
}

/** The standard web ports ('' is the scheme's default). */
const WEB_PORTS = ['', '80', '443'];

/** A URL a person gave, checked before anything is fetched; throws 'invalid_url'. */
export function checkPageUrl(value, ports = WEB_PORTS) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new PageFetchError('invalid_url', 'Not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PageFetchError('invalid_url', 'Only http and https pages can be read');
  }
  if (url.username || url.password) {
    throw new PageFetchError('invalid_url', 'URLs with credentials are not read');
  }
  if (!ports.includes(url.port)) {
    throw new PageFetchError('invalid_url', 'Only the standard web ports are read');
  }
  // An address written as an IP connects without a DNS lookup, so the
  // lookup's check never sees it: it is checked here. The URL parser has
  // already turned 2130706433 or 0x7f.1 into 127.0.0.1.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) {
    throw new PageFetchError('blocked', `${host} is not a public address`);
  }
  url.hash = '';
  return url;
}

function charsetOf(contentType) {
  const match = /charset=["']?([\w-]+)/i.exec(contentType ?? '');
  return match ? match[1].toLowerCase() : 'utf-8';
}

function decode(buffer, contentType) {
  try {
    return new TextDecoder(charsetOf(contentType)).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/**
 * One request, no redirects followed: the response, or where it redirects to.
 * A body over `maxBytes` is refused, or with `truncate` cut off there.
 */
function requestOnce(url, { signal, lookup, maxBytes, truncate, types, accept }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        agent: false,
        lookup,
        signal,
        headers: {
          'user-agent': USER_AGENT,
          accept,
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // What isn't read is dropped, not drained: a large file stops here.
        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy();
          resolve({ redirect: res.headers.location, status });
          return;
        }
        if (status < 200 || status >= 300) {
          res.destroy();
          reject(new PageFetchError('http_error', `The page answered ${status}`, { status }));
          return;
        }
        const contentType = res.headers['content-type'] ?? '';
        if (!types.test(contentType)) {
          res.destroy();
          // The words are ours: a content type is the page's to write.
          reject(new PageFetchError('not_html', 'The address is not a web page'));
          return;
        }
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
        let decoder = null;
        if (encoding === 'gzip' || encoding === 'x-gzip') decoder = zlib.createGunzip();
        else if (encoding === 'deflate') decoder = zlib.createInflate();
        else if (encoding === 'br') decoder = zlib.createBrotliDecompress();
        // pipeline, not pipe: a page cut off part way fails the read instead
        // of leaving its decoder waiting for an end that never comes, past
        // the timeout (the request is over by then).
        if (decoder) pipeline(res, decoder, (err) => err && reject(err));
        const body = decoder ?? res;
        res.on('close', () => {
          if (!res.complete) {
            reject(new PageFetchError('unreachable', 'The page stopped part way through'));
          }
        });

        const chunks = [];
        let size = 0;
        let full = false;
        body.on('data', (chunk) => {
          if (full) return;
          size += chunk.length;
          if (size > maxBytes) {
            full = true;
            req.destroy();
            if (truncate) {
              // The start of the page, up to the cap: the rest is never read.
              chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
              resolve({ status, contentType, body: decode(Buffer.concat(chunks), contentType) });
              return;
            }
            reject(new PageFetchError('too_large', 'The page is too large to read'));
            return;
          }
          chunks.push(chunk);
        });
        body.on('end', () =>
          resolve({ status, contentType, body: decode(Buffer.concat(chunks), contentType) }),
        );
        body.on('error', (err) => reject(err));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * A web page's HTML, fetched safely (see above).
 *
 * @param {string} address
 * @param {{ timeoutMs?: number, maxBytes?: number, truncate?: boolean, maxRedirects?: number, lookup?: Function, ports?: string[], signal?: AbortSignal, types?: RegExp, accept?: string, allowUrl?: (url: URL) => boolean }} [opts]
 *   `signal` ends the read early too (a run's Stop), as its timeout does.
 *   `truncate` reads a page over `maxBytes` up to it, instead of refusing it
 *   ('too_large'), for a caller that needs only its start.
 *   `lookup` and `ports` replace the public-only lookup and the web ports;
 *   tests use them to reach a local server.
 *   `types` and `accept` read something other than a web page (a product
 *   feed): the content types taken, else 'not_html', and the Accept header.
 *   `allowUrl` is a caller's own check of each address, the first and each
 *   redirect's, after safe-fetch's: false refuses it ('not_allowed'). Chat
 *   keeps a page's redirects on the sites a run may open with it.
 * @returns {Promise<{ url: string, status: number, html: string }>} url is the address after redirects
 */
export async function fetchPage(address, opts = {}) {
  const {
    timeoutMs = FETCH_TIMEOUT_MS,
    maxBytes = MAX_PAGE_BYTES,
    truncate = false,
    types = HTML_TYPES,
    accept = HTML_ACCEPT,
    maxRedirects = MAX_REDIRECTS,
    lookup = publicOnlyLookup,
    ports = WEB_PORTS,
    signal: outer = null,
    allowUrl = null,
  } = opts;
  const signal = outer
    ? AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const allowed = (next) => {
    if (allowUrl && !allowUrl(next)) {
      throw new PageFetchError('not_allowed', 'The address is not one this read may open');
    }
    return next;
  };
  let url = allowed(checkPageUrl(address, ports));
  for (let hops = 0; ; hops += 1) {
    let res;
    try {
      res = await requestOnce(url, { signal, lookup, maxBytes, truncate, types, accept });
    } catch (err) {
      if (err instanceof PageFetchError) throw err;
      if (signal.aborted) throw new PageFetchError('timeout', 'The page took too long to answer');
      if (err?.cause instanceof PageFetchError) throw err.cause;
      throw new PageFetchError(
        'unreachable',
        `The page could not be reached (${err?.code ?? err?.message})`,
        { errno: err?.code },
      );
    }
    if (!res.redirect) {
      if (types === HTML_TYPES && nestsTooDeep(res.body)) {
        throw new PageFetchError('too_deep', 'The page nests its elements too deeply to read');
      }
      return { url: url.toString(), status: res.status, html: res.body };
    }
    if (hops >= maxRedirects) {
      throw new PageFetchError('too_many_redirects', 'The page redirects too many times');
    }
    url = allowed(checkPageUrl(new URL(res.redirect, url).toString(), ports));
  }
}
