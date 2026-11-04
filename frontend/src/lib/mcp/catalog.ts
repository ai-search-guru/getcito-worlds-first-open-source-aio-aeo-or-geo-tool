import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { readAllRpcRows } from '@/lib/supabase/rpcPages';
import {
  CARD_MAX_ROWS,
  hasMerchantCenter,
  readCatalogProducts,
  readCatalogRows,
  readCatalogSources,
  readForIds,
} from '@/lib/shopping/catalogRead';
import { readiness, type ReadinessCheck } from '@/lib/shopping/products';
import { brandAllowed, planIncludes } from './data';

/**
 * A brand's product catalog (#1263) for the MCP tools get_catalog_sources and
 * list_catalog_products and their REST mirrors (MCP plan B6a): where it is
 * read from and how its last sync went, and its products as Product
 * Visibility reads them (readCatalogProducts), each with its readiness for
 * AI shopping, its Google Merchant Center issues (00296) and the AI visits
 * and orders its page brought (00361). Read through the service role once
 * the brand is the key's. The readiness, the issues and the AI visits are
 * Product Visibility's Products tab, so like that tab (and the other shopping
 * reads) they need a plan with shopping analytics: on another plan they are
 * null and only the products themselves are read.
 */

/** A catalog source and its last sync, as Settings › Integrations › Catalog shows it. */
export interface McpCatalogSource {
  id: string;
  /** feed_url, upload, or a store's connector (shopify, merchant_center…). */
  kind: string;
  format: string;
  url: string | null;
  /** A store's account (a shop's domain); null for feeds and uploads. */
  account: string | null;
  label: string | null;
  last_synced_at: string | null;
  /** ok, failed, format_error or auth_failed (the store refused the saved sign-in). */
  last_status: string | null;
  last_error: string | null;
  /** What the last sync read: items, skipped, added/changed/removed, Merchant Center issues, past the plan's cap. */
  last_counts: Record<string, unknown> | null;
  /** Its products in the catalog now. */
  products: number;
}

export async function getCatalogSourcesFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<McpCatalogSource[] | null> {
  if (!(await brandAllowed(auth, brandId))) return null;
  const sources = await readCatalogSources(supabaseAdmin, brandId);
  return sources.map((s) => ({
    id: s.id,
    kind: s.kind,
    format: s.format,
    url: s.url,
    account: s.account,
    label: s.label,
    last_synced_at: s.lastSyncedAt,
    last_status: s.lastStatus,
    last_error: s.lastError,
    last_counts: s.lastCounts as Record<string, unknown> | null,
    products: s.products,
  }));
}

/** A catalog product as list_catalog_products gives it. */
export interface McpCatalogProduct {
  id: string;
  title: string;
  url: string | null;
  brand: string | null;
  product_type: string | null;
  category: string | null;
  image: string | null;
  /** Its lowest price in stock (else of any variant), sale price first. */
  price: number | null;
  currency: string | null;
  in_stock: boolean;
  has_gtin: boolean;
  /**
   * How ready it is for AI shopping, 0–100, the checks it misses, and those
   * that can't be made (left out of the score). Null on a plan without
   * shopping analytics, as are the issues and the AI visits below.
   */
  readiness: { score: number; missing: ReadinessCheck[]; unknown: ReadinessCheck[] } | null;
  /**
   * Google Merchant Center's issues on its offers by severity, each issue
   * (its code and attribute) once however many of its variants and
   * destinations it is on; null without a Merchant Center account whose last
   * sync went through.
   */
  merchant_center_issues: McpIssueCounts | null;
  /** AI-referred visits to its page and the orders they led to, over the last 30 days. */
  ai_visits_30d: number | null;
  orders_30d: number | null;
  /** Those orders' revenue, in their main currency; null without orders. */
  revenue_30d: number | null;
  revenue_currency: string | null;
}

export interface McpCatalogPage {
  /** The brand's live products that match. */
  total: number;
  products: McpCatalogProduct[];
  /** The offset of the next page; null on the last. */
  next_offset: number | null;
}

/** A product's AI visits and orders (catalog_product_ai_stats, 00361). */
interface ProductAiStatsRow {
  product_id: string;
  ai_visits: number;
  orders: number;
  revenue: number | null;
  currency: string | null;
}

const SEVERITIES = ['disapproved', 'demoted', 'not_impacted'] as const;
type Severity = (typeof SEVERITIES)[number];
type McpIssueCounts = Record<Severity, number>;

const PRODUCTS_DEFAULT = 50;
const PRODUCTS_MAX = 200;
const STATS_DAYS = 30;
/** PostgREST's answer to an offset past the rows it counted (416). */
const PAST_THE_END = 'PGRST103';

/**
 * `text` as a regular expression that matches it as written. The search is
 * a case-insensitive regex (`~*`), not ilike: PostgREST turns every `*` of
 * a like pattern into `%` before Postgres reads it, so no escape keeps one.
 */
const literal = (text: string) => text.replace(/[\\^$.*+?()[\]{}|]/g, (c) => `\\${c}`);

/**
 * A page of the brand's live catalog products, by title, each read as
 * Product Visibility reads it; `search` narrows to titles containing it.
 * Null for a brand outside the key's organization. Without shopping
 * analytics in the plan, each product's readiness, issues and AI visits are
 * null, and neither the issues nor the visits are read.
 */
export async function listCatalogProductsFor(
  auth: McpAuthContext,
  params: { brandId: string; search?: string; limit?: number; offset?: number },
): Promise<McpCatalogPage | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const analytics = await planIncludes(auth.organizationId!, 'shopping_analytics');
  const limit = Math.min(Math.max(params.limit ?? PRODUCTS_DEFAULT, 1), PRODUCTS_MAX);
  const offset = Math.max(params.offset ?? 0, 0);
  const search = params.search?.trim();

  // The brand's live products the search matches; `head` for their count alone.
  const matching = (head: boolean) => {
    const query = supabaseAdmin
      .from('catalog_products')
      .select('id', { count: 'exact', head })
      .eq('brand_id', params.brandId)
      .is('removed_at', null);
    return search ? query.regexIMatch('title', literal(search)) : query;
  };
  const { data, count, error } = await matching(false)
    .order('title')
    .order('id')
    .range(offset, offset + limit - 1);
  if (error?.code === PAST_THE_END) {
    // Past the last match: an empty page, as before it.
    const { count: total, error: countError } = await matching(true);
    if (countError) throw new Error(countError.message);
    return { total: total ?? 0, products: [], next_offset: null };
  }
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((row) => row.id as string);
  const total = count ?? 0;
  if (!ids.length) return { total, products: [], next_offset: null };

  const since = new Date(Date.now() - STATS_DAYS * 86_400_000).toISOString();
  const [catalog, issues, stats] = await Promise.all([
    readCatalogProducts(supabaseAdmin, params.brandId, ids),
    analytics ? issuesOf(params.brandId, ids) : null,
    analytics
      ? readAllRpcRows<ProductAiStatsRow>(
          (start, end) =>
            supabaseAdmin
              .rpc('catalog_product_ai_stats', { p_brand_id: params.brandId, p_from: since })
              .order('product_id')
              .range(start, end) as unknown as PromiseLike<{
              data: ProductAiStatsRow[] | null;
              error: { message: string } | null;
            }>,
        )
      : [],
  ]);
  const statsOf = new Map(stats.map((row) => [row.product_id, row]));
  const byId = new Map(catalog.map((product) => [product.id, product]));

  const products = ids.flatMap((id) => {
    const product = byId.get(id);
    if (!product) return [];
    const stat = statsOf.get(id);
    return [
      {
        id,
        title: product.title,
        url: product.url,
        brand: product.brand,
        product_type: product.productType,
        category: product.category,
        image: product.image,
        price: product.price,
        currency: product.currency,
        in_stock: product.inStock,
        has_gtin: product.hasGtin,
        readiness: analytics ? readiness(product) : null,
        merchant_center_issues: issues && (issues.get(id) ?? noIssues()),
        ai_visits_30d: analytics ? Number(stat?.ai_visits ?? 0) : null,
        orders_30d: analytics ? Number(stat?.orders ?? 0) : null,
        revenue_30d: stat?.revenue == null ? null : Number(stat.revenue),
        revenue_currency: stat?.currency ?? null,
      },
    ];
  });
  return {
    total,
    products,
    next_offset: offset + ids.length < total ? offset + ids.length : null,
  };
}

const noIssues = (): McpIssueCounts => ({ disapproved: 0, demoted: 0, not_impacted: 0 });

/**
 * Merchant Center's issues on the products' offers (00296: a row per issue,
 * destination and offer, an offer being a variant's external id), counted
 * per product by severity, each issue (code and attribute) once: one thing
 * to fix, though it is on every size and in Shopping ads and free listings
 * alike. Every variant and issue read, 100 ids and 1,000 rows a request.
 * Null without a Merchant Center account whose last sync went through
 * (hasMerchantCenter, as the editor's shopping check): its issues aren't
 * current then, if there are any.
 */
async function issuesOf(
  brandId: string,
  productIds: string[],
): Promise<Map<string, McpIssueCounts> | null> {
  if (!(await hasMerchantCenter(supabaseAdmin, brandId))) return null;
  const variants = await readForIds(productIds, (some) =>
    readCatalogRows<{ product_id: string; external_id: string }>(
      () =>
        supabaseAdmin
          .from('catalog_variants')
          .select('product_id, external_id')
          .eq('brand_id', brandId)
          .is('removed_at', null)
          .in('product_id', some)
          .order('id'),
      CARD_MAX_ROWS,
    ),
  );
  const productOf = new Map(variants.map((v) => [v.external_id, v.product_id]));
  const issues = await readForIds([...productOf.keys()], (some) =>
    readCatalogRows<{
      external_id: string;
      severity: string;
      code: string;
      attribute: string | null;
    }>(
      () =>
        supabaseAdmin
          .from('catalog_item_issues')
          .select('external_id, severity, code, attribute')
          .eq('brand_id', brandId)
          .in('external_id', some)
          .order('id'),
      CARD_MAX_ROWS,
    ),
  );

  const seen = new Map<string, Set<string>>();
  const counts = new Map<string, McpIssueCounts>();
  for (const issue of issues) {
    const product = productOf.get(issue.external_id);
    const severity = issue.severity as Severity;
    if (!product || !SEVERITIES.includes(severity)) continue;
    const key = JSON.stringify([severity, issue.code, issue.attribute]);
    const own = seen.get(product) ?? new Set<string>();
    if (own.has(key)) continue;
    own.add(key);
    seen.set(product, own);
    const tally = counts.get(product) ?? noIssues();
    tally[severity] += 1;
    counts.set(product, tally);
  }
  return counts;
}
