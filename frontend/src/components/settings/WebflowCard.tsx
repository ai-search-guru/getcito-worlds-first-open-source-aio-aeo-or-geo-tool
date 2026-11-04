'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Globe, Loader2, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useDemoBrand } from '@/components/context/DemoBrandProvider';
import { DEMO_WEBFLOW_COLLECTION, demoIntegration } from '@/lib/demo/integrations';
import { SampleDataBadge } from './SampleDataBadge';
import {
  WEBFLOW_PARTS,
  WEBFLOW_PART_TYPES,
  type WebflowError,
  connectWebflow,
  disconnectWebflow,
  listWebflowCollections,
  readWebflow,
  readWebflowCollection,
  saveWebflowSettings,
  type WebflowCollection,
  type WebflowConnection,
  type WebflowField,
  type WebflowFieldMap,
  type WebflowSite,
} from '@/lib/webflowClient';
import { useBrandStore } from '@/state/useBrandStore';

/** The parts of a map whose field is still one of that part's choices, each field once. */
function fitting(map: WebflowFieldMap, fields: WebflowField[]): WebflowFieldMap {
  const kept: WebflowFieldMap = {};
  const used = new Set<string>();
  for (const part of WEBFLOW_PARTS) {
    const slug = map[part];
    const field = fields.find((f) => f.slug === slug);
    if (!slug || !field || field.type !== WEBFLOW_PART_TYPES[part]) continue;
    if (slug === 'name' || slug === 'slug' || used.has(slug)) continue;
    kept[part] = slug;
    used.add(slug);
  }
  return kept;
}

/** A part the map leaves out. */
const NOT_SENT = '__none__';
/** Answers that mean the connection changed: it's read again. */
const STALE: readonly WebflowError[] = ['auth_failed', 'changed', 'not_connected'];

/**
 * Send to CMS → Webflow (#1331, phase 2): the active brand's Webflow site.
 * Admins and managers connect it with a site token, pick the collection
 * pages go to and which of its fields takes each part of a page, replace
 * the token and disconnect; members see where pages go.
 *
 * On the demo brand, connected with sample data (lib/demo/integrations):
 * where its pages go, and Replace token and Disconnect opening the plan
 * dialog. Nothing is read from Webflow.
 */
export function WebflowCard() {
  const t = useTranslations('settings.webflow');
  const { activeBrandId, brands } = useBrandStore();
  const { canManage } = useUserRole();
  // A read-only workspace's refusal opens the upgrade dialog, not a toast;
  // while it is read-only, Replace token opens it at once. Disconnect stays
  // open: it ends an access, it starts nothing.
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;
  const { isDemo } = useDemoBrand();
  const demo = isDemo && demoIntegration('webflow') === 'connected';

  // The connection as read for a brand: another brand's never shows.
  const [read, setRead] = useState<{
    brandId: string;
    configured: boolean;
    connection: WebflowConnection | null;
    failed: boolean;
  } | null>(null);
  // Replacing the token, for the brand it was asked for.
  const [replacingFor, setReplacingFor] = useState<string | null>(null);
  const replacing = replacingFor !== null && replacingFor === activeBrandId;
  const [disconnecting, setDisconnecting] = useState(false);
  // Connected just now without a collection, for the brand: its picker takes the focus.
  const [settingUpFor, setSettingUpFor] = useState<string | null>(null);
  // Bumped to read the connection again: a token refused or replaced meanwhile.
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!activeBrandId || demo) return;
    let cancelled = false;
    readWebflow(activeBrandId).then((result) => {
      if (cancelled) return;
      setRead(
        result.ok
          ? {
              brandId: activeBrandId,
              configured: result.configured,
              connection: result.connection,
              failed: false,
            }
          : { brandId: activeBrandId, configured: true, connection: null, failed: true },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, reads, demo]);

  // The demo brand's sample connection, never read from the API.
  const demoRead =
    demo && activeBrandId
      ? {
          brandId: activeBrandId,
          configured: true,
          connection: {
            status: 'connected' as const,
            siteId: 'demo',
            siteName: brand?.name ?? null,
            collectionId: 'demo',
            collectionName: DEMO_WEBFLOW_COLLECTION,
            fieldMap: {},
            connectedAt: '',
            updatedAt: '',
          },
          failed: false,
        }
      : null;
  const current = demoRead ?? (read?.brandId === activeBrandId ? read : null);
  const connection = current?.connection ?? null;
  const setConnection = (next: WebflowConnection | null) =>
    setRead((r) => (r && r.brandId === activeBrandId ? { ...r, connection: next } : r));

  const disconnect = async () => {
    if (!activeBrandId) return;
    setDisconnecting(true);
    const result = await disconnectWebflow(activeBrandId);
    setDisconnecting(false);
    if (!result.ok) {
      if (result.code === 'subscription') openUpgrade();
      else toast.error(t(`errors.${result.code}`));
      return;
    }
    setConnection(null);
    toast.success(t('disconnected'));
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Globe className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t('title')}</p>
            {connection?.status === 'connected' && connection.collectionId && (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                {t('connected')}
              </Badge>
            )}
            {demo && <SampleDataBadge />}
            {/* Connected, but nothing goes to Webflow until a collection is saved. */}
            {connection?.status === 'connected' && !connection.collectionId && (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              >
                {t('setupNotFinished')}
              </Badge>
            )}
            {connection?.status === 'auth_failed' && (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              >
                {t('refused')}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {brand ? t('description', { brand: brand.name }) : t('noBrand')}
          </p>
          {connection?.siteName && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('site', { site: connection.siteName })}
            </p>
          )}
          {canManage && connection && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!replacing && current?.configured && connection.status === 'connected' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={guard(() => setReplacingFor(activeBrandId), {
                    action: tActions('connectCms'),
                  })}
                >
                  {t('replaceToken')}
                </Button>
              )}
              {demo ? (
                // Sample data: there is nothing to disconnect.
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => openUpgrade(tActions('disconnectIntegrations'))}
                >
                  <Unplug className="h-3.5 w-3.5" />
                  {t('disconnect')}
                </Button>
              ) : (
                <Dialog>
                  <DialogTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={disconnecting}
                      />
                    }
                  >
                    {disconnecting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Unplug className="h-3.5 w-3.5" />
                    )}
                    {t('disconnect')}
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                      <DialogTitle>{t('disconnectTitle')}</DialogTitle>
                      <DialogDescription>{t('disconnectDescription')}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
                      <DialogClose render={<Button variant="destructive" onClick={disconnect} />}>
                        {t('disconnect')}
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          )}
        </div>
      </div>

      {!activeBrandId ? null : !current ? (
        <Skeleton className="h-16 w-full" />
      ) : current.failed ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : !current.configured ? (
        <p className="text-sm text-muted-foreground">{t('notConfigured')}</p>
      ) : demo ? (
        <p className="text-sm text-muted-foreground">
          {t('pagesGoTo', { collection: DEMO_WEBFLOW_COLLECTION })}
        </p>
      ) : !canManage ? (
        <p className="text-sm text-muted-foreground">
          {!connection
            ? t('notConnectedMember')
            : connection.status === 'auth_failed'
              ? t('refusedMember')
              : connection.collectionName
                ? t('pagesGoTo', { collection: connection.collectionName })
                : t('noCollection')}
        </p>
      ) : !connection || connection.status === 'auth_failed' || replacing ? (
        <div className="space-y-3">
          {connection?.status === 'auth_failed' && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('refusedNote')}</span>
            </div>
          )}
          <TokenForm
            brandId={activeBrandId}
            onCancel={replacing ? () => setReplacingFor(null) : undefined}
            onConnected={(next) => {
              setReplacingFor(null);
              setSettingUpFor(next.collectionId ? null : activeBrandId);
              setConnection(next);
            }}
          />
        </div>
      ) : (
        <WebflowMapping
          key={activeBrandId}
          brandId={activeBrandId}
          connection={connection}
          focusCollection={settingUpFor === activeBrandId}
          onSaved={(next) => {
            setSettingUpFor(null);
            setConnection(next);
          }}
          onStale={() => setReads((n) => n + 1)}
        />
      )}
    </div>
  );
}

/** Making a site token in Webflow, in order (en.json settings.webflow.tokenSteps). */
const TOKEN_STEPS = ['open', 'name', 'permissions', 'copy'] as const;

/** The site token, pasted once: it goes to the API and is never shown again. */
function TokenForm({
  brandId,
  onConnected,
  onCancel,
}: {
  brandId: string;
  onConnected: (connection: WebflowConnection) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('settings.webflow');
  // Read-only (plan not active): Connect opens the upgrade dialog before anything is sent.
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setConnecting(true);
    const result = await connectWebflow(brandId, token.trim());
    setConnecting(false);
    if (!result.ok) {
      if (result.code === 'subscription') openUpgrade();
      else
        toast.error(t(result.code === 'invalid' ? 'errors.invalidToken' : `errors.${result.code}`));
      return;
    }
    setToken('');
    // A new token for the same site keeps its collection; else the setup's last step is left,
    // with the site to pick first when the token reaches several (none saved then).
    toast.success(
      t(
        result.connection.collectionId
          ? 'connectedToast'
          : result.connection.siteId
            ? 'connectedSetupToast'
            : 'connectedPickSiteToast',
      ),
    );
    onConnected(result.connection);
  };

  const connectToken = guard(() => void connect(), { action: tActions('connectCms') });

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim() && !connecting) connectToken();
      }}
    >
      <Label htmlFor={`webflow-token-${brandId}`}>{t('tokenLabel')}</Label>
      {/* How to make one, read before the field it's pasted into. */}
      <ol
        id={`webflow-token-steps-${brandId}`}
        aria-label={t('tokenSteps.label')}
        className="list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground"
      >
        {TOKEN_STEPS.map((step) => (
          <li key={step}>{t(`tokenSteps.${step}`)}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Input
          id={`webflow-token-${brandId}`}
          aria-describedby={`webflow-token-steps-${brandId} webflow-token-hint-${brandId}`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t('tokenPlaceholder')}
          className="min-w-0 flex-1 basis-64"
        />
        <Button
          type="submit"
          size="sm"
          className="h-9 gap-2"
          disabled={!token.trim() || connecting}
        >
          {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {connecting ? t('connecting') : t('connect')}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
      </div>
      <p id={`webflow-token-hint-${brandId}`} className="text-xs text-muted-foreground">
        {t('tokenNote')}
      </p>
    </form>
  );
}

/** The site and collection pages go to, and which of its fields takes each part of a page. */
function WebflowMapping({
  brandId,
  connection,
  focusCollection,
  onSaved,
  onStale,
}: {
  brandId: string;
  connection: WebflowConnection;
  /** Just connected: the collection picker, the setup's last step, takes the focus. */
  focusCollection: boolean;
  onSaved: (connection: WebflowConnection) => void;
  /** The connection changed (a token refused, replaced or removed): read it again. */
  onStale: () => void;
}) {
  const t = useTranslations('settings.webflow');
  // Read-only (plan not active): Save opens the upgrade dialog before anything is sent.
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // The saved settings, for the fields read: a save doesn't read them again.
  const saved = useRef(connection);
  useEffect(() => {
    saved.current = connection;
  }, [connection]);
  const stale = useRef(onStale);
  useEffect(() => {
    stale.current = onStale;
  }, [onStale]);
  /** Says what went wrong, and reads the connection again when it changed. */
  const report = (code: WebflowError) => {
    if (code === 'subscription') {
      openUpgrade();
      return;
    }
    toast.error(t(`errors.${code}`));
    if (STALE.includes(code)) stale.current();
  };
  const [siteId, setSiteId] = useState<string | null>(connection.siteId);
  const [collectionId, setCollectionId] = useState<string | null>(connection.collectionId);
  // What was read, by the site or collection asked: until it's the one on screen, it's loading.
  const [siteRead, setSiteRead] = useState<{
    siteId: string | null;
    sites: WebflowSite[];
    collections: WebflowCollection[];
    failed: boolean;
  } | null>(null);
  const [fieldsRead, setFieldsRead] = useState<{
    key: string;
    fields: WebflowField[];
    failed: boolean;
  } | null>(null);
  const fieldsKey = `${siteId}:${collectionId}`;
  const sites = siteRead?.sites ?? [];
  const sitesRead = siteRead && siteRead.siteId === siteId ? siteRead : null;
  const collections = sitesRead ? sitesRead.collections : null;
  const fieldsNow = fieldsRead?.key === fieldsKey ? fieldsRead : null;
  const fields = fieldsNow?.fields ?? null;
  const [map, setMap] = useState<WebflowFieldMap>(connection.fieldMap);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // The site's collections.
  useEffect(() => {
    let cancelled = false;
    listWebflowCollections(brandId, siteId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        report(result.code);
        // The sites stay pickable; the collections say they couldn't be read.
        setSiteRead((prev) => ({
          siteId,
          sites: prev?.sites ?? [],
          collections: [],
          failed: true,
        }));
        return;
      }
      // The site the API read (none when the token no longer reaches the
      // one asked), or the token's one site.
      const site =
        result.siteId ?? (result.sites.length === 1 ? (result.sites[0]?.id ?? null) : null);
      if (site !== siteId) setSiteId(site);
      setSiteRead({
        siteId: site,
        sites: result.sites,
        collections: site === result.siteId ? result.collections : [],
        failed: false,
      });
    });
    return () => {
      cancelled = true;
    };
    // report reads the latest onStale through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, siteId, t]);

  // The collection's fields: the saved map for the saved collection, else the suggested one.
  useEffect(() => {
    if (!collectionId) return;
    let cancelled = false;
    const key = `${siteId}:${collectionId}`;
    readWebflowCollection(brandId, collectionId, siteId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        report(result.code);
        setFieldsRead({ key, fields: [], failed: true });
        return;
      }
      setFieldsRead({ key, fields: result.fields, failed: false });
      // Only what the pickers can show: a saved part whose field was deleted
      // or changed type in Webflow since is left out, so what's saved is what's shown.
      setMap(
        fitting(
          collectionId === saved.current.collectionId ? saved.current.fieldMap : result.suggested,
          result.fields,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
    // report reads the latest onStale through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, collectionId, siteId, t]);

  const save = async () => {
    if (!siteId || !collectionId) return;
    setSaving(true);
    setProblems([]);
    const result = await saveWebflowSettings(brandId, { siteId, collectionId, fieldMap: map });
    setSaving(false);
    if (!result.ok) {
      setProblems(result.problems ?? []);
      report(result.code);
      return;
    }
    toast.success(t('saved', { collection: result.connection.collectionName ?? '' }));
    onSaved(result.connection);
  };

  /** The API names a part by its key ("metaTitle: …"): the person reads its label. */
  const problemText = (problem: string) => {
    const part = WEBFLOW_PARTS.find((p) => problem.startsWith(`${p}: `));
    return part ? `${t(`parts.${part}`)}: ${problem.slice(part.length + 2)}` : problem;
  };
  const siteItems = sites.map((s) => ({ value: s.id, label: s.name }));
  // A token for several sites saves none (#1601): the site comes first. While
  // the sites are read, no site means several, so the line doesn't change.
  const siteFirst = !siteId && (siteRead === null || sites.length > 1);
  const collectionItems = (collections ?? []).map((c) => ({ value: c.id, label: c.name }));
  const required = new Set((fields ?? []).filter((f) => f.required).map((f) => f.slug));

  return (
    <div className="space-y-4">
      {!connection.collectionId && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t(siteFirst ? 'setupStepSite' : 'setupStep')}</span>
        </div>
      )}
      {sites.length > 1 && (
        <Picker
          label={t('siteLabel')}
          items={siteItems}
          value={siteId}
          placeholder={t('sitePlaceholder')}
          // A token for several sites saves none: the site comes first (#1601).
          autoFocus={focusCollection && !siteId}
          onChange={(value) => {
            setSiteId(value);
            setCollectionId(null);
            setMap({});
          }}
        />
      )}
      {siteRead === null || (siteId !== null && collections === null) ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('loadingCollections')}
        </p>
      ) : !siteId || !collections ? null : sitesRead?.failed ? (
        <p className="text-sm text-muted-foreground">{t('collectionsUnavailable')}</p>
      ) : collections.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noCollections')}</p>
      ) : (
        <Picker
          label={t('collectionLabel')}
          items={collectionItems}
          value={collectionId}
          placeholder={t('collectionPlaceholder')}
          autoFocus={focusCollection}
          onChange={(value) => {
            if (value === collectionId) return;
            setCollectionId(value);
            // The new collection's own map comes with its fields.
            setMap({});
            setProblems([]);
          }}
        />
      )}

      {collectionId && (
        <div className="space-y-3 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">{t('fieldsTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('fieldsHint')}</p>
          </div>
          {fields === null ? (
            <Skeleton className="h-24 w-full" />
          ) : fieldsNow?.failed ? (
            <p className="text-sm text-muted-foreground">{t('fieldsUnavailable')}</p>
          ) : (
            WEBFLOW_PARTS.map((part) => {
              // A field of the part's type that no other part takes.
              const taken = new Set(
                WEBFLOW_PARTS.filter((other) => other !== part).map((other) => map[other]),
              );
              const fits = fields.filter(
                (f) =>
                  f.type === WEBFLOW_PART_TYPES[part] &&
                  f.slug !== 'name' &&
                  f.slug !== 'slug' &&
                  !taken.has(f.slug),
              );
              const items = [
                ...(part === 'body' ? [] : [{ value: NOT_SENT, label: t('notSent') }]),
                ...fits.map((f) => ({
                  value: f.slug,
                  label: required.has(f.slug) ? t('fieldRequired', { name: f.name }) : f.name,
                })),
              ];
              const picked = map[part];
              return (
                <Picker
                  key={part}
                  label={t(`parts.${part}`)}
                  items={items}
                  value={
                    picked && items.some((item) => item.value === picked)
                      ? picked
                      : part === 'body'
                        ? null
                        : NOT_SENT
                  }
                  placeholder={t('pickField')}
                  onChange={(value) =>
                    setMap((m) => {
                      const next = { ...m };
                      if (!value || value === NOT_SENT) delete next[part];
                      else next[part] = value;
                      return next;
                    })
                  }
                />
              );
            })
          )}
          {map.jsonLd && <p className="text-xs text-muted-foreground">{t('jsonLdHint')}</p>}
          {map.date && <p className="text-xs text-muted-foreground">{t('dateHint')}</p>}
          {problems.length > 0 && (
            <ul role="alert" className="list-disc space-y-1 pl-5 text-xs text-destructive">
              {problems.map((p) => (
                <li key={p}>{problemText(p)}</li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            className="gap-2"
            onClick={guard(save, { action: tActions('saveCmsSettings') })}
            disabled={saving || !fields || fieldsNow?.failed || !fields.length || !map.body}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A labelled select, one row: the Framer card's too. */
export function Picker({
  label,
  items,
  value,
  placeholder,
  autoFocus,
  onChange,
}: {
  label: string;
  items: { value: string; label: string }[];
  value: string | null;
  placeholder: string;
  /** Focused when it shows (and so scrolled into view). */
  autoFocus?: boolean;
  onChange: (value: string | null) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Select items={items} value={value} onValueChange={(v) => onChange(v ?? null)}>
        <SelectTrigger id={id} autoFocus={autoFocus} className="h-8 w-64 max-w-full text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
