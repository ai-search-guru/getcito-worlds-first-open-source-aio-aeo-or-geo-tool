/**
 * Posting JSON to an address a workspace configured (Send to CMS, #1331).
 * On GetCito Cloud it never reaches anything private, as fetchPage reads a
 * page:
 *   * http(s) only, with no credentials in it; any port, since a workspace's
 *     own automation (n8n, a CMS) often listens on one of its own;
 *   * every address its host resolves to must be public, checked in the
 *     connection's own DNS lookup (no DNS rebinding);
 *   * no redirect is followed: a 3xx is an answer, as any other non-2xx,
 *     handed back with where it points;
 *   * a time limit for the whole request, and only the start of the answer
 *     is read back; an answer cut off after its status is still that status.
 * Self-hosted, a private address is the workspace's own network (n8n at
 * http://n8n:5678), as its other webhooks reach it: only the scheme and
 * credentials are checked. Failures carry PageFetchError's codes:
 * invalid_url, blocked, unreachable, timeout.
 */

import http from 'node:http';
import https from 'node:https';
import { isCloud } from '../config/plans.js';
import { PageFetchError, checkPageUrl, publicOnlyLookup } from './safeFetch.js';

export const POST_TIMEOUT_MS = 15_000;
/** How much of an answer is read back: enough to keep with the delivery. */
export const MAX_ANSWER_BYTES = 8 * 1024;

const USER_AGENT = 'GetCito-Webhook/1.0 (+https://getcito.com)';

/** A 3xx: an answer that sends elsewhere, so the body never arrived (none is followed). */
export const isRedirect = (status) => status >= 300 && status < 400;

/** Where a 3xx points, as a full address (a Location may be relative); null without one. */
function redirectTarget(location, base) {
  if (!location) return null;
  try {
    return new URL(location, base).href;
  } catch {
    return location;
  }
}

/**
 * A webhook address, checked as a page's is but on any port; throws
 * 'invalid_url' or 'blocked'. `privateOk` (self-hosted) takes a private one.
 * The scheme and credentials are checked here in both modes, so the test
 * says them in a webhook's words, not a page's.
 */
export function checkWebhookUrl(value, { privateOk = false } = {}) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new PageFetchError('invalid_url', 'Not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PageFetchError('invalid_url', 'Only http and https addresses can be posted to');
  }
  if (url.username || url.password) {
    throw new PageFetchError('invalid_url', 'URLs with credentials are not posted to');
  }
  if (privateOk) return url;
  // On Cloud, an address written as an IP must be a public one.
  return checkPageUrl(value, [url.port]);
}

/**
 * POSTs `body` (a string, already JSON) to the address.
 * @param {string} address
 * @param {string} body
 * @param {{ headers?: Record<string, string>, timeoutMs?: number, lookup?: Function }} [opts]
 *   `lookup` replaces the public-only lookup; tests use it to reach a local server.
 * @returns {Promise<{ status: number, answer: string, location?: string }>} the HTTP status
 *   and the start of the answer; for a 3xx, where it points, when it says
 */
export async function postJson(address, body, opts = {}) {
  const cloud = isCloud();
  const url = checkWebhookUrl(address, { privateOk: !cloud });
  const { headers = {}, timeoutMs = POST_TIMEOUT_MS } = opts;
  // The test's lookup, else the public-only one on Cloud, else the system's.
  const lookup = opts.lookup ?? (cloud ? publicOnlyLookup : undefined);
  const signal = AbortSignal.timeout(timeoutMs);
  return new Promise((resolve, reject) => {
    // Set once the status arrives: the answer's end, with what was read.
    let answered = null;
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'POST',
        agent: false,
        lookup,
        signal,
        headers: {
          'user-agent': USER_AGENT,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = isRedirect(status) ? redirectTarget(res.headers.location, url) : null;
        const chunks = [];
        let size = 0;
        // May run more than once (a cut answer, then its error): the first wins.
        const done = () =>
          resolve({
            status,
            answer: Buffer.concat(chunks).toString('utf8'),
            ...(location ? { location } : {}),
          });
        res.on('data', (chunk) => {
          if (size >= MAX_ANSWER_BYTES) return;
          chunks.push(chunk.subarray(0, MAX_ANSWER_BYTES - size));
          size += chunk.length;
          // The rest of a long answer isn't read.
          if (size >= MAX_ANSWER_BYTES) {
            res.destroy();
            done();
          }
        });
        res.on('end', done);
        // The status has arrived: an answer cut off after it is still that
        // answer, with what was read of it.
        res.on('error', done);
        answered = done;
      },
    );
    req.on('error', (err) => {
      // The time limit, or the connection dropping, after the status
      // arrived: the request hears of it first, and the answer still holds.
      if (answered) return answered();
      if (err instanceof PageFetchError) return reject(err);
      if (signal.aborted) {
        return reject(new PageFetchError('timeout', 'The webhook took too long to answer'));
      }
      reject(
        new PageFetchError('unreachable', 'The webhook could not be reached', { errno: err?.code }),
      );
    });
    req.end(body);
  });
}
