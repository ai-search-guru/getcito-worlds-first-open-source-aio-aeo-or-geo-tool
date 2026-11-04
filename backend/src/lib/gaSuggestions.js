/**
 * Analytics-fed suggestion candidates (#705).
 *
 * Search Console answers "what are people typing into a search box". The
 * traffic pipeline (#704) answers two questions it structurally cannot:
 *
 *   revenue_blind_spot  pages that earn money and no tracked prompt would surface
 *   ai_momentum         pages an AI engine already sends visitors to
 *
 * The first finds what is missing, the second finds what is already working.
 * Everything up to the LLM handoff is deterministic: SQL aggregation →
 * page-scope exclusion → ranking → page read → coverage filter. Any
 * failure returns [] so the base suggestion flow never degrades, and brands
 * without synced traffic short-circuit on the first (empty) query.
 */

import * as cheerio from 'cheerio';
import supabaseAdmin from '../config/supabase.js';
import { fetchViaScrapeDo } from './audit/fetcher.js';
import { isCoveredByPrompts } from './gscSuggestions.js';
import { isExcludedPath } from './pagePaths.js';
import { logger } from './logger.js';

const WINDOW_DAYS = 28;
/** Candidates handed to the model. Deliberately small — each one is a page read. */
export const MAX_CANDIDATES = 8;
/**
 * Pages ranked before the coverage filter runs. Reading a page costs a proxy
 * credit, so the filter runs on a shortlist rather than on everything, and the
 * headroom absorbs the ones that turn out to be already covered.
 */
const SHORTLIST = 14;
/** Page reads in flight at once. */
const READ_CONCURRENCY = 4;
/** Below this a page has too little behind it to argue from. */
const MIN_SESSIONS = 5;
const MIN_AI_SESSIONS = 3;

/** Sum the per-day rows of one table into one row per landing page. */
export function aggregateByPage(rows, fields) {
  const byPage = new Map();
  for (const row of rows || []) {
    const page = row.landing_page ?? '';
    if (isExcludedPath(page)) continue;
    const acc = byPage.get(page) ?? { landing_page: page };
    for (const field of fields) acc[field] = (acc[field] ?? 0) + (Number(row[field]) || 0);
    byPage.set(page, acc);
  }
  return [...byPage.values()];
}

/** Platform names seen referring traffic to each page, busiest first. */
export function aiPlatformsByPage(rows) {
  const byPage = new Map();
  for (const row of rows || []) {
    const page = row.landing_page ?? '';
    const platform = row.platform;
    if (!platform) continue;
    const acc = byPage.get(page) ?? new Map();
    acc.set(platform, (acc.get(platform) ?? 0) + (Number(row.sessions) || 0));
    byPage.set(page, acc);
  }
  return new Map(
    [...byPage].map(([page, platforms]) => [
      page,
      [...platforms].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    ]),
  );
}

/**
 * Rank and interleave the two signals into one candidate list.
 *
 * Interleaved rather than concatenated: taking the top N of a combined sort
 * would let a shop with real revenue crowd out every momentum candidate, and
 * a brand with no ecommerce would produce nothing from the revenue side at
 * all. Alternating keeps both questions represented whatever the property
 * reports.
 *
 * Revenue ranks on money where the property has it and on key events where it
 * does not, which is what makes this work without ecommerce tracking.
 */
export function composeGaCandidates({
  pageRows,
  aiRows,
  excludedPages = new Set(),
  limit = SHORTLIST,
}) {
  const pages = aggregateByPage(pageRows, [
    'sessions',
    'key_events',
    'transactions',
    'purchase_revenue',
  ]);
  const ai = aggregateByPage(aiRows, ['sessions']);
  const platforms = aiPlatformsByPage(aiRows);
  const pageBySlug = new Map(pages.map((p) => [p.landing_page, p]));

  const excluded = (page) => excludedPages.has(page);

  const revenue = pages
    .filter((p) => !excluded(p.landing_page))
    .filter((p) => p.purchase_revenue > 0 || p.transactions > 0 || p.key_events > 0)
    .filter((p) => p.sessions >= MIN_SESSIONS)
    .sort(
      (a, b) =>
        b.purchase_revenue - a.purchase_revenue ||
        b.transactions - a.transactions ||
        b.key_events - a.key_events ||
        b.sessions - a.sessions,
    )
    .map((p, i) => ({
      landingPage: p.landing_page,
      kind: 'revenue_blind_spot',
      rank: i + 1,
      sessions: p.sessions,
      keyEvents: p.key_events,
      transactions: p.transactions,
      revenue: Math.round(p.purchase_revenue * 100) / 100,
      aiSessions: ai.find((a) => a.landing_page === p.landing_page)?.sessions ?? 0,
      aiPlatforms: platforms.get(p.landing_page) ?? [],
    }));

  const momentum = ai
    .filter((a) => !excluded(a.landing_page))
    .filter((a) => a.sessions >= MIN_AI_SESSIONS)
    .sort((a, b) => b.sessions - a.sessions)
    .map((a, i) => {
      const page = pageBySlug.get(a.landing_page);
      return {
        landingPage: a.landing_page,
        kind: 'ai_momentum',
        rank: i + 1,
        sessions: page?.sessions ?? 0,
        keyEvents: page?.key_events ?? 0,
        transactions: page?.transactions ?? 0,
        revenue: Math.round((page?.purchase_revenue ?? 0) * 100) / 100,
        aiSessions: a.sessions,
        aiPlatforms: platforms.get(a.landing_page) ?? [],
      };
    });

  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < limit && (i < revenue.length || i < momentum.length); i++) {
    for (const candidate of [revenue[i], momentum[i]]) {
      if (!candidate || seen.has(candidate.landingPage) || out.length >= limit) continue;
      seen.add(candidate.landingPage);
      out.push(candidate);
    }
  }
  return out;
}

/** Absolute URL for a landing-page path on the brand's own domain. */
export function toAbsoluteUrl(domain, path) {
  const host = String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!host) return null;
  const suffix = String(path || '/');
  return `https://${host}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

/**
 * What the page is about, in the words of the page itself.
 *
 * This is the step that makes the suggestions usable. A URL slug or a product
 * name is usually an SKU nobody asks an AI about; the answerable question
 * lives at the category and need level, and reading the page is how we get
 * there — which is also why this works with no product catalogue at all.
 */
export function extractPageSummary(html) {
  const $ = cheerio.load(html || '');
  const clean = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  const headings = $('h2, h3')
    .slice(0, 6)
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);

  return {
    title: clean($('title').first().text()) || null,
    description:
      clean($('meta[name="description"]').attr('content')) ||
      clean($('meta[property="og:description"]').attr('content')) ||
      null,
    h1: clean($('h1').first().text()) || null,
    headings,
  };
}

/** The page's own words, as one string for the coverage check and the model. */
export function summaryText(summary) {
  return [summary?.title, summary?.h1, summary?.description, ...(summary?.headings ?? [])]
    .filter(Boolean)
    .join(' — ');
}

/** A page's summary, read through Scrape.do; null when it can't be read. */
export async function readPage(url) {
  try {
    const res = await fetchViaScrapeDo(url, { render: false, retries: 0 });
    if (!res.ok || !res.html) return null;
    return extractPageSummary(res.html);
  } catch {
    return null;
  }
}

/** Landing pages behind recently dismissed GA suggestions stay off the table. */
async function recentlyDismissedPages(brandId) {
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from('prompt_suggestions')
    .select('source_data')
    .eq('brand_id', brandId)
    .eq('source', 'ga')
    .eq('status', 'dismissed')
    .gte('updated_at', cutoff);
  return new Set((data || []).map((d) => d.source_data?.landingPage).filter(Boolean));
}

/**
 * Candidate list for the suggestion generator. Empty array (never a throw) for
 * brands without synced traffic or on any upstream failure.
 */
export async function getGaSuggestionCandidates(brandId, existingPromptTexts) {
  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

    const [{ data: pageRows, error: pageErr }, { data: aiRows, error: aiErr }] = await Promise.all([
      supabaseAdmin
        .from('ga_page_stats')
        .select('landing_page, sessions, key_events, transactions, purchase_revenue')
        .eq('brand_id', brandId)
        .gte('date', since),
      supabaseAdmin
        .from('ga_ai_traffic_stats')
        .select('landing_page, platform, sessions')
        .eq('brand_id', brandId)
        .gte('date', since),
    ]);
    if (pageErr) throw new Error(pageErr.message);
    if (aiErr) throw new Error(aiErr.message);
    if (!pageRows?.length && !aiRows?.length) return [];

    const excludedPages = await recentlyDismissedPages(brandId);
    const shortlist = composeGaCandidates({ pageRows, aiRows, excludedPages });
    if (shortlist.length === 0) return [];

    // Reading the page needs a domain to resolve the path against; without one
    // there is nothing to read and a slug-derived suggestion is exactly what
    // this generator exists to avoid.
    const { data: domains } = await supabaseAdmin
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', brandId)
      .limit(1);
    const domain = domains?.[0]?.domain;
    if (!domain) return [];

    const withSummaries = [];
    for (let i = 0; i < shortlist.length; i += READ_CONCURRENCY) {
      if (withSummaries.length >= MAX_CANDIDATES) break;
      const batch = shortlist.slice(i, i + READ_CONCURRENCY);
      const summaries = await Promise.all(
        batch.map((c) => readPage(toAbsoluteUrl(domain, c.landingPage))),
      );
      batch.forEach((candidate, j) => {
        const summary = summaries[j];
        const text = summaryText(summary);
        // A page we could not read, or one already covered by a tracked
        // prompt, is dropped rather than passed on with a slug for the model
        // to guess from.
        if (!text || isCoveredByPrompts(text, existingPromptTexts)) return;
        withSummaries.push({ ...candidate, page: summary, pageText: text });
      });
    }

    return withSummaries.slice(0, MAX_CANDIDATES);
  } catch (err) {
    logger.error({ err, brandId }, '[ga-suggestions] candidate mining failed');
    return [];
  }
}
