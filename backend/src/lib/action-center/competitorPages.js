/**
 * What the pages AI answers cite have (learning C1).
 *
 * "Analyze competitor content" was a step for a person: nothing looked at the
 * pages AI engines cite instead of the brand's. This reads them: the pages
 * cited in the brand's own tracked answers for the action's prompts lately —
 * its competitors' pages, then pages cited in answers that don't name the
 * brand — and the brand's own page cited there. An action that names no
 * prompts reads its topics' prompts, else the brand's tracked ones. Each page
 * is fetched free (safe-fetch: public addresses only, never a paid scraper),
 * unless its site's robots.txt shuts the reader out, and run through Site
 * Audit's own rule checks that read the page alone — structure, FAQ, schema,
 * statistics, dates, length. What the checks found is kept
 * (cited_page_features, 00369), never the page's text, and nothing is
 * summarised by AI. The result is the checks at least half of the competitor
 * pages pass that the brand's page doesn't.
 *
 * Only addresses the brand's own answers cited are read — never one a request
 * names — at most `perBrandPerDay` new reads a day for a brand, and a page
 * read (or found unreadable) in the last `freshDays` isn't read again.
 */

import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/actionEngine.js';
import { fetchPage } from '../safeFetch.js';
import { extractHostname } from '../responseParser.js';
import { opportunityKey } from '../audit/opportunities.js';
import { robotsGroups } from '../audit/signals/trust.js';
import { logger } from '../logger.js';
import { topicPromptIds } from './basketMetrics.js';
import { promptIdsOf } from './priority.js';
import { FEATURE_CHECKS, featureGaps, pageFeatures } from './pageFeatures.js';
import { sketch as wordSketch, visibleText } from './taskChecks.js';

// The page checks live in pageFeatures.js, which reads no database; kept
// here for the imports that name this module.
export {
  FEATURE_CHECKS,
  MIN_PAGE_CHARACTERS,
  featureGaps,
  pageContext,
  pageFeatures,
} from './pageFeatures.js';

const { competitorPages: C } = resolve();

const DAY_MS = 86_400_000;
const READ_TIMEOUT_MS = 8_000;
/** Answers read for the action's prompts, newest first. */
const ANSWERS_READ = 300;
/** Prompts whose answers are read, at most. */
const PROMPTS_READ = 50;
/** safe-fetch's User-Agent, as robots.txt names a crawler. */
const ROBOTS_AGENT = 'getcitobot';
/** The most of a robots.txt read (RFC 9309 asks crawlers to read 500 KiB). */
const ROBOTS_MAX_BYTES = 512 * 1024;

/**
 * A run that leaves its task as it was (execution/run.js reads `retryLater`):
 * the brand's reads for the day can't cover it, so it waits for the next
 * night; or it found nothing to compare, so the task stays a person's, shows
 * `output` (why), and isn't tried again for `retryDays`.
 */
export class ReadLaterError extends Error {
  /**
   * @param {string} message
   * @param {{ output?: object | null, retryDays?: number }} [later]
   */
  constructor(message, { output = null, retryDays = 0 } = {}) {
    super(message);
    this.retryLater = true;
    this.output = output;
    this.retryDays = retryDays;
  }
}

const hostOf = (value) => extractHostname(/^https?:\/\//i.test(value) ? value : `https://${value}`);
const onDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/**
 * The pages to read from the answers: the competitors' most cited first, then
 * the most cited in answers that don't name the brand, at most `perAction`;
 * and the brand's own page most cited there (`yours`), with all its own pages
 * cited, the most cited first (`own`: learning C4's winning pages).
 *
 * @param {Array<{ mention_count?: number, citations?: Array<{ url?: string }> }>} answers
 * @param {{ ownDomains: string[], competitorDomains: string[], perAction?: number }} options
 */
export function citedPages(answers, { ownDomains, competitorDomains, perAction = C.perAction }) {
  const own = ownDomains.map(hostOf).filter(Boolean);
  const rivals = competitorDomains.map(hostOf).filter(Boolean);
  const tally = { own: new Map(), rival: new Map(), other: new Map() };
  for (const answer of answers) {
    const seen = new Set();
    for (const cite of answer.citations ?? []) {
      const url = typeof cite?.url === 'string' ? cite.url : null;
      const host = url ? hostOf(url) : null;
      const key = url ? opportunityKey(url) : null;
      if (!host || !key || seen.has(key) || !/^https?:\/\//i.test(url)) continue;
      seen.add(key);
      const group = own.some((d) => onDomain(host, d))
        ? tally.own
        : rivals.some((d) => onDomain(host, d))
          ? tally.rival
          : (answer.mention_count ?? 0) === 0
            ? tally.other
            : null;
      if (!group) continue;
      const known = group.get(key) ?? { key, url, domain: host, count: 0 };
      known.count += 1;
      group.set(key, known);
    }
  }
  const ranked = (map) =>
    [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const competitors = [...ranked(tally.rival), ...ranked(tally.other)].slice(0, perAction);
  const ownPages = ranked(tally.own);
  return { competitors, yours: ownPages[0] ?? null, own: ownPages };
}

const passing = (checks) => FEATURE_CHECKS.filter((key) => checks?.[key] === 'pass');

/**
 * Whether a site's robots.txt shuts this reader out of the whole site: the
 * groups naming it, else those for every crawler ('*'), disallow "/" and
 * none allows it back. Rules for single paths aren't read (robotsGroups).
 */
export function robotsDisallow(robotsTxt) {
  const groups = robotsGroups(robotsTxt);
  const own = groups.filter((group) => group.agents.includes(ROBOTS_AGENT));
  const apply = own.length > 0 ? own : groups.filter((group) => group.agents.includes('*'));
  return apply.some((group) => group.disallowAll) && !apply.some((group) => group.allowAll);
}

/** An HTML page served where robots.txt should be: no robots.txt. */
const isHtml = (body) => /^\s*(<!doctype\s+html|<html[\s>])/i.test(body ?? '');

/**
 * Whether the reader may read pages on the site at `url`. No robots.txt (a
 * 4xx) lets it in; one that can't be read (a server error, asked to wait,
 * no answer) keeps it out, as RFC 9309 asks.
 */
async function robotsAllow(url, read) {
  try {
    const robots = await read(new URL('/robots.txt', url).href, {
      timeoutMs: READ_TIMEOUT_MS,
      // Crawlers read it whatever its type (S3 serves it as octet-stream).
      types: /(?:)/,
      accept: 'text/plain',
      maxBytes: ROBOTS_MAX_BYTES,
      truncate: true,
    });
    return isHtml(robots.html) || !robotsDisallow(robots.html);
  } catch (err) {
    return err?.code === 'http_error' && err.status < 500 && err.status !== 429;
  }
}

/**
 * The prompts whose answers are read: the ones the action names; else its
 * topics' prompts; else (an action about competitors or sources) the brand's
 * tracked prompts. At most PROMPTS_READ.
 */
export async function scopePromptIds(brandId, payload) {
  const named = promptIdsOf([payload]);
  if (named.length > 0) return named.slice(0, PROMPTS_READ);
  if ((payload?.entity ?? payload?.targetEntity) === 'topics') {
    const listed = Array.isArray(payload.targetIds)
      ? payload.targetIds
      : (Array.isArray(payload.targets) ? payload.targets : []).map((target) => target?.id);
    const topicIds = [...new Set([payload.topicId, ...listed])].filter(
      (id) => typeof id === 'string' && id,
    );
    return (await topicPromptIds(brandId, topicIds)).slice(0, PROMPTS_READ);
  }
  const { data, error } = await supabaseAdmin
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(PROMPTS_READ);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.id);
}

/**
 * Each page's features, set on it as `features` when it could be read: one
 * read (or found unreadable) within `freshDays` is reused, the rest are read
 * now, unless their site's robots.txt shuts the reader out, and kept
 * (cited_page_features) with what the checks found and a sketch of its words
 * (learning C3), never the text. A page read now gets its new sketch as
 * `sketch`, and what the read before kept as `before` ({ features, sketch }).
 * All of the pages are read the same night, or none: ReadLaterError when the
 * brand's reads left today (`perBrandPerDay`, shared by every reader: C1's,
 * C4's and C3's weekly re-read) can't cover them.
 *
 * @param {{ brandId: string,
 *   pages: Array<{ key: string, url: string, domain: string, own?: boolean, features?: object,
 *     sketch?: object, before?: object }>,
 *   now: Date, read?: typeof fetchPage, freshDays?: number }} input
 */
export async function readPages({
  brandId,
  pages,
  now,
  read = fetchPage,
  freshDays = C.freshDays,
}) {
  if (pages.length === 0) return;
  const [knownRes, todayRes] = await Promise.all([
    supabaseAdmin
      .from('cited_page_features')
      .select('page_key, features, sketch, read_at')
      .eq('brand_id', brandId)
      .in(
        'page_key',
        pages.map((page) => page.key),
      ),
    supabaseAdmin
      .from('cited_page_features')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('read_at', `${now.toISOString().slice(0, 10)}T00:00:00.000Z`),
  ]);
  if (knownRes.error) throw new Error(knownRes.error.message);
  if (todayRes.error) throw new Error(todayRes.error.message);
  const freshSince = now.getTime() - freshDays * DAY_MS;
  const known = new Map((knownRes.data ?? []).map((row) => [row.page_key, row]));
  const fresh = new Map(
    (knownRes.data ?? [])
      .filter((row) => Date.parse(row.read_at) >= freshSince)
      .map((row) => [row.page_key, row.features ?? {}]),
  );
  // A run that read some would compare a part, and its task wouldn't run again.
  const toRead = pages.filter((page) => !fresh.has(page.key)).length;
  if (toRead > C.perBrandPerDay - (todayRes.count ?? 0)) {
    throw new ReadLaterError("the brand's page reads for today can't cover this action's");
  }

  const allowed = new Map();
  for (const page of pages) {
    if (fresh.has(page.key)) {
      const known = fresh.get(page.key);
      if (!known.unreadable) page.features = known;
      continue;
    }
    const before = known.get(page.key);
    if (before) page.before = { features: before.features ?? {}, sketch: before.sketch ?? null };
    let features = null;
    let sketched = null;
    let disallowed = false;
    try {
      const origin = new URL(page.url).origin;
      if (!allowed.has(origin)) allowed.set(origin, await robotsAllow(page.url, read));
      disallowed = !allowed.get(origin);
      if (!disallowed) {
        const fetched = await read(page.url, { timeoutMs: READ_TIMEOUT_MS });
        features = await pageFeatures(fetched.url, fetched.html, now.getTime());
        // Its words as the page checks measure a change: what changes by itself left out.
        if (features) sketched = wordSketch(visibleText(fetched.html, undefined, { steady: true }));
      }
    } catch {
      // A page that blocks the reader, or isn't one: unreadable, not a failure.
    }
    if (features) page.features = features;
    if (sketched) page.sketch = sketched;
    // An unreadable page is kept too: it counts against the day's reads and
    // isn't tried again while it would be fresh.
    const { error } = await supabaseAdmin.from('cited_page_features').upsert(
      {
        brand_id: brandId,
        page_key: page.key,
        url: page.url,
        domain: page.domain,
        own: Boolean(page.own),
        features: features ?? { unreadable: true, ...(disallowed ? { disallowed: true } : {}) },
        // An unreadable read keeps the last sketch, to compare the next one with.
        sketch: sketched ?? before?.sketch ?? null,
        read_at: now.toISOString(),
      },
      { onConflict: 'brand_id,page_key' },
    );
    if (error) {
      logger.warn({ err: error, brandId, page: page.key }, '[competitor-pages] read not kept');
    }
  }
}

/**
 * The "Analyze competitor content" task's result: the competitor pages read,
 * the brand's, and the checks the first pass that the second doesn't.
 *
 * It throws ReadLaterError when it can't give one: the day's reads left
 * can't cover the pages (the next night), or there is nothing to compare —
 * no prompts, no page cited, none readable (`retryDays`, the reason as the
 * task's output).
 *
 * @param {{ brandId: string, payload: object, now?: Date, read?: typeof fetchPage }} input
 *   read: the page reader, for tests
 */
export async function analyzeCompetitorPages({
  brandId,
  payload,
  now = new Date(),
  read = fetchPage,
}) {
  const nothing = (reason, message, found = {}) =>
    new ReadLaterError(message, {
      output: {
        competitorPages: [],
        yourPage: null,
        gaps: [],
        unreadable: 0,
        ...found,
        reason,
      },
      retryDays: C.retryDays,
    });

  const promptIds = await scopePromptIds(brandId, payload);
  if (promptIds.length === 0) throw nothing('no_prompts', 'no prompts to read the answers of');

  const since = new Date(now.getTime() - C.answersDays * DAY_MS).toISOString();
  const [answersRes, domainsRes, competitorsRes] = await Promise.all([
    supabaseAdmin
      .from('prompt_results')
      .select('mention_count, citations')
      .eq('brand_id', brandId)
      .neq('platform', 'chatgpt-shopping')
      .in('prompt_id', promptIds)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(ANSWERS_READ),
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
    supabaseAdmin.from('competitors').select('domain').eq('brand_id', brandId),
  ]);
  for (const res of [answersRes, domainsRes, competitorsRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const picked = citedPages(answersRes.data ?? [], {
    ownDomains: (domainsRes.data ?? []).map((row) => row.domain).filter(Boolean),
    competitorDomains: (competitorsRes.data ?? []).map((row) => row.domain).filter(Boolean),
  });
  if (picked.competitors.length === 0) {
    throw nothing('none_cited', 'no competitor page cited for these prompts lately');
  }

  const pages = [...picked.competitors, ...(picked.yours ? [{ ...picked.yours, own: true }] : [])];
  await readPages({ brandId, pages, now, read });

  const unreadable = pages.filter((page) => !page.features).length;
  const competitorPages = pages
    .filter((page) => !page.own && page.features)
    .map((page) => ({
      url: page.url,
      domain: page.domain,
      cited: page.count,
      words: page.features.words ?? null,
      checks: page.features.checks ?? {},
    }));
  const own = pages.find((page) => page.own);
  const yourPageStatus = !own ? 'not_cited' : own.features ? 'read' : 'unreadable';
  if (competitorPages.length === 0) {
    throw nothing('unreadable', 'no competitor page cited could be read', {
      yourPageStatus,
      unreadable,
    });
  }
  const yourPage = own?.features
    ? {
        url: own.url,
        cited: own.count,
        words: own.features.words ?? null,
        checks: own.features.checks ?? {},
      }
    : null;
  // The checks each passes, by key: what the task shows.
  const shown = ({ checks, ...page }) => ({ ...page, passes: passing(checks) });
  return {
    competitorPages: competitorPages.map(shown),
    yourPage: yourPage ? shown(yourPage) : null,
    yourPageStatus,
    gaps: featureGaps(competitorPages, yourPage),
    // Fewer pages than this, and nothing is compared (featureGaps).
    compared: competitorPages.length >= C.minPages,
    unreadable,
  };
}

/**
 * What the checks found on pages already read (learning C2), by page key,
 * for the brand: read in the last two `freshDays`, never read here. Improve
 * gives them to its model as seen evidence, not a guess.
 *
 * @returns {Promise<Map<string, { own: boolean, checks: Record<string, string> }>>}
 */
export async function storedFeatures(brandId, urls, now = new Date()) {
  const keys = [...new Set(urls.map((url) => opportunityKey(url)).filter(Boolean))];
  if (keys.length === 0) return new Map();
  const since = new Date(now.getTime() - 2 * C.freshDays * DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('cited_page_features')
    .select('page_key, own, features')
    .eq('brand_id', brandId)
    .in('page_key', keys)
    .gte('read_at', since);
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? [])
      // A page that couldn't be read leaves a row with nothing to tell.
      .filter((row) => !row.features?.unreadable && row.features?.checks)
      .map((row) => [row.page_key, { own: row.own === true, checks: row.features.checks }]),
  );
}
