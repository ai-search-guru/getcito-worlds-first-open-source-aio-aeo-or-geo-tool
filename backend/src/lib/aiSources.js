/**
 * The AI assistants GetCito counts traffic from (AT-004, spec §5.1): one
 * list, in ai-sources.json, for the tracking snippet and the Google Analytics
 * sync, so the two name the same engine the same way and never disagree on
 * what counts.
 *
 * Each source has a key (the host-style name stored in
 * ai_traffic_logs.source_platform and ga_ai_traffic_stats.platform), the
 * hosts it is reached from, and aliases: exact names some tools use instead
 * of a host, like GA4's "chatgpt" or "openai".
 *
 * A value matches a host when it is the host or one of its subdomains
 * (m.perplexity.ai, search.chatgpt.com) — never when it merely contains an
 * engine's name. A *.workers.dev proxy with "claude" in its name once showed
 * up in a real property; substring matching would have booked it as AI
 * traffic.
 *
 * A source can have surfaces: a part of the assistant whose links carry
 * their own utm_medium, like ChatGPT Shopping's product cards, whose feed
 * links say utm_medium=feed (#1283). A visit through one is still the
 * source's, so the source's totals don't change; it is also marked with the
 * surface's key (ai_traffic_logs.source_surface, ga_ai_traffic_stats.surface).
 *
 * The list is versioned: each change adds an entry to `changes` and bumps
 * `version`, and every stored row records the version that counted it, so a
 * step in the history can be traced to the list rather than to the traffic.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('./ai-sources.json');

export const AI_SOURCES_VERSION = config.version;
export const AI_SOURCE_CHANGES = config.changes;
export const AI_SOURCES = config.sources;

/**
 * Where a value comes from. A referrer is the snippet's main signal; a
 * utm_source tag and a GA4 session source are names chosen by whoever built
 * the link or by GA4, so a source can opt out of either (Bing's links say
 * nothing about Copilot without the /ck/a path only a referrer carries).
 */
const ORIGINS = ['referrer', 'utm', 'analytics'];

/** Lowercased, trimmed, without a leading "www.". */
export function normalizeSource(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}

function counts(source, origin) {
  if (origin === 'utm') return source.utm !== false;
  if (origin === 'analytics') return source.analytics !== false;
  return true;
}

/**
 * The source key behind a referrer host, a utm_source value or a GA4 session
 * source, or null when it isn't on the list. Unrecognised is a normal
 * outcome: most traffic isn't from an AI assistant.
 */
export function classifyAiSource(raw, { origin = 'referrer' } = {}) {
  if (!ORIGINS.includes(origin)) throw new Error(`Unknown AI source origin: ${origin}`);
  const value = normalizeSource(raw);
  if (!value) return null;
  for (const source of AI_SOURCES) {
    if (!counts(source, origin)) continue;
    if (source.aliases.includes(value)) return source.key;
    if (source.hosts.some((host) => value === host || value.endsWith(`.${host}`))) {
      return source.key;
    }
  }
  return null;
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The same match as one regular expression, for asking GA4 for these
 * sessions (FULL_REGEXP, RE2 syntax): a listed host or any subdomain of it,
 * or an alias exactly.
 */
export function aiSourcePattern({ origin = 'analytics' } = {}) {
  const sources = AI_SOURCES.filter((source) => counts(source, origin));
  const hosts = sources.flatMap((source) => source.hosts).map(escapeRegex);
  const aliases = sources.flatMap((source) => source.aliases).map(escapeRegex);
  return `^((.+\\.)?(${hosts.join('|')})|(www\\.)?(${aliases.join('|')}))$`;
}

/**
 * The surface of source `sourceKey` that a visit or session came through,
 * from its medium (a landing URL's utm_medium, or GA4's session medium), or
 * null for the source's ordinary links. The medium matches exactly, in any
 * case: "feed" is ChatGPT Shopping, "rss-feed" isn't.
 */
export function classifyAiSurface(sourceKey, medium) {
  const value = typeof medium === 'string' ? medium.toLowerCase() : '';
  if (!value) return null;
  const source = AI_SOURCES.find((s) => s.key === sourceKey);
  return source?.surfaces?.find((surface) => surface.medium === value)?.key ?? null;
}

/**
 * A landing URL's utm_medium: the first utm_medium parameter, its name in any
 * case, as 00251 read the URLs stored before. Empty without one, or for a
 * value that isn't a URL.
 */
export function landingMedium(url) {
  try {
    for (const [name, value] of new URL(url).searchParams) {
      if (name.toLowerCase() === 'utm_medium') return value;
    }
  } catch {
    // Not a URL: no medium.
  }
  return '';
}
