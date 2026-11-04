'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, ShoppingBag, Star } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AIProviderAvatar, resolveAIProvider } from '@/components/AiProviderAvatar';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import { getSiteIconUrl } from '@/lib/siteIcon';
import { formatCompactNumber, formatNumber } from '@/lib/format';
import { getPlatformName } from '@/lib/trafficPlatforms';
import { cn } from '@/lib/utils';
import { priceText } from '@/lib/shopping/price';
import type { ShoppingAiOrders, ShoppingShelf } from '@/lib/actions/shopping';
import type { ProductRow } from '@/lib/shopping/products';
import {
  BAND_RANGE,
  PRICE_BANDS,
  inPriceBand,
  shelfCurrency,
  whyNotYou,
  type PriceBand,
  type ShelfCard,
  type ShelfRow,
} from '@/lib/shopping/shelf';

/** Rows shown before "Show more". */
const ROWS_SHOWN = 20;

const platformName = (platform: string) => PLATFORM_LABELS[platform] ?? platform;

const MARKETPLACE_NAMES: Record<string, string> = {
  amazon: 'Amazon',
  ebay: 'eBay',
  walmart: 'Walmart',
  etsy: 'Etsy',
};
const marketplaceName = (id: string) =>
  MARKETPLACE_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

/** A month's revenue, short: "$24.9k". */
function revenueText(value: number, currency: string | null): string {
  if (value < 1000) return priceText(Math.round(value), currency);
  const symbol = priceText(0, currency).replace(/[\d.,\s]/g, '');
  return `${symbol}${formatCompactNumber(Math.round(value))}`;
}

/** A change against the period before, in percent, or null when there's nothing to compare. */
function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function Kpi({
  title,
  value,
  delta,
  sub,
  loading = false,
}: {
  title: string;
  value: string;
  delta?: string | null;
  sub: React.ReactNode;
  /** Its value still being read. */
  loading?: boolean;
}) {
  if (loading) {
    return (
      <Card aria-busy="true">
        <CardContent className="space-y-1.5 p-4">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="space-y-1.5 p-4">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className="flex items-baseline gap-2">
          {/* A long value is cut: the whole of it on hover. */}
          <span className="truncate text-2xl font-bold tabular-nums" title={value}>
            {value}
          </span>
          {delta && (
            <span
              className={cn(
                'text-xs font-medium tabular-nums',
                delta.startsWith('-')
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-emerald-600 dark:text-emerald-400',
              )}
            >
              {delta}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

/**
 * The Shelf's four numbers (ECOM-006): the brand's share of the product
 * slots in AI answers, its products on the shelf (of the catalog's), its
 * orders from AI visits in the last 30 days, and the AI channel most of them
 * came from (else the one showing its products most). The two read from
 * the orders wait for them (`orders` undefined).
 */
export function ShelfKpis({
  shelf,
  orders,
  salesConnected,
}: {
  shelf: ShoppingShelf | null;
  /** The brand's orders from AI visits: undefined while read, null when they couldn't be. */
  orders: ShoppingAiOrders | null | undefined;
  /** Whether a source of sales is in: the tracking snippet, the Shopify pixel or GA. */
  salesConnected: boolean;
}) {
  const t = useTranslations('shopping.shelf.kpis');
  if (!shelf) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
    );
  }
  const { stats } = shelf;
  const share = stats.slots ? Math.round((stats.ownSlots / stats.slots) * 100) : 0;
  const revenueChange =
    orders?.revenue && orders.previousRevenue !== null
      ? change(orders.revenue.value, orders.previousRevenue)
      : null;
  const topOrders = orders?.channels[0];
  const topShelf = stats.channels[0];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi title={t('share')} value={`${share}%`} sub={t('shareSub')} />
      <Kpi
        title={t('products')}
        value={
          stats.fromCatalog && shelf.catalogProducts
            ? t('productsOf', {
                count: formatNumber(stats.products),
                total: formatNumber(shelf.catalogProducts),
              })
            : formatNumber(stats.products)
        }
        sub={stats.fromCatalog ? t('productsSub') : t('productsTitlesSub')}
      />
      <Kpi
        title={t('revenue')}
        loading={orders === undefined}
        value={
          orders?.revenue && orders.orders
            ? revenueText(orders.revenue.value, orders.revenue.currency)
            : orders?.orders
              ? formatNumber(orders.orders)
              : '—'
        }
        delta={
          revenueChange !== null && orders?.orders
            ? `${revenueChange >= 0 ? '+' : ''}${revenueChange}%`
            : null
        }
        sub={
          orders?.orders ? (
            t('orders', { count: orders.orders })
          ) : salesConnected ? (
            t('noOrders')
          ) : (
            <Link href="/dashboard/traffic" className="text-primary hover:underline">
              {t('connectSales')}
            </Link>
          )
        }
      />
      <Kpi
        title={t('channel')}
        loading={orders === undefined}
        value={
          topOrders
            ? getPlatformName(topOrders.source)
            : topShelf
              ? platformName(topShelf.platform)
              : '—'
        }
        sub={
          topOrders && orders
            ? t('channelOrders', { percent: Math.round((topOrders.orders / orders.orders) * 100) })
            : topShelf
              ? t('channelSlots', {
                  percent: Math.round((topShelf.ownSlots / stats.ownSlots) * 100),
                })
              : t('channelNone')
        }
      />
    </div>
  );
}

/**
 * The shelves that couldn't be read: said, with a way to read them again,
 * in place of their numbers and rows (which would wait on them for good).
 */
export function ShelfFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('shopping.shelf');
  const tCommon = useTranslations('common');
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <p>{t('failed')}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {tCommon('retry')}
      </Button>
    </div>
  );
}

function ProductCard({ card }: { card: ShelfCard }) {
  const t = useTranslations('shopping.shelf');
  return (
    <li
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-2.5',
        card.own && 'border-primary/60 bg-primary/5 ring-1 ring-primary/40',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-muted-foreground">
          {card.rank}
          {card.own && <span className="text-primary"> · {t('you')}</span>}
        </span>
        {card.via && (
          <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
            {t('via', { place: marketplaceName(card.via) })}
          </Badge>
        )}
      </div>
      <div className="grid h-20 place-items-center overflow-hidden rounded bg-muted/50">
        {card.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- answer images from any host
          <img
            src={card.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-contain"
          />
        ) : (
          <ShoppingBag className="h-6 w-6 text-muted-foreground/40" aria-hidden />
        )}
      </div>
      <p className="line-clamp-2 text-xs font-medium" title={card.title}>
        {card.title}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground tabular-nums">
        {card.price !== null && <span>{priceText(card.price, card.currency)}</span>}
        {card.rating !== null && (
          <span className="inline-flex items-center gap-0.5">
            <Star className="h-2.5 w-2.5 fill-current" aria-hidden />
            {card.rating.toFixed(1)}
          </span>
        )}
      </p>
      {card.merchant && (
        <p className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element -- a merchant's favicon */}
          <img
            src={getSiteIconUrl(card.merchant, 32)}
            alt=""
            className="h-3 w-3 shrink-0 rounded-sm"
            loading="lazy"
          />
          <span className="truncate">{card.merchant}</span>
        </p>
      )}
    </li>
  );
}

/**
 * "Why not you?" on a shelf the brand isn't on: its product the question
 * asks for most, greyed after the shelf's own, and the way to its page
 * opened on this shelf, beside the product AI picked.
 */
function WhyNotYouCard({ row, product }: { row: ShelfRow; product: ProductRow }) {
  const t = useTranslations('shopping.shelf.whyNot');
  const { product: p } = product;
  const href = `/dashboard/shopping/products/${p.id}?${new URLSearchParams({
    prompt: row.promptId,
    platform: row.platform,
  })}`;
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-dashed bg-muted/30 p-2.5">
      <span className="text-xs font-semibold text-muted-foreground">{t('yours')}</span>
      <div className="grid h-20 place-items-center overflow-hidden rounded bg-muted/50 opacity-60 grayscale">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- catalog images from any host
          <img
            src={p.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-contain"
          />
        ) : (
          <ShoppingBag className="h-6 w-6 text-muted-foreground/40" aria-hidden />
        )}
      </div>
      <p className="line-clamp-2 text-xs font-medium text-muted-foreground" title={p.title}>
        {p.title}
      </p>
      {p.price !== null && (
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {priceText(p.price, p.currency)}
        </p>
      )}
      <Link
        href={href}
        className="mt-auto inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
        aria-label={t('linkLabel', { product: p.title })}
      >
        {t('link')}
        <ChevronRight className="h-3 w-3" aria-hidden />
      </Link>
    </li>
  );
}

function ShelfRowCard({ row, products }: { row: ShelfRow; products: readonly ProductRow[] }) {
  const t = useTranslations('shopping.shelf');
  const missing = whyNotYou(row, products);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium" title={row.promptText}>
              {row.promptText}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AIProviderAvatar
                provider={resolveAIProvider(row.platform, row.platform)}
                className="h-3.5 w-3.5"
                plain
              />
              {platformName(row.platform)}
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
              row.ownRank === null
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : row.ownRank === 1
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'bg-primary/10 text-primary',
            )}
          >
            {row.ownRank === null
              ? t('absent')
              : row.weekShelves > 1
                ? t('rankWeek', {
                    rank: row.ownRank,
                    own: row.weekOwnShelves,
                    count: row.weekShelves,
                  })
                : t('rank', { rank: row.ownRank })}
          </span>
        </div>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {/* Room for the brand's own beside a full shelf: its last card gives way. */}
          {(missing ? row.cards.slice(0, 5) : row.cards).map((card) => (
            <ProductCard key={card.rank} card={card} />
          ))}
          {missing && <WhyNotYouCard row={row} product={missing} />}
        </ol>
      </CardContent>
    </Card>
  );
}

/**
 * The shelves (ECOM-006): one row per shopping question and channel, its
 * latest products in order with their photos, prices, ratings and
 * merchants, the brand's own ringed. Filters: the channel (the page's
 * platform filter, as chips) and the shelf's price.
 */
export function ShelfRows({
  shelf,
  platforms,
  platform,
  onPlatform,
  products = [],
}: {
  shelf: ShoppingShelf | null;
  /** The channels with data, for the chips. */
  platforms: string[];
  platform: string;
  onPlatform: (platform: string) => void;
  /** The catalog's products (the Products table's rows), for "Why not you?". */
  products?: readonly ProductRow[];
}) {
  const t = useTranslations('shopping.shelf');
  const [band, setBand] = useState<PriceBand>('all');
  const [shown, setShown] = useState(ROWS_SHOWN);

  if (!shelf) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[180px]" />
        ))}
      </div>
    );
  }
  const rows = shelf.rows.filter((row) => inPriceBand(row, band));
  // The bands in the shelves' own currency: "Under €50".
  const currency = shelfCurrency(shelf.rows);
  const bandLabel = (id: PriceBand) => {
    if (id === 'all') return t('price.all');
    const [min, max] = BAND_RANGE[id];
    if (min === 0) return t('price.under', { price: priceText(max, currency) });
    if (max === Infinity) return t('price.over', { price: priceText(min, currency) });
    return t('price.between', { from: priceText(min, currency), to: priceText(max, currency) });
  };
  const chip = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      aria-pressed={platform === id}
      onClick={() => onPlatform(id)}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        platform === id
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <section className="space-y-3" aria-label={t('label')}>
      <div className="flex flex-wrap items-center gap-1.5">
        {chip('all', t('allChannels'))}
        {platforms.map((id) => chip(id, platformName(id)))}
        <Select
          value={band}
          onValueChange={(value) => {
            setBand(value as PriceBand);
            setShown(ROWS_SHOWN);
          }}
          items={PRICE_BANDS.map((id) => ({
            value: id,
            label: `${t('price.label')}: ${bandLabel(id)}`,
          }))}
        >
          <SelectTrigger size="sm" className="ml-auto h-7" aria-label={t('price.label')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {PRICE_BANDS.map((id) => (
              <SelectItem key={id} value={id}>
                {bandLabel(id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {shelf.rows.length ? t('emptyBand') : t('empty')}
        </p>
      ) : (
        <>
          {rows.slice(0, shown).map((row) => (
            <ShelfRowCard key={row.key} row={row} products={products} />
          ))}
          {rows.length > shown && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setShown((n) => n + ROWS_SHOWN)}>
                {t('more', { count: rows.length - shown })}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
