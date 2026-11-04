/**
 * The AI bots GetCito counts reading a brand's site (AT-010, spec §3.7): one
 * versioned list, in ai-bots.json, of each bot's user-agent token, its type
 * (training crawler, search crawler, or a fetch a person asked for) and the
 * URL where its operator publishes the IP ranges it crawls from.
 *
 * A request counts only when both hold: its user agent names a bot, and its
 * IP is in that bot's published ranges (§3.7: "the user agent must match and
 * the IP must be in the operator's published ranges"). User agents are easy
 * to fake; the ranges are not. No model is involved anywhere.
 *
 * The ranges are fetched on first use and again once a day, and kept in
 * memory. A failed refresh keeps the last list; with none ever read, the
 * bot's requests can't be verified and aren't counted, and the list isn't
 * tried again for a few minutes. A list past its day is still used while it
 * is read again; only requests with no list to use wait, for that one read.
 *
 * The list is versioned like ai-sources.json: each change adds an entry to
 * `changes` and bumps `version`.
 */

import { createRequire } from 'module';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);
const config = require('./ai-bots.json');

export const AI_BOTS_VERSION = config.version;
export const AI_BOT_CHANGES = config.changes;
export const AI_BOTS = config.bots;

/** How long a published range list is used before it is read again. */
export const RANGES_TTL_MS = 24 * 60 * 60 * 1000;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A token stands on its own in the user agent: "GPTBot/1.2", "(compatible;
// ClaudeBot/1.0; ...)", never as part of a longer name.
const MATCHERS = AI_BOTS.map((bot) => ({
  bot,
  re: new RegExp(`(^|[^a-z0-9-])${escape(bot.userAgent)}([^a-z0-9-]|$)`, 'i'),
}));

/** The bot a user agent names, or null. */
export function matchBot(userAgent) {
  if (typeof userAgent !== 'string' || !userAgent) return null;
  return MATCHERS.find((m) => m.re.test(userAgent))?.bot ?? null;
}

/** An IPv4 or IPv6 address as a number and its family, or null. */
export function parseIp(raw) {
  if (typeof raw !== 'string') return null;
  const ip = raw.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { family: 4, value: parts.reduce((n, p) => (n << 8n) + BigInt(p), 0n) };
  }
  if (!ip.includes(':') || !/^[0-9a-f:.]+$/i.test(ip)) return null;
  // An IPv4-mapped address (::ffff:1.2.3.4) reads as the IPv4 one.
  const mapped = ip.match(/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i);
  if (mapped) return parseIp(mapped[1]);
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array(missing).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { family: 6, value: groups.reduce((n, g) => (n << 16n) + BigInt(parseInt(g, 16)), 0n) };
}

/** "20.171.206.0/24" as a family, a first address and a prefix length; null when malformed. */
export function parsePrefix(cidr) {
  if (typeof cidr !== 'string') return null;
  const [addr, len] = cidr.split('/');
  const ip = parseIp(addr);
  const bits = Number(len);
  const width = ip?.family === 4 ? 32 : 128;
  if (!ip || !Number.isInteger(bits) || bits < 0 || bits > width) return null;
  const shift = BigInt(width - bits);
  return { family: ip.family, base: (ip.value >> shift) << shift, shift };
}

/** True when the address is in one of the prefixes. */
export function inPrefixes(ip, prefixes) {
  const addr = parseIp(ip);
  if (!addr) return false;
  return prefixes.some(
    (p) => p.family === addr.family && (addr.value >> p.shift) << p.shift === p.base,
  );
}

/** The prefixes in a published range file: {prefixes: [{ipv4Prefix | ipv6Prefix}]}. */
export function readRangeFile(json) {
  const list = Array.isArray(json?.prefixes) ? json.prefixes : [];
  return list.map((p) => parsePrefix(p?.ipv4Prefix ?? p?.ipv6Prefix)).filter(Boolean);
}

/**
 * After a failed read with no list to fall back on, the next try waits this
 * long: a batch's requests for that bot would otherwise each wait out the
 * fetch's timeout, one after another (#1179's review).
 */
export const RANGES_RETRY_MS = 5 * 60 * 1000;

/** A failed refresh keeps the last list this long before the next try. */
const STALE_KEEP_MS = 60 * 60 * 1000;

/** url → { until, prefixes }: prefixes null after a failed first read. */
const cache = new Map();
/** url → the read under way, which concurrent requests share. */
const pending = new Map();

async function readRanges(url, hit, fetchImpl, now) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const prefixes = readRangeFile(await res.json());
    if (prefixes.length === 0) throw new Error('no prefixes');
    cache.set(url, { until: now + RANGES_TTL_MS, prefixes });
    return prefixes;
  } catch (err) {
    logger.warn({ err, url }, '[ai-bots] range list not refreshed');
    const prefixes = hit?.prefixes ?? null;
    cache.set(url, { until: now + (prefixes ? STALE_KEEP_MS : RANGES_RETRY_MS), prefixes });
    return prefixes;
  }
}

/**
 * A range file's prefixes: from memory while fresh, read again after a day.
 * A failed read keeps what was read before; null when nothing ever was, and
 * then until RANGES_RETRY_MS has passed. One read at a time per file, and a
 * request with a list past its day uses it rather than waiting for the read
 * (gkhngyk on #1251).
 */
export async function rangesFor(url, { fetchImpl = fetch, now = Date.now() } = {}) {
  const hit = cache.get(url);
  if (hit && now < hit.until) return hit.prefixes;
  let read = pending.get(url);
  if (!read) {
    read = readRanges(url, hit, fetchImpl, now).finally(() => pending.delete(url));
    pending.set(url, read);
  }
  return hit?.prefixes ?? read;
}

/** Forgets every range list (tests). */
export function clearRangeCache() {
  cache.clear();
  pending.clear();
}

/**
 * Whether a request is a verified AI bot: its bot, or why it isn't one —
 * `unknown_agent` (not on the list), `unverified_ip` (not in the operator's
 * ranges) or `no_ranges` (the ranges couldn't be read yet).
 */
export async function verifyBotRequest({ userAgent, ip }, deps) {
  const bot = matchBot(userAgent);
  if (!bot) return { reason: 'unknown_agent' };
  const prefixes = await rangesFor(bot.ranges, deps);
  if (!prefixes) return { reason: 'no_ranges' };
  if (!inPrefixes(ip, prefixes)) return { reason: 'unverified_ip' };
  return { bot };
}
