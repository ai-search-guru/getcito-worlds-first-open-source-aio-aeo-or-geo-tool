import { createRequire } from 'node:module';
import { ownDomainMatcher } from './responseParser.js';

const require = createRequire(import.meta.url);
const MARKETPLACES = require('./merchant-marketplaces.json');
const MARKETPLACE_ENTRIES = Object.entries(MARKETPLACES);
const REDIRECTS = MARKETPLACE_ENTRIES.flatMap(([marketplace, config]) =>
  (config.redirects ?? []).map((redirect) => ({ marketplace, ...redirect })),
);

function normalizeHost(host) {
  return typeof host === 'string' ? host.trim().toLowerCase().replace(/\.$/, '') : '';
}

/** A host matches a registered domain only at a label boundary. */
function hostMatches(host, domain) {
  const candidate = normalizeHost(host);
  const registered = normalizeHost(domain);
  return Boolean(
    candidate && registered && (candidate === registered || candidate.endsWith(`.${registered}`)),
  );
}

/**
 * Parse only HTTP(S) destinations. Scheme-less merchant links are accepted,
 * but opaque schemes such as javascript: are not merchant URLs.
 */
function parseHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    // Many merchant URLs omit the scheme. Do not prepend one to an explicitly
    // unsupported scheme, because that would turn malformed input into a host.
    if (/^[a-z][a-z\d+.-]*:/i.test(raw)) return null;
    try {
      parsed = new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
  return parsed;
}

function redirectTarget(value, marketplace) {
  const candidates = [value];
  let decoded = value;
  // searchParams decodes one URL-encoding layer already. A few redirectors
  // encode the destination again, so allow two extra decode attempts.
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      candidates.push(decoded);
    } catch {
      break;
    }
  }

  const canonicalHost = MARKETPLACES[marketplace]?.hosts?.[0];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;

    // Relative paths are common on affiliate links. Resolve them against the
    // marketplace's canonical host, never the affiliate redirect host.
    if (candidate.startsWith('/') && !candidate.startsWith('//') && canonicalHost) {
      try {
        return new URL(candidate, `https://${canonicalHost}/`);
      } catch {
        continue;
      }
    }

    // Only explicitly absolute HTTP(S) URLs are valid redirect destinations.
    // Do not reinterpret arbitrary strings such as "foo" as hosts.
    if (!/^https?:\/\//i.test(candidate)) continue;
    const absolute = parseHttpUrl(candidate);
    if (absolute) return absolute;
  }
  return null;
}

/** Resolve known affiliate links before checking marketplace or brand hosts. */
function resolveMerchantUrl(initialUrl) {
  let url = initialUrl;
  const visited = new Set([url.href]);

  // Do not follow untrusted general-purpose redirects. Only hosts and query
  // parameters listed in merchant-marketplaces.json are inspected.
  for (let depth = 0; depth < 3; depth += 1) {
    const host = normalizeHost(url.hostname);
    const redirect = REDIRECTS.find((entry) =>
      entry.hosts.some((registered) => hostMatches(host, registered)),
    );
    if (!redirect) break;

    let target = null;
    for (const parameter of redirect.parameters ?? []) {
      const candidate = url.searchParams.get(parameter);
      if (!candidate) continue;
      target = redirectTarget(candidate, redirect.marketplace);
      if (target) break;
    }
    if (!target || visited.has(target.href)) break;

    visited.add(target.href);
    url = target;
  }

  return url;
}

function detectMarketplace(host) {
  for (const [marketplace, config] of MARKETPLACE_ENTRIES) {
    if ((config.hosts ?? []).some((registered) => hostMatches(host, registered))) {
      return marketplace;
    }
  }

  // When a known affiliate URL has no usable destination parameter, classify
  // its redirect host itself instead of treating the merchant as a reseller.
  const redirect = REDIRECTS.find((entry) =>
    entry.hosts.some((registered) => hostMatches(host, registered)),
  );
  return redirect?.marketplace ?? null;
}

function isOwnDomain(url, brandDomains) {
  if (!Array.isArray(brandDomains)) return false;
  return ownDomainMatcher(brandDomains)(url.href);
}

function listingIdFor(marketplace, pathname) {
  const segments = pathname.split('/').filter(Boolean);
  const segmentIndex = (name) => segments.findIndex((segment) => segment.toLowerCase() === name);

  if (marketplace === 'amazon') {
    const match = pathname.match(/\/(?:dp|gp\/product)\/([a-z\d]{10})(?:\/|$)/i);
    return match ? match[1].toUpperCase() : null;
  }

  if (marketplace === 'ebay') {
    const index = segmentIndex('itm');
    if (index < 0) return null;
    const direct = segments[index + 1];
    if (/^\d+$/.test(direct ?? '')) return direct;
    const slugged = segments[index + 2];
    return /^\d+$/.test(slugged ?? '') ? slugged : null;
  }

  if (marketplace === 'walmart') {
    const index = segmentIndex('ip');
    if (index < 0) return null;
    const first = segments[index + 1];
    if (/^\d+$/.test(first ?? '')) return first;
    const withSlug = segments[index + 2];
    return /^\d+$/.test(withSlug ?? '') ? withSlug : null;
  }

  if (marketplace === 'etsy') {
    const index = segmentIndex('listing');
    const id = segments[index + 1];
    return index >= 0 && /^\d+$/.test(id ?? '') ? id : null;
  }

  return null;
}

/**
 * Classify the destination behind an AI shopping card's merchant URL.
 *
 * Marketplace host and redirect rules live in merchant-marketplaces.json, so
 * new country domains and redirectors can be added without changing logic.
 * Unknown and malformed URLs intentionally fall back to reseller.
 *
 * @param {string} merchantUrl
 * @param {{ brandDomains?: string[] }} [options]
 * @returns {{ kind: 'own'|'marketplace'|'reseller', marketplace: string|null, listingId: string|null }}
 */
export function classifyMerchant(merchantUrl, { brandDomains = [] } = {}) {
  const parsed = parseHttpUrl(merchantUrl);
  if (!parsed) return { kind: 'reseller', marketplace: null, listingId: null };

  const destination = resolveMerchantUrl(parsed);
  const host = normalizeHost(destination.hostname);
  const marketplace = detectMarketplace(host);

  if (marketplace) {
    return {
      kind: 'marketplace',
      marketplace,
      listingId: listingIdFor(marketplace, destination.pathname),
    };
  }

  if (isOwnDomain(destination, brandDomains)) {
    return { kind: 'own', marketplace: null, listingId: null };
  }

  return { kind: 'reseller', marketplace: null, listingId: null };
}
