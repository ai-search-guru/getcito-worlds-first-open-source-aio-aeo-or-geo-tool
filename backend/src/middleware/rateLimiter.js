import { createHash } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { webhookSecretsMatch } from '../lib/webhookSecret.js';
import { verifiedActingUserId, verifiedBotConnection, verifiedUserId } from './verifiedTokens.js';

/**
 * Anonymous bucket key. IPv4 (including v4-mapped IPv6) keys on the exact
 * address; plain IPv6 collapses to the /64 prefix so one caller can't dodge
 * the limit by rotating through their subnet's practically unlimited
 * addresses.
 */
export function anonymousIpKey(ip) {
  if (!ip) return 'ip:unknown';
  if (!ip.includes(':') || ip.includes('.')) return 'ip:' + ip;
  const [head, tail = ''] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const zeros = Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0');
  const prefix = [...headGroups, ...zeros, ...tailGroups].slice(0, 4).join(':');
  return 'ip:' + prefix + '::/64';
}

/**
 * Key dashboard traffic by VERIFIED user, falling back to IP. The web app's
 * server actions all egress through Vercel's small shared IP pool, so a purely
 * IP-keyed limiter lumps every user's server-side traffic (volume analyses,
 * tracking-status polls, page loads…) into a handful of buckets and 429s
 * legitimate users while browser-direct calls sail through.
 *
 * The per-user bucket is granted only to tokens decodeToken has already
 * verified (see verifiedTokens.js): merely ATTACHING an Authorization header
 * earns nothing, so an attacker spamming forged tokens stays pinned to their
 * IP bucket. A legit token's first-ever request counts against the IP bucket
 * too (it isn't verified yet) — one request per token per half hour, noise.
 * Rotating IPs to evade the anonymous limit remains an infra-level concern
 * (WAF/CDN), same as before this limiter existed.
 *
 * An internal request acting as a member (actingUser.js) counts in that
 * member's bucket, once the member has been checked: the web's triggered
 * Chat runs share the limits of the person they run for.
 */
export function apiLimiterKey(req) {
  const userId = verifiedCaller(req);
  if (userId) return 'user:' + userId;
  return anonymousIpKey(req.ip);
}

/** The verified person a request comes from, by their token or the member it acts for. */
function verifiedCaller(req) {
  const { authorization } = req.headers;
  return (
    verifiedActingUserId(authorization, req.headers['x-acting-user']) ??
    verifiedUserId(authorization)
  );
}

/**
 * The web's Chat engine's budget calls and page reads, and its model menu
 * (routes/internalChatBudget.js, internalChatPages.js, internalChatModels.js).
 */
const CHAT_BUDGET_PATH = /^\/api\/internal\/chat\/(budget|pages|models)(\/|$)/;

/**
 * Whether a request is the web's Chat engine holding or settling a model
 * step on the AI budget, with the internal secret (CRON_SECRET, compared in
 * constant time). Every Chat step makes two of them, and on Vercel the web's
 * calls come from a few shared addresses, so the API's per-IP bucket would
 * stop Chat for every workspace at once. Only this path, and only with the
 * secret: any other request, or this path without it, is counted as before.
 */
export function isInternalChatBudgetCall(req) {
  if (!CHAT_BUDGET_PATH.test(`${req.baseUrl ?? ''}${req.path ?? ''}`)) return false;
  const auth = req.headers?.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return false;
  return webhookSecretsMatch(process.env.CRON_SECRET, auth.slice('Bearer '.length));
}

// General API rate limit, per verified user (per IP otherwise). The Chat
// engine's budget calls, with the internal secret, aren't counted.
export const apiLimiter = rateLimit({
  skip: isInternalChatBudgetCall,
  windowMs: 15 * 60 * 1000,
  // A verified user's bucket only needs to absorb their own burst (several
  // tabs polling tracking status every 15s plus normal navigation).
  // Unverified traffic keeps the tighter IP limit.
  max: (req) => (verifiedCaller(req) ? 1000 : 250),
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// A draft's link check (Content Editor Trust): the editor asks after its
// links change, a few times a minute at most. Each ask can read links on
// other sites, so it has its own bucket besides the API's.
export const linkCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// The Content Editor's Quality checks read by AI (CE-046 part b on): the
// editor asks a few seconds after a save. Each ask can cost model calls
// (a call a site, MAX_SOURCE_SITES at most), so it has its own bucket,
// smaller than the link check's.
export const qualityCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Quality's claims (CE-045): the editor asks after saves, as it does for
// the sources' kinds, but from a bucket of its own, so neither starves the other.
export const claimsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Check now (AC-010): a task's page fetched again on a click, from a bucket
// of its own, so it doesn't use up the editor's page reads (an AI-cost route).
export const taskCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Quality's page read (CE-049): the editor asks after saves, a minute apart
// at most, from a bucket of its own.
export const pageReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// A brand's facts read from its site again when asked (Quality CE-047): a
// few model calls, so its own bucket.
// Catalog syncs and uploads (#1263): each reads a feed or a file of up to
// 50 MB / 4 MB, so a member's are few.
export const catalogLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// A catalog category's page set by hand, or put back to its match (shopping
// path, 00350): a person goes down the table a row at a time, so a bucket
// of its own, wider than the syncs'. Reading the table takes the API's.
export const catalogCategoryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// A draft's shopping path built from the brand's catalog (shopping path,
// 00351): each build reads up to 2,000 products and their details, and the
// Brief tab asks on a person's click (Pick again, Swap, Add), so a bucket of
// its own.
export const shoppingPathLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// A draft's Site Audit estimate (customer priorities item 9): the editor
// reads it again each time typing pauses, and each reading parses the whole
// page and runs the audit's checks on it, so a bucket of its own.
export const auditEstimateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// A brand's CMS connection (Send to CMS, #1331): each call reaches Webflow
// through Composio, so a member's are few.
export const cmsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// The Library's checks whether pages sent to a CMS were published there:
// four each time it opens, answered from a two-minute memory per brand. A
// bucket of their own, so opening the Library never uses up a member's
// cmsLimiter, and connecting a CMS stays open to them.
export const cmsStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 180,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Test Webhook (#1568 review): each test posts to an address the caller
// typed, so a member's are few, 10 a minute.
export const webhookTestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// AI Traffic's Check again: one read of the brand's home page each.
export const snippetCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

export const brandFactsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Stricter limit for public/unauthenticated endpoints: 30 requests per 15 minutes
export const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Traffic tracking beacon: 60 requests per minute per IP
export const trafficLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: '',
  handler: (_req, res) => res.status(204).end(),
});

/** Whether a beacon is a journey's pageview or conversion (CE-017), as the route reads its body. */
export function isJourneyBeacon(body) {
  let read = body;
  if (typeof read === 'string') {
    try {
      read = JSON.parse(read);
    } catch {
      return false;
    }
  }
  return read?.k === 'pv' || read?.k === 'cv';
}

/** A journey event's bucket: its tracking code, whatever address sends it. */
export function journeyEventKey(req) {
  return 'journey:' + req.params.trackingCode;
}

// A brand's journey events (CE-017): 3,000 a minute per tracking code, beside
// the 60 per address, so a sender cycling addresses can't fill the table. A
// big shop's AI visitors send a few pageviews each, far below it. Visits
// aren't counted here; past it, the events are dropped as the address
// limiter drops beacons.
export const journeyEventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3000,
  keyGenerator: journeyEventKey,
  skip: (req) => !isJourneyBeacon(req.body),
  standardHeaders: false,
  legacyHeaders: false,
  message: '',
  handler: (_req, res) => res.status(204).end(),
});

/**
 * AI-bot ingest key (AT-010): the connection, since a Cloudflare Worker's
 * requests leave from addresses Cloudflare shares across its customers. Only
 * a secret the route has already matched to a live connection
 * (verifiedTokens.js) earns that bucket: an unknown one, or none, counts
 * against the caller's IP, so a flood of made-up secrets can't take a fresh
 * bucket, and a lookup, per request.
 */
export function botIngestKey(req) {
  const connectionId = verifiedBotConnection(req.headers.authorization);
  if (connectionId) return 'bot:' + connectionId;
  return anonymousIpKey(req.ip);
}

/**
 * Group public workflow callbacks by a hash of the supplied webhook secret,
 * not the provider's shared egress IP. Missing secrets fall back to IP; a
 * separate failed-auth limiter below keeps brute-force attempts constrained.
 */
export function webhookCallbackKey(req) {
  const header = req.get?.('X-Webhook-Secret') ?? req.headers?.['x-webhook-secret'];
  const secret = typeof header === 'string' ? header : '';
  if (!secret) return anonymousIpKey(req.ip);
  return 'webhook:' + createHash('sha256').update(secret).digest('hex');
}

// Workflow providers share egress IP pools and may fan out multiple callbacks
// per opportunity. Give each configured webhook its own generous 15-minute
// budget, independent of all other customers using the same provider IP.
export const webhookCallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  keyGenerator: webhookCallbackKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// Only failed authentication attempts (401) consume this small per-IP bucket.
// Valid callbacks and unrelated 4xx/5xx responses are removed from the counter
// after the response finishes.
export const webhookCallbackAuthFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => anonymousIpKey(req.ip),
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_failed_webhook_auth_attempts' },
});

// AI-bot ingest: 600 requests a minute per connection. A Worker isolate
// sends a batch about every 10 s, and a Logpush job or drain a file at a
// time, so this leaves room for many of them while stopping a runaway sender.
export const botIngestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  keyGenerator: botIngestKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// Auth endpoints: 10 requests per 15 minutes
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
  },
});
