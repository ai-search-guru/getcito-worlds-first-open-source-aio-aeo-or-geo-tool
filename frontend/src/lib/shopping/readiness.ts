import type { CatalogSource } from '@/lib/catalog';
import type { ShoppingMarket } from '@/lib/shopping/markets';
import { openAiIndexStatus, type OpenAiIndexRead } from '@/lib/shopping/openaiIndex';
import type { ProductRow, ReadinessCheck } from '@/lib/shopping/products';
import { priceText } from '@/lib/shopping/price';
import { pageKey } from '@/lib/content/feedMatch';

/**
 * Product Visibility's Readiness (ECOM-015, spec §3.4 / §3.4b): how ready
 * the brand is for AI shopping, as a checklist scored 0–100. Only what
 * GetCito can read is checked: the catalog and its feed, Merchant Center,
 * OpenAI's product index in the US, the prices AI answers show, resellers
 * and Amazon's share. What it can't read yet (product page schema, return
 * policies, AI bots on product pages, colors as separate items) isn't
 * listed rather than guessed.
 */

export type CheckState = 'pass' | 'warn' | 'fail' | 'unknown';

export type ReadinessKey =
  | 'catalog'
  | 'merchantCenter'
  | 'googleShopping'
  | 'openAiIndex'
  | 'verifiedSeller'
  | 'firstWords'
  | 'feedFields'
  | 'feedLinks'
  | 'wrongPrice'
  | 'resellerCheaper'
  | 'amazonShare';

export interface ReadinessItem {
  key: ReadinessKey;
  state: CheckState;
  /** Values for its title and line (en.json shopping.readiness.checks). */
  values?: Record<string, string | number>;
  /** Where its fix starts: the Products table, or Settings › Integrations. */
  action?: 'products' | 'settings';
}

/**
 * The brand's pages Google showed as merchant listings or product snippets
 * over the last 28 days (Search Console, 00377), by page key; or why it
 * can't say: no property mapped, or not read yet.
 */
export interface ShoppingSearchAppearance {
  state: 'not_connected' | 'not_synced' | 'read';
  pages: string[];
}

/** At least this share of the products with a page shown passes; fewer, but some, warns. */
export const SHOWN_PASS_SHARE = 0.5;

export interface ReadinessInput {
  market: ShoppingMarket;
  /** The brand's catalog sources; null when they couldn't be read. */
  catalog: CatalogSource[] | null;
  /**
   * Whether this deployment can connect Google Merchant Center. Where it
   * can't and the brand has no Merchant Center source, the check isn't
   * listed, nor scored: nothing the brand can do about it here.
   */
  merchantCenterOffered: boolean;
  /** The catalog's products; null without a catalog, or while unread. */
  products: ProductRow[] | null;
  /** Google's shopping results from Search Console; null when it couldn't be read. */
  searchAppearance: ShoppingSearchAppearance | null;
  /** OpenAI's product index (US); null when not read. */
  openAi: OpenAiIndexRead | null;
  /** Resellers cheaper than the brand in AI answers; null when not read. */
  cheaperResellers: number | null;
  /** Amazon's share of where AI sends shoppers, when it fell sharply. */
  amazonDrop: { from: number; to: number } | null;
}

const SCORE: Record<CheckState, number | null> = { pass: 1, warn: 0.5, fail: 0, unknown: null };

/** A share of products as a state: all pass, most warn, the rest fail. */
function shareState(bad: number, total: number, warnUpTo = 0.1): CheckState {
  if (bad === 0) return 'pass';
  return bad / total <= warnUpTo ? 'warn' : 'fail';
}

/** The fields AI shopping feeds need on each product. */
const FEED_FIELDS: readonly ReadinessCheck[] = ['gtin', 'image', 'price', 'brand', 'category'];

export function readinessChecklist(input: ReadinessInput): {
  score: number | null;
  items: ReadinessItem[];
} {
  const items: ReadinessItem[] = [];
  const catalog = input.catalog ?? [];
  const products = input.products ?? [];

  items.push({
    key: 'catalog',
    state: input.catalog === null ? 'unknown' : catalog.length ? 'pass' : 'fail',
    values: { count: products.length },
    action: catalog.length ? undefined : 'settings',
  });
  const merchantCenter = catalog.some((source) => source.kind === 'merchant_center');
  if (merchantCenter || input.merchantCenterOffered) {
    items.push({
      key: 'merchantCenter',
      // In Europe the Merchant Center feed decides ChatGPT too (§3.4b). Sources
      // that couldn't be read say nothing either way.
      state:
        input.catalog === null
          ? 'unknown'
          : merchantCenter
            ? 'pass'
            : input.market === 'europe'
              ? 'fail'
              : 'warn',
      action: merchantCenter || input.catalog === null ? undefined : 'settings',
    });
  }
  if (products.length) {
    // The products with a page, as Search Console's pages are keyed.
    const linked = new Set(products.flatMap((row) => pageKey(row.product.url) ?? []));
    const search = input.searchAppearance;
    if (!search || search.state !== 'read' || linked.size === 0) {
      items.push({
        key: 'googleShopping',
        state: 'unknown',
        values: {
          reason: !search ? 'unread' : search.state === 'read' ? 'no_pages' : search.state,
        },
        action: search?.state === 'not_connected' ? 'settings' : undefined,
      });
    } else {
      const shownPages = new Set(search.pages);
      const shown = [...linked].filter((key) => shownPages.has(key)).length;
      items.push({
        key: 'googleShopping',
        state: shown === 0 ? 'fail' : shown / linked.size >= SHOWN_PASS_SHARE ? 'pass' : 'warn',
        values: { count: shown, total: linked.size },
      });
    }
  }
  if (input.market === 'us') {
    if (input.openAi) {
      const status = openAiIndexStatus(input.openAi);
      items.push({
        key: 'openAiIndex',
        state: status === 'direct_feed' ? 'pass' : status === 'found' ? 'warn' : 'fail',
        values: { status },
      });
    }
    items.push({ key: 'verifiedSeller', state: 'unknown' });
  }

  if (products.length) {
    // Only the products with a type can be checked (products.ts, readiness):
    // without any, the check is unknown and left out of the score.
    const typed = products.filter((row) => !row.unknown?.includes('typeFirst'));
    const firstWords = typed.filter((row) => row.missing.includes('typeFirst')).length;
    items.push({
      key: 'firstWords',
      state: typed.length ? shareState(firstWords, typed.length) : 'unknown',
      values: { count: firstWords },
      action: firstWords ? 'products' : undefined,
    });

    const incomplete = products.filter((row) =>
      FEED_FIELDS.some((field) => row.missing.includes(field)),
    ).length;
    const gtin = products.filter((row) => row.missing.includes('gtin')).length;
    const image = products.filter((row) => row.missing.includes('image')).length;
    const complete = Math.round(((products.length - incomplete) / products.length) * 100);
    items.push({
      key: 'feedFields',
      state: complete >= 90 ? 'pass' : complete >= 60 ? 'warn' : 'fail',
      values: { percent: complete, gtin, image },
      action: incomplete ? 'products' : undefined,
    });

    const linked = products.filter((row) => row.product.url);
    if (linked.length) {
      const untagged = linked.filter(
        (row) => !/[?&]utm_medium=feed(?:&|$)/i.test(row.product.url ?? ''),
      ).length;
      items.push({
        key: 'feedLinks',
        state: untagged === 0 ? 'pass' : untagged === linked.length ? 'fail' : 'warn',
        values: { count: untagged },
      });
    }

    const wrong = products.filter((row) => row.wrongPrice);
    const example = wrong[0];
    items.push({
      key: 'wrongPrice',
      state: wrong.length ? 'fail' : 'pass',
      values: example
        ? {
            count: wrong.length,
            product: example.product.title,
            seen: example.wrongPrice!.seen,
            yours: example.product.price ?? 0,
            currency: example.product.currency ?? example.wrongPrice!.currency ?? 'USD',
          }
        : { count: 0 },
      action: wrong.length ? 'products' : undefined,
    });
  }

  if (input.cheaperResellers !== null) {
    items.push({
      key: 'resellerCheaper',
      state: input.cheaperResellers ? 'fail' : 'pass',
      values: { count: input.cheaperResellers },
    });
  }
  if (input.amazonDrop) {
    items.push({
      key: 'amazonShare',
      state: 'warn',
      values: {
        from: Math.round(input.amazonDrop.from * 100),
        to: Math.round(input.amazonDrop.to * 100),
      },
    });
  }

  const scored = items
    .map((item) => SCORE[item.state])
    .filter((value): value is number => value !== null);
  return {
    score: scored.length
      ? Math.round((100 * scored.reduce((a, b) => a + b, 0)) / scored.length)
      : null,
    items,
  };
}

/** The values a check's copy reads (en.json shopping.readiness.checks), prices written as prices. */
export function copyValues(item: ReadinessItem): Record<string, string | number> {
  const values = { ...(item.values ?? {}) };
  if (item.key === 'wrongPrice' && typeof values.seen === 'number') {
    const currency = String(values.currency ?? 'USD');
    values.seen = priceText(Number(values.seen), currency);
    values.yours = priceText(Number(values.yours), currency);
  }
  return values;
}

/** The AI channels a shop sells through, in the spec's priority order. */
export const READINESS_CHANNELS = [
  'chatgpt-shopping',
  'google-aio',
  'google-aimode',
  'gemini-web',
  'copilot-web',
] as const;

export type ChannelState = 'showing' | 'notShowing' | 'notTracked';

/** A channel's state: the brand's products on its shelves, its shelves without them, or none read. */
export function channelState(
  platform: string,
  tracked: readonly string[],
  ownSlots: ReadonlyMap<string, number>,
): ChannelState {
  if ((ownSlots.get(platform) ?? 0) > 0) return 'showing';
  return tracked.includes(platform) ? 'notShowing' : 'notTracked';
}
