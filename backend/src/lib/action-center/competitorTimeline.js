/**
 * A competitor's pages over time (learning C3).
 *
 * A competitor rising in AI answers had no "why" beside it. This keeps two
 * kinds of dated events for the competitor pages the brand's own tracked
 * answers cite (competitor_page_events, 00376):
 *
 *  - first_cited: the first day the brand's answers cited the page, read in
 *    the database from its citations (competitor_cited_urls): no page read.
 *    A competitor never read is read back `backfillDays` once
 *    (competitor_timeline_scans), so it is the first since then;
 *  - changed: a weekly re-read of the competitor pages the answers cite most
 *    found its words changed by more than a date or a price moving (the
 *    Action Center's page checks' rule, taskChecks.js), with the Site Audit
 *    checks it gained and lost.
 *
 * Pages are read as "Analyze competitor content" reads them
 * (competitorPages.js readPages): free, robots.txt respected, within the
 * brand's daily reads, after the night's tasks have read theirs. What is
 * kept of a read is what the checks found and a sketch of its words, never
 * its text. Nothing is compared across brands.
 */

import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/actionEngine.js';
import { isCloud, isSubscriptionActive } from '../../config/plans.js';
import { fetchPage } from '../safeFetch.js';
import { logger } from '../logger.js';
import { selectInChunks } from '../chunkedIn.js';
import { opportunityKey } from '../audit/opportunities.js';
import { describeSignal } from '../audit/rubric.js';
import { readPages } from './competitorPages.js';
import { FEATURE_CHECKS } from './pageFeatures.js';
import {
  CHANGED_BELOW,
  MIN_CHANGED_RUNS,
  SKETCH_VERSION,
  changedRuns,
  similarity,
} from './taskChecks.js';

const { competitorPages: CP, competitorTimeline: T } = resolve();

const DAY_MS = 86_400_000;
/** A night's sweep stops starting brands after this, as the brand facts sweep. */
const SWEEP_DEADLINE_MS = 10 * 60_000;
/** PostgREST's most rows a read returns (max_rows): a longer read goes page by page. */
const PAGE_ROWS = 1000;
/** Page keys per `in` filter: they are addresses, so fewer than ids fit a request's URL. */
const KEYS_PER_READ = 30;

/**
 * Every row of a read, past PostgREST's row cap: `build` makes the ordered
 * query, read a page of PAGE_ROWS at a time.
 */
async function allRows(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await build().range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_ROWS) return rows;
  }
}

/**
 * The cited competitor URLs as pages: one per page key (a URL's query left
 * out), its first citation the earliest of its URLs', its answers summed.
 *
 * @param {Array<{ url: string, domain: string, competitor_id: string,
 *   first_at: string, answers: number }>} rows
 */
export function citedCompetitorPages(rows) {
  const pages = new Map();
  for (const row of rows) {
    const key = row.url ? opportunityKey(row.url) : null;
    if (!key || !/^https?:\/\//i.test(row.url)) continue;
    const page = pages.get(key);
    if (!page) {
      pages.set(key, {
        key,
        url: row.url,
        domain: row.domain,
        competitorId: row.competitor_id,
        firstAt: row.first_at,
        answers: Number(row.answers ?? 0),
      });
      continue;
    }
    page.answers += Number(row.answers ?? 0);
    if (Date.parse(row.first_at) < Date.parse(page.firstAt)) page.firstAt = row.first_at;
  }
  return [...pages.values()];
}

/** A Site Audit check as an event keeps it: its key, and its name as the rubric gives it. */
const checkOf = (key) => ({ key, label: describeSignal(key)?.label ?? key });

/**
 * Whether a re-read page changed since the read before: its words by the
 * page checks' rule, and the Site Audit checks it gained and lost. Null when
 * there is no earlier sketch to compare (the first read), or it didn't.
 */
export function pageChange(before, sketch, checks) {
  const first = before?.sketch;
  if (
    !sketch ||
    !Array.isArray(first?.hashes) ||
    !Number.isFinite(first?.runs) ||
    first.v !== SKETCH_VERSION ||
    sketch.v !== SKETCH_VERSION
  ) {
    return null;
  }
  const j = similarity(first.hashes, sketch.hashes);
  if (j >= CHANGED_BELOW || changedRuns(first, sketch) < MIN_CHANGED_RUNS) return null;
  const was = before.features?.checks ?? {};
  const now = checks ?? {};
  return {
    similarity: Math.round(j * 100) / 100,
    gained: FEATURE_CHECKS.filter((key) => now[key] === 'pass' && was[key] !== 'pass').map(checkOf),
    lost: FEATURE_CHECKS.filter((key) => was[key] === 'pass' && now[key] !== 'pass').map(checkOf),
  };
}

async function citedUrls(brandId, since) {
  // A brand's 90 days back can cite more competitor addresses than a read returns.
  const rows = await allRows(() =>
    supabaseAdmin
      .rpc('competitor_cited_urls', { p_brand_id: brandId, p_since: since.toISOString() })
      .order('url')
      .order('competitor_id'),
  );
  return citedCompetitorPages(rows);
}

/**
 * Records the brand's competitor pages first cited since each competitor's
 * last read (`backfillDays` back for one never read), once each.
 */
export async function recordFirstCitations(brandId, now = new Date()) {
  const [competitorsRes, scansRes] = await Promise.all([
    supabaseAdmin.from('competitors').select('id').eq('brand_id', brandId),
    supabaseAdmin
      .from('competitor_timeline_scans')
      .select('competitor_id, scanned_at')
      .eq('brand_id', brandId),
  ]);
  for (const res of [competitorsRes, scansRes]) if (res.error) throw new Error(res.error.message);
  const competitorIds = (competitorsRes.data ?? []).map((row) => row.id);
  if (competitorIds.length === 0) return 0;
  const scanned = new Map((scansRes.data ?? []).map((row) => [row.competitor_id, row.scanned_at]));
  // A day's overlap with the last read: answers stamped late aren't missed.
  const sinceMs = Math.min(
    ...competitorIds.map((id) =>
      scanned.has(id)
        ? Date.parse(scanned.get(id)) - DAY_MS
        : now.getTime() - T.backfillDays * DAY_MS,
    ),
  );
  const pages = await citedUrls(brandId, new Date(sinceMs));

  let recorded = 0;
  if (pages.length > 0) {
    // Read in parts: hundreds of addresses in one filter pass a request's URL limit.
    const { data: known, error } = await selectInChunks(
      pages.map((page) => page.key),
      (keys) =>
        supabaseAdmin
          .from('competitor_page_events')
          .select('page_key')
          .eq('brand_id', brandId)
          .eq('kind', 'first_cited')
          .in('page_key', keys),
      KEYS_PER_READ,
    );
    if (error) throw new Error(error.message);
    const seen = new Set((known ?? []).map((row) => row.page_key));
    const fresh = pages.filter((page) => !seen.has(page.key));
    if (fresh.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('competitor_page_events').insert(
        fresh.map((page) => ({
          brand_id: brandId,
          competitor_id: page.competitorId,
          page_key: page.key,
          url: page.url,
          domain: page.domain,
          kind: 'first_cited',
          at: page.firstAt,
          detail: { answers: page.answers },
        })),
      );
      if (insertError) throw new Error(insertError.message);
      recorded = fresh.length;
    }
  }

  const { error: scanError } = await supabaseAdmin.from('competitor_timeline_scans').upsert(
    competitorIds.map((id) => ({
      competitor_id: id,
      brand_id: brandId,
      scanned_at: now.toISOString(),
    })),
    { onConflict: 'competitor_id' },
  );
  if (scanError) throw new Error(scanError.message);
  return recorded;
}

/**
 * Reads again the brand's competitor pages its answers cited most lately
 * whose last read is `rereadDays` old, as many as its reads left today
 * allow, and records those that changed.
 *
 * @param {string} brandId
 * @param {{ now?: Date, read?: typeof fetchPage }} [options] read: the page reader, for tests
 */
export async function recordPageChanges(brandId, { now = new Date(), read = fetchPage } = {}) {
  const cited = await citedUrls(brandId, new Date(now.getTime() - T.citedDays * DAY_MS));
  const top = cited
    .sort((a, b) => b.answers - a.answers || a.key.localeCompare(b.key))
    .slice(0, T.pagesPerBrand);
  if (top.length === 0) return 0;

  const [knownRes, todayRes] = await Promise.all([
    supabaseAdmin
      .from('cited_page_features')
      .select('page_key, read_at')
      .eq('brand_id', brandId)
      .in(
        'page_key',
        top.map((page) => page.key),
      ),
    supabaseAdmin
      .from('cited_page_features')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('read_at', `${now.toISOString().slice(0, 10)}T00:00:00.000Z`),
  ]);
  for (const res of [knownRes, todayRes]) if (res.error) throw new Error(res.error.message);
  const readAt = new Map((knownRes.data ?? []).map((row) => [row.page_key, row.read_at]));
  const staleBefore = now.getTime() - T.rereadDays * DAY_MS;
  const left = Math.max(0, CP.perBrandPerDay - (todayRes.count ?? 0));
  const pages = top
    .filter((page) => !readAt.has(page.key) || Date.parse(readAt.get(page.key)) < staleBefore)
    .slice(0, left)
    .map((page) => ({
      key: page.key,
      url: page.url,
      domain: page.domain,
      competitorId: page.competitorId,
    }));
  if (pages.length === 0) return 0;

  // Every page here is due, so none is reused as fresh.
  await readPages({ brandId, pages, now, read, freshDays: T.rereadDays });
  const changed = pages.flatMap((page) => {
    const change = pageChange(page.before, page.sketch, page.features?.checks);
    return change
      ? [
          {
            brand_id: brandId,
            competitor_id: page.competitorId,
            page_key: page.key,
            url: page.url,
            domain: page.domain,
            kind: 'changed',
            at: now.toISOString(),
            detail: change,
          },
        ]
      : [];
  });
  if (changed.length > 0) {
    const { error } = await supabaseAdmin.from('competitor_page_events').insert(changed);
    if (error) throw new Error(error.message);
  }
  return changed.length;
}

/**
 * The night's pass over the brands with competitors (on Cloud, those whose
 * organization's plan is active): their first citations, then their pages'
 * changes. A brand that fails is logged and the next one goes on.
 */
export async function sweepCompetitorTimeline({
  now = new Date(),
  limit = T.brandsPerNight,
  read = fetchPage,
} = {}) {
  // Every brand's competitors and reads, past the read's row cap.
  const rows = await allRows(() =>
    supabaseAdmin
      .from('competitors')
      .select('id, brand_id, brands!inner(organization_id, is_active, is_demo)')
      .eq('brands.is_active', true)
      // A demo brand's answers (00380) are sample data: none of its pages is read.
      .eq('brands.is_demo', false)
      .neq('domain', '')
      .order('id'),
  );
  const brands = new Map();
  for (const row of rows) brands.set(row.brand_id, row.brands.organization_id);
  // The brands read longest ago first, never read before them: past the
  // night's limit, the rest are first in line the next night.
  const scans = await allRows(() =>
    supabaseAdmin
      .from('competitor_timeline_scans')
      .select('competitor_id, brand_id, scanned_at')
      .order('competitor_id'),
  );
  const lastRead = new Map();
  for (const scan of scans) {
    const at = Date.parse(scan.scanned_at);
    if (!(at <= (lastRead.get(scan.brand_id) ?? -Infinity))) lastRead.set(scan.brand_id, at);
  }
  const order = [...brands.keys()].sort(
    (a, b) => (lastRead.get(a) ?? -Infinity) - (lastRead.get(b) ?? -Infinity),
  );

  let active = () => true;
  if (brands.size > 0 && isCloud()) {
    const { data: orgs, error: orgError } = await selectInChunks([...brands.values()], (ids) =>
      supabaseAdmin.from('organizations').select('id, subscription_status').in('id', ids),
    );
    if (orgError) throw new Error(orgError.message);
    const subscribed = new Set(
      (orgs ?? []).filter((o) => isSubscriptionActive(o.subscription_status)).map((o) => o.id),
    );
    active = (orgId) => subscribed.has(orgId);
  }

  const outcome = { brands: 0, firstCited: 0, changed: 0, failed: 0 };
  const started = Date.now();
  for (const brandId of order) {
    const orgId = brands.get(brandId);
    if (outcome.brands >= limit || Date.now() - started > SWEEP_DEADLINE_MS) break;
    if (!active(orgId)) continue;
    outcome.brands += 1;
    try {
      outcome.firstCited += await recordFirstCitations(brandId, now);
      outcome.changed += await recordPageChanges(brandId, { now, read });
    } catch (err) {
      outcome.failed += 1;
      logger.warn({ err, brandId }, '[competitor-timeline] brand failed');
    }
  }
  logger.info(outcome, '[competitor-timeline] sweep done');
  return outcome;
}
