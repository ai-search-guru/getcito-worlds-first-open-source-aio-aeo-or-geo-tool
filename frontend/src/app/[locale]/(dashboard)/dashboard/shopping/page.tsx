'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
const DynamicPlatformCardRateChart = dynamic(
  () => import('./shopping_charts').then((m) => m.PlatformCardRateChartView),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[220px] w-full" />,
  },
);

const DynamicShoppingTrendChart = dynamic(
  () => import('./shopping_charts').then((m) => m.ShoppingTrendChartView),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[220px] w-full" />,
  },
);
import {
  ShoppingBag,
  Crown,
  Download,
  ExternalLink,
  Layers,
  AlertTriangle,
  HelpCircle,
} from 'lucide-react';
import { useBrandStore } from '@/state/useBrandStore';
import { useFeatureGate } from '@/hooks/useFeatureGate';
import { useUserRole } from '@/hooks/useUserRole';
import {
  getShoppingFilterOptions,
  getShoppingOverview,
  getShoppingAmazonShareDropAlert,
  getOwnProducts,
  getCompetitorProducts,
  getCompetitorSummary,
  getShoppingAiOrders,
  getShoppingActionResults,
  getShoppingCategories,
  getShoppingProducts,
  getShoppingSearchAppearance,
  getShoppingShelf,
  type ShoppingChartData,
  type ShoppingDatePreset,
  type ShoppingFilters,
  type ShoppingKpis,
  type ShoppingProduct,
  type CompetitorShoppingSummary,
  type ShoppingAiOrders,
  type ShoppingProducts,
  type ShoppingShelf,
} from '@/lib/actions/shopping';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { CodeBlock, CodeBlockCode } from '@/components/ui/code-block';
import {
  AIProviderAvatar,
  resolveAIProvider,
  getAIProviderDisplayName,
} from '@/components/AiProviderAvatar';
import { toCsv } from '@/lib/csv';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import { formatRegionDisplay } from '@/lib/region';
import type { AmazonShareDropAlert } from '@/lib/shoppingAmazonShareAlert';
import type { CategoryRow } from '@/lib/shopping/categories';
import { RECHECK_TARGETS, type ActionResult } from '@/lib/shopping/recheck';
import { readinessChecklist } from '@/lib/shopping/readiness';
import { formatNumber } from '@/lib/format';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';
import { googleSourceStatus } from '@/lib/trafficSources';
import { readUrlChoice, writeUrlParams } from '@/lib/urlState';
import { CatalogNote } from './_CatalogNote';
import { ProductDataStrip, useProductSources } from './_DataStrip';
import { CategoriesTable } from './_CategoriesTable';
import { ProductsTable } from './_ProductsTable';
import { ReadinessTab } from './_readiness';
import { ShelfFailed, ShelfKpis, ShelfRows } from './_shelf';
import { ShoppingMarketSwitch, useShoppingMarket } from './_MarketSwitch';
import { WhyDialog } from './_WhyDialog';
import { MerchantSplitCard } from './merchant_split_card';
import { OpenAiIndexCard } from './openai_index_card';
import { ProductMatchScores } from './product_match_scores';
import { ResellerPriceAlerts } from './reseller_price_alerts';
import { useKeyedRead } from './use_keyed_read';
import { useMerchantDestinations } from './use_merchant_destinations';
import { useOpenAiIndex } from './use_openai_index';

const DATE_PRESETS: ShoppingDatePreset[] = ['7d', '30d', '90d', 'all'];

/** The page's tabs, the one open in the URL (?tab=products). */
const SHOPPING_TABS = ['shelf', 'categories', 'products', 'readiness', 'competitors'] as const;
type ShoppingTab = (typeof SHOPPING_TABS)[number];

// Theme tokens in globals.css ship as full oklch values; reference them
// directly with var(--…). Wrapping in hsl() yields invalid CSS, so chart
// text turns black on dark mode (lesson learned from #138).

export default function ShoppingPage() {
  const t = useTranslations('shopping');
  const tCommon = useTranslations('common');
  const { activeBrandId } = useBrandStore();
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const { canUse, requiredPlanFor } = useFeatureGate();
  const { canManage } = useUserRole();
  const hasFullAccess = canUse('shopping_analytics');

  const [datePreset, setDatePreset] = useState<ShoppingDatePreset>('30d');
  const [platform, setPlatform] = useState<string>('all');
  const [region, setRegion] = useState<string>('all');
  const shoppingMarket = useShoppingMarket(activeBrandId, region);

  const [filterOpts, setFilterOpts] = useState<{ platforms: string[]; regions: string[] }>({
    platforms: [],
    regions: [],
  });
  const [kpis, setKpis] = useState<ShoppingKpis | null>(null);
  const [charts, setCharts] = useState<ShoppingChartData | null>(null);
  // True from the start: the first load waits for the market, and an idle
  // page with no KPIs yet would read as empty.
  const [loading, setLoading] = useState(true);
  const [amazonShareDropAlert, setAmazonShareDropAlert] = useState<AmazonShareDropAlert | null>(
    null,
  );

  const [ownProducts, setOwnProducts] = useState<ShoppingProduct[]>([]);
  const [competitorProducts, setCompetitorProducts] = useState<ShoppingProduct[]>([]);
  const [competitorSummary, setCompetitorSummary] = useState<CompetitorShoppingSummary[]>([]);
  // The catalog's categories (ECOM-008), read when their tab opens, for the filters they were read with.
  const [categories, setCategories] = useState<{
    key: string;
    rows: CategoryRow[] | null | 'failed';
    /** Each category's last done action, 7 days on (ECOM-018). */
    results?: Record<string, ActionResult>;
  } | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ShoppingProduct | null>(null);
  const [activeTab, setActiveTab] = useState<ShoppingTab>('shelf');
  const [whyOpen, setWhyOpen] = useState(false);
  const sources = useProductSources(activeBrandId);
  const primaryDomain =
    activeBrand?.domains?.find((d) => d.isPrimary)?.domain ?? activeBrand?.domains?.[0]?.domain;
  // Sales come from the tracking snippet (with the Shopify pixel) or GA.
  const salesConnected =
    !!sources.google &&
    (!!sources.google.snippetLastVisitAt || googleSourceStatus(sources.google.ga) === 'connected');
  // Connect Google Analytics in the Why popup: while GA isn't connected.
  const offerGa =
    canManage && !!sources.google && googleSourceStatus(sources.google.ga) === 'not_connected';

  useEffect(() => {
    setActiveTab(readUrlChoice('tab', SHOPPING_TABS, 'shelf'));
  }, []);
  const changeTab = (next: ShoppingTab) => {
    setActiveTab(next);
    writeUrlParams({ tab: next }, { tab: 'shelf' });
  };

  const filters = useMemo<ShoppingFilters>(
    () => ({
      datePreset,
      platforms: platform === 'all' ? undefined : [platform],
      regions: region === 'all' ? undefined : [region],
      chatgptMarket: shoppingMarket.filter,
    }),
    [datePreset, platform, region, shoppingMarket.filter],
  );
  // Like the Overview's own load, these wait for the market.
  const destinations = useMerchantDestinations(
    activeBrandId,
    filters,
    hasFullAccess && shoppingMarket.ready,
  );
  const destinationsLoading = destinations.loading || !shoppingMarket.ready;
  // ChatGPT in the US (#1281): only while the market shown is the US.
  const showOpenAiIndex = shoppingMarket.shown === 'us';
  const openAiIndex = useOpenAiIndex(activeBrandId, datePreset, hasFullAccess && showOpenAiIndex);

  // Load filter options once per brand so the dropdowns only show
  // platform / region values that actually appear in this brand's data.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    (async () => {
      try {
        const opts = await getShoppingFilterOptions(activeBrandId);
        if (!cancelled) setFilterOpts(opts);
      } catch {
        if (!cancelled) setFilterOpts({ platforms: [], regions: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  // De-dupe overlapping fetches when filters change in quick succession.
  const reqIdRef = useRef(0);
  const loadData = useCallback(async () => {
    if (!activeBrandId) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    if (hasFullAccess) {
      setTableLoading(true);
    }
    try {
      const promises: [
        Promise<{ kpis: ShoppingKpis; charts: ShoppingChartData }>,
        ...Promise<unknown>[],
      ] = [getShoppingOverview(activeBrandId, filters)];

      if (hasFullAccess) {
        promises.push(
          getOwnProducts(activeBrandId, filters),
          getCompetitorProducts(activeBrandId, filters),
          getCompetitorSummary(activeBrandId, filters),
        );
      }

      const results = await Promise.all(promises);

      if (reqId === reqIdRef.current) {
        const overview = results[0] as { kpis: ShoppingKpis; charts: ShoppingChartData };
        setKpis(overview.kpis);
        setCharts(overview.charts);
        if (hasFullAccess && results.length >= 4) {
          setOwnProducts(results[1] as ShoppingProduct[]);
          setCompetitorProducts(results[2] as ShoppingProduct[]);
          setCompetitorSummary(results[3] as CompetitorShoppingSummary[]);
        }
      }
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setTableLoading(false);
      }
    }
  }, [activeBrandId, filters, hasFullAccess]);

  useEffect(() => {
    if (!shoppingMarket.ready) return;
    void loadData();
  }, [loadData, shoppingMarket.ready]);

  // The Shelf (ECOM-006) and the Products table (ECOM-007) read once per
  // brand and filters, apart from the rest: neither waits for the other, nor
  // for the older tables. The Products table reads when its tab, or
  // Readiness, is open.
  const readKey = `${activeBrandId}:${JSON.stringify(filters)}`;
  const canRead = !!activeBrandId && hasFullAccess && shoppingMarket.ready;
  // Each "Try again" on a shelf that couldn't be read is a new read.
  const [shelfTry, setShelfTry] = useState(0);
  // Null while it reads.
  const shelf: ShoppingShelf | 'failed' | null =
    useKeyedRead(
      canRead,
      `${readKey}#${shelfTry}`,
      () => getShoppingShelf(activeBrandId!, filters),
      'the shelves',
    ) ?? null;
  // Readiness's channel cards look at every channel whatever the one chosen
  // (the Shelf's chips): with one chosen, the shelf read for it has only its
  // cards, and would show the others as not showing the brand's products.
  const channelFilters = useMemo<ShoppingFilters>(
    () => ({ ...filters, platforms: undefined }),
    [filters],
  );
  const channelShelfRead = useKeyedRead(
    canRead && activeTab === 'readiness' && platform !== 'all',
    `${activeBrandId}:${JSON.stringify(channelFilters)}`,
    () => getShoppingShelf(activeBrandId!, channelFilters),
    'the shelves of every channel',
  );
  // Null while it reads.
  const channelShelf = platform === 'all' ? shelf : (channelShelfRead ?? null);
  const productsRead = useKeyedRead(
    canRead && (activeTab === 'products' || activeTab === 'readiness'),
    readKey,
    () => getShoppingProducts(activeBrandId!, filters),
    'the products',
  );
  const productsLoading = productsRead === undefined;
  // "Why not you?" on the Shelf needs the catalog's products, not the
  // window's numbers: read once per brand there, apart from the table.
  const shelfProducts = useKeyedRead(
    canRead && activeTab === 'shelf' && !productsRead,
    activeBrandId ?? '',
    () => getShoppingProducts(activeBrandId!, filters),
    'the products for the shelf',
  );
  // Null for a brand without a catalog, and while it reads.
  const catalogTable: ShoppingProducts | null | 'failed' = productsRead ?? null;
  // Google's shopping results from Search Console (00377), for Readiness.
  const searchAppearance = useKeyedRead(
    canRead && activeTab === 'readiness',
    activeBrandId ?? '',
    () => getShoppingSearchAppearance(activeBrandId!),
    "Search Console's shopping results",
  );

  // The Categories tab reads when it's open, once per brand and filters.
  const categoriesKey = `${activeBrandId}:${JSON.stringify(filters)}`;
  useEffect(() => {
    if (activeTab !== 'categories' || !activeBrandId || !hasFullAccess) return;
    if (!shoppingMarket.ready || categories?.key === categoriesKey) return;
    let cancelled = false;
    getShoppingCategories(activeBrandId, filters)
      .then((rows) => {
        if (cancelled) return;
        setCategories({ key: categoriesKey, rows });
        if (!rows?.length) return;
        // Then their last done actions, 7 days on: a table without them is still the table.
        // Kept by key, not `cancelled`: setting the rows re-runs this effect.
        getShoppingActionResults(
          activeBrandId,
          rows.slice(0, RECHECK_TARGETS).map((row) => ({ type: 'category' as const, id: row.id })),
        )
          .then((results) =>
            setCategories((read) => (read?.key === categoriesKey ? { ...read, results } : read)),
          )
          .catch((err) => console.error('Failed to re-check the categories’ actions:', err));
      })
      .catch((err) => {
        console.error('Failed to read the categories:', err);
        if (!cancelled) setCategories({ key: categoriesKey, rows: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    activeBrandId,
    hasFullAccess,
    shoppingMarket.ready,
    categoriesKey,
    categories?.key,
    filters,
  ]);
  const categoriesRead = categories?.key === categoriesKey ? categories.rows : undefined;

  // Orders from AI visits, the last 30 days whatever the filters (ECOM-006),
  // kept by brand: another brand's never show while this one's are read.
  const ordersRead = useKeyedRead(
    !!activeBrandId && hasFullAccess,
    activeBrandId ?? '',
    () => getShoppingAiOrders(activeBrandId!),
    'the orders from AI visits',
  );
  // Undefined while they're read, null when they couldn't be.
  const orders: ShoppingAiOrders | null | undefined = ordersRead === 'failed' ? null : ordersRead;

  // This alert always evaluates five consecutive rolling seven-day windows
  // ending at query time, independently of display/platform/region filters.
  useEffect(() => {
    if (!activeBrandId) {
      setAmazonShareDropAlert(null);
      return;
    }
    let cancelled = false;
    getShoppingAmazonShareDropAlert(activeBrandId)
      .then((alert) => {
        if (!cancelled) setAmazonShareDropAlert(alert);
      })
      .catch(() => {
        // The alert is supplemental; a query failure must not break Shopping.
        if (!cancelled) setAmazonShareDropAlert(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  if (!activeBrandId) {
    return (
      <div className="space-y-6">
        <PageHeader t={t} onWhy={() => setWhyOpen(true)} />
        <EmptyState title={t('noBrandTitle')} description={t('noBrandDescription')} />
      </div>
    );
  }

  const totalCards =
    (charts?.ownPresenceTrend ?? []).reduce((sum, p) => sum + p.totalCards, 0) +
    // platformCardRate's data has card-rate built in, so the trend total is
    // sufficient as a "do we have any data at all?" check.
    0;
  const isEmpty = !loading && (kpis?.shoppingCardRateSampleSize ?? 0) === 0 && totalCards === 0;

  return (
    <div className="space-y-6">
      <PageHeader t={t} onWhy={() => setWhyOpen(true)} />
      <WhyDialog
        open={whyOpen}
        onOpenChange={setWhyOpen}
        offerGa={offerGa}
        onConnected={sources.reload}
      />
      <ProductDataStrip
        sources={sources}
        domain={primaryDomain}
        canConnect={canManage}
        onConnected={sources.reload}
      />

      {amazonShareDropAlert && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500"
            aria-hidden="true"
          />
          <p className="text-sm text-amber-900 dark:text-amber-200">
            {t('amazonShareDropAlert', {
              from: Math.round(amazonShareDropAlert.fromShare * 100),
              to: Math.round(amazonShareDropAlert.toShare * 100),
            })}
          </p>
        </div>
      )}

      <FilterBar
        t={t}
        datePreset={datePreset}
        setDatePreset={setDatePreset}
        platform={platform}
        setPlatform={setPlatform}
        region={region}
        setRegion={setRegion}
        platformOpts={filterOpts.platforms}
        regionOpts={filterOpts.regions}
      />

      <ShoppingMarketSwitch
        state={shoppingMarket}
        onSelect={(market) => {
          shoppingMarket.select(market);
          setRegion('all');
        }}
      />

      {isEmpty ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <>
          <Tabs
            value={activeTab}
            onValueChange={(value) => changeTab(value as ShoppingTab)}
            className="space-y-6"
          >
            <TabsList>
              <TabsTrigger value="shelf">{t('tabShelf')}</TabsTrigger>
              <TabsTrigger value="categories">
                {t('tabCategories')}
                {Array.isArray(categoriesRead) && (
                  <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                    {categoriesRead.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="products">{t('tabProducts')}</TabsTrigger>
              <TabsTrigger value="readiness">{t('tabReadiness')}</TabsTrigger>
              <TabsTrigger value="competitors">{t('tabCompetitors')}</TabsTrigger>
            </TabsList>

            <TabsContent value="shelf" className="space-y-6">
              {hasFullAccess ? (
                <>
                  {shelf === 'failed' ? (
                    <ShelfFailed onRetry={() => setShelfTry((n) => n + 1)} />
                  ) : (
                    <ShelfKpis shelf={shelf} orders={orders} salesConnected={salesConnected} />
                  )}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <MerchantSplitCard split={destinations.split} loading={destinationsLoading} />
                    <ResellerPriceAlerts
                      alerts={destinations.priceAlerts}
                      loading={destinationsLoading}
                    />
                  </div>
                  {shelf !== 'failed' && (
                    <ShelfRows
                      shelf={shelf}
                      platforms={filterOpts.platforms}
                      platform={platform}
                      onPlatform={setPlatform}
                      products={
                        catalogTable && catalogTable !== 'failed'
                          ? catalogTable.rows
                          : shelfProducts && shelfProducts !== 'failed'
                            ? shelfProducts.rows
                            : undefined
                      }
                    />
                  )}
                  <h2 className="pt-2 text-sm font-semibold">{t('shelf.trends')}</h2>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <PlatformCardRateChart
                      t={t}
                      data={charts?.platformCardRate ?? []}
                      loading={loading}
                    />
                    <OwnPresenceTrendChart
                      t={t}
                      data={charts?.ownPresenceTrend ?? []}
                      loading={loading}
                    />
                  </div>
                </>
              ) : (
                <UpgradeCard t={t} requiredPlan={requiredPlanFor('shopping_analytics')} />
              )}
            </TabsContent>

            <TabsContent value="categories" className="space-y-6">
              {hasFullAccess ? (
                <CategoriesTable
                  brandId={activeBrandId}
                  categories={categoriesRead === 'failed' ? null : (categoriesRead ?? null)}
                  loading={categoriesRead === undefined}
                  failed={categoriesRead === 'failed'}
                  results={categories?.key === categoriesKey ? categories.results : undefined}
                />
              ) : (
                <UpgradeCard t={t} requiredPlan={requiredPlanFor('shopping_analytics')} />
              )}
            </TabsContent>

            <TabsContent value="products" className="space-y-6">
              {hasFullAccess && (productsLoading || (catalogTable && catalogTable !== 'failed')) ? (
                <ProductsTable
                  products={catalogTable === 'failed' ? null : catalogTable}
                  loading={productsLoading}
                />
              ) : hasFullAccess ? (
                <>
                  {/* No catalog yet: the products AI showed, by title, until one is connected. */}
                  {catalogTable === 'failed' ? (
                    <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                      {t('products.failed')}
                    </p>
                  ) : (
                    <CatalogNote brandId={activeBrandId} />
                  )}
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{t('tabMyProducts')}</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const headers = [
                          'product_title',
                          'product_brand',
                          'impressions',
                          'platforms',
                          'regions',
                          'last_price',
                          'price_currency',
                          'top_merchant',
                          'last_seen',
                        ];
                        const rows = ownProducts.map((p) => ({
                          product_title: p.product_title,
                          product_brand: p.product_brand || '',
                          impressions: p.impressions,
                          platforms: p.platforms.join('; '),
                          regions: p.regions.join('; '),
                          last_price:
                            p.last_price !== null ? Math.round(p.last_price * 100) / 100 : '',
                          price_currency: p.price_currency || '',
                          top_merchant: p.top_merchant || '',
                          last_seen: p.last_seen,
                        }));
                        const csv = toCsv(rows, headers);
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        const date = new Date().toISOString().slice(0, 10);
                        link.download = `my_products_${date}.csv`;
                        link.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {tCommon('exportCsv')}
                    </Button>
                  </div>
                  <ProductTable
                    t={t}
                    products={ownProducts}
                    loading={tableLoading}
                    onRowClick={setSelectedProduct}
                  />
                </>
              ) : (
                <UpgradeCard t={t} requiredPlan={requiredPlanFor('shopping_analytics')} />
              )}
            </TabsContent>

            <TabsContent value="readiness" className="space-y-6">
              {hasFullAccess ? (
                <ReadinessTab
                  market={shoppingMarket.shown ?? 'us'}
                  tracked={filterOpts.platforms}
                  ownSlots={
                    new Map(
                      (channelShelf && channelShelf !== 'failed'
                        ? channelShelf.stats.channels
                        : []
                      ).map((c) => [c.platform, c.ownSlots]),
                    )
                  }
                  channelsRead={
                    channelShelf === null
                      ? 'loading'
                      : channelShelf === 'failed'
                        ? 'failed'
                        : undefined
                  }
                  {...readinessChecklist({
                    market: shoppingMarket.shown ?? 'us',
                    catalog: sources.catalog,
                    merchantCenterOffered: sources.merchantCenterOffered,
                    searchAppearance:
                      searchAppearance && searchAppearance !== 'failed' ? searchAppearance : null,
                    products: catalogTable && catalogTable !== 'failed' ? catalogTable.rows : null,
                    openAi: showOpenAiIndex ? openAiIndex.read : null,
                    cheaperResellers: destinationsLoading ? null : destinations.priceAlerts.length,
                    amazonDrop: amazonShareDropAlert
                      ? { from: amazonShareDropAlert.fromShare, to: amazonShareDropAlert.toShare }
                      : null,
                  })}
                  loading={!sources.loaded || productsLoading}
                  unread={[
                    ...(sources.loaded && sources.catalog === null ? (['sources'] as const) : []),
                    ...(catalogTable === 'failed' ? (['products'] as const) : []),
                  ]}
                  onProducts={() => changeTab('products')}
                >
                  {showOpenAiIndex && (
                    <OpenAiIndexCard
                      read={openAiIndex.read}
                      loading={openAiIndex.loading}
                      canManage={canManage}
                      onDirectFeedChange={openAiIndex.setDirectFeed}
                    />
                  )}
                </ReadinessTab>
              ) : (
                <UpgradeCard t={t} requiredPlan={requiredPlanFor('shopping_analytics')} />
              )}
            </TabsContent>

            <TabsContent value="competitors" className="space-y-6">
              {hasFullAccess ? (
                <>
                  <CompetitorSummaryList
                    t={t}
                    summaries={competitorSummary}
                    loading={tableLoading}
                  />

                  <div className="flex items-center justify-between pt-4">
                    <h2 className="text-lg font-semibold">{t('tabCompetitors')}</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const headers = [
                          'competitor_name',
                          'product_title',
                          'product_brand',
                          'impressions',
                          'platforms',
                          'regions',
                          'last_price',
                          'price_currency',
                          'top_merchant',
                          'last_seen',
                        ];
                        const rows = competitorProducts.map((p) => ({
                          competitor_name: p.competitor_name || '',
                          product_title: p.product_title,
                          product_brand: p.product_brand || '',
                          impressions: p.impressions,
                          platforms: p.platforms.join('; '),
                          regions: p.regions.join('; '),
                          last_price:
                            p.last_price !== null ? Math.round(p.last_price * 100) / 100 : '',
                          price_currency: p.price_currency || '',
                          top_merchant: p.top_merchant || '',
                          last_seen: p.last_seen,
                        }));
                        const csv = toCsv(rows, headers);
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        const date = new Date().toISOString().slice(0, 10);
                        link.download = `competitor_products_${date}.csv`;
                        link.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {tCommon('exportCsv')}
                    </Button>
                  </div>
                  <ProductTable
                    t={t}
                    products={competitorProducts}
                    loading={tableLoading}
                    onRowClick={setSelectedProduct}
                    showCompetitorName
                  />
                </>
              ) : (
                <UpgradeCard t={t} requiredPlan={requiredPlanFor('shopping_analytics')} />
              )}
            </TabsContent>
          </Tabs>

          {hasFullAccess && (
            <ProductAppearancesDrawer
              t={t}
              brandId={activeBrandId}
              filters={filters}
              product={selectedProduct}
              onOpenChange={(open) => {
                if (!open) setSelectedProduct(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

/** The title, with "Why GetCito Product Visibility?" beside it (ECOM-010). */
function PageHeader({
  t,
  onWhy,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  onWhy: () => void;
}) {
  return (
    <HeaderWithAiUsage>
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ShoppingBag className="h-6 w-6 text-primary" />
            {t('title')}
          </h1>
          <button
            type="button"
            onClick={onWhy}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
            {t('why.button')}
          </button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>
    </HeaderWithAiUsage>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  t,
  datePreset,
  setDatePreset,
  platform,
  setPlatform,
  region,
  setRegion,
  platformOpts,
  regionOpts,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  datePreset: ShoppingDatePreset;
  setDatePreset: (v: ShoppingDatePreset) => void;
  platform: string;
  setPlatform: (v: string) => void;
  region: string;
  setRegion: (v: string) => void;
  platformOpts: string[];
  regionOpts: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
      <FilterField label={t('filterDateRange')}>
        <Select value={datePreset} onValueChange={(v) => setDatePreset(v as ShoppingDatePreset)}>
          <SelectTrigger className="h-8 w-32">
            <SelectValue>{(value) => (value === 'all' ? 'All time' : `Last ${value}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESETS.map((p) => (
              <SelectItem key={p} value={p}>
                {p === 'all' ? 'All time' : `Last ${p}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label={t('filterPlatform')}>
        <Select value={platform} onValueChange={(v) => setPlatform(v ?? 'all')}>
          <SelectTrigger className="h-8 w-40">
            <SelectValue>
              {(value) =>
                value === 'all' || !value
                  ? 'All platforms'
                  : (PLATFORM_LABELS[String(value)] ?? String(value))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platformOpts.map((p) => (
              <SelectItem key={p} value={p}>
                {PLATFORM_LABELS[p] ?? p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label={t('filterRegion')}>
        <Select value={region} onValueChange={(v) => setRegion(v ?? 'all')}>
          <SelectTrigger className="h-8 w-32">
            <SelectValue>
              {(value) =>
                value === 'all' || !value ? 'All regions' : formatRegionDisplay(String(value))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {regionOpts.map((r) => (
              <SelectItem key={r} value={r}>
                {formatRegionDisplay(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

function PlatformCardRateChart({
  t,
  data,
  loading,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  data: Array<{ platform: string; cardRate: number; totalResults: number }>;
  loading: boolean;
}) {
  const chartData = data.map((d) => ({ platform: d.platform, rate: Math.round(d.cardRate * 100) }));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('platformBreakdownTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : (
          <ResponsiveBarChart data={chartData} label={t('seriesCardRate')} />
        )}
      </CardContent>
    </Card>
  );
}

function ResponsiveBarChart({
  data,
  label,
}: {
  data: Array<{ platform: string; rate: number }>;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: '100%', height: 220 }}>
      {width > 0 && <DynamicPlatformCardRateChart width={width} data={data} label={label} />}
    </div>
  );
}

function OwnPresenceTrendChart({
  t,
  data,
  loading,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  data: Array<{ date: string; ownCards: number; totalCards: number }>;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('trendTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : (
          <ResponsiveLineChart
            data={data}
            labels={{ own: t('seriesOwnCards'), all: t('seriesAllCards') }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ResponsiveLineChart({
  data,
  labels,
}: {
  data: Array<{ date: string; ownCards: number; totalCards: number }>;
  labels: { own: string; all: string };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: '100%', height: 220 }}>
      {width > 0 && <DynamicShoppingTrendChart width={width} data={data} labels={labels} />}
    </div>
  );
}

// ── States ────────────────────────────────────────────────────────────────────

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed py-12 text-center">
      <ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground/40" />
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function UpgradeCard({
  t,
  requiredPlan,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  requiredPlan: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Crown className="mt-1 h-5 w-5 text-amber-500" />
          <div>
            <p className="font-medium">{t('lockedTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('lockedDescription')}</p>
          </div>
        </div>
        <Link
          href="/dashboard/settings?tab=billing"
          className={buttonVariants({ variant: 'default' })}
        >
          <Badge variant="secondary" className="mr-2 gap-1">
            <Crown className="h-3 w-3" />
            {requiredPlan}
          </Badge>
          Upgrade
        </Link>
      </CardContent>
    </Card>
  );
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0%';
  if (value < 0.01) return '<1%';
  return `${Math.round(value * 100)}%`;
}

// ── Product table component ────────────────────────────────────────────────────

interface ProductTableProps {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  products: ShoppingProduct[];
  loading: boolean;
  onRowClick: (p: ShoppingProduct) => void;
  showCompetitorName?: boolean;
}

function ProductTable({
  t,
  products,
  loading,
  onRowClick,
  showCompetitorName = false,
}: ProductTableProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-8 text-center bg-card">
        <Layers className="mx-auto h-8 w-8 text-muted-foreground/30" />
        <p className="mt-2 text-sm text-muted-foreground">No products found matching filters.</p>
      </div>
    );
  }

  // Ensure default sorting: impressions descending
  const sortedProducts = [...products].sort((a, b) => b.impressions - a.impressions);

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[60px]"></TableHead>
            <TableHead>{t('colProductTitle')}</TableHead>
            {showCompetitorName && <TableHead>{t('competitorName')}</TableHead>}
            <TableHead>{t('colPlatforms')}</TableHead>
            <TableHead>{t('colRegions')}</TableHead>
            <TableHead className="text-right">{t('colImpressions')}</TableHead>
            <TableHead className="text-right">{t('colLastPrice')}</TableHead>
            <TableHead>{t('colTopMerchant')}</TableHead>
            <TableHead className="text-right">{t('colLastSeen')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedProducts.map((p, idx) => {
            const formattedPrice =
              p.last_price !== null
                ? new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }).format(p.last_price)
                : '';
            const lastPriceStr =
              p.last_price !== null ? `${formattedPrice} ${p.price_currency || ''}` : '—';
            const formattedDate = p.last_seen
              ? new Date(p.last_seen).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })
              : '—';

            return (
              <TableRow
                key={idx}
                className="cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => onRowClick(p)}
              >
                <TableCell>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted overflow-hidden">
                    {p.image_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={p.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <ShoppingBag className="h-5 w-5 text-muted-foreground/40" />
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-medium max-w-[240px] truncate">
                  <div>
                    <span className="block truncate text-sm" title={p.product_title}>
                      {p.product_title}
                    </span>
                    {p.product_brand && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.product_brand}
                      </span>
                    )}
                  </div>
                </TableCell>
                {showCompetitorName && (
                  <TableCell className="max-w-[120px] truncate">
                    <span className="font-medium text-xs">{p.competitor_name || '—'}</span>
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-1">
                    {p.platforms.map((plat) => (
                      <AIProviderAvatar
                        key={plat}
                        provider={resolveAIProvider(plat)}
                        className="h-5 w-5 border"
                      />
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[120px]">
                    {p.regions.map((reg) => (
                      <Badge key={reg} variant="outline" className="text-[10px] py-0 px-1.5">
                        {reg}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatNumber(p.impressions)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {lastPriceStr}
                </TableCell>
                <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                  {p.top_merchant || '—'}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                  {formattedDate}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Competitor summary list component ──────────────────────────────────────────

interface CompetitorSummaryListProps {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  summaries: CompetitorShoppingSummary[];
  loading: boolean;
}

function CompetitorSummaryList({ t, summaries, loading }: CompetitorSummaryListProps) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (summaries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
        {t('compSummaryTitle')}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summaries.map((s) => (
          <Card key={s.competitor_id} className="relative overflow-hidden bg-card">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between min-w-0">
                <span className="font-semibold text-sm truncate block" title={s.name}>
                  {s.name}
                </span>
                <span className="text-[10px] text-muted-foreground truncate ml-1 max-w-[100px]">
                  {s.domain}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground text-[10px] block">
                    {t('compDistinctProducts')}
                  </span>
                  <span className="font-bold text-sm tabular-nums">
                    {s.distinct_products_count}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-muted-foreground text-[10px] block">{t('compSov')}</span>
                  <span className="font-bold text-sm tabular-nums">{formatPercent(s.sov)}</span>
                </div>
              </div>
              {/* Shopping SOV progress bar */}
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-400 transition-all rounded-full"
                  style={{ width: `${Math.round(s.sov * 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Product appearances side drawer ─────────────────────────────────────────────

interface ProductAppearancesDrawerProps {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  product: ShoppingProduct | null;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  filters: ShoppingFilters;
}

function ProductAppearancesDrawer({
  t,
  product,
  onOpenChange,
  brandId,
  filters,
}: ProductAppearancesDrawerProps) {
  const isOpen = product !== null;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl flex flex-col gap-0 p-0 h-full">
        <SheetHeader className="border-b px-5 py-4 shrink-0">
          <SheetTitle className="text-base truncate" title={product?.product_title}>
            {product?.product_title}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {product?.product_brand
              ? `${product.product_brand} • ${product.impressions} appearances`
              : `${product?.impressions || 0} appearances`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* The brand's own products only: a competitor's text isn't the brand's to change. */}
          {product && !product.competitor_name && (
            <ProductMatchScores brandId={brandId} filters={filters} product={product} />
          )}
          {product?.appearances.map((app) => {
            const dateStr = new Date(app.created_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <Card key={app.id} className="border hover:shadow-xs transition-shadow">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 font-medium text-foreground text-xs">
                        <AIProviderAvatar
                          provider={resolveAIProvider(app.platform)}
                          className="h-4.5 w-4.5"
                        />
                        <span>{getAIProviderDisplayName(resolveAIProvider(app.platform))}</span>
                      </div>
                      {app.region && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          {app.region}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {dateStr}
                      </span>
                    </div>

                    {app.merchant_url && (
                      <a
                        href={app.merchant_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                      >
                        {t('appearanceMerchant')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      {t('appearancePrompt')}
                    </span>
                    <div>
                      {app.prompt_id ? (
                        <Link
                          href={`/dashboard/prompts/${app.prompt_id}`}
                          className="text-sm text-foreground font-medium hover:text-primary hover:underline line-clamp-3 block leading-relaxed"
                          title="View Prompt Details"
                          onClick={() => onOpenChange(false)}
                        >
                          &quot;{app.prompt_text}&quot;
                        </Link>
                      ) : (
                        <p className="text-sm font-medium text-foreground italic leading-relaxed">
                          &quot;{app.prompt_text}&quot;
                        </p>
                      )}
                    </div>
                  </div>

                  <details className="text-xs border rounded-md group">
                    <summary className="cursor-pointer font-medium p-2 text-muted-foreground hover:text-foreground select-none flex items-center justify-between">
                      <span>{t('appearanceRaw')}</span>
                      <span className="transition-transform group-open:rotate-180">↓</span>
                    </summary>
                    <div className="border-t p-2 bg-muted/20 overflow-x-auto max-h-[220px]">
                      <CodeBlock>
                        <CodeBlockCode
                          code={JSON.stringify(app.raw, null, 2)}
                          language="json"
                          theme="github-light"
                        />
                      </CodeBlock>
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
