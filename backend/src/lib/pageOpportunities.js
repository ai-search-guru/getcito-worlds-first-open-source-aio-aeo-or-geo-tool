/**
 * Page opportunity detection (#719, Phase 5).
 *
 * Answers two questions per brand: which pages carry commercial weight and
 * get nothing from AI engines, and — for each of those — why. The figures
 * come from `ga_page_ai_visibility`, which aggregates the tables the GA sync
 * (#704) writes and joins the brand's own citations, prompt targeting and
 * tracking-snippet visits to them. No model runs in this path and no page is
 * fetched.
 *
 * The ranking signal is chosen from what the property actually reports rather
 * than assumed. A shop with ecommerce ranks on money; a site with no
 * conversion events at all ranks on engagement. The signal used is stored on
 * every finding, because a surface that calls an engagement rank "your most
 * valuable page" is making a true statement about the wrong thing.
 *
 * Ranking and the exclusion list stay here rather than moving into SQL with
 * the aggregation: `isExcludedPath` is shared with the prompt suggestion
 * generator (#705), and a second copy of it in the RPC would drift from this
 * one the first time either is extended. The cost is that every page travels,
 * which is what the paginated read below exists to survive.
 *
 * Deliberately not here: LLM enrichment, clustering, and the acted-on half of
 * the opportunity lifecycle. Those need more volume than one connected
 * property produces, and a finding nobody can verify is worse than one that
 * is merely narrow.
 */

import supabaseAdmin from '../config/supabase.js';
import { activeOrgFilter } from './activeSubscriptions.js';
import { isExcludedPath } from './pagePaths.js';
import { logger } from './logger.js';
import { resolve } from '../config/actionEngine.js';

// Thresholds live in config/actionEngine.js (#818 phase 2.5).
const { detection } = resolve();

const WINDOW_DAYS = detection.pageWindowDays;

/**
 * A page below this has too little behind it for a finding, whatever its
 * percentile. This is what stops the engine from producing a constant
 * fraction of every site: a percentile alone always qualifies the same share
 * of pages, so a brand with genuinely little to fix would still be handed a
 * full list.
 */
const MIN_SESSIONS = detection.pageMinSessions;

/** How far up its own site a page must rank before it is worth raising. */
const MIN_PERCENTILE = detection.pageMinPercentile;

/**
 * PostgREST returns at most 1000 rows per request whatever range is asked
 * for, so the read is paged rather than trusted to come back whole.
 *
 * This is the #427/#450/#464 trap, and detection was standing on it: it read
 * 28 days of `ga_page_stats` un-paginated, and ga-sync keeps up to 5000 pages
 * per day. Truncation there does not merely lose findings — the AI-traffic
 * half truncates too, and a page missing from that lookup is raised as
 * receiving no AI traffic when it received some. Today's only property
 * produces 743 rows and fits under the cap, which is the only reason nothing
 * has gone wrong yet.
 */
const READ_PAGE_SIZE = 1000;

/**
 * Stop after this many pages of rows. A site large enough to reach it has
 * something wrong with it, and the run is logged rather than left to walk a
 * table for minutes — but it is logged, not silently trimmed, because a
 * ranking computed over part of a site is exactly the failure above.
 */
const MAX_READ_PAGES = 50;

/**
 * Ranking signals in order of how directly they express commercial value.
 * The first one the property actually reports wins.
 */
const VALUE_SIGNALS = [
  { name: 'revenue', of: (p) => p.revenue },
  { name: 'transactions', of: (p) => p.transactions },
  { name: 'key_events', of: (p) => p.keyEvents },
  { name: 'engagement', of: (p) => p.engagementSeconds },
];

/**
 * The strongest signal this brand's property reports.
 *
 * Falls back to engagement, which every property has: without it a site with
 * no ecommerce and no configured key events would produce no findings at all,
 * and "nobody has set up conversion tracking" is not a reason to tell a
 * customer there is nothing to look at.
 */
export function pickValueSignal(pages) {
  for (const signal of VALUE_SIGNALS) {
    if ((pages ?? []).some((page) => (signal.of(page) ?? 0) > 0)) return signal.name;
  }
  return 'engagement';
}

function signalValue(page, signalName) {
  const signal = VALUE_SIGNALS.find((s) => s.name === signalName);
  return signal ? (signal.of(page) ?? 0) : 0;
}

/**
 * Why a page that earns gets nothing from AI engines.
 *
 * Three states, because they need three different actions and lumping them
 * together points two thirds of the customers at the wrong fix:
 *
 *   cited              answers do cite this page and it still earns no visit
 *   targeted_not_cited a prompt points here and no answer cites it
 *   not_targeted       nothing we track points here at all
 *
 * The last one is a coverage gap, and on a large site it is the common case:
 * URL-level AI visibility exists for a three-digit number of pages, so
 * "invisible" is the default state rather than a discovery. Saying which kind
 * of invisible is the whole value of the classification.
 *
 * `targeted` means a prompt carries this URL as a target (#642), not that a
 * prompt covers the page's topic — that is not something arithmetic can
 * decide, and inventing it would put a made-up reason on a finding.
 */
export function classifyCitationState({ citations = 0, targetingPrompts = 0 } = {}) {
  if (citations > 0) return 'cited';
  if (targetingPrompts > 0) return 'targeted_not_cited';
  return 'not_targeted';
}

/**
 * Rank pages within their own site, so a small B2B site and a large shop are
 * judged on the same scale.
 *
 * Percentile is the share of the brand's own pages this one beats, which
 * makes 100 the top page rather than an unreachable ceiling. Ties share a
 * percentile — two pages with identical revenue should not be separated by
 * whichever happened to sort first.
 */
export function scorePages(pages, signalName) {
  const values = (pages ?? []).map((page) => signalValue(page, signalName));
  const total = values.length;

  const ranked = (pages ?? [])
    .map((page, i) => ({ page, value: values[i] }))
    .sort((a, b) => b.value - a.value || b.page.sessions - a.page.sessions);

  return ranked.map((entry, index) => ({
    ...entry.page,
    valueSignal: signalName,
    value: entry.value,
    valueRank: index + 1,
    valuePercentile:
      total <= 1
        ? 100
        : Math.round((values.filter((v) => v < entry.value).length / total) * 1000) / 10,
  }));
}

/**
 * Findings for one brand's pages.
 *
 * A page qualifies when it ranks high on its site AND clears the absolute
 * floors — both conditions, because either alone misreports. The percentile
 * without a floor hands every site the same number of findings; the floor
 * without a percentile buries a small site's best page under a large one's
 * long tail.
 *
 * The citation state explains a finding, it does not gate one: a page cited
 * 104 times that still earns no AI visit is as real a problem as one nothing
 * points to, and dropping it would hide the more surprising of the two.
 *
 * An AI visit is one either source saw: Analytics' AI channel or the
 * tracking snippet (AT-002). Analytics alone missed visits the snippet
 * recorded, so a page the AI Traffic page listed Gemini visitors on could be
 * raised as getting nothing from AI in the same week.
 */
export function detectPageOpportunities({ pages, windowDays = WINDOW_DAYS }) {
  const signal = pickValueSignal(pages);
  const scored = scorePages(pages, signal);

  return scored
    .filter((page) => page.sessions >= MIN_SESSIONS)
    .filter((page) => page.value > 0)
    .filter((page) => page.valuePercentile >= MIN_PERCENTILE)
    .filter((page) => !(page.aiSessions > 0) && !(page.snippetVisits > 0))
    .map((page) => ({
      landing_page: page.landingPage,
      kind: 'no_ai_traffic',
      value_signal: page.valueSignal,
      value_percentile: page.valuePercentile,
      value_rank: page.valueRank,
      sessions: page.sessions,
      engaged_sessions: page.engagedSessions,
      key_events: page.keyEvents,
      transactions: page.transactions,
      revenue: page.revenue,
      engagement_seconds: page.engagementSeconds,
      ai_sessions: 0,
      ai_platforms: [],
      citation_state: classifyCitationState(page),
      citations: page.citations ?? 0,
      citing_prompts: page.citingPrompts ?? 0,
      targeting_prompts: page.targetingPrompts ?? 0,
      window_days: windowDays,
    }));
}

/**
 * RPC rows in the shape the scoring above reads.
 *
 * Excluded paths are dropped here rather than after ranking, so they are out
 * of the denominator too: /checkout carries a shop's revenue, and leaving it
 * in the population would push every real page's percentile down.
 */
export function mapVisibilityRows(rows) {
  return (rows ?? [])
    .filter((row) => !isExcludedPath(row.landing_page ?? ''))
    .map((row) => ({
      landingPage: row.landing_page ?? '',
      sessions: Number(row.sessions) || 0,
      engagedSessions: Number(row.engaged_sessions) || 0,
      keyEvents: Number(row.key_events) || 0,
      transactions: Number(row.transactions) || 0,
      revenue: Number(row.revenue) || 0,
      engagementSeconds: Number(row.engagement_seconds) || 0,
      aiSessions: Number(row.ai_sessions) || 0,
      aiPlatforms: row.ai_platforms ?? [],
      citations: Number(row.citations) || 0,
      citingPrompts: Number(row.citing_prompts) || 0,
      targetingPrompts: Number(row.targeting_prompts) || 0,
      snippetVisits: Number(row.snippet_visits) || 0,
    }));
}

/**
 * Every page of the brand's window, read a thousand rows at a time. Both
 * bounds are inclusive dates (YYYY-MM-DD); null leaves that end open.
 *
 * Ordered by landing page rather than left to the planner: `range` without an
 * order is a promise the database never made, and two requests could return
 * the same row twice while another is never seen at all.
 */
async function readVisibilityRows(brandId, since, until = null) {
  const rows = [];

  for (let page = 0; page < MAX_READ_PAGES; page++) {
    const from = page * READ_PAGE_SIZE;
    const { data, error } = await supabaseAdmin
      .rpc('ga_page_ai_visibility', { p_brand_id: brandId, p_since: since, p_until: until })
      .order('landing_page', { ascending: true })
      .range(from, from + READ_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < READ_PAGE_SIZE) return rows;
  }

  logger.warn(
    { brandId, read: rows.length },
    '[page-opportunities] page limit reached; ranking covers only what was read',
  );
  return rows;
}

async function detectForBrand(brandId) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  const pages = mapVisibilityRows(await readVisibilityRows(brandId, since));
  if (!pages.length) return { found: 0, resolved: 0 };

  const findings = detectPageOpportunities({ pages });

  const now = new Date().toISOString();
  if (findings.length > 0) {
    // first_detected_at is left to the column default so it survives the
    // upsert: a finding that has been open for a week should say so, not
    // reset its age every night.
    const { error } = await supabaseAdmin.from('page_opportunities').upsert(
      findings.map((f) => ({ ...f, brand_id: brandId, last_detected_at: now, resolved_at: null })),
      { onConflict: 'brand_id,landing_page,kind' },
    );
    if (error) throw new Error(error.message);
  }

  // Anything still open that this run did not touch no longer qualifies — the
  // page picked up AI traffic, lost its standing, or fell below the floors.
  // Stamped rather than deleted so a surface can show that something improved
  // instead of the row quietly disappearing.
  //
  // Selected by the timestamp the upsert above just wrote, not by excluding a
  // list of paths: a `not.in.(...)` filter has to be built as a string, and a
  // landing page containing a comma or a quote would silently change which
  // rows it matched.
  const { error: resolveErr } = await supabaseAdmin
    .from('page_opportunities')
    .update({ resolved_at: now })
    .eq('brand_id', brandId)
    .is('resolved_at', null)
    .lt('last_detected_at', now);
  if (resolveErr) throw new Error(resolveErr.message);

  return {
    found: findings.length,
    signal: findings[0]?.value_signal ?? null,
    cited: findings.filter((f) => f.citation_state === 'cited').length,
  };
}

/**
 * Findings for the range the AI Traffic page shows, computed on request
 * (AT-002). The page used to list the nightly 28-day findings whatever range
 * it showed; ranking the page's own range means the list can't disagree
 * with the visits beside it.
 *
 * Nothing is written. The nightly findings stay the engine's record — Action
 * Center and Site Audit read them — and a range someone looked at is not a
 * finding to open or resolve. `pages` is how many pages Analytics reported
 * in the range, so the page can tell "nothing qualifies" from "no data".
 */
export async function detectPageOpportunitiesInWindow(
  brandId,
  { since = null, until = null, limit = 10 } = {},
) {
  const pages = mapVisibilityRows(await readVisibilityRows(brandId, since, until));
  // window_days describes the nightly run's fixed window; a page range has
  // its own bounds, which the caller already holds.
  const findings = detectPageOpportunities({ pages, windowDays: null });
  return { pages: pages.length, findings: findings.slice(0, limit) };
}

/**
 * Detect for every brand with synced GA data, on an active subscription;
 * optionally scoped to one organization. Per-brand failures are logged and
 * skipped.
 */
export async function runPageOpportunityDetection({ organizationId } = {}) {
  let brandQuery = supabaseAdmin
    .from('brands')
    .select('id, organization_id')
    .eq('is_active', true)
    // A demo brand's pages (00380) are sample data: nothing is found for it.
    .eq('is_demo', false)
    .not('ga_property_id', 'is', null);
  if (organizationId) brandQuery = brandQuery.eq('organization_id', organizationId);
  const { data: rows, error } = await brandQuery;
  if (error) throw new Error(error.message);
  // Once the plan has ended, nothing new is found for the organization.
  const isActive = await activeOrgFilter((rows ?? []).map((b) => b.organization_id));
  const brands = (rows ?? []).filter((b) => isActive(b.organization_id));
  if (!brands.length) return { scanned: 0, results: [] };

  const results = [];
  for (const brand of brands) {
    try {
      const outcome = await detectForBrand(brand.id);
      results.push({ brandId: brand.id, ...outcome });
    } catch (err) {
      logger.error({ err, brandId: brand.id }, '[page-opportunities] detection failed');
      results.push({ brandId: brand.id, error: err.message });
    }
  }

  logger.info({ scanned: brands.length }, '[page-opportunities] detection completed');
  return { scanned: brands.length, results };
}
