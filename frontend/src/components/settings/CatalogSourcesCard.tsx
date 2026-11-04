'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { KeyRound, Loader2, Package, RefreshCw, Store, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { addFeedSource, listCatalogSources, removeCatalogSource } from '@/lib/actions/catalog';
import { withReadTimeout } from '@/lib/integrationsClient';
import { isStoreSource, SIGN_IN_PLATFORM_LABELS, type CatalogSource } from '@/lib/catalog';
import {
  connectStore,
  listStoreConnectors,
  removeStore,
  syncCatalogSource,
  updateStoreSignIn,
  uploadCatalogFile,
  type CatalogSyncResult,
  type SignInConnector,
  type StoreConnector,
  type StoreResult,
} from '@/lib/catalogClient';
import { useBrandStore } from '@/state/useBrandStore';
import { StoreSignInForm } from './CatalogStoreForm';

/** A brand's sources as the card read them: null when they couldn't be read. */
export interface CatalogSourcesRead {
  brandId: string;
  sources: CatalogSource[] | null;
}

/**
 * Product catalog (#1263): where the active brand's catalog comes from, a
 * product feed URL read daily, a CSV / feed file uploaded, or a store
 * connected with its sign-in (00282), as the API's connectors offer them.
 * A Google Merchant Center account (#1270) is added above, under its
 * Integrations card, and listed here with how many of its products
 * Merchant Center reports issues for. Admins and managers add, sync and
 * remove; members see the sources and how they went, and the products past
 * the plan's cap left out (ECOM-019).
 *
 * `refreshKey`: changed by the page to read the sources again (an account
 * added elsewhere). `onSources` hears each read, for the Merchant Center
 * picker to mark the accounts the brand has already.
 */
export function CatalogSourcesCard({
  refreshKey = 0,
  onSources,
}: {
  refreshKey?: number;
  onSources?: (read: CatalogSourcesRead | null) => void;
}) {
  const t = useTranslations('settings.catalog');
  const format = useFormatter();
  const { activeBrandId, brands } = useBrandStore();
  const { canManage } = useUserRole();
  // A read-only workspace's refusal opens the upgrade dialog, not a toast;
  // while it is read-only, adding, syncing, uploading, connecting a store or
  // its sign-in, and removing a feed or upload open it before anything is
  // sent. Removing a store stays open: it disconnects the store.
  const { guard, isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;

  // The sources as read for a brand, and when ("synced 3 hours ago"): another
  // brand's never show.
  const [loaded, setLoaded] = useState<{
    brandId: string;
    sources: CatalogSource[] | null;
    at: Date;
  } | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The stores the API can connect; null until read, or when it can't be.
  const [stores, setStores] = useState<{
    connectors: StoreConnector[];
    ready: boolean;
    signIns: SignInConnector[];
  } | null>(null);
  // The store being connected (its kind), or the store whose sign-in is being replaced (its id).
  const [connecting, setConnecting] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listStoreConnectors().then((list) => {
      if (!cancelled) setStores(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const connectorOf = (kind: string) => stores?.connectors.find((c) => c.kind === kind) ?? null;
  const signInOf = (kind: string) => stores?.signIns.find((c) => c.kind === kind) ?? null;

  // Bumped to read the sources again, after a sync, an add or a removal.
  const [reads, setReads] = useState(0);
  const load = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    // A read that takes too long says the sources can't be read, like one that fails.
    withReadTimeout(listCatalogSources(activeBrandId)).then(
      (sources) => {
        if (!cancelled) setLoaded({ brandId: activeBrandId, sources, at: new Date() });
      },
      (err) => {
        console.error('Failed to read the catalog sources:', err);
        if (!cancelled) setLoaded({ brandId: activeBrandId, sources: null, at: new Date() });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, reads, refreshKey]);

  const current = loaded?.brandId === activeBrandId ? loaded : null;
  useEffect(() => {
    onSources?.(current);
  }, [current, onSources]);
  const sources = current?.sources ?? null;
  const failed = current !== null && current.sources === null;
  const now = current?.at ?? new Date();

  /** Says how a sync went, then reads the sources again. */
  const report = (result: CatalogSyncResult) => {
    if (!result.ok && result.code === 'subscription') openUpgrade();
    else if (!result.ok) toast.error(t(`errors.${result.code}`));
    else if (result.status === 'ok') {
      toast.success(t('synced', { count: result.counts?.items ?? 0 }));
    } else toast.error(result.error ?? t('errors.failed'));
    load();
  };

  const add = async () => {
    if (!activeBrandId) return;
    setBusy('add');
    const added = await addFeedSource(activeBrandId, url);
    if (!added.ok) {
      toast.error(t(`errors.${added.code}`));
      setBusy(null);
      return;
    }
    setUrl('');
    // Read it now, so the person sees whether it's a feed.
    report(await syncCatalogSource(added.id));
    setBusy(null);
  };

  const addFeed = guard(() => void add(), { action: tActions('addCatalogSources') });

  const sync = async (id: string) => {
    setBusy(id);
    report(await syncCatalogSource(id));
    setBusy(null);
  };

  const remove = async (source: CatalogSource) => {
    if (!window.confirm(t('removeConfirm'))) return;
    setBusy(source.id);
    if (isStoreSource(source.kind)) {
      // A store goes through the API, which holds its sign-in.
      const removed = await removeStore(source.id);
      if (!removed.ok && removed.code === 'subscription') openUpgrade();
      else if (!removed.ok) toast.error(t(`stores.errors.${removed.code}`));
      load();
    } else {
      try {
        await removeCatalogSource(source.id);
        load();
      } catch {
        toast.error(t('errors.forbidden'));
      }
    }
    setBusy(null);
  };

  /** Says how a store call went, then reads the sources again. */
  const reportStore = (result: StoreResult, success: string) => {
    if (!result.ok && result.code === 'subscription') openUpgrade();
    else if (!result.ok) toast.error(result.message ?? t(`stores.errors.${result.code}`));
    else toast.success(success);
    load();
    return result.ok;
  };

  const connect = async (connector: StoreConnector, input: Record<string, string>) => {
    if (!activeBrandId) return;
    setBusy('connect');
    const ok = reportStore(
      await connectStore(activeBrandId, connector.kind, input),
      t('stores.connected', { store: connector.label }),
    );
    if (ok) setConnecting(null);
    setBusy(null);
  };

  const signIn = async (source: CatalogSource, input: Record<string, string>) => {
    setBusy(source.id);
    const ok = reportStore(await updateStoreSignIn(source.id, input), t('stores.updated'));
    if (ok) setSigningIn(null);
    setBusy(null);
  };

  /** How a source is named in its row: a feed by its address, a store by its name and account. */
  const nameOf = (source: CatalogSource) => {
    if (source.kind === 'feed_url') return source.url;
    if (source.kind === 'upload') return t('upload');
    // A sign-in platform's account by its name and id ("Google Merchant Center · Acme (123)"),
    // named by the platform even before (or without) the API's connectors.
    const signIn = signInOf(source.kind)?.label ?? SIGN_IN_PLATFORM_LABELS[source.kind];
    if (signIn) {
      const account =
        source.label && source.account ? `${source.label} (${source.account})` : source.account;
      return account ? `${signIn} · ${account}` : signIn;
    }
    const platform = connectorOf(source.kind)?.label ?? source.label ?? source.kind;
    return source.account ? `${platform} · ${source.account}` : platform;
  };

  const upload = async (file: File | undefined) => {
    if (!file || !activeBrandId) return;
    setBusy('upload');
    report(await uploadCatalogFile(activeBrandId, file));
    setBusy(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Package className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="font-medium">{t('title')}</p>
          <p className="text-sm text-muted-foreground">
            {brand ? t('description', { brand: brand.name }) : t('noBrand')}
          </p>
        </div>
      </div>

      {activeBrandId &&
        (failed ? (
          <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
        ) : sources === null ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sources.map((source) => (
                  <li key={source.id} className="space-y-1 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className="min-w-0 truncate font-medium"
                        title={source.url ?? undefined}
                      >
                        {nameOf(source)}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge variant={source.lastStatus === 'ok' ? 'secondary' : 'outline'}>
                          {source.lastStatus ? t(`status.${source.lastStatus}`) : t('status.never')}
                        </Badge>
                        {canManage && isStoreSource(source.kind) && connectorOf(source.kind) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={guard(
                              () => setSigningIn(signingIn === source.id ? null : source.id),
                              { action: tActions('updateStoreSignIn') },
                            )}
                            aria-label={t('stores.update')}
                            aria-expanded={signingIn === source.id}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                        )}
                        {canManage && source.kind !== 'upload' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={guard(() => void sync(source.id), {
                              action: tActions('syncCatalog'),
                            })}
                            aria-label={t('syncNow')}
                          >
                            {busy === source.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={
                              isStoreSource(source.kind)
                                ? () => void remove(source)
                                : guard(() => void remove(source), {
                                    action: tActions('removeCatalogSources'),
                                  })
                            }
                            aria-label={t('remove')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('products', { count: source.products })}
                      {(source.lastCounts?.issues?.items ?? 0) > 0 &&
                        ` · ${t('issues', { count: source.lastCounts!.issues!.items })}`}
                      {(source.lastCounts?.repeated ?? 0) > 0 &&
                        ` · ${t('repeated', { count: source.lastCounts!.repeated! })}`}
                      {source.kind !== 'upload' &&
                        source.lastSyncedAt &&
                        ` · ${t('lastSync', { when: format.relativeTime(new Date(source.lastSyncedAt), now) })}`}
                    </p>
                    {/* An upload is read once: it says so, with when, rather than "synced". */}
                    {source.kind === 'upload' && source.lastSyncedAt && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        {t('uploadStale', {
                          when: format.relativeTime(new Date(source.lastSyncedAt), now),
                        })}
                      </p>
                    )}
                    {source.lastStatus !== 'ok' && source.lastError && (
                      <p className="text-xs text-destructive">{source.lastError}</p>
                    )}
                    {source.lastStatus === 'ok' && (source.lastCounts?.skipped ?? 0) > 0 && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          {t('skipped', { count: source.lastCounts!.skipped })}
                        </summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {source.lastCounts!.errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {source.lastStatus === 'ok' && (source.lastCounts?.overLimit ?? 0) > 0 && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        {t('overLimit', {
                          count: source.lastCounts!.overLimit!,
                          limit: source.lastCounts!.limit ?? 0,
                        })}
                        {canManage && (
                          <>
                            {' '}
                            <Link
                              href="/dashboard/settings/billing"
                              className="font-medium underline underline-offset-2"
                            >
                              {t('upgrade')}
                            </Link>
                          </>
                        )}
                      </p>
                    )}
                    {signingIn === source.id && connectorOf(source.kind) && (
                      <StoreSignInForm
                        connector={connectorOf(source.kind)!}
                        submitLabel={t('stores.save')}
                        busy={busy === source.id}
                        onSubmit={(input) => void signIn(source, input)}
                        onCancel={() => setSigningIn(null)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canManage ? (
              <div className="space-y-2">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{t('recommended')}</Badge>
                  {t('feedRecommended')}
                </p>
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addFeed();
                  }}
                >
                  <Input
                    type="url"
                    inputMode="url"
                    placeholder={t('urlPlaceholder')}
                    aria-label={t('urlLabel')}
                    value={url}
                    maxLength={2048}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <Button type="submit" disabled={!url.trim() || busy !== null}>
                    {busy === 'add' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('addFeed')}
                  </Button>
                </form>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".csv,.tsv,.txt,.xml,text/csv,text/plain,application/xml,text/xml"
                    className="hidden"
                    onChange={(e) => void upload(e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      if (isLocked) openUpgrade(tActions('addCatalogSources'));
                      else fileInput.current?.click();
                    }}
                  >
                    {busy === 'upload' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {t('uploadFile')}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t('uploadHint')}</span>
                </div>
                {stores && stores.connectors.length > 0 && (
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-sm font-medium">{t('stores.title')}</p>
                    {stores.ready ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {stores.connectors.map((connector) => (
                            <Button
                              key={connector.kind}
                              type="button"
                              variant={connecting === connector.kind ? 'secondary' : 'outline'}
                              size="sm"
                              disabled={busy !== null}
                              aria-expanded={connecting === connector.kind}
                              onClick={guard(
                                () =>
                                  setConnecting(
                                    connecting === connector.kind ? null : connector.kind,
                                  ),
                                { action: tActions('connectStores') },
                              )}
                            >
                              <Store className="mr-2 h-4 w-4" />
                              {t('stores.connect', { store: connector.label })}
                            </Button>
                          ))}
                        </div>
                        {connecting && connectorOf(connecting) && (
                          <StoreSignInForm
                            key={connecting}
                            connector={connectorOf(connecting)!}
                            submitLabel={t('stores.submit')}
                            busy={busy === 'connect'}
                            onSubmit={(input) => void connect(connectorOf(connecting)!, input)}
                            onCancel={() => setConnecting(null)}
                          />
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('stores.notConfigured')}</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('managersOnly')}</p>
            )}
          </>
        ))}
    </div>
  );
}
