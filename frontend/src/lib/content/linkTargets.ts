import { classifyDomain, extractHostname, normalizeDomain } from '@/lib/citations/classify';

/**
 * Where an agent may link (Content Agent rule gaps, A): the brand's own pages
 * for internal links, and the sources the draft keeps for outbound links and
 * inline citations. A link to anything else is unwrapped, so an agent never
 * invents one. The same rules as the Content Agent's on the server
 * (backend/src/lib/contentLinks.js).
 */

/** The brand's pages offered, the most cited and visited first. */
export const MAX_OWN_PAGES = 40;
/** The draft's sources offered, as the Sources tab lists them (its top 20). */
export const MAX_SOURCE_PAGES = 20;

export interface LinkTarget {
  url: string;
  title: string;
}

export interface LinkTargets {
  /** The brand's own pages: internal links. */
  own: LinkTarget[];
  /** The draft's sources, not the brand's or a competitor's: outbound links and citations. */
  sources: LinkTarget[];
}

/** Query parameters that only track a visit. */
const TRACKING = /^(utm_\w+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref)$/i;

/** A path without the slashes it ends in, read back from its end. */
function withoutTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') end -= 1;
  return path.slice(0, end);
}

/**
 * A URL as links compare: an http(s) address, its host lower-cased without
 * www, no hash, no tracking parameters, no trailing slash. Null for anything else.
 */
export function linkKey(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(String(url ?? '').trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...parsed.searchParams].filter(([name]) => !TRACKING.test(name));
  const search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  return `${host}${withoutTrailingSlashes(parsed.pathname)}${search}`;
}

/** A URL as a link keeps it: without tracking parameters or a hash; null when not http(s). */
export function linkHref(url: string): string | null {
  if (!linkKey(url)) return null;
  const parsed = new URL(String(url).trim());
  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING.test(name)) parsed.searchParams.delete(name);
  }
  parsed.hash = '';
  return parsed.toString();
}

/** The URL a link may keep, by its key: every target's. */
export function linkAllowList(targets: LinkTargets): Map<string, string> {
  return new Map(
    [...targets.own, ...targets.sources].flatMap((p) => {
      const key = linkKey(p.url);
      return key ? [[key, p.url] as const] : [];
    }),
  );
}

const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The targets from what was read: the brand's pages (site_pages, the most
 * cited first), and the draft's sources (the content_draft_sources RPC's
 * cited pages and the ones the person added, without those they left out
 * and without the brand's and its competitors' own). Without the sources
 * read, competitors can't be told apart: no outbound targets.
 */
export function pickLinkTargets({
  pages,
  sources,
  choices,
  sourceUrl,
}: {
  pages: { url: string; title: string | null; h1: string | null }[];
  sources: {
    citedPages?: { url: string; title: string | null }[];
    brandDomains?: string[];
    competitorDomains?: string[];
  } | null;
  choices: { ref: string; included: boolean; added: boolean }[];
  sourceUrl: string | null;
}): LinkTargets {
  const seen = new Set([linkKey(sourceUrl ?? '')].filter(Boolean));
  const take = (list: LinkTarget[], max: number, url: string, title: string | null) => {
    const key = linkKey(url);
    const href = linkHref(url);
    if (!key || !href || seen.has(key) || list.length >= max) return;
    seen.add(key);
    list.push({ url: href, title: clean(title) || href });
  };

  const own: LinkTarget[] = [];
  for (const page of pages) take(own, MAX_OWN_PAGES, page.url, page.title || page.h1);
  if (!sources) return { own, sources: [] };

  const leftOut = new Set(choices.filter((c) => !c.included).map((c) => linkKey(c.ref)));
  const ctx = {
    brandDomains: (sources.brandDomains ?? []).map(normalizeDomain),
    competitorDomains: (sources.competitorDomains ?? []).map(normalizeDomain),
  };
  const outbound: LinkTarget[] = [];
  for (const page of [
    ...(sources.citedPages ?? []),
    // Added by the person in the Sources tab: kept, even with no answer citing them yet.
    ...choices.filter((c) => c.added && c.included).map((c) => ({ url: c.ref, title: null })),
  ]) {
    const host = extractHostname(page.url);
    if (!host || leftOut.has(linkKey(page.url))) continue;
    const kind = classifyDomain(host, ctx);
    if (kind === 'you' || kind === 'competitor') continue;
    take(outbound, MAX_SOURCE_PAGES, page.url, page.title);
  }
  return { own, sources: outbound };
}
