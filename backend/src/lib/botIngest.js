/**
 * AI-bot requests sent from a brand's own Cloudflare or Vercel (AT-010, spec
 * §6). Each connection has its own secret: the sender presents it, only its
 * SHA-256 is stored, and the person sees it once when it is made.
 *
 * A batch is verified request by request (a page on one of the brand's
 * domains, user agent on the list, IP in the operator's published ranges,
 * aiBots.js), then written in one step that
 * holds the organization's monthly cap (00183 ai_bot_ingest): rows while
 * there is room, bot × page × day counters always. A log sender's file is
 * claimed, counted against the raw cap and written in that same transaction
 * (00189 ai_bot_ingest_file). No IP is kept. Crossing 80% of the cap raises
 * the internal alert once a month (§6.3 guardrails).
 */

import { createHash, randomBytes } from 'crypto';
import supabaseAdmin from '../config/supabase.js';
import { verifyBotRequest } from './aiBots.js';
import { onBrandDomain } from './audit/host.js';
import { getBotEventCap, getBotRawCap } from './planGuard.js';
import { logger } from './logger.js';

/** The most requests one Worker batch may carry (a Worker sends about 100). */
export const MAX_BATCH = 500;

/** Requests older than this are dropped: a sender catching up after a week isn't the site's reading now. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const CONNECTION_KINDS = ['cloudflare_worker', 'cloudflare_logpush', 'vercel_drain'];

const SECRET_PREFIX = 'getcito_bot_';

/** A new connection secret: 32 random bytes, shown once. */
export function newConnectionSecret() {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Where a connection sends its events: the API's public address
 * (PUBLIC_SERVER_URL), never the Host a request came in on. The create call
 * comes from the web server, which may reach the API at an internal address,
 * and the endpoint is written into the customer's Worker, Logpush job or
 * drain, where it is hard to change later. https only, but for localhost
 * outside production. Null when it isn't set or can't be used.
 */
export function publicIngestEndpoint(env = process.env) {
  let url;
  try {
    url = new URL(env.PUBLIC_SERVER_URL ?? '');
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowed =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && local && env.NODE_ENV !== 'production');
  return allowed ? `${url.origin}/bots/ingest` : null;
}

/**
 * The live connection a secret belongs to, with its brand's organization and
 * domains (read in the same query); null otherwise.
 */
export async function connectionForSecret(secret) {
  if (typeof secret !== 'string' || !secret.startsWith(SECRET_PREFIX) || secret.length > 200) {
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from('ai_bot_connections')
    .select('id, brand_id, kind, revoked_at, brands!inner(organization_id, brand_domains(domain))')
    .eq('secret_hash', hashSecret(secret))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.revoked_at) return null;
  return {
    id: data.id,
    brandId: data.brand_id,
    kind: data.kind,
    organizationId: data.brands?.organization_id ?? null,
    domains: (data.brands?.brand_domains ?? []).map((d) => d.domain).filter(Boolean),
  };
}

/**
 * Whether a request's page is the brand's site: its host is one of the
 * brand's domains or a subdomain of one. A Logpush zone with several
 * hostnames, or a Vercel drain set for a whole team, also sends other sites'
 * requests, which would fill the report and the event cap. A bare path (a
 * Worker on the brand's own route may send one) passes, and so does every
 * page of a brand with no domain stored, which would otherwise read nothing.
 */
export function onBrandSite(url, domains) {
  if (!domains?.length || !/^https?:\/\//i.test(url)) return true;
  return onBrandDomain(url, domains);
}

/** One request as a sender reports it: user agent, IP, URL, status, time, country. */
function readRequest(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const userAgent = raw.userAgent ?? raw.ua;
  const url = raw.url ?? raw.path;
  if (typeof userAgent !== 'string' || typeof raw.ip !== 'string' || typeof url !== 'string') {
    return null;
  }
  const at = new Date(raw.at ?? raw.ts ?? now);
  const ms = at.getTime();
  if (Number.isNaN(ms) || ms > now + 60 * 60 * 1000 || ms < now - MAX_AGE_MS) return null;
  const status = Number(raw.status);
  return {
    userAgent: userAgent.slice(0, 512),
    ip: raw.ip,
    url: url.slice(0, 2048),
    status: Number.isInteger(status) && status >= 100 && status < 600 ? status : null,
    country: typeof raw.country === 'string' ? raw.country.slice(0, 2).toUpperCase() : null,
    at: at.toISOString(),
  };
}

/** The bots among a sender's requests, as events to write, and why the rest were skipped. */
async function verifyRequests(list, domains, deps) {
  const now = deps.now ?? Date.now();
  const skipped = { invalid: 0, other_host: 0, unknown_agent: 0, unverified_ip: 0, no_ranges: 0 };
  const events = [];
  for (const raw of list) {
    const request = readRequest(raw, now);
    if (!request) {
      skipped.invalid++;
      continue;
    }
    // Before the ranges are read: another site's request isn't verified.
    if (!onBrandSite(request.url, domains)) {
      skipped.other_host++;
      continue;
    }
    const verdict = await verifyBotRequest(request, deps);
    if (!verdict.bot) {
      skipped[verdict.reason]++;
      continue;
    }
    events.push({
      bot: verdict.bot.key,
      bot_type: verdict.bot.type,
      page: request.url,
      status: request.status,
      country: request.country,
      at: request.at,
    });
  }
  return { events, skipped };
}

/** The internal alert, once a month, when a write takes the month past 80% of the cap. */
function alertAt80(connection, data, cap) {
  if (!data?.crossed80) return;
  logger.warn(
    {
      organizationId: connection.organizationId,
      brandId: connection.brandId,
      used: data.used,
      cap,
    },
    '[ai-bots] 80% of the monthly bot event cap reached',
  );
}

/**
 * Verify and store one Worker batch (at most MAX_BATCH requests) for a
 * connection. Returns what was received, verified and stored, and why the
 * rest wasn't counted.
 */
export async function ingestBotRequests(connection, requests, deps = {}) {
  const list = Array.isArray(requests) ? requests.slice(0, MAX_BATCH) : [];
  const { events, skipped } = await verifyRequests(list, connection.domains, deps);

  let stored = 0;
  if (events.length > 0) {
    const cap = await getBotEventCap(connection.organizationId);
    // A plan without the report (Starter) stores nothing, not even counters.
    if (cap === 0)
      return { received: list.length, verified: events.length, stored, skipped, locked: true };
    const { data, error } = await supabaseAdmin.rpc('ai_bot_ingest', {
      p_connection_id: connection.id,
      p_cap: cap,
      p_events: events,
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(`ai_bot_ingest: ${data.error}`);
    stored = data?.stored ?? 0;
    alertAt80(connection, data, cap);
  }

  return { received: list.length, verified: events.length, stored, skipped };
}

/**
 * A log file's key (a Logpush job's or a Vercel drain's): the SHA-256 of its
 * body. A sender that times out waiting sends the same file again, and the
 * key keeps it from being read twice.
 */
export function logFileHash(body) {
  return createHash('sha256')
    .update(Buffer.isBuffer(body) ? body : Buffer.alloc(0))
    .digest('hex');
}

/**
 * Whether the connection's file was read already, so a resent one is
 * answered before it is opened. Only a shortcut: ai_bot_ingest_file claims
 * the file again in its own transaction.
 */
export async function logFileRead(connection, hash) {
  const { data, error } = await supabaseAdmin
    .from('ai_bot_ingested_files')
    .select('body_hash')
    .eq('connection_id', connection.id)
    .eq('body_hash', hash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

/**
 * Whether the organization's month has reached the raw cap already (00184
 * ai_bot_usage.raw_records), so a file is only counted, not verified. The
 * count itself, compared with today's cap: a plan raised mid-month reads
 * again. Only a shortcut: ai_bot_ingest_file decides under the usage lock.
 */
async function rawCapReached(connection, rawCap, now) {
  if (rawCap < 0) return false;
  const month = `${new Date(now).toISOString().slice(0, 7)}-01`;
  const { data, error } = await supabaseAdmin
    .from('ai_bot_usage')
    .select('raw_records')
    .eq('organization_id', connection.organizationId)
    .eq('month', month)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.raw_records ?? 0) >= rawCap;
}

/**
 * Read a log sender's file (a Logpush job's or a Vercel drain's, §6.3):
 * verify its requests, then claim the file, count its records against the
 * month's raw cap and write its events in one transaction
 * (ai_bot_ingest_file). When that fails, nothing was claimed or counted,
 * so the sender's retry is read in full. Past the raw cap, the records are
 * counted and nothing is verified or written; a plan without the report
 * reads nothing.
 */
export async function ingestLogFile(connection, hash, parsed, deps = {}) {
  const rawCap = await getBotRawCap(connection.organizationId);
  const cap = await getBotEventCap(connection.organizationId);
  if (rawCap === 0 || cap === 0) {
    return { received: parsed.records, verified: 0, stored: 0, locked: true };
  }
  const capped = await rawCapReached(connection, rawCap, deps.now ?? Date.now());
  const list = !capped && Array.isArray(parsed.requests) ? parsed.requests : [];
  // Every record counts against the raw cap, other sites' too: the cap is
  // what the server reads, and it reads them to tell them apart.
  const { events, skipped } = await verifyRequests(list, connection.domains, deps);

  const { data, error } = await supabaseAdmin.rpc('ai_bot_ingest_file', {
    p_connection_id: connection.id,
    p_body_hash: hash,
    p_records: parsed.records,
    p_raw_cap: rawCap,
    p_cap: cap,
    p_events: events,
  });
  if (error) throw new Error(error.message);
  if (data?.duplicate) return { received: 0, verified: 0, stored: 0, duplicate: true };
  if (data?.raw_capped) {
    return { received: parsed.records, verified: 0, stored: 0, rawCapped: true };
  }
  alertAt80(connection, data, cap);
  return { received: list.length, verified: events.length, stored: data?.stored ?? 0, skipped };
}

/** Verified rows are kept 90 days (§6.2); the bot × page × day counters 400. */
export const EVENT_RETENTION_DAYS = 90;
export const DAILY_RETENTION_DAYS = 400;
/** Log file hashes kept for spotting a sender's retry (ai_bot_ingest_file). */
export const FILE_HASH_RETENTION_DAYS = 7;

/** Rows the prune deletes per table per call, each call its own statement. */
export const PRUNE_BATCH = 5000;
/** Calls per daily run at most (a million rows a table); the rest waits a day. */
export const MAX_PRUNE_CALLS = 200;

/**
 * The daily prune of rows past their retention (the daily run), PRUNE_BATCH
 * rows a table per call (00189 ai_bot_prune), so no one DELETE runs into the
 * statement timeout. Stops when a call deletes fewer than that from every
 * table.
 */
export async function pruneBotEvents(now = Date.now()) {
  const before = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const bounds = {
    p_events_before: before(EVENT_RETENTION_DAYS),
    p_daily_before: before(DAILY_RETENTION_DAYS).slice(0, 10),
    // A sender retries within minutes; a week of file hashes is plenty.
    p_files_before: before(FILE_HASH_RETENTION_DAYS),
    p_limit: PRUNE_BATCH,
  };
  for (let call = 0; call < MAX_PRUNE_CALLS; call++) {
    const { data, error } = await supabaseAdmin.rpc('ai_bot_prune', bounds);
    if (error) {
      logger.warn({ err: error }, '[ai-bots] prune failed');
      return;
    }
    const counts = [data?.events, data?.daily, data?.files].map((n) => n ?? 0);
    if (counts.every((n) => n < PRUNE_BATCH)) return;
  }
  logger.warn({ calls: MAX_PRUNE_CALLS }, '[ai-bots] prune stopped early; the rest goes tomorrow');
}
