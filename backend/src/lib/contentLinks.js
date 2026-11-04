import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { ownDomainMatcher } from './responseParser.js';

/**
 * Where the Content Agent may link (Content Agent rule gaps, A): the brand's
 * own pages for internal links, and the sources the draft keeps for outbound
 * links and inline citations. The agent links only to these, by their URL;
 * keepSuggestions unwraps any other link, so it never invents one.
 */

/** No targets: every link an agent writes is unwrapped. */
export const NO_LINK_TARGETS = Object.freeze({ own: [], sources: [] });

/** The brand's pages offered, the most cited and visited first. */
export const MAX_OWN_PAGES = 40;
/** The draft's sources offered, as the Sources tab lists them (its top 20). */
export const MAX_SOURCE_PAGES = 20;

/** Query parameters that only track a visit. */
const TRACKING = /^(utm_\w+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref)$/i;

/** A path without the slashes it ends in, read back from its end. */
function withoutTrailingSlashes(path) {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') end -= 1;
  return path.slice(0, end);
}

/**
 * A URL as links compare: an http(s) address, its host lower-cased without
 * www, no hash, no tracking parameters, no trailing slash. Null for anything else.
 */
export function linkKey(url) {
  let parsed;
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
export function linkHref(url) {
  if (!linkKey(url)) return null;
  const parsed = new URL(String(url).trim());
  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING.test(name)) parsed.searchParams.delete(name);
  }
  parsed.hash = '';
  return parsed.toString();
}

const clean = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The draft's link targets: `own` (the brand's pages) and `sources` (pages AI
 * answers cite for the draft's prompts, without the brand's own and its
 * competitors', without the ones the person left out, with the ones they
 * added), each { url, title }. A failed read leaves its list empty: the agent
 * then links nothing there, as before.
 */
export async function readLinkTargets({ brandId, draftId, sourceUrl, ruleKeys }) {
  // Each list is read only for the rules that use it.
  const wantsOwn = ruleKeys.has('internalLinks');
  const wantsSources = ruleKeys.has('outboundLinks') || ruleKeys.has('citeInline');
  if (!wantsOwn && !wantsSources) return NO_LINK_TARGETS;
  const none = { data: null, error: null };
  const [pagesRead, sourcesRead, choicesRead] = await Promise.all([
    wantsOwn
      ? supabaseAdmin
          .from('site_pages')
          .select('url, title, h1')
          .eq('brand_id', brandId)
          // Not fetched yet, or answered: 0 is a fetch that failed outright (00104).
          .or('fetch_status.is.null,and(fetch_status.gte.200,fetch_status.lt.400)')
          .order('ai_citations', { ascending: false })
          .order('ga_sessions', { ascending: false })
          .limit(MAX_OWN_PAGES + 1)
      : none,
    wantsSources
      ? supabaseAdmin.rpc('content_draft_sources', { p_draft_id: draftId, p_days: 30 })
      : none,
    wantsSources
      ? supabaseAdmin
          .from('content_draft_sources')
          .select('ref, included, added')
          .eq('draft_id', draftId)
          .eq('kind', 'cited_page')
      : none,
  ]);
  for (const [what, read] of [
    ['site pages', pagesRead],
    ['sources', sourcesRead],
    ['source choices', choicesRead],
  ]) {
    if (read.error) {
      logger.warn({ err: read.error, draftId }, `[content-links] reading ${what} failed`);
    }
  }

  const seen = new Set([linkKey(sourceUrl)].filter(Boolean));
  const take = (list, max, page) => {
    const key = linkKey(page.url);
    if (!key || seen.has(key) || list.length >= max) return;
    seen.add(key);
    const url = linkHref(page.url);
    list.push({ url, title: clean(page.title) || url });
  };

  const own = [];
  for (const page of pagesRead.error ? [] : (pagesRead.data ?? [])) {
    take(own, MAX_OWN_PAGES, { url: page.url, title: page.title || page.h1 });
  }

  const data = sourcesRead.error ? null : sourcesRead.data;
  // Without the read, competitors can't be told apart: no outbound targets.
  if (!data) return { own, sources: [] };
  const choices = choicesRead.error ? [] : (choicesRead.data ?? []);
  const leftOut = new Set(choices.filter((c) => !c.included).map((c) => linkKey(c.ref)));
  // The brand's and its competitors' own sites, a domain written with a path too.
  const closed = ownDomainMatcher([
    ...(data.brandDomains ?? []),
    ...(data.competitorDomains ?? []),
  ]);
  const sources = [];
  const candidates = [
    ...(data.citedPages ?? []),
    // Added by the person in the Sources tab: kept, even with no answer citing them yet.
    ...choices.filter((c) => c.added && c.included).map((c) => ({ url: c.ref, title: '' })),
  ];
  for (const page of candidates) {
    if (leftOut.has(linkKey(page.url)) || closed(page.url)) continue;
    take(sources, MAX_SOURCE_PAGES, page);
  }
  return { own, sources };
}

/**
 * The targets as the model reads them, by the rules asked for; '' when there
 * are none. A draft's shopping path (shoppingLinks.js withShopping) comes
 * first, whatever the rules: it's the page's plan.
 */
export function linkTargetsPrompt(targets, ruleKeys) {
  const lines = (list) => list.map((p) => `- ${p.title} — ${p.url}`).join('\n');
  const parts = [];
  if (targets.shopping?.length) {
    parts.push(
      `The shopping path, the brand's shop pages this page sends readers to: link each where the page names it, once:\n${lines(targets.shopping)}`,
    );
  }
  if (targets.own.length && ruleKeys.has('internalLinks')) {
    parts.push(
      `Pages on the brand's site you may link to (internal links):\n${lines(targets.own)}`,
    );
  }
  if (targets.sources.length && (ruleKeys.has('outboundLinks') || ruleKeys.has('citeInline'))) {
    parts.push(
      `Sources you may link to and cite (outbound links, inline citations):\n${lines(targets.sources)}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * The URL a link may keep, by its key: every target's. A link to anything
 * else is unwrapped.
 */
export function linkAllowList(targets) {
  return new Map(
    [...targets.own, ...targets.sources, ...(targets.shopping ?? [])].map((p) => [
      linkKey(p.url),
      p.url,
    ]),
  );
}
