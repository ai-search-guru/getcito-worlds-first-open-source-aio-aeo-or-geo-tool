/**
 * Daily Search Console sync (#644).
 *
 * For every active brand mapped to a GSC property (whose connection is live:
 * the Google sign-in it uses, lib/brandIntegrations.js), pulls the last
 * SYNC_WINDOW_DAYS of per-query daily stats through Composio and upserts
 * them into gsc_query_stats, the same per page into
 * gsc_page_stats (AT-008: which pages lose clicks while impressions rise),
 * and the pages Google showed in its shopping results into
 * gsc_shopping_page_stats (00377: Product Visibility's Readiness). A
 * brand's page sync reads a week at a time, and reads its property's
 * PAGE_BACKFILL_DAYS once, resuming where a sync stopped, so a 90-day range
 * has a period before it (pagesSyncPlan).
 * Parameters are fully deterministic — no LLM anywhere in
 * this path. Per-brand failures are logged and skipped; one broken property
 * never aborts the run.
 */

import supabaseAdmin from '../config/supabase.js';
import { activeOrgFilter } from './activeSubscriptions.js';
import { composioTarget, connectedBrands } from './brandIntegrations.js';
import { selectInChunks } from './chunkedIn.js';
import { isComposioConfigured, queryGscSearchAnalytics } from './composio.js';
import { logger } from './logger.js';

const GSC = 'google-search-console';

const SYNC_WINDOW_DAYS = 28;
const ROW_LIMIT = 5000;
// GSC returns rows sorted by clicks desc, so pagination walks the long tail
// of low-volume queries. The page cap is a defensive ceiling (25k rows/brand)
// — hitting it is logged, never silent.
const MAX_PAGES = 5;
const UPSERT_CHUNK = 500;
// Page stats (AT-008): the first syncs read 190 days — a 90-day range and
// the 90 days before it, plus Google's delay; the daily prune keeps as many.
export const PAGE_BACKFILL_DAYS = 190;
// A week per [page, date] pull: GSC sorts its rows by clicks, so a pull that
// hits the row cap drops the zero-click page-days. Over a week the cap is
// spread evenly instead of falling on the older days of a 28-day pull, which
// are read once while recent days are re-read daily (#1177's review).
export const PAGE_WINDOW_DAYS = 7;

/** YYYY-MM-DD in UTC, `daysAgo` days before now. */
function utcDateString(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Map raw GSC rows ({keys:[query,date],...}) to gsc_query_stats rows. */
export function mapAnalyticsRows(brandId, rows) {
  const mapped = [];
  for (const r of rows || []) {
    const [query, date] = r.keys || [];
    if (!query || !date) continue;
    mapped.push({
      brand_id: brandId,
      query,
      date,
      clicks: Math.round(r.clicks || 0),
      impressions: Math.round(r.impressions || 0),
      ctr: r.ctr || 0,
      position: r.position || 0,
    });
  }
  return mapped;
}

/** Map raw GSC rows ({keys:[page,date],...}) to gsc_page_stats rows (AT-008). */
export function mapPageRows(brandId, rows) {
  return mapAnalyticsRows(brandId, rows).map(({ query, ...row }) => ({ ...row, page: query }));
}

/**
 * The page windows from `newest` to `oldest` days ago, both included,
 * PAGE_WINDOW_DAYS at a time and newest first, with no gap.
 */
export function pageWindows(newest, oldest) {
  const windows = [];
  for (let to = newest; to <= oldest; to += PAGE_WINDOW_DAYS) {
    windows.push({ from: Math.min(to + PAGE_WINDOW_DAYS - 1, oldest), to });
  }
  return windows;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole UTC days from a YYYY-MM-DD date to `now`'s. */
function daysSince(date, now) {
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  return Math.round((today - Date.parse(date)) / DAY_MS);
}

/**
 * Pull one window of daily rows by `dimension` and upsert them, paging
 * through the result set up to the row cap. Returns the rows written.
 */
async function pullWindow(brand, { dimension, table, onConflict, map }, { from, to }) {
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await queryGscSearchAnalytics(composioTarget(brand.connection), {
      site_url: brand.gsc_property,
      start_date: utcDateString(from),
      end_date: utcDateString(to),
      dimensions: [dimension, 'date'],
      search_type: 'web',
      row_limit: ROW_LIMIT,
      start_row: page * ROW_LIMIT,
      aggregation_type: 'auto',
      data_state: 'final',
      dimension_filter_groups: [],
    });

    const mapped = map(brand.id, rows);
    for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
      const chunk = mapped.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict });
      if (error) throw new Error(`Upsert failed: ${error.message}`);
    }
    total += mapped.length;

    // A short page means we've reached the end of the result set.
    if (rows.length < ROW_LIMIT) return total;
  }

  logger.warn(
    { brandId: brand.id, dimension, total, maxRows: MAX_PAGES * ROW_LIMIT },
    '[gsc-sync] page cap reached — result set truncated',
  );
  return total;
}

// ─── Shopping results (00377) ────────────────────────────────────────────────

/** Shopping rows are kept this long, as query rows are. */
const SHOPPING_KEEP_DAYS = 90;
/** Appearance types a property has, at most: there are a few dozen. */
const APPEARANCE_ROW_LIMIT = 100;

/**
 * The shopping appearance an API type names: merchant listings (the free
 * shopping listings) or product snippets (price, rating and stock under a
 * result); null for any other. Matched by name, not one exact string, so
 * the API's spelling (MERCHANT_LISTINGS, "Merchant listings") doesn't matter.
 */
export function shoppingAppearance(type) {
  const name = String(type ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (name.includes('merchantlisting')) return 'merchant_listings';
  if (name.includes('productsnippet')) return 'product_snippets';
  return null;
}

/** Map one appearance's GSC rows ({keys:[page,date],...}) to gsc_shopping_page_stats rows. */
export function mapShoppingRows(brandId, appearance, rows) {
  return mapPageRows(brandId, rows).map((row) => ({ ...row, appearance }));
}

/**
 * The pages Google showed in its shopping results over the last
 * SYNC_WINDOW_DAYS, read in the two steps the API needs (search appearance
 * can't be a column beside the page): the property's appearance types, then
 * each shopping type's pages by day, filtered to it. Both steps count
 * impressions by page: counted by property, a result showing several of the
 * shop's products counts once, and a shop's pages would always add up past
 * it. A filtered read whose impressions pass its type's total by more than
 * rounding means the filter wasn't applied: it is dropped, not kept as every
 * page shown, and the brand is left unread rather than read as showing
 * none. The brand's rows from another property are dropped first. Returns
 * the rows written.
 */
async function syncBrandShopping(brand, now = Date.now()) {
  const target = composioTarget(brand.connection);
  if (brand.gsc_shopping_property && brand.gsc_shopping_property !== brand.gsc_property) {
    const { error } = await supabaseAdmin
      .from('gsc_shopping_page_stats')
      .delete()
      .eq('brand_id', brand.id);
    if (error) throw new Error(error.message);
  }
  const window = {
    site_url: brand.gsc_property,
    start_date: utcDateString(SYNC_WINDOW_DAYS),
    end_date: utcDateString(0),
    search_type: 'web',
    aggregation_type: 'auto',
    data_state: 'final',
  };
  const types = await queryGscSearchAnalytics(target, {
    ...window,
    // As the page rows below are counted, so their sums compare.
    aggregation_type: 'byPage',
    dimensions: ['searchAppearance'],
    row_limit: APPEARANCE_ROW_LIMIT,
    start_row: 0,
    dimension_filter_groups: [],
  });

  let total = 0;
  let dropped = false;
  for (const type of types) {
    const name = type.keys?.[0];
    const appearance = shoppingAppearance(name);
    if (!appearance) continue;
    const rows = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await queryGscSearchAnalytics(target, {
        ...window,
        dimensions: ['page', 'date'],
        row_limit: ROW_LIMIT,
        start_row: page * ROW_LIMIT,
        dimension_filter_groups: [
          {
            groupType: 'and',
            filters: [{ dimension: 'searchAppearance', operator: 'equals', expression: name }],
          },
        ],
      });
      rows.push(...batch);
      if (batch.length < ROW_LIMIT) break;
    }
    const impressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0);
    if (impressions > (type.impressions || 0) * 1.05 + 10) {
      logger.error(
        { brandId: brand.id, appearance: name, impressions, expected: type.impressions },
        '[gsc-sync] shopping filter not applied — rows dropped',
      );
      dropped = true;
      continue;
    }
    const mapped = mapShoppingRows(brand.id, appearance, rows);
    for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
      const { error } = await supabaseAdmin
        .from('gsc_shopping_page_stats')
        .upsert(mapped.slice(i, i + UPSERT_CHUNK), { onConflict: 'brand_id,page,appearance,date' });
      if (error) throw new Error(`Upsert failed: ${error.message}`);
    }
    total += mapped.length;
  }
  // A dropped read leaves the brand unread: Readiness then says it can't
  // tell, never that Google shows none of its products.
  await updateBrand(brand, {
    gsc_shopping_property: brand.gsc_property,
    gsc_shopping_synced_at: dropped ? null : new Date(now).toISOString(),
  });
  return total;
}

const QUERIES = {
  dimension: 'query',
  table: 'gsc_query_stats',
  onConflict: 'brand_id,query,date',
  map: mapAnalyticsRows,
};
const PAGES = {
  dimension: 'page',
  table: 'gsc_page_stats',
  onConflict: 'brand_id,page,date',
  map: mapPageRows,
};

async function syncBrand(brand) {
  return pullWindow(brand, QUERIES, { from: SYNC_WINDOW_DAYS, to: 0 });
}

/**
 * What a brand's page sync does (AT-008, 00201). Every sync reads the last
 * SYNC_WINDOW_DAYS. A property's PAGE_BACKFILL_DAYS are read once, older
 * windows after those: gsc_pages_backfilled_property names the property the
 * page rows belong to, and gsc_pages_backfill_from how far back its backfill
 * has read (null once through). So a sync cut short resumes after its last
 * window the next day, rather than reading the whole history again, and a
 * window that keeps failing is the only one tried again. A brand mapped to
 * another property drops the old one's pages and starts over.
 */
export function pagesSyncPlan(brand, now = Date.now()) {
  const recent = pageWindows(0, SYNC_WINDOW_DAYS);
  const started = brand.gsc_pages_backfilled_property === brand.gsc_property;
  if (started && !brand.gsc_pages_backfill_from) {
    return { recent, backfill: [], start: false, dropOldPages: false };
  }
  // Days up to SYNC_WINDOW_DAYS ago are the recent windows' every day.
  const readTo = started
    ? Math.max(daysSince(brand.gsc_pages_backfill_from, now), SYNC_WINDOW_DAYS)
    : SYNC_WINDOW_DAYS;
  return {
    recent,
    backfill: readTo < PAGE_BACKFILL_DAYS ? pageWindows(readTo + 1, PAGE_BACKFILL_DAYS) : [],
    start: !started,
    dropOldPages: !started && brand.gsc_pages_backfilled_property != null,
  };
}

async function updateBrand(brand, fields) {
  const { error } = await supabaseAdmin.from('brands').update(fields).eq('id', brand.id);
  if (error) throw new Error(error.message);
}

/** The brand's page stats (AT-008), as pagesSyncPlan says. */
async function syncBrandPages(brand) {
  const plan = pagesSyncPlan(brand);
  if (plan.dropOldPages) {
    const { error } = await supabaseAdmin.from('gsc_page_stats').delete().eq('brand_id', brand.id);
    if (error) throw new Error(error.message);
  }
  let total = 0;
  for (const window of plan.recent) {
    total += await pullWindow(brand, PAGES, window);
  }
  if (plan.start) {
    // Only once the recent days are in, so a first sync cut short there
    // starts over rather than leaving them out.
    await updateBrand(brand, {
      gsc_pages_backfilled_property: brand.gsc_property,
      gsc_pages_backfill_from: utcDateString(SYNC_WINDOW_DAYS),
    });
  }
  for (const window of plan.backfill) {
    total += await pullWindow(brand, PAGES, window);
    // Kept after each window, so the next sync resumes after it.
    await updateBrand(brand, { gsc_pages_backfill_from: utcDateString(window.from) });
  }
  // Through the PAGE_BACKFILL_DAYS: from now on the recent windows only.
  if (plan.start || brand.gsc_pages_backfill_from) {
    await updateBrand(brand, { gsc_pages_backfill_from: null });
  }
  return total;
}

/**
 * Sync every eligible brand; optionally scoped to one organization (the
 * manual trigger) or to one brand (right after its property is mapped).
 * Returns per-brand counts.
 */
export async function runGscSync({ organizationId, brandId } = {}) {
  if (!isComposioConfigured(GSC)) return { synced: 0, skipped: 0, results: [] };

  // Brands whose Google sign-in is live (00470)…
  const connections = await connectedBrands(GSC, { organizationId, brandId });
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
      .select(
        'id, organization_id, gsc_property, gsc_pages_backfilled_property, gsc_pages_backfill_from, gsc_shopping_property',
      )
      .eq('is_active', true)
      // A demo brand's figures (00380) are sample data, never synced.
      .eq('is_demo', false)
      .not('gsc_property', 'is', null)
      .in('id', ids),
  );
  if (brandError) throw new Error(brandError.message);
  const brands = (rows || []).map((brand) => ({ ...brand, connection: live.get(brand.id) }));

  const results = [];
  let synced = 0;
  let skipped = 0;
  for (const brand of brands || []) {
    try {
      const count = await syncBrand(brand);
      // The page stats are a step of their own: failing there leaves the
      // query rows synced.
      let pages = null;
      try {
        pages = await syncBrandPages(brand);
      } catch (err) {
        logger.error({ err, brandId: brand.id }, '[gsc-sync] page sync failed');
      }
      // So are the shopping results (00377).
      let shopping = null;
      try {
        shopping = await syncBrandShopping(brand);
      } catch (err) {
        logger.error({ err, brandId: brand.id }, '[gsc-sync] shopping sync failed');
      }
      results.push({ brandId: brand.id, rows: count, pages, shopping });
      synced++;
    } catch (err) {
      logger.error({ err, brandId: brand.id }, '[gsc-sync] brand sync failed');
      results.push({ brandId: brand.id, error: err.message });
      skipped++;
    }
  }

  // Retention (#648): the suggestion pipeline reads a 28-day window; 90 days
  // keeps room for trend features without unbounded growth. Table-wide, so a
  // single-brand sync leaves it to the daily run.
  if (!brandId) {
    const { error: pruneError } = await supabaseAdmin
      .from('gsc_query_stats')
      .delete()
      .lt('date', utcDateString(90));
    if (pruneError) {
      logger.warn({ err: pruneError }, '[gsc-sync] retention prune failed');
    }
    const { error: pagePruneError } = await supabaseAdmin
      .from('gsc_page_stats')
      .delete()
      .lt('date', utcDateString(PAGE_BACKFILL_DAYS));
    if (pagePruneError) {
      logger.warn({ err: pagePruneError }, '[gsc-sync] page retention prune failed');
    }
    const { error: shoppingPruneError } = await supabaseAdmin
      .from('gsc_shopping_page_stats')
      .delete()
      .lt('date', utcDateString(SHOPPING_KEEP_DAYS));
    if (shoppingPruneError) {
      logger.warn({ err: shoppingPruneError }, '[gsc-sync] shopping retention prune failed');
    }
  }

  logger.info({ synced, skipped, total: (brands || []).length }, '[gsc-sync] completed');
  return { synced, skipped, results };
}
