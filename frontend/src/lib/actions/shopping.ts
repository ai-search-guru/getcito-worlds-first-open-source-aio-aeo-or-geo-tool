'use server';

import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import { dbClient } from '@/lib/supabase/scoped';
import { readAllRpcRows } from '@/lib/supabase/rpcPages';
import { pageKey } from '@/lib/content/feedMatch';
import type { ShoppingSearchAppearance } from '@/lib/shopping/readiness';
import { expandDateToEndOfDay } from '@/lib/dates';
import { detectAmazonShareDrop, type AmazonShareDropAlert } from '@/lib/shoppingAmazonShareAlert';
import { z } from 'zod';
import { marketRegionCodes, type ShoppingMarket } from '@/lib/shopping/markets';
import { matchScores, missingWords, queryTerms, sameProduct } from '@/lib/shopping/matchScore';
import {
  buildShelf,
  shelfStats,
  type ShelfCardRow,
  type ShelfRow,
  type ShelfStats,
} from '@/lib/shopping/shelf';
import { categoryRows, type CategoryCardRow, type CategoryRow } from '@/lib/shopping/categories';
import {
  comparison,
  detailPrompts,
  focusShelf,
  productShelves,
  type ComparisonRow,
  type DetailCard,
  type ProductShelfLine,
} from '@/lib/shopping/productDetail';
import { priceText } from '@/lib/shopping/price';
import {
  CARD_MAX_ROWS,
  PRODUCTS_TABLE_MAX,
  readCatalogProducts,
  readCatalogRows,
  readForIds,
} from '@/lib/shopping/catalogRead';
import { productAiSays, type AiSaysAnswer, type ProductAiSays } from '@/lib/shopping/aiSays';
import { READINESS_CHANNELS } from '@/lib/shopping/readiness';
import { FROM_PRODUCTS_KINDS } from '@/lib/action-center/registry';
import {
  RECHECK_DAYS,
  RECHECK_TARGETS,
  actionResult,
  resultKey,
  type ActionResult,
  type RecheckAction,
  type RecheckCard,
} from '@/lib/shopping/recheck';
import {
  productRows,
  readiness,
  type CatalogProductRow,
  type ProductAiStats,
  type ProductCardRow,
  type ProductRow,
} from '@/lib/shopping/products';
import {
  toMerchantSplit,
  type MerchantSplitRow,
  type ShoppingMerchantSplit,
} from '@/lib/shoppingMerchantSplit';
import {
  detectResellerPriceAlerts,
  type MerchantKind,
  type ResellerPriceAlert,
} from '@/lib/shoppingResellerPriceAlert';

/**
 * Server actions for the Shopping dashboard page. Reads from the
 * normalized `prompt_result_shopping_cards` table introduced in #103.
 *
 * Org-scoping is enforced via the calling user's auth session — every
 * query joins or filters on `brand_id`, and RLS on
 * `prompt_result_shopping_cards` already restricts to the caller's
 * organization. The action just adds the matching brand filter to keep
 * results scoped to a single brand at a time. The reads the MCP server
 * shares (lib/mcp/productVisibility.ts) query through dbClient(), so it can
 * run them with the service role once it has checked the brand.
 */

export type ShoppingDatePreset = '7d' | '30d' | '90d' | 'all';

export interface ShoppingFilters {
  datePreset: ShoppingDatePreset;
  /** ISO date strings; only used when datePreset === 'all' wants override. */
  dateFrom?: string;
  dateTo?: string;
  /** Scraper / platform ids, e.g. `['perplexity-web', 'google-aimode']`. */
  platforms?: string[];
  /** Region codes. */
  regions?: string[];
  /**
   * ChatGPT Shopping's market (#1278): its results and cards are kept to the
   * market's regions, other platforms' are unaffected. Applies to the card
   * reads and to the Overview (`p_chatgpt_regions`, 00267), including where
   * AI sends shoppers and the reseller prices (00268).
   */
  chatgptMarket?: ShoppingMarket;
}

export interface ShoppingKpis {
  shoppingCardRate: number;
  shoppingCardRateSampleSize: number;
  productsSurfaced: number;
  shoppingSov: number;
  topMerchant: { domain: string; cardCount: number } | null;
}

export interface PlatformCardRatePoint {
  platform: string;
  cardRate: number;
  totalResults: number;
}

export interface OwnPresenceTrendPoint {
  date: string;
  ownCards: number;
  totalCards: number;
}

export interface ShoppingChartData {
  platformCardRate: PlatformCardRatePoint[];
  ownPresenceTrend: OwnPresenceTrendPoint[];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function resolveDateRange(filters: ShoppingFilters): {
  from: string | undefined;
  to: string | undefined;
} {
  const now = new Date();
  if (filters.datePreset === 'all') {
    return { from: filters.dateFrom, to: filters.dateTo };
  }
  const days = filters.datePreset === '7d' ? 7 : filters.datePreset === '30d' ? 30 : 90;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: undefined };
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The Overview window's RPC arguments: brand, dates, platforms, regions and
 * ChatGPT Shopping's market (#1278), whose regions go only with a market.
 */
function windowArgs(brandId: string, filters: ShoppingFilters) {
  const { from, to } = resolveDateRange(filters);
  return {
    p_brand_id: brandId,
    p_from: from,
    p_to: expandDateToEndOfDay(to),
    p_platforms: filters.platforms?.length ? filters.platforms : undefined,
    p_regions: filters.regions?.length ? filters.regions : undefined,
    p_chatgpt_regions: filters.chatgptMarket ? marketRegionCodes(filters.chatgptMarket) : undefined,
  };
}

// ── Overview (KPIs + charts) ──────────────────────────────────────────────────

interface ShoppingOverviewRow {
  total_results: number;
  results_with_cards: number;
  total_cards: number;
  own_cards: number;
  top_merchant: { domain: string; card_count: number } | null;
  by_platform: Array<{ platform: string; total_results: number; results_with_cards: number }>;
  trend: Array<{ day: string; own_cards: number; total_cards: number }>;
}

/**
 * One `shopping_overview` call (#922). The KPIs and charts are aggregated in
 * Postgres: fetched as rows they were cut off at PostgREST's 1,000-row cap.
 * `trendFrom` is omitted when the caller doesn't need the trend.
 */
async function loadShoppingOverview(
  brandId: string,
  filters: ShoppingFilters,
  trendFrom?: string,
): Promise<ShoppingOverviewRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('shopping_overview', {
    ...windowArgs(brandId, filters),
    p_trend_from: trendFrom,
  });
  if (error) throw new Error(error.message);
  return data as unknown as ShoppingOverviewRow;
}

function toKpis(row: ShoppingOverviewRow): ShoppingKpis {
  const totalResults = Number(row.total_results);
  const totalCards = Number(row.total_cards);
  return {
    shoppingCardRate: totalResults > 0 ? Number(row.results_with_cards) / totalResults : 0,
    shoppingCardRateSampleSize: totalResults,
    productsSurfaced: Number(row.own_cards),
    shoppingSov: totalCards > 0 ? Number(row.own_cards) / totalCards : 0,
    topMerchant: row.top_merchant
      ? { domain: row.top_merchant.domain, cardCount: Number(row.top_merchant.card_count) }
      : null,
  };
}

/**
 * Two compact chart payloads for the Overview tab:
 *
 *  - `platformCardRate` — bar chart, one row per platform, `cardRate` is
 *    `cards-bearing prompts / total prompts on that platform`.
 *  - `ownPresenceTrend` — line chart, one bucket per UTC day for the
 *    last 30 days, with own + total card counts.
 */
function toChartData(row: ShoppingOverviewRow): ShoppingChartData {
  const platformCardRate: PlatformCardRatePoint[] = row.by_platform
    .filter((p) => Number(p.total_results) > 0)
    .map((p) => ({
      platform: p.platform,
      cardRate: Number(p.results_with_cards) / Number(p.total_results),
      totalResults: Number(p.total_results),
    }))
    .sort((a, b) => b.cardRate - a.cardRate);

  const buckets = new Map(row.trend.map((d) => [d.day, d]));
  // Fill in zero buckets so the line chart doesn't skip empty days.
  const ownPresenceTrend: OwnPresenceTrendPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slot = buckets.get(date);
    ownPresenceTrend.push({
      date,
      ownCards: Number(slot?.own_cards ?? 0),
      totalCards: Number(slot?.total_cards ?? 0),
    });
  }

  return { platformCardRate, ownPresenceTrend };
}

/** The four overview KPIs for a window (also used by reports). */
export async function getShoppingKpis(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingKpis> {
  return toKpis(await loadShoppingOverview(brandId, filters));
}

/**
 * The Overview tab in one round trip: KPIs plus charts. The trend is always
 * the last 30 days regardless of the date filter, so the chart shows a stable
 * window; the platform and region filters still apply.
 */
export async function getShoppingOverview(
  brandId: string,
  filters: ShoppingFilters,
): Promise<{ kpis: ShoppingKpis; charts: ShoppingChartData }> {
  const row = await loadShoppingOverview(brandId, filters, daysAgoIso(30));
  return { kpis: toKpis(row), charts: toChartData(row) };
}

/**
 * Returns an Amazon share-drop alert for own-product cards across five rolling
 * seven-day windows. The RPC aggregates in Postgres so this stays accurate
 * beyond PostgREST's 1,000-row cap; only classified cards enter the counts.
 */
export async function getShoppingAmazonShareDropAlert(
  brandId: string,
): Promise<AmazonShareDropAlert | null> {
  const supabase = await dbClient();
  const { data, error } = await supabase.rpc('shopping_amazon_share_weekly', {
    p_brand_id: brandId,
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    week_start: string;
    amazon_cards: number | string;
    classified_cards: number | string;
  }>;
  return detectAmazonShareDrop(
    rows.map((row) => ({
      weekStart: row.week_start,
      amazonCards: Number(row.amazon_cards),
      classifiedCards: Number(row.classified_cards),
    })),
  );
}

/**
 * "Where AI sends shoppers" (#1277): the brand's own-product cards per
 * destination over the Overview window and filters, counted in Postgres by
 * `shopping_merchant_split` so the split holds past PostgREST's 1,000-row cap.
 */
export async function getShoppingMerchantSplit(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingMerchantSplit> {
  const supabase = await dbClient();
  const { data, error } = await supabase.rpc(
    'shopping_merchant_split',
    windowArgs(brandId, filters),
  );
  if (error) throw new Error(error.message);
  return toMerchantSplit((data as MerchantSplitRow[] | null)?.[0]);
}

interface OwnProductOfferRow {
  merchant_kind: MerchantKind;
  marketplace: string | null;
  merchant_domain: string | null;
  merchant_url: string | null;
  listing_id: string | null;
  product_title: string | null;
  price_amount: number | string;
  price_currency: string | null;
}

/**
 * Resellers selling the brand's products for at least 5% less than its own
 * store (#1277), over the Overview window and filters. The RPC returns each
 * merchant's lowest price per product as one jsonb list (no row cap); the
 * matching and the 5% rule live in `detectResellerPriceAlerts`.
 */
export async function getResellerPriceAlerts(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ResellerPriceAlert[]> {
  const supabase = await dbClient();
  const { data, error } = await supabase.rpc(
    'shopping_own_product_offers',
    windowArgs(brandId, filters),
  );
  if (error) throw new Error(error.message);
  const rows = (Array.isArray(data) ? data : []) as unknown as OwnProductOfferRow[];
  return detectResellerPriceAlerts(
    rows.map((row) => ({
      merchantKind: row.merchant_kind,
      marketplace: row.marketplace,
      merchantDomain: row.merchant_domain,
      merchantUrl: row.merchant_url,
      listingId: row.listing_id,
      productTitle: row.product_title,
      priceAmount: Number(row.price_amount),
      priceCurrency: row.price_currency,
    })),
  );
}

/**
 * Collected once at page load so the filter bar shows only platform / region
 * values that actually appear in this brand's data — all of it, not the first
 * 1,000 results.
 */
/** Days of Search Console shopping results Readiness reads, as the sync's window. */
const SEARCH_APPEARANCE_DAYS = 28;

/**
 * The brand's pages Google showed as merchant listings or product snippets
 * over the last 28 days, from its own Search Console property (00377), by
 * page key; or why it can't say: no property mapped, or not read yet.
 */
export async function getShoppingSearchAppearance(
  brandId: string,
): Promise<ShoppingSearchAppearance> {
  const supabase = await dbClient();
  const { data: brand, error } = await supabase
    .from('brands')
    .select('gsc_property, gsc_shopping_synced_at')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!brand?.gsc_property) return { state: 'not_connected', pages: [] };
  if (!brand.gsc_shopping_synced_at) return { state: 'not_synced', pages: [] };
  const since = new Date(Date.now() - SEARCH_APPEARANCE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await readAllRpcRows<{ page: string }>(
    (from, to) =>
      supabase
        .from('gsc_shopping_page_stats')
        .select('page')
        .eq('brand_id', brandId)
        .gte('date', since)
        .gt('impressions', 0)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{
        data: { page: string }[] | null;
        error: { message: string } | null;
      }>,
  );
  const pages = new Set(rows.flatMap((row) => pageKey(row.page) ?? []));
  return { state: 'read', pages: [...pages] };
}

export async function getShoppingFilterOptions(brandId: string): Promise<{
  platforms: string[];
  regions: string[];
}> {
  const supabase = await dbClient();
  const { data, error } = await supabase.rpc('shopping_filter_options', { p_brand_id: brandId });
  if (error) return { platforms: [], regions: [] };
  const row = (data as { platforms: string[] | null; regions: string[] | null }[] | null)?.[0];
  return { platforms: row?.platforms ?? [], regions: row?.regions ?? [] };
}

// ── Paged card reads ──────────────────────────────────────────────────────────

const CARD_PAGE_SIZE = 1000;

/**
 * Every row a card query matches, read in `.range()` pages: an unpaged select
 * stops at PostgREST's 1,000-row cap (#922). `build` returns a fresh, filtered
 * query per page; the order makes the pages deterministic. Bounded by
 * CARD_MAX_ROWS so a pathological brand can't pin the server action.
 */
async function fetchAllCards<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder generics
  build: () => any,
): Promise<T[]> {
  return (await readCardPages<T>(build)).rows;
}

/**
 * fetchAllCards' read, and whether it stopped at CARD_MAX_ROWS with every
 * page full (`cut`): the oldest cards past it may not have been read.
 */
async function readCardPages<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder generics
  build: () => any,
): Promise<{ rows: T[]; cut: boolean }> {
  const rows: T[] = [];
  for (let start = 0; start < CARD_MAX_ROWS; start += CARD_PAGE_SIZE) {
    const { data, error } = await build()
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + CARD_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < CARD_PAGE_SIZE) return { rows, cut: false };
  }
  return { rows, cut: true };
}

/**
 * A PostgREST `or` filter keeping ChatGPT Shopping's cards to one market's
 * regions (#1278) and letting every other platform's cards through.
 */
function chatgptMarketFilter(market: ShoppingMarket): string {
  return `platform.neq.chatgpt-shopping,region.in.(${marketRegionCodes(market).join(',')})`;
}

/** A card query over the filter window: brand, dates, platforms and regions. */
function cardsInWindow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  filters: ShoppingFilters,
  columns: string,
) {
  const { from, to } = resolveDateRange(filters);
  const expandedTo = expandDateToEndOfDay(to);
  let query = supabase.from('prompt_result_shopping_cards').select(columns).eq('brand_id', brandId);
  if (from) query = query.gte('created_at', from);
  if (expandedTo) query = query.lte('created_at', expandedTo);
  if (filters.platforms?.length) query = query.in('platform', filters.platforms);
  if (filters.regions?.length) query = query.in('region', filters.regions);
  if (filters.chatgptMarket) query = query.or(chatgptMarketFilter(filters.chatgptMarket));
  return query;
}

const PRODUCT_CARD_COLUMNS = `
      id,
      created_at,
      platform,
      region,
      product_title,
      product_brand,
      price_amount,
      price_currency,
      image_url,
      merchant_url,
      merchant_domain,
      raw,
      matched_brand_id,
      prompt_results:prompt_result_id (
        prompt:prompt_id (
          id,
          text
        )
      )
    `;

// ── My Products / Competitors tab actions ──────────────────────────────────────

export interface ShoppingProductAppearance {
  id: string;
  prompt_id: string;
  prompt_text: string;
  created_at: string;
  region: string | null;
  platform: string;
  raw: unknown;
  merchant_url: string | null;
  merchant_domain: string | null;
}

export interface ShoppingProduct {
  product_title: string;
  product_brand: string | null;
  impressions: number;
  platforms: string[];
  regions: string[];
  last_seen: string;
  last_price: number | null;
  price_currency: string | null;
  top_merchant: string | null;
  image_url: string | null;
  appearances: ShoppingProductAppearance[];
  competitor_name?: string;
}

export interface CompetitorShoppingSummary {
  competitor_id: string;
  name: string;
  domain: string;
  distinct_products_count: number;
  card_count: number;
  sov: number;
}

interface CardRow {
  id: string;
  created_at: string;
  platform: string;
  region: string | null;
  product_title: string | null;
  product_brand: string | null;
  price_amount: number | string | null;
  price_currency: string | null;
  image_url: string | null;
  merchant_url: string | null;
  merchant_domain: string | null;
  raw: unknown;
  matched_brand_id: string | null;
  prompt_results: {
    prompt: {
      id: string;
      text: string;
    } | null;
  } | null;
}

function getProductKey(brand: string | null, title: string | null): string {
  const cleanBrand = (brand ?? '').trim().toLowerCase();
  const cleanTitle = (title ?? '').trim().toLowerCase();
  return `${cleanBrand}::${cleanTitle}`;
}

function aggregateProducts(
  cards: CardRow[],
  competitorMap?: Map<string, { id: string; name: string; domain: string }>,
): ShoppingProduct[] {
  const groups = new Map<
    string,
    {
      product_title: string;
      product_brand: string | null;
      matched_brand_id: string | null;
      appearances: CardRow[];
      merchantDomains: Map<string, number>;
    }
  >();

  for (const card of cards) {
    const title = card.product_title || 'Unknown Product';
    const brandName = card.product_brand || null;
    const key = getProductKey(brandName, title);

    let group = groups.get(key);
    if (!group) {
      group = {
        product_title: title,
        product_brand: brandName,
        matched_brand_id: card.matched_brand_id,
        appearances: [],
        merchantDomains: new Map(),
      };
      groups.set(key, group);
    }

    group.appearances.push(card);
    if (card.merchant_domain) {
      group.merchantDomains.set(
        card.merchant_domain,
        (group.merchantDomains.get(card.merchant_domain) ?? 0) + 1,
      );
    }
  }

  const result: ShoppingProduct[] = [];

  for (const group of groups.values()) {
    const sortedApps = [...group.appearances].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const latest = sortedApps[0];

    let top_merchant: string | null = null;
    let maxCount = 0;
    for (const [domain, count] of group.merchantDomains.entries()) {
      if (count > maxCount) {
        maxCount = count;
        top_merchant = domain;
      }
    }

    const platforms = [...new Set(group.appearances.map((a) => a.platform).filter(Boolean))];
    const regions = [
      ...new Set(group.appearances.map((a) => a.region).filter((r): r is string => !!r)),
    ];
    const heroImage = group.appearances.find((a) => a.image_url)?.image_url || null;

    const competitor_name =
      group.matched_brand_id && competitorMap
        ? competitorMap.get(group.matched_brand_id)?.name
        : undefined;

    const mappedApps: ShoppingProductAppearance[] = sortedApps.map((a) => {
      let promptText = 'Unknown Prompt';
      let promptId = '';
      if (a.prompt_results?.prompt) {
        promptText = a.prompt_results.prompt.text;
        promptId = a.prompt_results.prompt.id;
      }
      return {
        id: a.id,
        prompt_id: promptId,
        prompt_text: promptText,
        created_at: a.created_at,
        region: a.region,
        platform: a.platform,
        raw: a.raw,
        merchant_url: a.merchant_url,
        merchant_domain: a.merchant_domain,
      };
    });

    result.push({
      product_title: group.product_title,
      product_brand: group.product_brand,
      impressions: group.appearances.length,
      platforms,
      regions,
      last_seen: latest.created_at,
      last_price: latest.price_amount ? Number(latest.price_amount) : null,
      price_currency: latest.price_currency || null,
      top_merchant,
      image_url: heroImage,
      appearances: mappedApps,
      competitor_name,
    });
  }

  return result;
}

export async function getOwnProducts(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingProduct[]> {
  const supabase = await createClient();

  const data = await fetchAllCards<CardRow>(() =>
    cardsInWindow(supabase, brandId, filters, PRODUCT_CARD_COLUMNS).eq('matched_brand_role', 'own'),
  );

  return aggregateProducts(data);
}

// ── Match with each prompt (#1282) ─────────────────────────────────────────────

/** Prompts read at once for one product's match. */
const MATCH_MAX_PROMPTS = 20;
/** Searches AI ran for a prompt, kept for its query. */
const MATCH_MAX_SEARCHES = 20;

export interface ProductPromptMatch {
  promptId: string;
  promptText: string;
  /** The product's keyword match with the prompt and its searches, 0–100 (GetCito estimate). */
  score: number;
  /** The query's words the product's title doesn't have. */
  missing: string[];
  /**
   * The product AI showed first for the prompt in its latest answer in the
   * window, with its score; `isThis` when it's this product. Null with no
   * card in the window.
   */
  top: { title: string; score: number; isThis: boolean } | null;
}

interface MatchCardRow {
  id: string;
  created_at: string;
  position: number | null;
  product_title: string | null;
  prompt_result_id: string;
  prompt_results: { prompt_id: string; search_queries: unknown } | null;
}

/** A result's searches: `search_queries` holds `{ query, source_platform }` entries. */
function searchesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      entry && typeof entry === 'object' ? (entry as { query?: unknown }).query : null,
    )
    .filter((query): query is string => typeof query === 'string' && query.trim() !== '');
}

/**
 * How well one of the brand's own products matches each prompt it was shown
 * for (#1282, part 1: keywords): BM25 between the prompt with the searches AI
 * ran for it and the titles of every product shown for it in the window, as
 * `matchScores` computes. With it, the product AI showed first in the
 * prompt's latest answer, and its score. RLS keeps the cards, results and
 * prompts to the caller's organization.
 */
export async function getProductMatchScores(
  brandId: string,
  productTitle: string,
  promptIds: string[],
  filters: ShoppingFilters,
): Promise<ProductPromptMatch[]> {
  const ids = [...new Set(promptIds)];
  if (
    !z.guid().safeParse(brandId).success ||
    typeof productTitle !== 'string' ||
    !productTitle.trim() ||
    productTitle.length > 500 ||
    !ids.length ||
    ids.length > MATCH_MAX_PROMPTS ||
    !ids.every((id) => z.guid().safeParse(id).success)
  ) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const [rows, prompts] = await Promise.all([
    fetchAllCards<MatchCardRow>(() =>
      cardsInWindow(
        supabase,
        brandId,
        filters,
        'id, created_at, position, product_title, prompt_result_id, prompt_results:prompt_result_id!inner(prompt_id, search_queries)',
      ).in('prompt_results.prompt_id', ids),
    ),
    supabase.from('prompts').select('id, text').in('id', ids),
  ]);
  if (prompts.error) throw new Error(prompts.error.message);
  const textOf = new Map((prompts.data ?? []).map((p) => [p.id as string, p.text as string]));

  const byPrompt = new Map<
    string,
    { titles: string[]; searches: Set<string>; results: Map<string, MatchCardRow[]> }
  >();
  for (const row of rows) {
    const promptId = row.prompt_results?.prompt_id;
    const title = row.product_title?.trim();
    if (!promptId || !title) continue;
    let group = byPrompt.get(promptId);
    if (!group) {
      group = { titles: [], searches: new Set(), results: new Map() };
      byPrompt.set(promptId, group);
    }
    if (!group.titles.some((t) => sameProduct(t, title))) group.titles.push(title);
    for (const query of searchesOf(row.prompt_results?.search_queries)) {
      if (group.searches.size < MATCH_MAX_SEARCHES) group.searches.add(query);
    }
    const cards = group.results.get(row.prompt_result_id) ?? [];
    cards.push(row);
    group.results.set(row.prompt_result_id, cards);
  }

  return ids.flatMap((promptId) => {
    const promptText = textOf.get(promptId);
    if (!promptText) return [];
    const group = byPrompt.get(promptId);
    const terms = queryTerms(promptText, [...(group?.searches ?? [])]);
    const others = (group?.titles ?? []).filter((t) => !sameProduct(t, productTitle));
    const docs = [productTitle, ...others];
    const scores = matchScores(terms, docs);

    // The latest answer's first card: its results ordered by when, then by position.
    let top: ProductPromptMatch['top'] = null;
    const latest = [...(group?.results.values() ?? [])]
      .map((cards) => ({
        at: cards.reduce((m, c) => (c.created_at > m ? c.created_at : m), ''),
        cards,
      }))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0];
    const first = latest?.cards
      .filter((c) => c.product_title?.trim())
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))[0];
    if (first?.product_title) {
      const title = first.product_title.trim();
      const isThis = sameProduct(title, productTitle);
      const index = isThis ? 0 : docs.findIndex((d) => sameProduct(d, title));
      top = { title, score: scores[index] ?? 0, isThis };
    }

    return [
      {
        promptId,
        promptText,
        score: scores[0],
        missing: missingWords(terms, productTitle),
        top,
      },
    ];
  });
}

export async function getCompetitorProducts(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingProduct[]> {
  const supabase = await createClient();

  const { data: competitorsData, error: compError } = await supabase
    .from('competitors')
    .select('id, name, domain')
    .eq('brand_id', brandId);

  if (compError) throw new Error(compError.message);
  const competitorMap = new Map((competitorsData ?? []).map((c) => [c.id, c]));

  const data = await fetchAllCards<CardRow>(() =>
    cardsInWindow(supabase, brandId, filters, PRODUCT_CARD_COLUMNS).eq(
      'matched_brand_role',
      'competitor',
    ),
  );

  return aggregateProducts(data, competitorMap);
}

export async function getCompetitorSummary(
  brandId: string,
  filters: ShoppingFilters,
): Promise<CompetitorShoppingSummary[]> {
  const supabase = await createClient();
  const { from, to } = resolveDateRange(filters);
  const expandedTo = expandDateToEndOfDay(to);

  let totalCardsQuery = supabase
    .from('prompt_result_shopping_cards')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId);

  if (from) totalCardsQuery = totalCardsQuery.gte('created_at', from);
  if (expandedTo) totalCardsQuery = totalCardsQuery.lte('created_at', expandedTo);
  if (filters.platforms?.length)
    totalCardsQuery = totalCardsQuery.in('platform', filters.platforms);
  if (filters.regions?.length) totalCardsQuery = totalCardsQuery.in('region', filters.regions);
  if (filters.chatgptMarket) {
    totalCardsQuery = totalCardsQuery.or(chatgptMarketFilter(filters.chatgptMarket));
  }

  const competitorCardsQuery = fetchAllCards<{
    matched_brand_id: string | null;
    product_title: string | null;
    product_brand: string | null;
  }>(() =>
    cardsInWindow(supabase, brandId, filters, 'matched_brand_id, product_title, product_brand').eq(
      'matched_brand_role',
      'competitor',
    ),
  );

  const competitorsQuery = supabase
    .from('competitors')
    .select('id, name, domain')
    .eq('brand_id', brandId);

  const [{ count: totalCount }, competitorCards, { data: competitors, error: compError }] =
    await Promise.all([totalCardsQuery, competitorCardsQuery, competitorsQuery]);

  if (compError) throw new Error(compError.message);

  const total = totalCount || 0;
  const compCards = competitorCards || [];
  const compList = competitors || [];

  const competitorStats = new Map<
    string,
    {
      card_count: number;
      distinctProducts: Set<string>;
    }
  >();

  for (const c of compList) {
    competitorStats.set(c.id, { card_count: 0, distinctProducts: new Set() });
  }

  for (const card of compCards) {
    if (!card.matched_brand_id) continue;
    let stats = competitorStats.get(card.matched_brand_id);
    if (!stats) {
      stats = { card_count: 0, distinctProducts: new Set() };
      competitorStats.set(card.matched_brand_id, stats);
    }
    stats.card_count += 1;
    const title = card.product_title || 'Unknown Product';
    const brandName = card.product_brand || '';
    stats.distinctProducts.add(getProductKey(brandName, title));
  }

  return compList
    .map((c) => {
      const stats = competitorStats.get(c.id) || { card_count: 0, distinctProducts: new Set() };
      return {
        competitor_id: c.id,
        name: c.name,
        domain: c.domain,
        distinct_products_count: stats.distinctProducts.size,
        card_count: stats.card_count,
        sov: total > 0 ? stats.card_count / total : 0,
      };
    })
    .sort((a, b) => b.card_count - a.card_count);
}

export interface ShoppingCardAppearance {
  id: string;
  title: string;
  price: string;
  imageUrl: string;
  merchantUrl: string;
}

export interface ShoppingPromptAppearance {
  promptResultId: string;
  timestamp: string;
  platform: string;
  region: string;
  cards: ShoppingCardAppearance[];
}

export interface CardEligiblePromptRow {
  promptId: string;
  promptText: string;
  topic: string;
  platforms: string[];
  totalCards: number;
  ownCardsCount: number;
  competitorCardsCount: number;
  otherCardsCount: number;
  lastTriggered: string; // ISO string
  appearances: ShoppingPromptAppearance[];
}

export interface CardEligiblePromptsResponse {
  prompts: CardEligiblePromptRow[];
  triggerRate: number;
  totalTrackedPrompts: number;
}

function formatPrice(amount: number | null, currency: string | null): string {
  if (amount == null) return '—';
  const formattedAmount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency || '';
  const isSymbolWord = symbol.length > 1;
  return isSymbolWord ? `${formattedAmount} ${symbol}` : `${symbol}${formattedAmount}`;
}

const ELIGIBLE_CARD_COLUMNS = `
      id,
      matched_brand_role,
      platform,
      region,
      created_at,
      product_title,
      price_amount,
      price_currency,
      image_url,
      merchant_url,
      prompt_result_id,
      prompt_results!inner (
        id,
        prompt_id,
        prompts!inner (
          id,
          text,
          category,
          topic_id,
          topics (
            name
          )
        )
      )
    `;

export async function getCardEligiblePrompts(
  brandId: string,
  filters: ShoppingFilters,
): Promise<CardEligiblePromptsResponse> {
  const supabase = await createClient();

  // 1. Get total number of tracked prompts for the brand
  const { count: totalTrackedPrompts, error: countError } = await supabase
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id)', { count: 'exact', head: true })
    .eq('prompt_sets.brand_id', brandId);

  if (countError) throw new Error(countError.message);

  // 2. Fetch all normalized shopping cards matching the brand and filters
  const cards = await fetchAllCards<unknown>(() =>
    cardsInWindow(supabase, brandId, filters, ELIGIBLE_CARD_COLUMNS),
  );

  const promptMap = new Map<
    string,
    {
      promptId: string;
      promptText: string;
      topic: string;
      platforms: Set<string>;
      totalCards: number;
      ownCardsCount: number;
      competitorCardsCount: number;
      otherCardsCount: number;
      lastTriggered: Date;
      appearancesMap: Map<
        string,
        {
          promptResultId: string;
          timestamp: string;
          platform: string;
          region: string;
          cards: ShoppingCardAppearance[];
        }
      >;
    }
  >();

  const rows = (cards ?? []) as unknown as Array<{
    id: string;
    matched_brand_role: string;
    platform: string;
    region: string | null;
    created_at: string;
    product_title: string | null;
    price_amount: number | null;
    price_currency: string | null;
    image_url: string | null;
    merchant_url: string | null;
    prompt_result_id: string;
    prompt_results: {
      id: string;
      prompt_id: string;
      prompts: {
        id: string;
        text: string;
        category: string | null;
        topic_id: string | null;
        topics: {
          name: string;
        } | null;
      };
    };
  }>;

  for (const row of rows) {
    const promptResult = row.prompt_results;
    if (!promptResult) continue;
    const prompt = promptResult.prompts;
    if (!prompt) continue;

    const promptId = prompt.id;
    if (!promptMap.has(promptId)) {
      promptMap.set(promptId, {
        promptId,
        promptText: prompt.text,
        topic: prompt.topics?.name || prompt.category || 'General',
        platforms: new Set<string>(),
        totalCards: 0,
        ownCardsCount: 0,
        competitorCardsCount: 0,
        otherCardsCount: 0,
        lastTriggered: new Date(0),
        appearancesMap: new Map(),
      });
    }

    const entry = promptMap.get(promptId)!;
    entry.platforms.add(row.platform);
    entry.totalCards += 1;
    if (row.matched_brand_role === 'own') {
      entry.ownCardsCount += 1;
    } else if (row.matched_brand_role === 'competitor') {
      entry.competitorCardsCount += 1;
    } else {
      entry.otherCardsCount += 1;
    }

    const cardDate = new Date(row.created_at);
    if (cardDate > entry.lastTriggered) {
      entry.lastTriggered = cardDate;
    }

    const prId = row.prompt_result_id;
    if (!entry.appearancesMap.has(prId)) {
      entry.appearancesMap.set(prId, {
        promptResultId: prId,
        timestamp: row.created_at,
        platform: row.platform,
        region: row.region || '',
        cards: [],
      });
    }
    const appEntry = entry.appearancesMap.get(prId)!;
    appEntry.cards.push({
      id: row.id,
      title: row.product_title || 'Unknown Product',
      price: formatPrice(row.price_amount, row.price_currency),
      imageUrl: row.image_url || '',
      merchantUrl: row.merchant_url || '',
    });
  }

  // Convert map to list and format timestamps
  const promptsList: CardEligiblePromptRow[] = Array.from(promptMap.values()).map((p) => {
    const appearances = Array.from(p.appearancesMap.values())
      .map((app) => ({
        ...app,
        // Sort cards in appearance: own first, or just keep original order
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return {
      promptId: p.promptId,
      promptText: p.promptText,
      topic: p.topic,
      platforms: Array.from(p.platforms),
      totalCards: p.totalCards,
      ownCardsCount: p.ownCardsCount,
      competitorCardsCount: p.competitorCardsCount,
      otherCardsCount: p.otherCardsCount,
      lastTriggered: p.lastTriggered.getTime() > 0 ? p.lastTriggered.toISOString() : '',
      appearances,
    };
  });

  // Sort by total cards desc
  promptsList.sort((a, b) => b.totalCards - a.totalCards);

  const trackedWithCards = promptMap.size;
  const totalTracked = totalTrackedPrompts ?? 0;
  const triggerRate = totalTracked > 0 ? trackedWithCards / totalTracked : 0;

  return {
    prompts: promptsList,
    triggerRate,
    totalTrackedPrompts: totalTracked,
  };
}

// ── Shelf (Product Visibility, ECOM-006) ──────────────────────────────────────

const SHELF_CARD_COLUMNS = `
      prompt_result_id,
      position,
      created_at,
      platform,
      product_title,
      price_amount,
      price_currency,
      image_url,
      merchant_domain,
      rating,
      review_count,
      matched_brand_role,
      merchant_kind,
      marketplace,
      catalog_product_id,
      prompt_results:prompt_result_id (
        prompt:prompt_id (
          id,
          text
        )
      )
    `;

export interface ShoppingShelf {
  rows: ShelfRow[];
  stats: ShelfStats;
  /** The brand's live catalog products, or null when it has no catalog. */
  catalogProducts: number | null;
}

/**
 * The Shelf over the filter window: each question's latest shelf per
 * channel, the brand's share of the product slots and its products on them,
 * against the catalog's count.
 */
export async function getShoppingShelf(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingShelf> {
  const supabase = await dbClient();
  const [rows, catalog] = await Promise.all([
    fetchAllCards<
      Omit<ShelfCardRow, 'prompt_id' | 'prompt_text'> & {
        prompt_results: { prompt: { id: string; text: string } | null } | null;
      }
    >(() => cardsInWindow(supabase, brandId, filters, SHELF_CARD_COLUMNS)),
    supabase
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .is('removed_at', null),
  ]);
  if (catalog.error) throw new Error(catalog.error.message);
  const cards: ShelfCardRow[] = rows.map(({ prompt_results, ...card }) => ({
    ...card,
    prompt_id: prompt_results?.prompt?.id ?? null,
    prompt_text: prompt_results?.prompt?.text ?? null,
  }));
  return {
    rows: buildShelf(cards),
    stats: shelfStats(cards),
    catalogProducts: catalog.count ? catalog.count : null,
  };
}

/**
 * The AI channels (READINESS_CHANNELS) with the brand's own products on
 * their shelves over the filter window, whatever its platforms: what
 * Readiness's channel cards (ECOM-015) read from the Shelf's stats, as one
 * row a channel instead of every card. The channels are read at once.
 */
export async function getShoppingOwnChannels(
  brandId: string,
  filters: ShoppingFilters,
): Promise<string[]> {
  if (!z.guid().safeParse(brandId).success) throw new Error('invalid');
  const supabase = await dbClient();
  const own = await Promise.all(
    READINESS_CHANNELS.map(async (platform) => {
      const { data, error } = await cardsInWindow(
        supabase,
        brandId,
        { ...filters, platforms: [platform] },
        'id',
      )
        .eq('matched_brand_role', 'own')
        .limit(1);
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    }),
  );
  return READINESS_CHANNELS.filter((_, i) => own[i]);
}

/** Orders from AI visits (CE-017): the last 30 days, the 30 before, and by AI channel. */
export interface ShoppingAiOrders {
  orders: number;
  previousOrders: number;
  /** The month's order value in its main currency, or null with no value. */
  revenue: { value: number; currency: string | null } | null;
  /** The 30 days before's, in the same currency. */
  previousRevenue: number | null;
  /** Orders by the AI source that first brought the visitor, most first. */
  channels: { source: string; orders: number }[];
}

const ORDERS_DAYS = 30;
const ORDER_PAGE = 1000;
const ORDER_MAX_ROWS = 50_000;

/**
 * The brand's orders from AI visits, as the tracking snippet and the Shopify
 * pixel record them (ai_traffic_events, 00286): a conversion with goal
 * 'order', credited to the AI source that first brought the visitor.
 */
export async function getShoppingAiOrders(brandId: string): Promise<ShoppingAiOrders> {
  const supabase = await createClient();
  const now = Date.now();
  const since = new Date(now - 2 * ORDERS_DAYS * 86_400_000).toISOString();
  const split = new Date(now - ORDERS_DAYS * 86_400_000).toISOString();
  const rows: {
    value: number | null;
    currency: string | null;
    first_source: string;
    occurred_at: string;
  }[] = [];
  for (let start = 0; start < ORDER_MAX_ROWS; start += ORDER_PAGE) {
    const { data, error } = await supabase
      .from('ai_traffic_events')
      .select('value, currency, first_source, occurred_at')
      .eq('brand_id', brandId)
      .eq('kind', 'conversion')
      .eq('goal', 'order')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + ORDER_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < ORDER_PAGE) break;
  }
  const current = rows.filter((row) => row.occurred_at >= split);
  const previous = rows.filter((row) => row.occurred_at < split);
  // The currency most of the month's valued orders are in.
  const counts = new Map<string, number>();
  for (const row of current) {
    if (row.value !== null)
      counts.set(row.currency ?? '', (counts.get(row.currency ?? '') ?? 0) + 1);
  }
  const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const sum = (list: typeof rows) =>
    list
      .filter((row) => row.value !== null && (row.currency ?? '') === main)
      .reduce((total, row) => total + Number(row.value), 0);
  const channels = new Map<string, number>();
  for (const row of current)
    channels.set(row.first_source, (channels.get(row.first_source) ?? 0) + 1);
  return {
    orders: current.length,
    previousOrders: previous.length,
    revenue: main === undefined ? null : { value: sum(current), currency: main || null },
    previousRevenue: main === undefined ? null : sum(previous),
    channels: [...channels]
      .map(([source, orders]) => ({ source, orders }))
      .sort((a, b) => b.orders - a.orders || a.source.localeCompare(b.source)),
  };
}

// ── Products (Product Visibility, ECOM-007) ───────────────────────────────────

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface ShoppingProducts {
  rows: ProductRow[];
  /** The brand's live catalog products; more than `rows` when past PRODUCTS_TABLE_MAX. */
  total: number;
}

/**
 * Per product, its AI visits and orders over the window (00361): only the
 * products with either, every page of them.
 */
async function readProductAiStats(supabase: ServerClient, brandId: string, from: string) {
  return readAllRpcRows((start, end) =>
    supabase
      .rpc('catalog_product_ai_stats', { p_brand_id: brandId, p_from: from })
      .order('product_id')
      .range(start, end),
  );
}

/**
 * The Products table: the brand's catalog, each product with its shelves,
 * win rate and average place over the filter window (its cards, 00360),
 * the AI visits its page got and the orders they led to (00361), and its
 * readiness. Null when the brand has no catalog.
 *
 * Past PRODUCTS_TABLE_MAX products, the table holds the products on a
 * shelf or visited from AI first (those with orders, then the most shelves,
 * then the most visits), then the rest by id; `total` counts them all.
 */
export async function getShoppingProducts(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingProducts | null> {
  const supabase = await dbClient();
  const { count: total, error: countErr } = await supabase
    .from('catalog_products')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .is('removed_at', null);
  if (countErr) throw new Error(countErr.message);
  if (!total) return null;

  const { from } = resolveDateRange(filters);
  const [cards, stats] = await Promise.all([
    fetchAllCards<{
      catalog_product_id: string;
      position: number;
      platform: string;
      price_amount: number | null;
      price_currency: string | null;
      created_at: string;
      prompt_results: { prompt_id: string } | null;
    }>(() =>
      cardsInWindow(
        supabase,
        brandId,
        filters,
        'catalog_product_id, position, platform, price_amount, price_currency, created_at, prompt_results:prompt_result_id ( prompt_id )',
      )
        .eq('matched_brand_role', 'own')
        .not('catalog_product_id', 'is', null),
    ),
    // All time reads the last 90 days of visits and orders.
    readProductAiStats(supabase, brandId, from ?? daysAgoIso(90)),
  ]);

  const shelfCards: ProductCardRow[] = cards.map((card) => ({
    productId: card.catalog_product_id,
    shelf: `${card.prompt_results?.prompt_id ?? '?'}:${card.platform}`,
    rank: card.position + 1,
    price: card.price_amount === null ? null : Number(card.price_amount),
    currency: card.price_currency,
    platform: card.platform,
    at: card.created_at,
  }));
  const aiStats: ProductAiStats[] = stats.map((row) => ({
    productId: row.product_id,
    aiVisits: Number(row.ai_visits),
    orders: Number(row.orders),
    revenue: row.revenue === null ? null : Number(row.revenue),
    currency: row.currency,
  }));
  const ids =
    total > PRODUCTS_TABLE_MAX
      ? await tableProductIds(supabase, brandId, shelfCards, aiStats)
      : null;
  const catalog = await readCatalogProducts(supabase, brandId, ids);
  return { rows: productRows(catalog, shelfCards, aiStats), total };
}

/**
 * The PRODUCTS_TABLE_MAX products a catalog bigger than that lists: those on
 * a shelf or visited from AI, the ones with orders first, then the most
 * shelves, then the most visits; then the rest of the catalog by id.
 */
async function tableProductIds(
  supabase: ServerClient,
  brandId: string,
  cards: readonly ProductCardRow[],
  stats: readonly ProductAiStats[],
): Promise<string[]> {
  const shelvesOf = new Map<string, Set<string>>();
  for (const card of cards) {
    if (!shelvesOf.has(card.productId)) shelvesOf.set(card.productId, new Set());
    shelvesOf.get(card.productId)!.add(card.shelf);
  }
  const statsOf = new Map(stats.map((row) => [row.productId, row]));
  const active = [...new Set([...shelvesOf.keys(), ...statsOf.keys()])].sort(
    (a, b) =>
      (statsOf.get(b)?.orders ?? 0) - (statsOf.get(a)?.orders ?? 0) ||
      (shelvesOf.get(b)?.size ?? 0) - (shelvesOf.get(a)?.size ?? 0) ||
      (statsOf.get(b)?.aiVisits ?? 0) - (statsOf.get(a)?.aiVisits ?? 0) ||
      (a < b ? -1 : 1),
  );
  const ids = new Set(active.slice(0, PRODUCTS_TABLE_MAX));
  if (ids.size < PRODUCTS_TABLE_MAX) {
    // The rest, by id: as many as could be needed past those already in.
    const rest = await readCatalogRows<{ id: string }>(
      () =>
        supabase
          .from('catalog_products')
          .select('id')
          .eq('brand_id', brandId)
          .is('removed_at', null)
          .order('id'),
      PRODUCTS_TABLE_MAX,
    );
    for (const { id } of rest) {
      if (ids.size >= PRODUCTS_TABLE_MAX) break;
      ids.add(id);
    }
  }
  return [...ids];
}

// ── Categories (Product Visibility, ECOM-008) ─────────────────────────────────

/**
 * The Categories table: each category of the brand's catalog with its
 * shopping questions, the brand's share of their shelves, its products on
 * them, the top rival there and its products' AI revenue, over the filter
 * window. Null when the catalog has no categories.
 */
export async function getShoppingCategories(
  brandId: string,
  filters: ShoppingFilters,
): Promise<CategoryRow[] | null> {
  const supabase = await createClient();
  const categories = await readCatalogRows<{ id: string; name: string }>(
    () =>
      supabase.from('catalog_categories').select('id, name').eq('brand_id', brandId).order('id'),
    CARD_MAX_ROWS,
  );
  if (!categories.length) return null;

  const { from } = resolveDateRange(filters);
  const [live, links, cards, competitors, stats] = await Promise.all([
    readCatalogRows<{ id: string }>(
      () =>
        supabase
          .from('catalog_products')
          .select('id')
          .eq('brand_id', brandId)
          .is('removed_at', null)
          .order('id'),
      CARD_MAX_ROWS,
    ),
    readCatalogRows<{ product_id: string; category_id: string }>(
      () =>
        supabase
          .from('catalog_product_categories')
          .select('product_id, category_id')
          .eq('brand_id', brandId)
          .order('product_id')
          .order('category_id'),
      CARD_MAX_ROWS,
    ),
    fetchAllCards<{
      matched_brand_role: string;
      matched_brand_id: string | null;
      product_brand: string | null;
      merchant_domain: string | null;
      catalog_product_id: string | null;
      prompt_results: { prompt: { id: string; text: string } | null } | null;
    }>(() =>
      cardsInWindow(
        supabase,
        brandId,
        filters,
        'matched_brand_role, matched_brand_id, product_brand, merchant_domain, catalog_product_id, prompt_results:prompt_result_id ( prompt:prompt_id ( id, text ) )',
      ),
    ),
    supabase.from('competitors').select('id, name, domain').eq('brand_id', brandId),
    readProductAiStats(supabase, brandId, from ?? daysAgoIso(90)),
  ]);
  if (competitors.error) throw new Error(competitors.error.message);

  const liveIds = new Set(live.map((row) => row.id));
  const productsOf = new Map<string, string[]>();
  for (const link of links) {
    if (!liveIds.has(link.product_id)) continue;
    if (!productsOf.has(link.category_id)) productsOf.set(link.category_id, []);
    productsOf.get(link.category_id)!.push(link.product_id);
  }
  const rows: CategoryCardRow[] = cards.flatMap((card) => {
    const prompt = card.prompt_results?.prompt;
    if (!prompt) return [];
    return [
      {
        promptId: prompt.id,
        promptText: prompt.text,
        role: card.matched_brand_role,
        competitorId: card.matched_brand_role === 'competitor' ? card.matched_brand_id : null,
        productBrand: card.product_brand,
        merchant: card.merchant_domain,
        productId: card.catalog_product_id,
      },
    ];
  });
  return categoryRows(
    categories.map((category) => ({
      id: category.id,
      name: category.name,
      productIds: productsOf.get(category.id) ?? [],
    })),
    rows,
    {
      competitors: new Map(
        (competitors.data ?? []).map((c) => [c.id, { name: c.name, domain: c.domain }]),
      ),
      revenueOf: new Map(
        stats.flatMap((row) =>
          row.orders && row.revenue !== null
            ? [[row.product_id, { value: Number(row.revenue), currency: row.currency }] as const]
            : [],
        ),
      ),
    },
  );
}

// ── A product's page (Product Visibility, ECOM-011) ───────────────────────────

export interface ShoppingProductDetail {
  product: CatalogProductRow;
  readiness: ReturnType<typeof readiness>;
  /** The questions it belongs on, each channel's latest shelf. */
  shelves: ProductShelfLine[];
  /** The shelf "Why not your product?" explains, and its rows. */
  focus: ProductShelfLine | null;
  comparison: ComparisonRow[];
  /** AI visits to its page and the orders they led to, over the window (00361). */
  ai: { visits: number; orders: number; revenue: number | null; currency: string | null };
  /** Its last done action from Products, 7 days on (ECOM-018); null without one. */
  result: ActionResult | null;
}

/** The brand's questions read at most, to find those a product belongs on. */
const DETAIL_PROMPTS_READ = 5_000;

/**
 * A product of the brand's catalog, on the AI shelves of the questions it
 * belongs on. Null when it isn't the brand's, or the id can't be a product's.
 *
 * Reads only what the page shows: the product's own cards (the questions it
 * was on, its rating as the answers showed it), the brand's questions, then
 * the shelves of those it may belong on (detailPrompts), and AI's searches
 * for each shelf's latest answer, not every card of the window with its
 * answer's searches.
 */
export async function getShoppingProductDetail(
  brandId: string,
  productId: string,
  filters: ShoppingFilters,
  /** The shelf to explain first: the Shelf's "Why not you?" (a question, its channel). */
  focusOn: { promptId: string; platform?: string | null } | null = null,
): Promise<ShoppingProductDetail | null> {
  if (!z.guid().safeParse(brandId).success) throw new Error('invalid');
  // An address with no product's id in it: the page says it isn't in the catalog.
  if (!z.guid().safeParse(productId).success) return null;
  const asked = focusOn && z.guid().safeParse(focusOn.promptId).success ? focusOn : null;
  const supabase = await createClient();
  // Read beside the rest; a re-check that can't be read leaves the page as it is.
  const resultsRead = readActionResults(supabase, brandId, [
    { type: 'product', id: productId },
  ]).catch((err) => {
    console.error('Failed to re-check the product’s last action:', err);
    return {} as Record<string, ActionResult>;
  });
  const { from } = resolveDateRange(filters);
  const [[product], ownCards, prompts, stats, domain] = await Promise.all([
    readCatalogProducts(supabase, brandId, [productId]),
    fetchAllCards<{
      created_at: string;
      rating: number | null;
      review_count: number | null;
      catalog_product_id: string | null;
      prompt_results: { prompt_id: string } | null;
    }>(() =>
      cardsInWindow(
        supabase,
        brandId,
        filters,
        'created_at, rating, review_count, catalog_product_id, prompt_results:prompt_result_id ( prompt_id )',
      ).eq('catalog_product_id', productId),
    ),
    readCatalogRows<{ id: string; text: string }>(
      () =>
        supabase
          .from('prompts')
          .select('id, text, prompt_sets!inner(brand_id)')
          .eq('prompt_sets.brand_id', brandId)
          .order('id'),
      DETAIL_PROMPTS_READ,
    ),
    // Its own row only (00361), none without AI visits or orders.
    supabase.rpc('catalog_product_ai_stats', {
      p_brand_id: brandId,
      p_from: from ?? daysAgoIso(90),
      p_product_id: productId,
    }),
    supabase
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', brandId)
      .eq('is_primary', true)
      .maybeSingle(),
  ]);
  if (!product) return null;
  if (stats.error) throw new Error(stats.error.message);

  const own = ownCards.filter((card) => card.catalog_product_id === productId);
  const promptIds = detailPrompts(product, prompts, {
    appeared: new Set(own.flatMap((card) => card.prompt_results?.prompt_id ?? [])),
    include: asked?.promptId ?? null,
  });
  const cards = await readForIds(promptIds, (some) =>
    fetchAllCards<{
      prompt_result_id: string;
      position: number;
      created_at: string;
      platform: string;
      product_title: string | null;
      price_amount: number | null;
      price_currency: string | null;
      rating: number | null;
      review_count: number | null;
      merchant_domain: string | null;
      image_url: string | null;
      matched_brand_role: string;
      catalog_product_id: string | null;
      prompt_results: { prompt_id: string; prompt: { text: string } | null } | null;
    }>(() =>
      cardsInWindow(
        supabase,
        brandId,
        filters,
        'prompt_result_id, position, created_at, platform, product_title, price_amount, price_currency, rating, review_count, merchant_domain, image_url, matched_brand_role, catalog_product_id, prompt_results!inner ( prompt_id, prompt:prompt_id ( text ) )',
      ).in('prompt_results.prompt_id', some),
    ),
  );
  // AI's searches for each shelf's latest answer, the one the page explains.
  const latestRun = new Map<string, { id: string; at: string }>();
  for (const card of cards) {
    const key = `${card.prompt_results?.prompt_id}:${card.platform}`;
    const kept = latestRun.get(key);
    if (!kept || card.created_at > kept.at) {
      latestRun.set(key, { id: card.prompt_result_id, at: card.created_at });
    }
  }
  const runs = await readForIds(
    [...new Set([...latestRun.values()].map((run) => run.id))],
    async (some) => {
      const { data, error } = await supabase
        .from('prompt_results')
        .select('id, search_queries')
        .eq('brand_id', brandId)
        .in('id', some);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; search_queries: unknown }[];
    },
  );
  const searchesOfRun = new Map(runs.map((run) => [run.id, searchesOf(run.search_queries)]));

  const detailCards: DetailCard[] = cards.flatMap((card) => {
    const promptId = card.prompt_results?.prompt_id;
    const promptText = card.prompt_results?.prompt?.text;
    if (!promptId || !promptText || !card.product_title?.trim()) return [];
    return [
      {
        promptId,
        promptText,
        platform: card.platform,
        promptResultId: card.prompt_result_id,
        at: card.created_at,
        position: card.position,
        title: card.product_title.trim(),
        price: card.price_amount,
        currency: card.price_currency,
        rating: card.rating,
        reviews: card.review_count,
        merchant: card.merchant_domain,
        image: card.image_url,
        role: card.matched_brand_role,
        productId: card.catalog_product_id,
        searches: searchesOfRun.get(card.prompt_result_id) ?? [],
      },
    ];
  });
  // How the answers showed it, its latest card first: its rating there.
  const shown = [...own].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  const results = await resultsRead;
  const shelves = productShelves(product, detailCards, { include: asked?.promptId ?? null });
  const focus = focusShelf(shelves, asked);
  const ai = (stats.data ?? []).find((row) => row.product_id === productId);
  return {
    product,
    readiness: readiness(product),
    shelves,
    focus,
    comparison: focus
      ? comparison(product, focus, {
          own: shown ? { rating: shown.rating, reviews: shown.review_count } : null,
          price: priceText,
          storeDomain: domain.data?.domain ?? null,
        })
      : [],
    ai: {
      visits: Number(ai?.ai_visits ?? 0),
      orders: Number(ai?.orders ?? 0),
      revenue: ai?.revenue === null || ai?.revenue === undefined ? null : Number(ai.revenue),
      currency: ai?.currency ?? null,
    },
    result: results[resultKey({ type: 'product', id: productId })] ?? null,
  };
}

// ── What AI says about a product (Product Visibility, ECOM-012) ───────────────

/** The product's cards read at most, the latest first, for its answers. */
const AI_SAYS_CARDS = 200;
/** Answers quoted from at most, the latest: their whole text is read. */
const AI_SAYS_QUOTED = 8;
/** Answers whose sources are counted, the latest. */
const AI_SAYS_CITED = 20;

/**
 * "What AI says" about a product (ECOM-012, V1): the answers in the period
 * that showed it, quoted where they name it, and the sources they cited
 * (lib/shopping/aiSays.ts). Read apart from the product's page, which it
 * follows: the answers' text is the heavy part. Through the member's
 * session (RLS) on the page; the MCP server runs it with the service role,
 * so every read here keeps to the brand by its brand_id filter.
 */
export async function getProductAiSays(
  brandId: string,
  productId: string,
  filters: ShoppingFilters,
): Promise<ProductAiSays> {
  if (!z.guid().safeParse(brandId).success || !z.guid().safeParse(productId).success) {
    throw new Error('invalid');
  }
  const supabase = await dbClient();
  const [cards, product] = await Promise.all([
    cardsInWindow(
      supabase,
      brandId,
      filters,
      'prompt_result_id, product_title, product_brand, created_at',
    )
      .eq('catalog_product_id', productId)
      .order('created_at', { ascending: false })
      .limit(AI_SAYS_CARDS),
    supabase
      .from('catalog_products')
      .select('title, product_brand')
      .eq('brand_id', brandId)
      .eq('id', productId)
      .maybeSingle(),
  ]);
  if (cards.error) throw new Error(cards.error.message);
  if (product.error) throw new Error(product.error.message);

  // The answers, the latest first, with how each one's cards titled the
  // product, and the brand they named, to look for the product's own name.
  const titlesOf = new Map<string, string[]>();
  const brands = new Set<string>();
  if (product.data?.product_brand) brands.add(product.data.product_brand);
  for (const card of (cards.data ?? []) as unknown as {
    prompt_result_id: string;
    product_title: string | null;
    product_brand: string | null;
  }[]) {
    const titles = titlesOf.get(card.prompt_result_id) ?? [];
    if (card.product_title?.trim()) titles.push(card.product_title.trim());
    titlesOf.set(card.prompt_result_id, titles);
    if (card.product_brand?.trim()) brands.add(card.product_brand.trim());
  }
  const ids = [...titlesOf.keys()];
  if (!ids.length) return { answers: 0, quotes: [], sources: [] };
  const [answers, citations] = await Promise.all([
    supabase
      .from('prompt_results')
      .select('id, platform, created_at, response, prompt:prompt_id ( text )')
      .eq('brand_id', brandId)
      .in('id', ids.slice(0, AI_SAYS_QUOTED)),
    supabase
      .from('prompt_result_citations')
      .select('prompt_result_id, url:url_id ( url, domain, title )')
      .eq('brand_id', brandId)
      .in('prompt_result_id', ids.slice(0, AI_SAYS_CITED)),
  ]);
  if (answers.error) throw new Error(answers.error.message);
  if (citations.error) throw new Error(citations.error.message);
  const answerRows = (answers.data ?? []) as unknown as {
    id: string;
    platform: string;
    created_at: string;
    response: string | null;
    prompt: { text: string } | null;
  }[];
  const citationRows = (citations.data ?? []) as unknown as {
    prompt_result_id: string;
    url: { url: string; domain: string; title: string | null } | null;
  }[];
  return productAiSays(
    answerRows.map((row): AiSaysAnswer => ({
      promptResultId: row.id,
      platform: row.platform,
      at: row.created_at,
      promptText: row.prompt?.text ?? null,
      response: row.response ?? '',
      titles: titlesOf.get(row.id) ?? [],
    })),
    citationRows.flatMap((row) =>
      row.url
        ? [
            {
              promptResultId: row.prompt_result_id,
              url: row.url.url,
              domain: row.url.domain,
              title: row.url.title,
            },
          ]
        : [],
    ),
    product.data?.title ? [product.data.title] : [],
    ids.length,
    [...brands],
  );
}

// ── Re-check after a done action (Product Visibility, ECOM-018) ───────────────

/** Done actions this recent are re-checked: older ones say little about the shelf now. */
const RECHECK_SINCE_DAYS = 60;
/** The actions read at most, the latest done first. */
const RECHECK_ACTIONS = 500;

const recheckTargets = z
  .array(z.object({ type: z.enum(['product', 'category']), id: z.guid() }))
  .max(RECHECK_TARGETS);

/**
 * Each target's last done action from Products, 7 days on: the shelves of
 * its questions in the week before it was done beside the week after
 * (recheck.ts), by "product:<id>" / "category:<id>". Every question the
 * actions name is read, IDS_PER_READ ids a read; a category's own products
 * are what count on its shelves. A read that stops at CARD_MAX_ROWS leaves
 * its oldest cards (the week before, first) unread: an action with one of
 * its questions is `partial`, and isn't compared. Through the member's
 * session (RLS): only the brand's own actions, cards and catalog.
 */
async function readActionResults(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  targets: { type: 'product' | 'category'; id: string }[],
  now: number = Date.now(),
): Promise<Record<string, ActionResult>> {
  const wanted = new Set(targets.map(resultKey));
  if (!wanted.size) return {};
  const { data, error } = await supabase
    .from('actions')
    .select('id, action_no, completed_at, payload')
    .eq('brand_id', brandId)
    .in('kind', [...FROM_PRODUCTS_KINDS])
    .eq('status', 'completed')
    .gte('completed_at', new Date(now - RECHECK_SINCE_DAYS * 86_400_000).toISOString())
    .order('completed_at', { ascending: false })
    .limit(RECHECK_ACTIONS);
  if (error) throw new Error(error.message);

  const actions = new Map<string, RecheckAction>();
  for (const row of data ?? []) {
    const payload = (row.payload ?? {}) as {
      target?: { type?: unknown; id?: unknown };
      promptIds?: unknown;
    };
    const type = payload.target?.type;
    const id = payload.target?.id;
    if ((type !== 'product' && type !== 'category') || typeof id !== 'string') continue;
    const target = { type, id } as RecheckAction['target'];
    const key = resultKey(target);
    // The latest done one per target: the rows come newest first.
    if (!wanted.has(key) || actions.has(key) || !row.completed_at) continue;
    actions.set(key, {
      id: row.id,
      actionNo: Number(row.action_no),
      target,
      completedAt: row.completed_at,
      promptIds: Array.isArray(payload.promptIds)
        ? payload.promptIds.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }
  if (!actions.size) return {};

  const promptIds = [...new Set([...actions.values()].flatMap((a) => a.promptIds))];
  const dones = [...actions.values()].map((a) => Date.parse(a.completedAt));
  const week = RECHECK_DAYS * 86_400_000;
  const from = new Date(Math.min(...dones) - week).toISOString();
  const to = new Date(Math.min(now, Math.max(...dones) + week)).toISOString();
  const categoryIds = [...actions.values()].flatMap((a) =>
    a.target.type === 'category' ? [a.target.id] : [],
  );
  // The questions of a read cut at CARD_MAX_ROWS.
  const cutPrompts = new Set<string>();
  const [rows, links] = await Promise.all([
    readForIds(promptIds, async (some) => {
      const { rows: read, cut } = await readCardPages<{
        created_at: string;
        platform: string;
        catalog_product_id: string | null;
        prompt_results: { prompt_id: string } | null;
      }>(() =>
        supabase
          .from('prompt_result_shopping_cards')
          .select('created_at, platform, catalog_product_id, prompt_results!inner ( prompt_id )')
          .eq('brand_id', brandId)
          .gte('created_at', from)
          .lt('created_at', to)
          .in('prompt_results.prompt_id', some),
      );
      if (cut) for (const id of some) cutPrompts.add(id);
      return read;
    }),
    // A category's products: those its shelves count.
    readForIds(categoryIds, (some) =>
      readCatalogRows<{ product_id: string; category_id: string }>(
        () =>
          supabase
            .from('catalog_product_categories')
            .select('product_id, category_id')
            .eq('brand_id', brandId)
            .in('category_id', some)
            .order('product_id')
            .order('category_id'),
        CARD_MAX_ROWS,
      ),
    ),
  ]);
  const productsOf = new Map<string, string[]>();
  for (const link of links) {
    if (!productsOf.has(link.category_id)) productsOf.set(link.category_id, []);
    productsOf.get(link.category_id)!.push(link.product_id);
  }
  for (const action of actions.values()) {
    if (action.target.type === 'category') action.products = productsOf.get(action.target.id) ?? [];
  }
  const cards: RecheckCard[] = rows.flatMap((row) =>
    row.prompt_results
      ? [
          {
            promptId: row.prompt_results.prompt_id,
            platform: row.platform,
            at: row.created_at,
            productId: row.catalog_product_id,
          },
        ]
      : [],
  );
  return Object.fromEntries(
    [...actions].map(([key, action]) => {
      const result = actionResult(action, cards, now);
      if (action.promptIds.some((id) => cutPrompts.has(id))) result.partial = true;
      return [key, result];
    }),
  );
}

/** What the brand's done Products actions did, 7 days on, for the Categories table (ECOM-018). */
export async function getShoppingActionResults(
  brandId: string,
  targets: { type: 'product' | 'category'; id: string }[],
): Promise<Record<string, ActionResult>> {
  const parsed = recheckTargets.safeParse(targets);
  if (!z.guid().safeParse(brandId).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  return readActionResults(supabase, brandId, parsed.data);
}

// ── Actions from Product Visibility (ECOM-013) ────────────────────────────────

/** A work type sent with a product or category, for a person ("me") or the agent. */
export interface ShoppingWork {
  type: 'optimize_page' | 'create_content' | 'get_listed' | 'technical';
  who: 'me' | 'agent';
  /** The line the person saw for it: the task's why. */
  why?: string;
}

/** Questions the route takes with an action at most (fromProducts.js MAX_PROMPTS). */
const ACTION_MAX_PROMPTS = 50;
/** A work line's length the route takes at most. */
const ACTION_WHY_MAX = 500;

/** A work line cut to what the route takes, at a word where one is near. */
function cutWhy(why: string): string {
  const text = why.trim();
  if (text.length <= ACTION_WHY_MAX) return text;
  let cut = text.slice(0, ACTION_WHY_MAX - 1);
  // Not half of a character written as two.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(' ');
  return `${(space > ACTION_WHY_MAX - 100 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Sends a product or a category to the Action Center with the work picked
 * (POST /api/action-center/products); the open one comes back when it was
 * sent before. A category's questions past ACTION_MAX_PROMPTS, and a work
 * line past ACTION_WHY_MAX, are cut here: the route refuses them whole.
 */
export async function sendShoppingActions(
  brandId: string,
  target: { type: 'product' | 'category'; id: string },
  work: ShoppingWork[],
  promptIds: string[],
): Promise<{ actionId: string; actionNo: number; created: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };
  const res = await fetch(`${API_BASE_URL}/api/action-center/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      brandId,
      target,
      work: work.map((item) => (item.why ? { ...item, why: cutWhy(item.why) } : item)),
      promptIds: [...new Set(promptIds)].slice(0, ACTION_MAX_PROMPTS),
    }),
  });
  // Returned, not thrown: a thrown error's message is masked in production.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.details || body.error || `Server error: ${res.status}` };
  }
  return res.json();
}
