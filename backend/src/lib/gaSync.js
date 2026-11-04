/**
 * Daily Google Analytics sync (#704).
 *
 * For every active brand mapped to a GA4 property (#694) whose connection is
 * live (the Google sign-in it uses, lib/brandIntegrations.js), pulls four
 * reports through Composio and upserts them:
 *
 *   ga_ai_traffic_stats  AI-sourced sessions per landing page
 *   ga_channel_stats     sessions per default channel group (AT-005)
 *   ga_page_stats        landing-page totals across every source
 *   ga_item_stats        product rows, when the property has ecommerce
 *
 * Parameters are fully deterministic — no LLM anywhere in this path. Per-brand
 * failures are logged and skipped; one broken property never aborts the run.
 *
 * Unlike Search Console, GA4 has no multi-day reporting lag, so there is no
 * fixed offset to wait out. It does revise recent figures, which is why every
 * run rewrites the last few days rather than only appending yesterday.
 */

import supabaseAdmin from '../config/supabase.js';
import { activeOrgFilter } from './activeSubscriptions.js';
import { composioTarget, connectedBrands } from './brandIntegrations.js';
import { selectInChunks } from './chunkedIn.js';
import { isComposioConfigured, runGaReport } from './composio.js';
import { AI_SOURCES_VERSION, classifyAiSurface } from './aiSources.js';
import {
  GA_AI_ASSISTANT_CHANNEL,
  GA_AI_SOURCE_PATTERN,
  classifyGaSource,
  gaAiPlatform,
} from './gaSources.js';
import { logger } from './logger.js';

const GA = 'google-analytics';

/** First sync pulls this much history; later runs only refresh the tail. */
const BACKFILL_DAYS = 90;
/** GA4 revises recent data, so each run rewrites this many days. */
const REFRESH_DAYS = 3;
const UPSERT_CHUNK = 500;
/**
 * Long enough for year-over-year comparisons once a surface wants them, while
 * still bounding growth.
 */
const RETENTION_DAYS = 400;

/**
 * Pages kept per day. A large shop can have tens of thousands of pages taking
 * traffic daily; storing all of them would mean millions of rows per brand,
 * almost all of it single-session noise that no ranking of commercial value
 * would surface. The ordering below makes the cut safe rather than arbitrary.
 */
const PAGE_DAILY_LIMIT = 5000;
/** Same reasoning for a catalogue with tens of thousands of SKUs. */
const ITEM_DAILY_LIMIT = 5000;
/** Days fetched at once during a backfill. GA4 allows 10 concurrent requests. */
const DAY_CONCURRENCY = 4;

/**
 * Order pages so the daily ceiling can never drop a page that earns money.
 *
 * Sorting by sessions alone would cut a page with three sessions and two
 * purchases the moment five thousand busier pages exist — and that page is
 * precisely the one worth finding. Transactions rank first, then other key
 * events, and only then volume.
 */
const PAGE_ORDER = [
  { desc: true, metric: { metricName: 'transactions' } },
  { desc: true, metric: { metricName: 'keyEvents' } },
  { desc: true, metric: { metricName: 'sessions' } },
];

/** Same guarantee for products: whatever sold outranks whatever was browsed. */
const ITEM_ORDER = [
  { desc: true, metric: { metricName: 'itemsPurchased' } },
  { desc: true, metric: { metricName: 'itemsViewed' } },
];

const TRAFFIC_METRICS = [
  'sessions',
  'engagedSessions',
  'keyEvents',
  // The share of sessions with a key event (AT-005): key events alone can't
  // give a rate, as one session can hold several.
  'sessionKeyEventRate',
  'totalUsers',
  'transactions',
  'purchaseRevenue',
  'userEngagementDuration',
];

const ITEM_METRICS = ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue'];

/** YYYY-MM-DD in UTC, `daysAgo` days before now. */
export function utcDateString(daysAgo = 0) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/** GA4 returns dates as "20260721"; storage wants "2026-07-21". */
export function gaDateToIso(raw) {
  const value = String(raw ?? '');
  if (!/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function toFloat(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Rows as `{ dimensionName: value, metricName: value }` objects.
 *
 * Reading by header name rather than by position: GA4 is documented to echo
 * the requested order, but a silently reordered response would otherwise
 * write sessions into the revenue column, and nothing downstream could tell.
 */
export function readReportRows(report) {
  const dimNames = (report?.dimensionHeaders ?? []).map((h) => h.name);
  const metricNames = (report?.metricHeaders ?? []).map((h) => h.name);

  return (report?.rows ?? []).map((row) => {
    const out = {};
    (row.dimensionValues ?? []).forEach((v, i) => {
      if (dimNames[i]) out[dimNames[i]] = v?.value ?? '';
    });
    (row.metricValues ?? []).forEach((v, i) => {
      if (metricNames[i]) out[metricNames[i]] = v?.value ?? '0';
    });
    return out;
  });
}

function trafficMetricColumns(row) {
  const sessions = toInt(row.sessions);
  return {
    sessions,
    engaged_sessions: toInt(row.engagedSessions),
    key_events: toInt(row.keyEvents),
    // A count rather than GA4's rate, so rows can be summed and a rate taken
    // over any range: sessions with a key event ÷ sessions.
    key_event_sessions: Math.round(toFloat(row.sessionKeyEventRate) * sessions),
    total_users: toInt(row.totalUsers),
    transactions: toInt(row.transactions),
    purchase_revenue: toFloat(row.purchaseRevenue),
    engagement_duration_seconds: toInt(row.userEngagementDuration),
  };
}

const SUMMED_COLUMNS = [
  'sessions',
  'engaged_sessions',
  'key_events',
  'key_event_sessions',
  'total_users',
  'transactions',
  'purchase_revenue',
  'engagement_duration_seconds',
];

/**
 * AI-sourced rows → ga_ai_traffic_stats. Rows without a date are dropped.
 *
 * The report is split by channel too, to know which sessions GA4 itself
 * calls AI (AT-004), so one source can come back twice for a page and day —
 * as a referral and as an AI Assistant session. Storage keeps one row per
 * (date, source, medium, entry URL), so those are summed into it: the same
 * visits GA4 would report without the channel, never counted twice.
 *
 * The session medium is kept apart (00251): ChatGPT's sessions with medium
 * feed came through a ChatGPT Shopping product card (#1283), so the row
 * carries that surface too. It stays a ChatGPT row.
 */
export function mapAiTrafficRows(brandId, report) {
  const byKey = new Map();
  for (const row of readReportRows(report)) {
    const date = gaDateToIso(row.date);
    if (!date) continue;
    const source = row.sessionSource ?? '';
    const medium = row.sessionMedium ?? '';
    const landingPageQuery = row.landingPagePlusQueryString ?? '';
    const metrics = trafficMetricColumns(row);
    const key = `${date}|${source}|${medium}|${landingPageQuery}`;
    const seen = byKey.get(key);
    if (seen) {
      for (const column of SUMMED_COLUMNS) seen[column] += metrics[column];
      // Known to GA4's channel on either row is enough to name it.
      seen.platform ??= gaAiPlatform(source, row.sessionDefaultChannelGroup);
      continue;
    }
    byKey.set(key, {
      brand_id: brandId,
      date,
      source,
      platform: gaAiPlatform(source, row.sessionDefaultChannelGroup),
      medium,
      // Path for joining the page totals, full URL for attribution.
      landing_page: row.landingPage ?? '',
      landing_page_query: landingPageQuery,
      ...metrics,
      // The AI source list that counted this row (ai-sources.json).
      source_list_version: AI_SOURCES_VERSION,
    });
  }
  // Once each row's platform is settled: a surface belongs to a platform.
  return [...byKey.values()].map((row) => ({
    ...row,
    surface: classifyAiSurface(row.platform, row.medium),
  }));
}

/**
 * Rows synced before the sync read the session medium (00251) have none, and
 * the medium is part of a row's key, so a re-read stores its rows beside
 * them rather than over them. Once the AI report has re-read the days from
 * `from` to `to`, their rows without a medium go: the report's replace them.
 * The daily run re-reads the last few days; the history backfill
 * (backfillGaAiHistory.js) the rest.
 */
export async function deleteRowsWithoutMedium(brandId, { from, to }) {
  const { error } = await supabaseAdmin
    .from('ga_ai_traffic_stats')
    .delete()
    .eq('brand_id', brandId)
    .is('medium', null)
    .gte('date', from)
    .lte('date', to);
  if (error) throw new Error(`Delete from ga_ai_traffic_stats failed: ${error.message}`);
}

/** Landing-page totals → ga_page_stats. */
export function mapPageRows(brandId, report) {
  const mapped = [];
  for (const row of readReportRows(report)) {
    const date = gaDateToIso(row.date);
    if (!date) continue;
    mapped.push({
      brand_id: brandId,
      date,
      landing_page: row.landingPage ?? '',
      ...trafficMetricColumns(row),
    });
  }
  return mapped;
}

/**
 * Sessions per day and default channel group → ga_channel_stats (AT-005):
 * Organic Search is what the AI Traffic page compares AI visitors with.
 */
export function mapChannelRows(brandId, report) {
  const mapped = [];
  for (const row of readReportRows(report)) {
    const date = gaDateToIso(row.date);
    if (!date) continue;
    mapped.push({
      brand_id: brandId,
      date,
      channel: row.sessionDefaultChannelGroup || '(not set)',
      ...trafficMetricColumns(row),
    });
  }
  return mapped;
}

/** Product rows → ga_item_stats. */
export function mapItemRows(brandId, report) {
  const mapped = [];
  for (const row of readReportRows(report)) {
    const date = gaDateToIso(row.date);
    if (!date) continue;
    mapped.push({
      brand_id: brandId,
      date,
      item_id: row.itemId ?? '',
      item_name: row.itemName ?? '',
      item_category: row.itemCategory ?? '',
      items_viewed: toInt(row.itemsViewed),
      items_added_to_cart: toInt(row.itemsAddedToCart),
      items_purchased: toInt(row.itemsPurchased),
      item_revenue: toFloat(row.itemRevenue),
    });
  }
  return mapped;
}

/**
 * Sources GA4 reported that the classification list does not know, ordered by
 * sessions. Logged rather than stored: the point is to notice a new assistant
 * showing up in real traffic and extend ai-sources.json deliberately, not to
 * accumulate every referrer a site ever sees.
 */
export function unclassifiedSources(report, { minSessions = 1, limit = 10 } = {}) {
  return readReportRows(report)
    .filter((row) => !classifyGaSource(row.sessionSource) && toInt(row.sessions) >= minSessions)
    .map((row) => ({ source: row.sessionSource ?? '', sessions: toInt(row.sessions) }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

async function upsertAll(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict });
    if (error) throw new Error(`Upsert into ${table} failed: ${error.message}`);
  }
}

/** The days a run covers, newest first, as YYYY-MM-DD. */
export function dayRange(days) {
  return Array.from({ length: days + 1 }, (_, i) => utcDateString(i));
}

/**
 * Run `task` over `items` with a small concurrency window. Backfilling 90 days
 * one request at a time would take minutes per brand for no reason; GA4 allows
 * ten concurrent requests per property and this stays well under it.
 */
async function mapWithConcurrency(items, limit, task) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    results.push(...(await Promise.all(items.slice(i, i + limit).map(task))));
  }
  return results;
}

/**
 * Fetch one day of a report and upsert it. Returns the row count, and whether
 * the day filled its ceiling — a day that did was truncated, and the caller
 * says so rather than letting it pass as complete data.
 */
async function syncDay({
  brand,
  target,
  date,
  dimensions,
  metrics,
  orderBys,
  limit,
  map,
  table,
  onConflict,
}) {
  const report = await runGaReport(target, brand.ga_property_id, {
    dateRanges: [{ startDate: date, endDate: date }],
    dimensions,
    metrics,
    orderBys,
    limit,
  });

  const rows = map(brand.id, report);
  if (rows.length) await upsertAll(table, rows, onConflict);
  return { stored: rows.length, truncated: (report?.rowCount ?? 0) > limit };
}

/** True when this brand has never been synced, so the first run backfills. */
async function isFirstSync(brandId) {
  const { data, error } = await supabaseAdmin
    .from('ga_page_stats')
    .select('id')
    .eq('brand_id', brandId)
    .limit(1);
  // On a failed read, refresh the short window rather than re-pulling 90 days.
  if (error) return false;
  return (data ?? []).length === 0;
}

/**
 * Run a per-day report across `days`, reporting how many rows were stored and
 * on how many days the ceiling was reached.
 *
 * Per day rather than one call for the whole window, because the ceiling has
 * to mean "the top pages of that day". Applied to a 90-day range it would mean
 * "the top pages of the whole quarter", which on a large property is less than
 * a single day's worth and silently biases everything computed from it.
 */
async function syncDays({ brand, target, days, label, ...report }) {
  const outcomes = await mapWithConcurrency(days, DAY_CONCURRENCY, (date) =>
    syncDay({ brand, target, date, ...report }),
  );

  const stored = outcomes.reduce((sum, o) => sum + o.stored, 0);
  const truncatedDays = outcomes.filter((o) => o.truncated).length;
  if (truncatedDays > 0) {
    logger.warn(
      { brandId: brand.id, label, truncatedDays, limit: report.limit, stored },
      '[ga-sync] daily ceiling reached — long tail not stored for these days',
    );
  }
  return stored;
}

/**
 * The days the AI report covers. A first sync, or a history backfill, takes
 * as far back as storage keeps (RETENTION_DAYS, about 13 months): GA4 fills
 * the AI traffic history from before the snippet was installed (spec §5.2),
 * and the AI slice is small. Page totals stay at BACKFILL_DAYS — up to 5,000
 * rows a day each.
 */
export function aiReportDays({ first, aiHistory = false }) {
  return dayRange(first || aiHistory ? RETENTION_DAYS : REFRESH_DAYS);
}

/** The AI report's filter: a session source on the list, or GA4's own AI channel. */
export const GA_AI_FILTER = {
  orGroup: {
    expressions: [
      {
        filter: {
          fieldName: 'sessionSource',
          stringFilter: {
            matchType: 'FULL_REGEXP',
            value: GA_AI_SOURCE_PATTERN,
            caseSensitive: false,
          },
        },
      },
      {
        filter: {
          fieldName: 'sessionDefaultChannelGroup',
          stringFilter: { matchType: 'EXACT', value: GA_AI_ASSISTANT_CHANNEL },
        },
      },
    ],
  },
};

async function syncBrand(brand, { aiHistory = false } = {}) {
  const target = composioTarget(brand.connection);
  const first = await isFirstSync(brand.id);
  const days = dayRange(first ? BACKFILL_DAYS : REFRESH_DAYS);
  const dateRanges = [{ startDate: days[days.length - 1], endDate: days[0] }];
  const aiDays = aiReportDays({ first, aiHistory });
  const metrics = TRAFFIC_METRICS.map((name) => ({ name }));

  // The AI slice is small enough to take in one call — a live property
  // produced 96 rows over 90 days — so it keeps the full entry URL and needs
  // no ceiling.
  const aiReport = await runGaReport(target, brand.ga_property_id, {
    dateRanges: [{ startDate: aiDays[aiDays.length - 1], endDate: aiDays[0] }],
    dimensions: [
      { name: 'date' },
      { name: 'sessionSource' },
      // ChatGPT Shopping's sessions have medium feed (#1283).
      { name: 'sessionMedium' },
      { name: 'sessionDefaultChannelGroup' },
      { name: 'landingPage' },
      { name: 'landingPagePlusQueryString' },
    ],
    metrics,
    // A host on the list or one of its subdomains, never a substring match —
    // see aiSources.js for why — or GA4's AI Assistant channel.
    dimensionFilter: GA_AI_FILTER,
    orderBys: PAGE_ORDER,
    limit: 100_000,
  });
  const aiMapped = mapAiTrafficRows(brand.id, aiReport);
  if (aiMapped.length) {
    await upsertAll(
      'ga_ai_traffic_stats',
      aiMapped,
      'brand_id,date,source,medium,landing_page_query',
    );
    // Not after an empty report: that may be GA4 answering with nothing,
    // and the older rows are all those days have.
    await deleteRowsWithoutMedium(brand.id, { from: aiDays[aiDays.length - 1], to: aiDays[0] });
  }
  const aiRows = aiMapped.length;

  // Every channel's sessions over the same days (AT-005): a dozen rows a
  // day, so one call. Organic Search is the AI Traffic page's comparison.
  const channelReport = await runGaReport(target, brand.ga_property_id, {
    dateRanges: [{ startDate: aiDays[aiDays.length - 1], endDate: aiDays[0] }],
    dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
    metrics,
    limit: 100_000,
  });
  const channelMapped = mapChannelRows(brand.id, channelReport);
  if (channelMapped.length) {
    await upsertAll('ga_channel_stats', channelMapped, 'brand_id,date,channel');
  }
  const channelRows = channelMapped.length;

  const pageRows = await syncDays({
    brand,
    target,
    days,
    label: 'pages',
    table: 'ga_page_stats',
    onConflict: 'brand_id,date,landing_page',
    map: mapPageRows,
    dimensions: [{ name: 'date' }, { name: 'landingPage' }],
    metrics,
    orderBys: PAGE_ORDER,
    limit: PAGE_DAILY_LIMIT,
  });

  // Ecommerce is optional. A property without it returns no rows, and a
  // property that rejects the item dimensions must not fail the whole brand —
  // the traffic tables above are already written by this point.
  let itemRows = 0;
  try {
    itemRows = await syncDays({
      brand,
      target,
      days,
      label: 'items',
      table: 'ga_item_stats',
      onConflict: 'brand_id,date,item_id,item_name',
      map: mapItemRows,
      dimensions: [
        { name: 'date' },
        { name: 'itemName' },
        { name: 'itemId' },
        { name: 'itemCategory' },
      ],
      metrics: ITEM_METRICS.map((name) => ({ name })),
      orderBys: ITEM_ORDER,
      limit: ITEM_DAILY_LIMIT,
    });
  } catch (err) {
    logger.info(
      { brandId: brand.id, err: err.message },
      '[ga-sync] item report unavailable — property has no ecommerce data',
    );
  }

  // Source discovery: one cheap call (no page dimension) over the same window
  // so a newly popular assistant shows up in the logs instead of silently
  // failing the filter above forever.
  try {
    const report = await runGaReport(target, brand.ga_property_id, {
      dateRanges,
      dimensions: [{ name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
      limit: 500,
    });
    const unknown = unclassifiedSources(report);
    if (unknown.length) {
      logger.debug({ brandId: brand.id, unknown }, '[ga-sync] unclassified sources observed');
    }
  } catch (err) {
    logger.debug({ brandId: brand.id, err: err.message }, '[ga-sync] source discovery failed');
  }

  return { first, aiRows, channelRows, pageRows, itemRows };
}

async function prune(table) {
  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .lt('date', utcDateString(RETENTION_DAYS));
  if (error) logger.warn({ err: error, table }, '[ga-sync] retention prune failed');
}

/**
 * Sync every eligible brand; optionally scoped to one organization (the
 * manual trigger) or to one brand (right after its property is mapped).
 * `aiHistory` re-reads the AI report as far back as storage keeps, for brands
 * synced before the AI history went past BACKFILL_DAYS (backfillGaAiHistory.js).
 * Returns per-brand counts.
 */
export async function runGaSync({ organizationId, brandId, aiHistory = false } = {}) {
  if (!isComposioConfigured(GA)) return { synced: 0, skipped: 0, results: [] };

  // Brands whose Google sign-in is live (00470)…
  const connections = await connectedBrands(GA, { organizationId, brandId });
  // …in organizations on an active subscription: once the plan has ended,
  // nothing is synced.
  const orgIds = [...new Set(connections.map((c) => c.organizationId))];
  const isActive = await activeOrgFilter(orgIds);
  const live = new Map(
    connections.filter((c) => isActive(c.organizationId)).map((c) => [c.brandId, c]),
  );
  if (live.size === 0) return { synced: 0, skipped: 0, results: [] };

  // …that are active and have a mapped property.
  const { data: rows, error: brandError } = await selectInChunks([...live.keys()], (ids) =>
    supabaseAdmin
      .from('brands')
      .select('id, organization_id, ga_property_id')
      .eq('is_active', true)
      // A demo brand's figures (00380) are sample data, never synced.
      .eq('is_demo', false)
      .not('ga_property_id', 'is', null)
      .in('id', ids),
  );
  if (brandError) throw new Error(brandError.message);
  const brands = (rows || []).map((brand) => ({ ...brand, connection: live.get(brand.id) }));

  const results = [];
  let synced = 0;
  let skipped = 0;
  for (const brand of brands || []) {
    try {
      const counts = await syncBrand(brand, { aiHistory });
      results.push({ brandId: brand.id, ...counts });
      synced++;
    } catch (err) {
      logger.error({ err, brandId: brand.id }, '[ga-sync] brand sync failed');
      results.push({ brandId: brand.id, error: err.message });
      skipped++;
    }
  }

  // Retention is table-wide, so a single-brand sync leaves it to the daily run.
  if (!brandId) {
    for (const table of [
      'ga_ai_traffic_stats',
      'ga_channel_stats',
      'ga_page_stats',
      'ga_item_stats',
    ]) {
      await prune(table);
    }
  }

  logger.info({ synced, skipped, total: (brands || []).length }, '[ga-sync] completed');
  return { synced, skipped, results };
}
