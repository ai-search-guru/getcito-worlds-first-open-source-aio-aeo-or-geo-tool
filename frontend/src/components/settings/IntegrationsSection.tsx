'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BarChart3, Globe, Loader2, Search, ShoppingBag, Unplug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  disconnectIntegration,
  getGscBrandMappings,
  setBrandGscProperty,
  getGaBrandMappings,
  setBrandGaProperty,
  type IntegrationProvider,
  type IntegrationStatus,
} from '@/lib/actions/integrations';
import {
  readGaProperties,
  readGscProperties,
  readIntegrationStatus,
  readIntegrationsConfig,
  isTimeout,
  withReadTimeout,
  type IntegrationFailure,
  type IntegrationResult,
} from '@/lib/integrationsClient';
import { matchProperty } from '@/lib/propertyMatch';
import { MERCHANT_CENTER_LABEL } from '@/lib/catalog';
import { CatalogSourcesCard, type CatalogSourcesRead } from './CatalogSourcesCard';
import { CatalogCategoryPages } from './CatalogCategoryPages';
import { FramerCard } from './FramerCard';
import { MerchantCenterAccounts } from './MerchantCenterAccounts';
import { WebflowCard } from './WebflowCard';
import { SampleDataBadge } from './SampleDataBadge';
import { WixCard } from './WixCard';
import { WordPressCard } from './WordpressCard';
import { useIntegrationConnect } from '@/hooks/useIntegrationConnect';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useDemoBrand } from '@/components/context/DemoBrandProvider';
import { useBrandStore } from '@/state/useBrandStore';
import type { Brand } from '@/types';
import {
  DEMO_ANALYTICS_PROPERTY_ID,
  demoIntegration,
  demoSearchConsoleProperty,
  upcomingDemoIntegrations,
} from '@/lib/demo/integrations';

/**
 * Settings → Integrations (#577, Google Analytics added in #658).
 *
 * Every OAuth provider shares the same lifecycle — not configured (self-host
 * without Composio env) → not connected → connecting (OAuth popup open,
 * polling) → connected — so the card and its state live in one place and each
 * provider only supplies its labels and any post-connection UI of its own.
 *
 * Stores and marketplaces (#1270): Google Merchant Center connects the same
 * way, then each brand picks its account, whose products land in the
 * product catalog card below it. Content management systems: where Send to
 * CMS puts a brand's pages.
 *
 * Every card reads on its own, from the browser or with a timeout, so a slow
 * or failing one never holds up the rest: each says when it couldn't be read.
 *
 * On the demo brand, the cards show the demo's states (lib/demo/integrations):
 * the live ones connected with sample data, the ones still to come as Coming
 * soon, those without a card of their own as a row in their group.
 */
export function IntegrationsSection() {
  const t = useTranslations('settings');
  const { isDemo } = useDemoBrand();
  // Merchant Center's card shows only where this server offers it (its Composio auth config),
  // as the API's config says: env only, read at once and never behind a status. Until it
  // says so the card isn't there, with no skeleton; a config that can't be read (an older
  // API, or one that is down) offers nothing.
  const [merchantCenterOffered, setMerchantCenterOffered] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readIntegrationsConfig().then((config) => {
      if (!cancelled) setMerchantCenterOffered(config?.googleMerchantCenter === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // Bumped when a brand adds a Merchant Center account, so the catalog card lists it.
  const [catalogReads, setCatalogReads] = useState(0);
  // The catalog's sources as its card read them, for the picker to mark the accounts added.
  const [catalogSources, setCatalogSources] = useState<CatalogSourcesRead | null>(null);
  // Bumped on each read of a brand's sources after its first (a feed added or synced, a
  // file uploaded, a store connected or removed), so the category pages count their
  // products again. A brand's first read comes with the category pages' own.
  const [categoryReads, setCategoryReads] = useState(0);
  const lastSourcesRead = useRef<CatalogSourcesRead | null>(null);
  const onCatalogSources = useCallback((read: CatalogSourcesRead | null) => {
    setCatalogSources(read);
    const last = lastSourcesRead.current;
    if (!read || read === last) return;
    if (last?.brandId === read.brandId) setCategoryReads((n) => n + 1);
    lastSourcesRead.current = read;
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('integrations')}</CardTitle>
        <CardDescription>{t('integrations_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <IntegrationCard
          anchor="google-search-console"
          provider="google-search-console"
          label="Google Search Console"
          description="Real search queries and impressions for your site — powers prompt suggestions and search-vs-AI insights."
          icon={<Search className="h-5 w-5 text-muted-foreground" />}
          authConfigEnv="COMPOSIO_GSC_AUTH_CONFIG_ID"
        >
          <GscPropertyMapping />
        </IntegrationCard>

        <IntegrationCard
          anchor="google-analytics"
          provider="google-analytics"
          label="Google Analytics"
          description="Sessions and conversions from your GA4 property — the basis for AI traffic history without installing the tracking snippet."
          icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />}
          authConfigEnv="COMPOSIO_GA_AUTH_CONFIG_ID"
        >
          <GaPropertyMapping />
        </IntegrationCard>

        <IntegrationGroup title={t('integrations_stores')}>
          {/* On the demo brand it shows, as Coming soon (lib/demo/integrations). */}
          {(merchantCenterOffered || isDemo) && (
            <IntegrationCard
              anchor="merchant-center"
              provider="google-merchant-center"
              label={MERCHANT_CENTER_LABEL}
              description={t('merchantCenter.description')}
              icon={<ShoppingBag className="h-5 w-5 text-muted-foreground" />}
              authConfigEnv="COMPOSIO_GMC_AUTH_CONFIG_ID"
            >
              <MerchantCenterAccounts
                sources={catalogSources}
                onConnected={() => setCatalogReads((n) => n + 1)}
              />
            </IntegrationCard>
          )}

          {isDemo &&
            upcomingDemoIntegrations('stores').map((id) => (
              <UpcomingIntegrationCard key={id} id={id} />
            ))}

          <div id="product-catalog" className="scroll-mt-4">
            <CatalogSourcesCard refreshKey={catalogReads} onSources={onCatalogSources} />
          </div>

          <CatalogCategoryPages refreshKey={categoryReads} />
        </IntegrationGroup>

        {/* Send to CMS destinations: a new CMS's card goes in this group. */}
        <IntegrationGroup title={t('integrations_cms')}>
          {/* Each has its anchor: Chat's Connections opens it by name (#webflow). */}
          <div id="webflow" className="scroll-mt-4">
            <WebflowCard />
          </div>

          <div id="wordpress" className="scroll-mt-4">
            <WordPressCard />
          </div>

          <div id="framer" className="scroll-mt-4">
            <FramerCard />
          </div>

          <div id="wix" className="scroll-mt-4">
            <WixCard />
          </div>
          {isDemo &&
            upcomingDemoIntegrations('cms').map((id) => (
              <UpcomingIntegrationCard key={id} id={id} />
            ))}
        </IntegrationGroup>
      </CardContent>
    </Card>
  );
}

/**
 * A group of integration cards under its heading: a section the heading
 * names, so a screen reader lists the heading and the group by it.
 */
function IntegrationGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h3 id={id} className="pt-2 text-sm font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The icons of the integrations without a card of their own yet. */
const UPCOMING_ICONS: Record<string, ReactNode> = {
  shopify: <ShoppingBag className="h-5 w-5 text-muted-foreground" />,
};

/**
 * An integration still to come, on the demo brand: its row as an
 * integration card has it, saying Coming soon, with nothing to connect.
 */
function UpcomingIntegrationCard({ id }: { id: string }) {
  const t = useTranslations('settings');
  return (
    <div
      data-integration={id}
      className="flex items-center justify-between gap-4 rounded-lg border p-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          {UPCOMING_ICONS[id] ?? <Globe className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{t(`demoIntegrations.${id}.label`)}</p>
            <Badge variant="secondary" className="bg-muted text-muted-foreground">
              {t('integrations_comingSoon')}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {t(`demoIntegrations.${id}.description`)}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * One integration row: status badge, Connect / Disconnect, and whatever the
 * provider wants to render once connected (`children`).
 *
 * Its status is read on its own (lib/integrationsClient.ts): one that is
 * slow or fails leaves the other cards be, and after its timeout the card
 * says it couldn't check, with Try again in place of the skeleton.
 *
 * On the demo brand, its state comes from the demo's list instead of the
 * API: connected (with "Sample data"; Disconnect opens the plan dialog), or
 * Coming soon. No set-up line there.
 */
function IntegrationCard({
  anchor,
  provider,
  label,
  description,
  icon,
  authConfigEnv,
  children,
}: {
  /** Its id on the page, which Chat's Connections opens it by (#google-analytics). */
  anchor: string;
  provider: IntegrationProvider;
  label: string;
  description: string;
  icon: ReactNode;
  authConfigEnv: string;
  children?: ReactNode;
}) {
  const t = useTranslations('settings');
  const { isDemo } = useDemoBrand();
  const demo = isDemo ? demoIntegration(provider) : null;
  const { openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [readStatus, setStatus] = useState<IntegrationStatus | null>(null);
  // Why the last read of the status didn't come back, while there's no status.
  const [failure, setFailure] = useState<IntegrationFailure | null>(null);
  // The demo's state, else the API's.
  const status: IntegrationStatus | null =
    demo === 'connected' ? 'connected' : demo === 'soon' ? 'not_configured' : readStatus;
  const [disconnecting, setDisconnecting] = useState(false);
  const { connecting, connect: handleConnect } = useIntegrationConnect(provider, {
    label,
    callbackUrl: () => `${window.location.origin}/dashboard/settings?tab=integrations`,
    onStatus: setStatus,
  });

  const load = useCallback(async () => {
    setFailure(null);
    const result = await readIntegrationStatus(provider);
    if (result.ok) setStatus(result.value);
    else setFailure(result.reason);
  }, [provider]);

  useEffect(() => {
    if (demo) return;
    void load();
  }, [load, demo]);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectIntegration(provider);
      setStatus('not_connected');
      toast.success(`${label} disconnected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const soon = demo === 'soon';

  return (
    <div id={anchor} className="scroll-mt-4 space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{label}</p>
              {status === 'connected' && (
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                >
                  {t('integrations_connected')}
                </Badge>
              )}
              {demo === 'connected' && <SampleDataBadge />}
              {soon && (
                <Badge variant="secondary" className="bg-muted text-muted-foreground">
                  {t('integrations_comingSoon')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          </div>
        </div>

        {soon ? null : status === null && failure ? (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => void load()}>
            {t('integrations_retry')}
          </Button>
        ) : status === null ? (
          <Skeleton className="h-8 w-24" />
        ) : status === 'not_configured' ? (
          <Badge variant="outline" className="text-muted-foreground shrink-0">
            {t('integrations_notConfigured')}
          </Badge>
        ) : status === 'connected' && demo ? (
          // Sample data: there is nothing to disconnect.
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            onClick={() => openUpgrade(tActions('disconnectIntegrations'))}
          >
            <Unplug className="h-3.5 w-3.5" />
            {t('integrations_disconnect')}
          </Button>
        ) : status === 'connected' ? (
          <Dialog>
            <DialogTrigger
              render={<Button variant="outline" size="sm" className="gap-2 shrink-0" />}
            >
              <Unplug className="h-3.5 w-3.5" />
              {t('integrations_disconnect')}
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>
                  {t('integrations_disconnect')} {label}
                </DialogTitle>
                <DialogDescription>{t('integrations_disconnectDescription')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  {t('integrations_cancel')}
                </DialogClose>
                <DialogClose
                  render={
                    <Button
                      variant="destructive"
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                    />
                  }
                >
                  {t('integrations_disconnect')}
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Button
            size="sm"
            className="gap-2 shrink-0"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {connecting ? t('integrations_connecting') : t('integrations_connect')}
          </Button>
        )}
      </div>

      {status === null && failure && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(failure === 'timeout' ? 'integrations_statusTimedOut' : 'integrations_statusFailed', {
            label,
          })}
        </p>
      )}

      {status === 'not_configured' && !soon && (
        <p className="text-xs text-muted-foreground">
          This server has no Composio credentials for {label}. Set{' '}
          <code className="rounded bg-muted px-1">COMPOSIO_API_KEY</code> and{' '}
          <code className="rounded bg-muted px-1">{authConfigEnv}</code> in the server environment
          to enable it.
        </p>
      )}

      {status === 'connected' && children}
    </div>
  );
}

/**
 * Brand → property mapping (#642, generalised for Analytics in #694).
 *
 * The connection is org-level; each brand picks exactly one property from it.
 * Search Console and Analytics differ only in where a property's site URLs
 * come from — a GSC property *is* a URL, a GA4 property is a numeric id whose
 * URLs live on its web data streams — so both providers render this component
 * and supply their own loaders. Brands whose domain matches exactly one
 * property are premapped automatically; the picker always overrides.
 */
const NONE_VALUE = '__none__';

interface PropertyOption {
  /** Value persisted on the brand row. */
  value: string;
  /** Plain-text label — the trigger renders the selected item's text. */
  label: string;
  /** URLs this property covers, used for the domain auto-match. */
  siteUrls: string[];
}

interface BrandPropertyRow {
  brandId: string;
  brandName: string;
  value: string | null;
  domains: string[];
}

function PropertyMapping({
  sourceName,
  description,
  emptyMessage,
  loadOptions,
  loadRows,
  save,
}: {
  sourceName: string;
  description: string;
  emptyMessage: string;
  loadOptions: () => Promise<IntegrationResult<PropertyOption[]>>;
  loadRows: () => Promise<BrandPropertyRow[]>;
  save: (brandId: string, value: string | null) => Promise<void>;
}) {
  const t = useTranslations('settings');
  const [options, setOptions] = useState<PropertyOption[] | null>(null);
  const [rows, setRows] = useState<BrandPropertyRow[] | null>(null);
  // Why the properties couldn't be read: they took too long, or the API's words.
  const [loadFailed, setLoadFailed] = useState<'timeout' | { message: string } | null>(null);
  const [savingBrandId, setSavingBrandId] = useState<string | null>(null);
  const autoMatched = useRef(false);
  // A read-only workspace (plan not active): picking a property opens the
  // upgrade dialog instead, and nothing is matched by itself.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const load = useCallback(async () => {
    setLoadFailed(null);
    try {
      const [properties, brands] = await Promise.all([loadOptions(), withReadTimeout(loadRows())]);
      if (!properties.ok) {
        setLoadFailed(
          properties.reason === 'timeout'
            ? 'timeout'
            : { message: properties.error ?? 'Failed to load properties' },
        );
        return;
      }
      setOptions(properties.value);
      setRows(brands);
    } catch (err) {
      setLoadFailed(
        isTimeout(err)
          ? 'timeout'
          : { message: err instanceof Error ? err.message : 'Failed to load properties' },
      );
    }
  }, [loadOptions, loadRows]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-match: premap unmapped brands whose domains match exactly one
  // property. Runs once per mount; a failed save (e.g. member role) just
  // leaves the brand unmapped for a manual pick by an admin.
  useEffect(() => {
    if (!options || !rows || autoMatched.current || isLocked) return;
    autoMatched.current = true;
    (async () => {
      for (const row of rows) {
        if (row.value) continue;
        const match = matchProperty(options, row.domains);
        if (!match) continue;
        try {
          await save(row.brandId, match);
          setRows((prev) =>
            (prev ?? []).map((r) => (r.brandId === row.brandId ? { ...r, value: match } : r)),
          );
        } catch (err) {
          console.error(`${sourceName} auto-map failed:`, err);
          return; // likely a permissions error — no point retrying the rest
        }
      }
    })();
  }, [options, rows, save, sourceName, isLocked]);

  const handlePick = async (brandId: string, picked: string) => {
    const value = picked === NONE_VALUE ? null : picked;
    const previous = rows;
    setSavingBrandId(brandId);
    setRows((prev) => (prev ?? []).map((r) => (r.brandId === brandId ? { ...r, value } : r)));
    try {
      await save(brandId, value);
    } catch (err) {
      setRows(previous);
      toast.error(err instanceof Error ? err.message : 'Failed to save property');
    } finally {
      setSavingBrandId(null);
    }
  };

  if (loadFailed) {
    return (
      <div className="rounded-lg border p-4 text-sm">
        <p className="text-muted-foreground">Couldn&apos;t load {sourceName} properties.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {loadFailed === 'timeout' ? t('integrations_propertiesTimedOut') : loadFailed.message}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}>
          {t('integrations_retry')}
        </Button>
      </div>
    );
  }

  if (!options || !rows) {
    return <Skeleton className="h-24 w-full" />;
  }

  const mappedCount = rows.filter((r) => r.value).length;
  // The trigger renders the *value* unless the Select knows the value → label
  // mapping. Search Console values are the label (a URL), but a GA4 value is a
  // numeric id, which would otherwise show as a bare number once picked.
  const selectItems = [
    { value: NONE_VALUE, label: t('integrations_notMapped') },
    ...options.map((option) => ({ value: option.value, label: option.label })),
  ];

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t('integrations_propertyMapping')}</p>
        <span className="text-xs text-muted-foreground">
          {mappedCount} of {rows.length} brand{rows.length !== 1 ? 's' : ''} mapped
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.brandId} className="flex items-center justify-between gap-3">
            <span className="truncate text-sm">{row.brandName}</span>
            <div className="flex items-center gap-2">
              {savingBrandId === row.brandId && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <Select
                items={selectItems}
                value={row.value ?? null}
                onValueChange={guard(
                  (v: string | null) => void handlePick(row.brandId, v ?? NONE_VALUE),
                  { action: tActions('mapProperties') },
                )}
              >
                <SelectTrigger className="h-8 w-64 text-xs">
                  <SelectValue placeholder={t('integrations_selectProperty')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t('integrations_notMapped')}</SelectItem>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>
      {options.length === 0 && <p className="text-xs text-muted-foreground">{emptyMessage}</p>}
    </div>
  );
}

// Loaders live at module scope so their identity is stable across renders —
// PropertyMapping's effects depend on them.

async function loadGscOptions(): Promise<IntegrationResult<PropertyOption[]>> {
  const result = await readGscProperties();
  if (!result.ok) return result;
  return {
    ok: true,
    value: result.value.map((p) => ({ value: p.siteUrl, label: p.siteUrl, siteUrls: [p.siteUrl] })),
  };
}

async function loadGscRows(): Promise<BrandPropertyRow[]> {
  const mappings = await getGscBrandMappings();
  return mappings.map((m) => ({
    brandId: m.brandId,
    brandName: m.brandName,
    value: m.gscProperty,
    domains: m.domains,
  }));
}

/**
 * The demo brand's mapping: its own row, mapped to its sample property. Its
 * picker opens the plan dialog, as the workspace is locked on the demo brand.
 */
function useDemoMapping(property: (brand: Brand) => PropertyOption) {
  const brand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId) ?? null);
  const option = brand ? property(brand) : null;
  const row: BrandPropertyRow | null =
    brand && option
      ? {
          brandId: brand.id,
          brandName: brand.name,
          value: option.value,
          domains: brand.domains.map((d) => d.domain),
        }
      : null;
  // Stable while the sample property is: the mapping reads again when its loaders change.
  const key = row ? `${row.brandId}|${row.brandName}|${option?.label}` : '';
  const [loaders, setLoaders] = useState({ key: '', loadOptions: noOptions, loadRows: noRows });
  if (loaders.key !== key) {
    setLoaders({
      key,
      loadOptions: async (): Promise<IntegrationResult<PropertyOption[]>> => ({
        ok: true,
        value: option ? [option] : [],
      }),
      loadRows: async () => (row ? [row] : []),
    });
  }
  return loaders;
}

const noOptions = async (): Promise<IntegrationResult<PropertyOption[]>> => ({
  ok: true,
  value: [],
});
const noRows = async (): Promise<BrandPropertyRow[]> => [];
const saveNothing = async () => {};

function primaryDomain(brand: Brand): string {
  return (brand.domains.find((d) => d.isPrimary) ?? brand.domains[0])?.domain ?? brand.slug;
}

function demoGscProperty(brand: Brand): PropertyOption {
  const url = demoSearchConsoleProperty(primaryDomain(brand));
  return { value: url, label: url, siteUrls: [url] };
}

function demoGaProperty(brand: Brand): PropertyOption {
  return {
    value: DEMO_ANALYTICS_PROPERTY_ID,
    label: `${brand.name} · GA4 (${DEMO_ANALYTICS_PROPERTY_ID})`,
    siteUrls: [`https://${primaryDomain(brand)}`],
  };
}

function GscPropertyMapping() {
  const { isDemo } = useDemoBrand();
  const demo = useDemoMapping(demoGscProperty);
  return (
    <PropertyMapping
      key={isDemo ? 'demo' : 'live'}
      sourceName="Search Console"
      description="Pick which Search Console property each brand's data comes from. Brands matching a property by domain are mapped automatically."
      emptyMessage="The connected account has no Search Console properties. Add your site in Search Console first, then retry."
      loadOptions={isDemo ? demo.loadOptions : loadGscOptions}
      loadRows={isDemo ? demo.loadRows : loadGscRows}
      save={isDemo ? saveNothing : setBrandGscProperty}
    />
  );
}

async function loadGaOptions(): Promise<IntegrationResult<PropertyOption[]>> {
  const result = await readGaProperties();
  if (!result.ok) return result;
  return {
    ok: true,
    value: result.value.map((p) => ({
      value: p.propertyId,
      // Display names repeat across accounts ("GA4"), so the id disambiguates.
      label: p.accountName
        ? `${p.displayName} · ${p.accountName} (${p.propertyId})`
        : `${p.displayName} (${p.propertyId})`,
      siteUrls: p.siteUrls,
    })),
  };
}

async function loadGaRows(): Promise<BrandPropertyRow[]> {
  const mappings = await getGaBrandMappings();
  return mappings.map((m) => ({
    brandId: m.brandId,
    brandName: m.brandName,
    value: m.gaPropertyId,
    domains: m.domains,
  }));
}

function GaPropertyMapping() {
  const { isDemo } = useDemoBrand();
  const demo = useDemoMapping(demoGaProperty);
  return (
    <PropertyMapping
      key={isDemo ? 'demo' : 'live'}
      sourceName="Analytics"
      description="Pick which GA4 property each brand's data comes from. Brands whose domain matches a property's web data stream are mapped automatically."
      emptyMessage="The connected account has no GA4 properties. Create one in Google Analytics first, then retry."
      loadOptions={isDemo ? demo.loadOptions : loadGaOptions}
      loadRows={isDemo ? demo.loadRows : loadGaRows}
      save={isDemo ? saveNothing : setBrandGaProperty}
    />
  );
}
