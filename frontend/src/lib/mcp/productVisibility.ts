import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { API_BASE_URL } from '@/config/api';
import {
  getProductAiSays,
  getResellerPriceAlerts,
  getShoppingAmazonShareDropAlert,
  getShoppingFilterOptions,
  getShoppingOwnChannels,
  getShoppingProducts,
  getShoppingSearchAppearance,
  getShoppingShelf,
  type ShoppingDatePreset,
  type ShoppingFilters,
} from '@/lib/actions/shopping';
import { getBrandMarketCountries } from '@/lib/actions/shoppingMarket';
import { getOpenAiIndexRead } from '@/lib/actions/shoppingOpenaiIndex';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { readCatalogSources } from '@/lib/shopping/catalogRead';
import { defaultMarket, type ShoppingMarket } from '@/lib/shopping/markets';
import type { ProductRow, ReadinessCheck } from '@/lib/shopping/products';
import {
  READINESS_CHANNELS,
  channelState,
  copyValues,
  readinessChecklist,
  type ChannelState,
  type CheckState,
  type ReadinessKey,
} from '@/lib/shopping/readiness';
import { whyNotYou } from '@/lib/shopping/shelf';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { dbClient, withDbClient } from '@/lib/supabase/scoped';
import { NOT_IN_PLAN, brandAllowed, planIncludes } from './data';

/**
 * Product Visibility over MCP (plan B6b): the Shelf with "Why not you?", the
 * Readiness checklist and a product's "What AI says", read by the page's own
 * loaders (lib/actions/shopping*.ts) with the service role once the brand is
 * the key's, so the tools and the page can't drift apart. Like the page's
 * tabs they need a plan with Product Visibility (shopping_analytics).
 */

/** The windows a read takes, as the page's date filter. */
export const PV_PERIODS: readonly ShoppingDatePreset[] = ['7d', '30d', '90d', 'all'];

const SHELVES_DEFAULT = 10;
const SHELVES_MAX = 50;
/** A shelf's products given, from the top; `products_total` counts them all. */
const SHELF_PRODUCTS = 10;

/** The page's loaders, with the service role in their dbClient(). */
const asService = <T>(read: () => Promise<T>) =>
  withDbClient(supabaseAdmin as unknown as Awaited<ReturnType<typeof dbClient>>, read);

/**
 * Null for another organization's brand, NOT_IN_PLAN without Product
 * Visibility, else nothing in the way. The plan check is the other shopping
 * reads' (planIncludes): the plan the organization is on, as the page reads
 * it, so a trial or subscription that ended leaves the reads open.
 */
async function access(
  auth: McpAuthContext,
  brandId: string,
): Promise<null | typeof NOT_IN_PLAN | true> {
  if (!(await brandAllowed(auth, brandId))) return null;
  return (await planIncludes(auth.organizationId!, 'shopping_analytics')) ? true : NOT_IN_PLAN;
}

/**
 * The ChatGPT Shopping market to read: the one asked, else the brand's own
 * (its domains' and prompts' countries), as the page opens on. A failed read
 * makes no claim, as on the page: no market.
 */
async function marketOf(brandId: string, asked?: ShoppingMarket): Promise<ShoppingMarket | null> {
  if (asked) return asked;
  return getBrandMarketCountries(brandId).then(defaultMarket, (err: unknown) => {
    console.error('[mcp] Failed to read the brand market:', err);
    return null;
  });
}

// ─── The Shelf (ECOM-006) and "Why not you?" ───

/** A product on a shelf. */
export interface McpShelfProduct {
  /** Its place on the shelf, from 1. */
  rank: number;
  title: string;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviews: number | null;
  merchant: string | null;
  /** One of the brand's own products. */
  own: boolean;
  /** The marketplace an own product was linked through ("Amazon"), else null. */
  via: string | null;
  /** Its catalog product, when matched. */
  product_id: string | null;
}

/** "Why not you?": the brand's product the question asks for most, on a shelf it isn't on. */
export interface McpWhyNotYou {
  product_id: string;
  title: string;
  url: string | null;
  price: number | null;
  currency: string | null;
  /** Its readiness for AI shopping, 0–100, and the checks it misses. */
  readiness: { score: number; missing: ReadinessCheck[] };
}

/** One shopping question on one channel: its latest shelf, and the brand's last 7 days on it. */
export interface McpShelf {
  prompt_id: string;
  prompt: string;
  platform: string;
  /** When its latest shelf was read. */
  read_at: string;
  /** The brand's best place on the latest shelf; null when it isn't on it. */
  own_rank: number | null;
  week_shelves: number;
  week_own_shelves: number;
  /** Its first SHELF_PRODUCTS products, from the top. */
  products: McpShelfProduct[];
  /** Every product on the shelf. */
  products_total: number;
  why_not_you: McpWhyNotYou | null;
}

export interface McpShelfPage {
  period: ShoppingDatePreset;
  /** The ChatGPT Shopping market read; null when the brand has none. */
  market: ShoppingMarket | null;
  /** The brand's place on every shelf in the period. */
  stats: {
    slots: number;
    own_slots: number;
    /** Its distinct products on the shelves: catalog products when matched, else titles. */
    products: number;
    from_catalog: boolean;
    channels: { platform: string; own_slots: number }[];
  };
  /** The brand's live catalog products; null without a catalog. */
  catalog_products: number | null;
  /** The shelves that match, those it isn't on first, then where it ranks lowest. */
  total: number;
  shelves: McpShelf[];
  next_offset: number | null;
}

export async function getShoppingShelfFor(
  auth: McpAuthContext,
  params: {
    brandId: string;
    period?: ShoppingDatePreset;
    platform?: string;
    market?: ShoppingMarket;
    absentOnly?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<McpShelfPage | typeof NOT_IN_PLAN | null> {
  const allowed = await access(auth, params.brandId);
  if (allowed !== true) return allowed;
  const period = params.period ?? '30d';
  const limit = Math.min(Math.max(params.limit ?? SHELVES_DEFAULT, 1), SHELVES_MAX);
  const offset = Math.max(params.offset ?? 0, 0);

  return asService(async () => {
    const market = await marketOf(params.brandId, params.market);
    const filters: ShoppingFilters = {
      datePreset: period,
      platforms: params.platform ? [params.platform] : undefined,
      chatgptMarket: market ?? undefined,
    };
    // "Why not you?" picks from the products the page's Products table reads
    // over the same window: read beside the shelves, as the page does, and
    // waited for only when a shelf on this page lacks the brand's products.
    const productsRead = getShoppingProducts(params.brandId, filters).then(
      (read) => ({ rows: read?.rows ?? [] }),
      (err: unknown) => ({ err }),
    );
    const shelf = await getShoppingShelf(params.brandId, filters);
    const rows = params.absentOnly ? shelf.rows.filter((row) => row.ownRank === null) : shelf.rows;
    const page = rows.slice(offset, offset + limit);
    let products: readonly ProductRow[] = [];
    if (shelf.catalogProducts && page.some((row) => row.ownRank === null)) {
      const read = await productsRead;
      if ('err' in read) throw read.err;
      products = read.rows;
    }

    return {
      period,
      market,
      stats: {
        slots: shelf.stats.slots,
        own_slots: shelf.stats.ownSlots,
        products: shelf.stats.products,
        from_catalog: shelf.stats.fromCatalog,
        channels: shelf.stats.channels.map((c) => ({
          platform: c.platform,
          own_slots: c.ownSlots,
        })),
      },
      catalog_products: shelf.catalogProducts,
      total: rows.length,
      shelves: page.map((row) => {
        const missing = whyNotYou(row, products);
        return {
          prompt_id: row.promptId,
          prompt: row.promptText,
          platform: row.platform,
          read_at: row.at,
          own_rank: row.ownRank,
          week_shelves: row.weekShelves,
          week_own_shelves: row.weekOwnShelves,
          products: row.cards.slice(0, SHELF_PRODUCTS).map((card) => ({
            rank: card.rank,
            title: card.title,
            price: card.price,
            currency: card.currency,
            rating: card.rating,
            reviews: card.reviews,
            merchant: card.merchant,
            own: card.own,
            via: card.via,
            product_id: card.productId,
          })),
          products_total: row.cards.length,
          why_not_you: missing && {
            product_id: missing.product.id,
            title: missing.product.title,
            url: missing.product.url,
            price: missing.product.price,
            currency: missing.product.currency,
            readiness: { score: missing.readiness, missing: missing.missing },
          },
        };
      }),
      next_offset: offset + page.length < rows.length ? offset + page.length : null,
    };
  });
}

// ─── Readiness (ECOM-015) ───

const checkCopy = createTranslator({
  locale: 'en',
  messages,
  namespace: 'shopping.readiness.checks',
});

export interface McpReadinessCheck {
  key: ReadinessKey;
  state: CheckState;
  /** The check and what it found, as the Readiness tab writes them. */
  title: string;
  detail: string | null;
  /** Where its fix starts: the Products tab, or Settings › Integrations › Catalog. */
  fix: 'products' | 'settings' | null;
}

export interface McpReadiness {
  /** The market the checks are for: OpenAI's index and the verified seller are the US's. */
  market: ShoppingMarket;
  period: ShoppingDatePreset;
  /** 0–100 over the checks that could be made; null when a read below failed. */
  score: number | null;
  checks: McpReadinessCheck[];
  /** Each AI channel: the brand's products on its shelves, shelves without them, or none read. */
  channels: { platform: string; state: ChannelState }[] | null;
  /**
   * The reads that failed: the catalog's sources or its products (no score:
   * it would be another one without them), or which channels hold its
   * products (no channels).
   */
  unread: ('sources' | 'products' | 'channels')[];
}

/**
 * Whether this deployment can connect Google Merchant Center, as the page
 * asks the API (/api/integrations/config), through the CRON_SECRET internal
 * endpoint: the MCP has no member session. False when it can't be read.
 */
export async function merchantCenterOffered(): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/internal/integrations-config`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { config?: { googleMerchantCenter?: boolean } };
    return Boolean(body.config?.googleMerchantCenter);
  } catch {
    return false;
  }
}

/** A read the checklist can do without: null, logged, when it fails. */
const orNull = <T>(what: string, read: Promise<T>): Promise<T | null> =>
  read.catch((err: unknown) => {
    console.error(`[mcp] Readiness: failed to read ${what}:`, err);
    return null;
  });

export async function getShoppingReadinessFor(
  auth: McpAuthContext,
  params: { brandId: string; period?: ShoppingDatePreset; market?: ShoppingMarket },
): Promise<McpReadiness | typeof NOT_IN_PLAN | null> {
  const allowed = await access(auth, params.brandId);
  if (allowed !== true) return allowed;
  const period = params.period ?? '30d';
  const { brandId } = params;

  return asService(async () => {
    const own = await marketOf(brandId, params.market);
    const market = own ?? 'us';
    const filters: ShoppingFilters = { datePreset: period, chatgptMarket: own ?? undefined };
    const [sources, products, openAi, cheaper, amazonDrop, options, ownOn, gmcOffered, search] =
      await Promise.all([
        orNull('catalog sources', readCatalogSources(supabaseAdmin, brandId)),
        getShoppingProducts(brandId, filters).then(
          (read) => read?.rows ?? null,
          (err: unknown) => {
            console.error('[mcp] Readiness: failed to read the products:', err);
            return 'failed' as const;
          },
        ),
        // As on the page: only for a brand in the US market, not one that just falls back to it.
        own === 'us' ? orNull('the OpenAI index', getOpenAiIndexRead(brandId, period)) : null,
        orNull('reseller prices', getResellerPriceAlerts(brandId, filters)),
        orNull('the Amazon share', getShoppingAmazonShareDropAlert(brandId)),
        getShoppingFilterOptions(brandId),
        // Which channels hold its products: one row a channel, not every card on the shelves.
        orNull('the channels', getShoppingOwnChannels(brandId, filters)),
        merchantCenterOffered(),
        orNull("Search Console's shopping results", getShoppingSearchAppearance(brandId)),
      ]);
    const { score, items } = readinessChecklist({
      market,
      catalog: sources,
      merchantCenterOffered: gmcOffered,
      searchAppearance: search,
      products: products === 'failed' ? null : products,
      openAi,
      cheaperResellers: cheaper?.length ?? null,
      amazonDrop: amazonDrop ? { from: amazonDrop.fromShare, to: amazonDrop.toShare } : null,
    });
    const unread: McpReadiness['unread'] = [
      ...(sources === null ? (['sources'] as const) : []),
      ...(products === 'failed' ? (['products'] as const) : []),
      ...(ownOn === null ? (['channels'] as const) : []),
    ];
    // channelState asks for the brand's slots on each channel: one at least, where it has any.
    const ownSlots = new Map((ownOn ?? []).map((platform) => [platform, 1]));

    return {
      market,
      period,
      score: sources === null || products === 'failed' ? null : score,
      checks: items.map((item) => {
        const values = copyValues(item);
        const detail = `${item.key}.${item.state}` as const;
        return {
          key: item.key,
          state: item.state,
          title: checkCopy(`${item.key}.title` as never, values as never),
          detail: checkCopy.has(detail as never)
            ? checkCopy(detail as never, values as never)
            : null,
          fix: item.action ?? null,
        };
      }),
      channels: ownOn
        ? READINESS_CHANNELS.map((platform) => ({
            platform,
            state: channelState(platform, options.platforms, ownSlots),
          }))
        : null,
      unread,
    };
  });
}

// ─── What AI says (ECOM-012) ───

export interface McpProductAiSays {
  product_id: string;
  title: string;
  period: ShoppingDatePreset;
  /** The AI answers that showed the product in the period. */
  answers: number;
  /** Where they name it, in their own words, the latest first. */
  quotes: { text: string; platform: string; at: string; prompt: string | null }[];
  /** The pages they cited most, with how many of those answers cited each. */
  sources: { url: string; domain: string; title: string | null; answers: number }[];
}

export async function getProductAiSaysFor(
  auth: McpAuthContext,
  params: { brandId: string; productId: string; period?: ShoppingDatePreset },
): Promise<McpProductAiSays | typeof NOT_IN_PLAN | null> {
  const allowed = await access(auth, params.brandId);
  if (allowed !== true) return allowed;
  const { data: product, error } = await supabaseAdmin
    .from('catalog_products')
    .select('id, title')
    .eq('brand_id', params.brandId)
    .eq('id', params.productId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!product) return null;
  const period = params.period ?? '30d';

  // As the product's page reads it: every market.
  const says = await asService(() =>
    getProductAiSays(params.brandId, params.productId, { datePreset: period }),
  );
  return {
    product_id: product.id as string,
    title: product.title as string,
    period,
    answers: says.answers,
    quotes: says.quotes.map((quote) => ({
      text: quote.text,
      platform: quote.platform,
      at: quote.at,
      prompt: quote.promptText,
    })),
    sources: says.sources,
  };
}
