/**
 * Site Audit's Opportunities inbox (SA-004): the brand's pages worth auditing,
 * each with why. Pure, so the route only reads rows and this decides what
 * they add up to.
 *
 * Sources in this version:
 * - Google Analytics: page_opportunities' open "no AI traffic" pages,
 *   valuable pages AI engines send no visitors to (refreshed nightly).
 * - Site pages (site_pages: the sitemap, GA and cited pages): pages never
 *   audited, or whose last audit is older than auditMaxAgeDays.
 * - Citations: prompts where a competitor is cited and the brand never is
 *   (audit_competitor_cited_prompts), each through the brand page closest
 *   to it (the prompt's target URL, else the best site_pages match).
 *
 * Pinned pages always show. Excluded pages are left out of the rows and
 * listed apart, so they can be put back; pages under the brand's exclude
 * patterns (SA-006 settings) are left out. The order is the priority score's
 * (priority.js rankOpportunities); here rows come pinned first, then by path.
 */

import { isExcludedPath } from '../pagePaths.js';
import { candidatePages } from '../pageMatching.js';
import { pageKey } from './history.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One key per page across GA paths, site_pages URLs, audits and prefs: the
 * Pages list's key (host without www., path without a trailing slash),
 * lowercased, since GA lowercases its paths. Null for something that isn't a
 * URL.
 */
export function opportunityKey(url) {
  return pageKey(url)?.key.toLowerCase() ?? null;
}

const pathOf = (url) => pageKey(url)?.path ?? '/';

/** Longest exclude pattern kept, and how many a brand may have. */
export const EXCLUDE_PATTERN_MAX_LENGTH = 200;
export const EXCLUDE_PATTERNS_MAX = 50;

/**
 * A brand's exclude pattern as stored (SA-006): a path such as "/legal/*",
 * lowercased, without a trailing slash. `*` stands for any characters,
 * slashes included. Null for something that isn't a path.
 */
export function normalizeExcludePattern(raw) {
  const pattern = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!pattern.startsWith('/') || pattern.length > EXCLUDE_PATTERN_MAX_LENGTH) return null;
  if (/\s/.test(pattern)) return null;
  return pattern.replace(/\/+$/, '') || '/';
}

const escapeRegExp = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** A test of a page path against the brand's exclude patterns. */
export function excludePatternMatcher(patterns = []) {
  const regexes = patterns.map(
    (pattern) => new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`),
  );
  return (path) => regexes.some((re) => re.test(path.toLowerCase()));
}

/**
 * The brand pages closest to the prompts a competitor is cited on and the
 * brand never is: the prompt's target URLs when it has any (a customer said
 * which page answers it), else the site page that best matches its text.
 * Prompts with no such page are left out: there is nothing to audit.
 *
 * @param {object} input
 * @param {Array<{ prompt_id: string, prompt_text: string, own_results: number|string, competitor_domains: string[] }>} input.prompts
 *   audit_competitor_cited_prompts rows
 * @param {Array<{ prompt_id: string, url: string }>} input.targetUrls  prompt_target_urls of those prompts
 * @param {Array<{ url: string, title?: string|null, h1?: string|null, description?: string|null }>} input.sitePages
 * @param {Map<string, string>} input.competitorNames  competitor host → name
 * @returns {Array<{ url: string, prompts: number, competitors: string[] }>}
 */
export function competitorGapPages({
  prompts = [],
  targetUrls = [],
  sitePages = [],
  competitorNames,
}) {
  const targets = new Map();
  for (const t of targetUrls) {
    if (!targets.has(t.prompt_id)) targets.set(t.prompt_id, []);
    targets.get(t.prompt_id).push(t.url);
  }
  const pages = new Map();
  for (const prompt of prompts) {
    if (Number(prompt.own_results) > 0) continue;
    const urls =
      targets.get(prompt.prompt_id) ??
      candidatePages(prompt.prompt_text, sitePages, 1).map((page) => page.url);
    for (const url of urls) {
      const key = opportunityKey(url);
      if (!key) continue;
      if (!pages.has(key)) pages.set(key, { url, prompts: new Set(), competitors: new Set() });
      const page = pages.get(key);
      page.prompts.add(prompt.prompt_id);
      for (const domain of prompt.competitor_domains ?? []) {
        page.competitors.add(competitorNames?.get(domain) ?? domain);
      }
    }
  }
  return [...pages.values()].map((page) => ({
    url: page.url,
    prompts: page.prompts.size,
    competitors: [...page.competitors].sort((a, b) => a.localeCompare(b)),
  }));
}

/**
 * @param {object} input
 * @param {string|null} input.primaryHost   the brand's primary host (normStoredDomain)
 * @param {Array<{ landing_page: string, value_signal: string, value_percentile: number|string, sessions: number, citation_state: string|null, citations: number|null }>} input.gaPages
 *   open page_opportunities rows (paths on the primary host)
 * @param {Array<{ url: string, title: string|null, ga_sessions: number|null, ai_citations: number|null }>} input.sitePages
 * @param {Array<{ key: string, url: string, score: number|null, auditId: string, lastAuditedAt: string, status: string }>} input.auditPages
 *   buildAuditPages output
 * @param {Array<{ url: string, prompts: number, competitors: string[] }>} [input.competitorPages]
 *   competitorGapPages output
 * @param {Array<{ page_key: string, url: string, state: 'pinned'|'excluded' }>} input.prefs
 * @param {string[]} [input.excludePatterns]  the brand's stored patterns (normalizeExcludePattern)
 * @param {number} input.staleDays   an audit older than this no longer counts
 * @param {number} [input.now]
 */
export function buildOpportunities({
  primaryHost,
  gaPages = [],
  sitePages = [],
  auditPages = [],
  competitorPages = [],
  prefs = [],
  excludePatterns = [],
  staleDays,
  now = Date.now(),
}) {
  const excludedByPattern = excludePatternMatcher(excludePatterns);
  const audits = new Map(auditPages.map((p) => [p.key.toLowerCase(), p]));
  // A page listed for another reason still takes its title and traffic from site_pages.
  const sitePagesByKey = new Map(sitePages.map((p) => [opportunityKey(p.url), p]));
  const prefsByKey = new Map(prefs.map((p) => [p.page_key, p]));
  const pages = new Map();

  const pageFor = (url) => {
    const key = opportunityKey(url);
    if (!key) return null;
    if (!pages.has(key)) {
      pages.set(key, {
        key,
        url,
        path: pathOf(url),
        title: null,
        reasons: [],
        pinned: false,
        sessions: null,
        citations: null,
      });
    }
    return pages.get(key);
  };

  if (primaryHost) {
    for (const row of gaPages) {
      const page = pageFor(`https://${primaryHost}${row.landing_page}`);
      if (!page) continue;
      page.reasons.push({
        type: 'no_ai_traffic',
        signal: row.value_signal,
        percentile: Number(row.value_percentile),
        citationState: row.citation_state ?? null,
      });
      page.sessions = row.sessions ?? page.sessions;
      page.citations = row.citations ?? page.citations;
    }
  }

  const staleBefore = now - staleDays * DAY_MS;
  for (const row of sitePages) {
    const key = opportunityKey(row.url);
    if (!key) continue;
    const audit = audits.get(key);
    const audited = audit && audit.score !== null;
    const stale = audited && Date.parse(audit.lastAuditedAt) < staleBefore;
    if (audited && !stale && !pages.has(key)) continue;
    const page = pageFor(row.url);
    page.title = row.title ?? page.title;
    page.sessions = page.sessions ?? row.ga_sessions ?? null;
    page.citations = page.citations ?? row.ai_citations ?? null;
    if (!audited) page.reasons.push({ type: 'never_audited' });
    else if (stale) {
      page.reasons.push({
        type: 'stale_audit',
        days: Math.floor((now - Date.parse(audit.lastAuditedAt)) / DAY_MS),
      });
    }
  }

  for (const gap of competitorPages) {
    const page = pageFor(gap.url);
    if (!page) continue;
    page.reasons.push({
      type: 'competitor_cited',
      prompts: gap.prompts,
      competitors: gap.competitors,
    });
  }

  for (const pref of prefs) {
    const page = pref.state === 'pinned' ? pageFor(pref.url) : null;
    if (page) page.pinned = true;
  }

  const rows = [];
  const excluded = [];
  for (const page of pages.values()) {
    const pref = prefsByKey.get(page.key);
    if (pref?.state === 'excluded') {
      excluded.push({ key: page.key, url: page.url, path: page.path, title: page.title });
      continue;
    }
    // Checkout, login, legal and the like carry no opportunity, nor do the
    // brand's exclude patterns, unless a team pinned the page.
    if (!page.pinned && (isExcludedPath(page.path) || excludedByPattern(page.path))) continue;
    if (!page.pinned && page.reasons.length === 0) continue;

    const audit = audits.get(page.key);
    const site = sitePagesByKey.get(page.key);
    rows.push({
      ...page,
      title: page.title ?? site?.title ?? null,
      sessions: page.sessions ?? site?.ga_sessions ?? null,
      citations: page.citations ?? site?.ai_citations ?? null,
      running: audit?.status === 'running',
      lastAudit:
        audit && audit.score !== null
          ? { at: audit.lastAuditedAt, score: audit.score, auditId: audit.auditId }
          : null,
    });
  }
  // Excluded pages the inbox no longer lists still show, to be put back.
  for (const pref of prefs) {
    if (pref.state === 'excluded' && !excluded.some((e) => e.key === pref.page_key)) {
      excluded.push({ key: pref.page_key, url: pref.url, path: pathOf(pref.url), title: null });
    }
  }

  rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.path.localeCompare(b.path));
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  return { rows, excluded };
}

/**
 * How much of the brand's site has a current audit (customer priorities
 * item 11): the site pages the inbox weighs, by the rules it lists them by
 * (excluded pages, checkout and legal paths and the brand's exclude
 * patterns left out unless pinned), each audited within `staleDays`, never
 * audited, or audited longer ago. `never` and `stale` are the inbox's
 * Never audited and Audited N days ago rows, so the Pages audited card and
 * the Not audited filter agree.
 *
 * @returns {{ pages: number, audited: number, never: number, stale: number }}
 */
export function siteCoverage({
  sitePages = [],
  auditPages = [],
  prefs = [],
  excludePatterns = [],
  staleDays,
  now = Date.now(),
}) {
  const excludedByPattern = excludePatternMatcher(excludePatterns);
  const audits = new Map(auditPages.map((p) => [p.key.toLowerCase(), p]));
  const prefsByKey = new Map(prefs.map((p) => [p.page_key, p]));
  const pinned = new Set(
    prefs.filter((p) => p.state === 'pinned').map((p) => opportunityKey(p.url)),
  );
  const staleBefore = now - staleDays * DAY_MS;
  const coverage = { pages: 0, audited: 0, never: 0, stale: 0 };
  const seen = new Set();
  for (const row of sitePages) {
    const key = opportunityKey(row.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (prefsByKey.get(key)?.state === 'excluded') continue;
    const path = pathOf(row.url);
    if (!pinned.has(key) && (isExcludedPath(path) || excludedByPattern(path))) continue;
    coverage.pages += 1;
    const audit = audits.get(key);
    if (!audit || audit.score === null) coverage.never += 1;
    else if (Date.parse(audit.lastAuditedAt) < staleBefore) coverage.stale += 1;
    else coverage.audited += 1;
  }
  return coverage;
}

/**
 * AI visits per page over the window, from ae_page_traffic_evidence: Google
 * Analytics where it has the page, else the tracking snippet, never both
 * added (the snippet counts the visits GA counts), as mergeTrafficPages does.
 *
 * @param {{ analytics?: Array<{ page: string, cur_sessions: number }>, snippet?: Array<{ page: string, cur_sessions: number }> }} evidence
 * @returns {Map<string, number>} by the page string the RPC was asked for
 */
export function aiVisitsByPage(evidence) {
  const sum = (rows) => {
    const totals = new Map();
    for (const r of rows ?? []) {
      if (!r.page) continue;
      totals.set(r.page, (totals.get(r.page) ?? 0) + Number(r.cur_sessions ?? 0));
    }
    return totals;
  };
  const visits = sum(evidence?.snippet);
  for (const [page, sessions] of sum(evidence?.analytics)) visits.set(page, sessions);
  return visits;
}
