/**
 * The Cloudflare Worker a brand installs to send AI-bot requests (AT-010,
 * spec §6.1 option A, "lowest cost for us"). It passes every request through
 * untouched, and only for requests whose user agent names a bot on the list
 * sends {userAgent, ip, url, status, at, country} to GetCito in batches of
 * about 100, after the response, without slowing the page.
 *
 * The bot tokens come from ai-bots.json, so the edge filter and the server's
 * check use the same list; the server still verifies every IP.
 *
 * The connection secret isn't in the code: the person adds it to the Worker
 * as a Secret named WORKER_SECRET_NAME, so it doesn't sit in the source a
 * teammate copies, a version keeps or a screenshot shows (#1179's review).
 * Without it the Worker reports nothing and the site is unaffected. Workers
 * set up before, with the secret in their code, keep working.
 */

import { AI_BOTS } from './aiBots.js';

/** Requests a Worker isolate holds before it sends them. */
export const WORKER_BATCH = 100;

/** The Worker Secret (Settings › Variables and Secrets) the script reads the connection secret from. */
export const WORKER_SECRET_NAME = 'GETCITO_BOT_SECRET';

export function buildWorkerScript({ endpoint }) {
  const tokens = JSON.stringify(AI_BOTS.map((b) => b.userAgent.toLowerCase()));
  return `// GetCito AI bot report — Cloudflare Worker (AT-010).
// Passes every request through; for AI bots only, sends the request line to
// GetCito after the response. Route it on your site's hostname, and add the
// connection secret under Settings › Variables and Secrets as a Secret named
// ${WORKER_SECRET_NAME}.
const ENDPOINT = ${JSON.stringify(endpoint)};
const BOTS = ${tokens};
const BATCH = ${WORKER_BATCH};
let queue = [];

function pageUrl(url) {
  const u = new URL(url);
  return u.origin + u.pathname;
}

function isAiBot(ua) {
  const s = (ua || '').toLowerCase();
  return BOTS.some((t) => s.includes(t));
}

async function flush(secret) {
  if (queue.length === 0) return;
  const requests = queue;
  queue = [];
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
      body: JSON.stringify({ requests }),
    });
  } catch (err) {
    // Never let reporting affect the site.
  }
}

export default {
  async fetch(request, env, ctx) {
    // Should this script fail, the request still reaches the site.
    ctx.passThroughOnException();
    const response = await fetch(request);
    const secret = env && env.${WORKER_SECRET_NAME};
    const ua = request.headers.get('user-agent');
    // No secret added yet: nothing is reported, and the site is unaffected.
    if (secret && isAiBot(ua)) {
      queue.push({
        userAgent: ua,
        ip: request.headers.get('cf-connecting-ip'),
        // The page, without its query string.
        url: pageUrl(request.url),
        status: response.status,
        at: new Date().toISOString(),
        country: request.cf && request.cf.country,
      });
      if (queue.length >= BATCH) ctx.waitUntil(flush(secret));
      else ctx.waitUntil(new Promise((r) => setTimeout(r, 10000)).then(() => flush(secret)));
    }
    return response;
  },
};
`;
}
