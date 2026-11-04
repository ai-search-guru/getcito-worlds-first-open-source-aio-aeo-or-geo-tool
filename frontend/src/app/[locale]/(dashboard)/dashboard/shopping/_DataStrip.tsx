'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/formatRelative';
import { listCatalogSources } from '@/lib/actions/catalog';
import { getMerchantCenterOffered } from '@/lib/actions/integrations';
import { getTrafficSources, type TrafficSources } from '@/lib/actions/traffic';
import type { CatalogSource } from '@/lib/catalog';
import { CATALOG_SETTINGS_PATH } from '@/lib/content/feedMatch';
import { SourceCard } from '../traffic/_SourceCard';
import { GoogleSource } from '../traffic/_SourcesStrip';

/** What feeds Product Visibility: the brand's catalog sources, and Google Analytics and Search Console. */
export interface ProductSources {
  /** Null while loading, or when it couldn't be read. */
  catalog: CatalogSource[] | null;
  google: TrafficSources | null;
  /**
   * Whether this deployment can connect Google Merchant Center. Where it
   * can't and the brand has none, the page doesn't ask for one.
   */
  merchantCenterOffered: boolean;
}

/** The brand's sources, read once per brand and again after a connection made on the page. */
export function useProductSources(brandId: string | null) {
  const [sources, setSources] = useState<ProductSources & { brandId: string | null }>({
    brandId: null,
    catalog: null,
    google: null,
    merchantCenterOffered: false,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    void Promise.all([
      listCatalogSources(brandId).catch(() => null),
      getTrafficSources(brandId).catch(() => null),
      getMerchantCenterOffered(),
    ]).then(([catalog, google, merchantCenterOffered]) => {
      if (!cancelled) setSources({ brandId, catalog, google, merchantCenterOffered });
    });
    return () => {
      cancelled = true;
    };
  }, [brandId, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  // A read for another brand (just switched) counts as still loading.
  const current =
    sources.brandId === brandId
      ? sources
      : { catalog: null, google: null, merchantCenterOffered: false };
  return {
    loaded: sources.brandId === brandId,
    catalog: current.catalog,
    google: current.google,
    merchantCenterOffered: current.merchantCenterOffered,
    reload,
  };
}

/**
 * The marketplaces and feeds a brand's products also sell through (ECOM-spec
 * §3.0). Google Merchant Center connects in Settings › Integrations, as a
 * catalog source, where the deployment offers it; else it is Soon, as the
 * marketplaces with no connector yet.
 */
const MARKETPLACES = [
  { id: 'merchant_center', name: 'Google Merchant Center', mark: 'G' },
  { id: 'amazon', name: 'Amazon', mark: 'a' },
  { id: 'ebay', name: 'eBay', mark: 'e' },
  { id: 'walmart', name: 'Walmart', mark: 'W' },
  { id: 'etsy', name: 'Etsy', mark: 'E' },
  { id: 'trendyol', name: 'Trendyol', mark: 'T' },
  { id: 'hepsiburada', name: 'Hepsiburada', mark: 'H' },
] as const;

type ChipState = 'connected' | 'connect' | 'soon';

function chipState(
  id: string,
  catalog: CatalogSource[],
  merchantCenterOffered: boolean,
): ChipState {
  if (catalog.some((source) => source.kind === id)) return 'connected';
  return id === 'merchant_center' && merchantCenterOffered ? 'connect' : 'soon';
}

/** The newest sync of the brand's sources, or null when none has synced. */
function lastSync(catalog: CatalogSource[]): string | null {
  return catalog.reduce<string | null>(
    (latest, source) =>
      source.lastSyncedAt && (!latest || source.lastSyncedAt > latest)
        ? source.lastSyncedAt
        : latest,
    null,
  );
}

/**
 * Product Visibility's data sources (ECOM-009), as AI Traffic's strip: the
 * catalog (its products and last sync), Google Analytics (the path from an
 * AI visit to an order) and Google Search Console (shopping questions from
 * real searches), each with Connect or Manage. Under it, the marketplaces
 * and feeds row.
 */
export function ProductDataStrip({
  sources,
  domain,
  canConnect,
  onConnected,
}: {
  sources: ReturnType<typeof useProductSources>;
  /** The brand's primary domain, for the GA4 property line. */
  domain: string | undefined;
  canConnect: boolean;
  onConnected: () => void;
}) {
  const t = useTranslations('shopping.sources');
  const tCommon = useTranslations('common');

  if (!sources.loaded) {
    return <Skeleton className="h-[104px] w-full rounded-xl" />;
  }

  const catalog = sources.catalog ?? [];
  const products = catalog.reduce((sum, source) => sum + source.products, 0);
  const synced = lastSync(catalog);
  const failing = catalog.some((source) => source.lastStatus && source.lastStatus !== 'ok');
  const settingsLink = (label: string, primary = false) => (
    <Link
      href={CATALOG_SETTINGS_PATH}
      className={cn(
        buttonVariants({ variant: primary ? 'default' : 'outline', size: 'sm' }),
        'h-7 text-xs',
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-2">
      <section
        aria-label={t('label')}
        className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3"
      >
        {sources.catalog === null ? (
          <SourceCard tone="off" title={t('catalog')} line={t('catalogFailed')} />
        ) : catalog.length === 0 ? (
          <SourceCard
            tone="off"
            title={t('catalog')}
            line={t('catalogNone')}
            action={canConnect ? settingsLink(t('connect'), true) : undefined}
          />
        ) : (
          <SourceCard
            tone={failing ? 'sync' : 'on'}
            title={t('catalog')}
            line={
              synced
                ? t('catalogLine', {
                    count: products,
                    when: formatRelative(synced, tCommon),
                  })
                : t('catalogNotSynced', { count: products })
            }
            action={settingsLink(t('manage'))}
          />
        )}
        {sources.google ? (
          <>
            <GoogleSource
              provider="google-analytics"
              state={sources.google.ga}
              domain={domain}
              canConnect={canConnect}
              onConnected={onConnected}
              pitch={t('gaPitch')}
            />
            <GoogleSource
              provider="google-search-console"
              state={sources.google.gsc}
              domain={domain}
              canConnect={canConnect}
              onConnected={onConnected}
              pitch={t('gscPitch')}
            />
          </>
        ) : (
          <>
            <SourceCard tone="off" title={t('ga')} line={t('googleFailed')} />
            <SourceCard tone="off" title={t('gsc')} line={t('googleFailed')} />
          </>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">{t('marketplaces')}</span>
        {MARKETPLACES.map((place) => {
          const state = chipState(place.id, catalog, sources.merchantCenterOffered);
          return (
            <span
              key={place.id}
              data-marketplace={place.id}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-1 pr-2.5 text-xs"
            >
              <span
                aria-hidden
                className="grid h-4 w-4 place-items-center rounded-full bg-muted text-[10px] font-semibold"
              >
                {place.mark}
              </span>
              <span className="font-medium">{place.name}</span>
              {state === 'connected' ? (
                <span className="text-emerald-700 dark:text-emerald-400">{t('connected')}</span>
              ) : state === 'connect' && canConnect ? (
                <Link
                  href={CATALOG_SETTINGS_PATH}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t('connect')}
                </Link>
              ) : (
                <span className="text-muted-foreground">
                  {state === 'connect' ? t('notConnected') : t('soon')}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
