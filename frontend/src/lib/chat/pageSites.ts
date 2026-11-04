/**
 * The pages Chat may open in a run (CHAT-10 §B item 11): a page the person
 * named, or one the workspace's data lists, never a link a page led to. The
 * list is built from what the person wrote and from structured fields only
 * (the brand's and competitors' domains, cited pages' addresses, Site Audit
 * pages), never from free text a read brought in (an AI answer, a draft):
 * text written outside the workspace can't add a site. Pure; the engine
 * keeps a run's list in its progress.
 *
 * Three kinds, from widest to narrowest:
 *   - domains: the brand's own, with every subdomain;
 *   - hosts: a site the person wrote, or a competitor's ("www." aside), at
 *     any path without a query; once the run has read outside text, only at
 *     its home page, so a path can't carry the workspace's data out;
 *   - urls: exact pages (host, path, query and fragment): the person's,
 *     cited and audited pages, a cited domain's home page. A cited host adds
 *     only these, never the host: anyone can get cited.
 * After a page aimed words at AI, only the exact pages open.
 */

export interface PageSites {
  /** Hosts opened at any path without a query ("www." aside): the person's, competitors'. */
  hosts: string[];
  /** Domains opened with their subdomains: the brand's own only. */
  domains: string[];
  /** Exact pages, as pageKey writes them: the person's, cited and audited pages. */
  urls: string[];
}

export const NO_SITES: PageSites = { hosts: [], domains: [], urls: [] };

/** Entries a run keeps, at most, per kind. */
const MAX_ENTRIES = 500;
/** A path Chat opens, at most. */
export const MAX_PATH = 200;

/**
 * Suffixes under which anyone may have a site (shared hosting, and second
 * levels of country domains): never a site on their own, so "github.io" opens
 * nothing and a subdomain of it is never another's. A short list on purpose,
 * not the public suffix list.
 */
const SHARED_SUFFIXES = new Set([
  'vercel.app',
  'github.io',
  'gitlab.io',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'appspot.com',
  'azurewebsites.net',
  'cloudfront.net',
  'onrender.com',
  'fly.dev',
  'glitch.me',
  'blogspot.com',
  'wordpress.com',
  'wixsite.com',
  'webflow.io',
  'framer.website',
  'framer.app',
  'myshopify.com',
  'squarespace.com',
  'notion.site',
  'substack.com',
  'carrd.co',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.tr',
  'org.tr',
  'net.tr',
  'gen.tr',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.za',
  'co.jp',
  'co.kr',
  'co.in',
  'com.br',
  'com.mx',
  'com.cn',
  'com.sg',
]);

/** A host as compared: lower case, without "www." and a final dot. */
export const bareHost = (host: string) =>
  host
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');

/** A DNS host name (labels of letters, digits and hyphens, 253 at most), or an IPv4 address. */
const HOST_NAME = /^(?=.{1,253}$)(?:[a-z0-9-]{1,63}\.)+[a-z0-9-]{1,63}$|^\d{1,3}(?:\.\d{1,3}){3}$/;

/** A name Chat may treat as a site: well formed, and not a shared suffix or a single label. */
export const isSite = (host: string) =>
  HOST_NAME.test(host) && !SHARED_SUFFIXES.has(host) && host.includes('.');

/** An http(s) address, parsed; null for anything else. */
function parsed(url: string): URL | null {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** A page as compared: its host (bare), path, query and fragment; http and https alike. */
const pageKey = (u: URL) => `${bareHost(u.hostname)}${u.pathname}${u.search}${u.hash}`;

/** An address, or a host and path without a scheme, as its pageKey; null when it isn't one. */
function keyOf(address: string): string | null {
  const u = parsed(/^https?:\/\//i.test(address) ? address : `https://${address}`);
  return u && isSite(bareHost(u.hostname)) ? pageKey(u) : null;
}

/** A domain field ("acme.com", "https://www.acme.com/") as a host, when it is a site. */
function domainHost(domain: string): string | null {
  const u = parsed(domain.includes('://') ? domain : `https://${domain.trim()}`);
  const host = u ? bareHost(u.hostname) : null;
  return host && isSite(host) ? host : null;
}

/** The sites a person's text names: "acme.com", "https://www.acme.com/pricing", "93.184.216.34". */
const HOST_IN_TEXT =
  /\b(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}|\d{1,3}(?:\.\d{1,3}){3})\b/gi;
/** The pages in a person's text, with a scheme or without ("acme.com/pricing"). */
const PAGE_IN_TEXT = /(?:https?:\/\/[^\s<>"'`]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\/[^\s<>"'`]*)/gi;
/** A sentence's last mark after an address. */
const TRAILING = /[.,;:!?)\]]+$/;

/** What a person's own words let Chat open: the hosts they name, and the pages they write. */
export function sitesInWords(text: string): PageSites {
  const hosts = Array.from(text.matchAll(HOST_IN_TEXT), (m) => bareHost(m[0])).filter(isSite);
  const urls = Array.from(text.matchAll(PAGE_IN_TEXT), (m) =>
    keyOf(m[0].replace(TRAILING, '')),
  ).filter((url): url is string => !!url);
  return { hosts, domains: [], urls };
}

/** The brand's own domains, opened with their subdomains. */
export function sitesOfDomains(domains: (string | null | undefined)[]): PageSites {
  return {
    hosts: [],
    domains: domains.flatMap((domain) => {
      const host = typeof domain === 'string' && domain.trim() ? domainHost(domain) : null;
      return host ? [host] : [];
    }),
    urls: [],
  };
}

/**
 * The structured fields of the reads that list sites (CHAT-10 item 11): a
 * read not named here adds none, whatever its text says. A competitor's
 * domain is a host; a cited or audited page is its exact address, and a
 * cited domain its home page.
 */
const SITE_FIELDS: Readonly<
  Record<string, { hosts?: string[]; homes?: string[]; urls?: string[] }>
> = {
  list_competitors: { hosts: ['domain'] },
  get_competitor_comparison: { hosts: ['domain'] },
  list_citations: { homes: ['domain'], urls: ['url'] },
  get_site_audit_summary: { urls: ['url', 'final_url', 'finalUrl'] },
  list_site_audit_issues: { urls: ['url', 'final_url', 'finalUrl'] },
};

/** What one read's structured fields let Chat open. */
export function sitesFromRead(toolName: string, value: unknown): PageSites {
  const fields = SITE_FIELDS[toolName];
  const out: PageSites = { hosts: [], domains: [], urls: [] };
  if (!fields) return out;
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      if (typeof item !== 'string') {
        walk(item, depth + 1);
      } else if (fields.hosts?.includes(key)) {
        const host = domainHost(item);
        if (host) out.hosts.push(host);
      } else if (fields.homes?.includes(key)) {
        const host = domainHost(item);
        if (host) out.urls.push(`${host}/`);
      } else if (fields.urls?.includes(key)) {
        const url = keyOf(item);
        if (url) out.urls.push(url);
      }
    }
  };
  walk(value, 0);
  return out;
}

/** Lists in one, each entry once, up to MAX_ENTRIES a kind. */
export function joinSites(...lists: PageSites[]): PageSites {
  const join = (pick: (sites: PageSites) => string[]) =>
    [...new Set(lists.flatMap(pick))].slice(0, MAX_ENTRIES);
  return {
    hosts: join((s) => s.hosts),
    domains: join((s) => s.domains),
    urls: join((s) => s.urls),
  };
}

const onDomain = (host: string, domains: string[]) =>
  domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

/**
 * The list as the API checks a redirect's every step: the hosts, with those
 * of the exact pages (a cited page's site picks where it redirects), and the
 * brand's domains.
 */
export function siteRules(sites: PageSites): { hosts: string[]; domains: string[] } {
  const hosts = [...sites.hosts, ...sites.urls.map((url) => url.slice(0, url.indexOf('/')))];
  return {
    hosts: [...new Set(hosts)].filter((host) => HOST_NAME.test(host)),
    domains: sites.domains.filter((domain) => HOST_NAME.test(domain)),
  };
}

/** Exact pages from addresses (a draft's Sources), as the list keeps them. */
export function sitesOfPages(addresses: (string | null | undefined)[]): PageSites {
  const urls = addresses.flatMap((address) => {
    const key = typeof address === 'string' && address.trim() ? keyOf(address) : null;
    return key ? [key] : [];
  });
  return { hosts: [], domains: [], urls };
}

/**
 * Whether a link goes to a site on the list (AUTONOMOUS-GO-LIVE §6.3 item 4):
 * an exact page (its #part aside), the brand's domains with their
 * subdomains, or a listed host at any path. Not an http(s) address: false.
 */
export function linksToSites(url: string, sites: PageSites): boolean {
  const u = parsed(url);
  if (!u) return false;
  const key = pageKey(u);
  const withoutHash = key.slice(0, key.length - u.hash.length);
  if (sites.urls.includes(key) || sites.urls.includes(withoutHash)) return true;
  const host = bareHost(u.hostname);
  return isSite(host) && (onDomain(host, sites.domains) || sites.hosts.includes(host));
}

/** Where the run stands: it read outside text (tainted), or a page aimed words at AI (injected). */
export interface RunTrust {
  tainted: boolean;
  injected: boolean;
}

const refusal = (message: string) => ({ code: 'not_allowed', message });

/**
 * Why a page may not be opened, or null when it may (see the header): an
 * exact page on the list always; else, unless a page aimed words at AI, a
 * page on the brand's domains, or on a host the person or a competitor read
 * gave (only its home page once the run is tainted), without a query or
 * fragment; and a path of 200 characters at most. Not a URL at all: null,
 * and the API says why.
 */
export function pageRefusal(
  url: string,
  sites: PageSites,
  trust: RunTrust,
): { code: string; message: string } | null {
  const u = parsed(url);
  if (!u) return null;
  if (u.pathname.length > MAX_PATH) return refusal('That address is too long to open.');
  if (sites.urls.includes(pageKey(u))) return null;
  if (trust.injected) {
    return refusal(
      'A page had words aimed at AI assistants: open only an address the person or the workspace’s data gave exactly.',
    );
  }
  const host = bareHost(u.hostname);
  const brand = isSite(host) && onDomain(host, sites.domains);
  if (!brand && !(isSite(host) && sites.hosts.includes(host))) {
    return refusal(
      "Open only a page on a site the person named or the workspace's data lists: ask the person for its address.",
    );
  }
  if (u.search || u.hash) {
    return refusal(
      'Open the address without its ?query or #part, unless the person or the workspace’s data gave it exactly.',
    );
  }
  if (!brand && trust.tainted && u.pathname !== '/') {
    return refusal(
      'After reading outside text, open another site only at its home page or at an address given exactly.',
    );
  }
  return null;
}
