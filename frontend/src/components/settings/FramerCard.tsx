'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, LayoutTemplate, Loader2, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useUpgradeGate } from '@/components/context/upgradeGate';
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
import { useUserRole } from '@/hooks/useUserRole';
import {
  FRAMER_NEEDED,
  FRAMER_PARTS,
  FRAMER_PART_TYPES,
  connectFramer,
  disconnectFramer,
  fittingFramerMap,
  missingFramerParts,
  readFramer,
  readFramerCollections,
  saveFramerTarget,
  suggestFramerMap,
  unfillableFramerFields,
  unmappedFramerFields,
  type FramerCollection,
  type FramerConnection,
  type FramerError,
  type FramerFieldMap,
} from '@/lib/framerClient';
import { useBrandStore } from '@/state/useBrandStore';
import { Picker } from './WebflowCard';

/** A part the map leaves out. */
const NOT_SENT = '__none__';
/** Answers that mean the connection changed: it's read again. */
const STALE: readonly FramerError[] = ['auth_failed', 'changed', 'not_connected'];

/**
 * Send to CMS → Framer (#1331, phase 2; 00295): the active brand's Framer
 * project. Admins and managers connect it with an API key made in the
 * project, pick the collection pages go to and which of its fields takes
 * each part of a page, replace the key and disconnect; members see where
 * pages go. Framer can't revoke a key through its API: the person deletes
 * it in the project.
 */
export function FramerCard() {
  const t = useTranslations('settings.framer');
  const { activeBrandId, brands } = useBrandStore();
  const { canManage } = useUserRole();
  // A read-only workspace's refusal opens the upgrade dialog, not a toast;
  // while it is read-only, Replace key opens it at once. Disconnect stays
  // open: it ends an access, it starts nothing.
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;

  // The connection as read for a brand: another brand's never shows.
  const [read, setRead] = useState<{
    brandId: string;
    configured: boolean;
    connection: FramerConnection | null;
    failed: boolean;
  } | null>(null);
  // Replacing the key, for the brand it was asked for.
  const [replacingFor, setReplacingFor] = useState<string | null>(null);
  const replacing = replacingFor !== null && replacingFor === activeBrandId;
  const [disconnecting, setDisconnecting] = useState(false);
  // Connected just now without a collection, for the brand: its picker takes the focus.
  const [settingUpFor, setSettingUpFor] = useState<string | null>(null);
  // Bumped to read the connection again: a key refused or replaced meanwhile.
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    readFramer(activeBrandId).then((result) => {
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
  }, [activeBrandId, reads]);

  const current = read?.brandId === activeBrandId ? read : null;
  const connection = current?.connection ?? null;
  const setConnection = (next: FramerConnection | null) =>
    setRead((r) => (r && r.brandId === activeBrandId ? { ...r, connection: next } : r));
  // The project, the published site and the user the key acts as, as far as Framer told them.
  const details = connection
    ? [
        t('project', { project: connection.projectName ?? connection.projectId }),
        connection.siteUrl ? t('published', { url: connection.siteUrl }) : null,
        connection.account ? t('account', { account: connection.account }) : null,
      ].filter(Boolean)
    : [];

  const disconnect = async () => {
    if (!activeBrandId) return;
    setDisconnecting(true);
    const result = await disconnectFramer(activeBrandId);
    setDisconnecting(false);
    if (!result.ok) {
      if (result.code === 'subscription') openUpgrade();
      else toast.error(t(`errors.${result.code}`));
      return;
    }
    setConnection(null);
    setReplacingFor(null);
    // Not revoked: the key still works until it's deleted in Framer.
    if (result.revoked) toast.success(t('disconnected'));
    else toast.warning(t('disconnectedNotRevoked'));
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <LayoutTemplate className="h-5 w-5 text-muted-foreground" />
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
            {/* Connected, but nothing goes to Framer until a collection is saved. */}
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
          {details.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {details.join(' · ')}
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
                  {t('replace')}
                </Button>
              )}
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
          <KeyForm
            brandId={activeBrandId}
            // Connecting again, to the project as it was: a new key for it keeps where pages go.
            initial={connection}
            onCancel={replacing ? () => setReplacingFor(null) : undefined}
            onConnected={(next) => {
              setReplacingFor(null);
              setSettingUpFor(next.collectionId ? null : activeBrandId);
              setConnection(next);
            }}
          />
        </div>
      ) : (
        <FramerMapping
          // Another project's collections are read again, never kept from the last one.
          key={`${activeBrandId}:${connection.projectId}`}
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

/** The project and an API key made in it: the key goes to the API once, never shown again. */
function KeyForm({
  brandId,
  initial,
  onConnected,
  onCancel,
}: {
  brandId: string;
  initial: FramerConnection | null;
  onConnected: (connection: FramerConnection) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('settings.framer');
  // Read-only (plan not active): Connect opens the upgrade dialog before anything is sent.
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // The API takes the project's id as well as its address.
  const [project, setProject] = useState(initial?.projectId ?? '');
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const id = (field: string) => `framer-${field}-${brandId}`;
  const key = apiKey.trim();
  // The API takes a key of 8 characters or more: a shorter one is a paste cut short.
  const short = key !== '' && key.length < 8;
  const ready = project.trim() !== '' && key !== '' && !short;

  const connect = async () => {
    setConnecting(true);
    const result = await connectFramer(brandId, { project: project.trim(), apiKey: key });
    setConnecting(false);
    if (!result.ok) {
      if (result.code === 'subscription') openUpgrade();
      else
        toast.error(
          t(result.code === 'invalid' ? 'errors.invalidConnect' : `errors.${result.code}`),
        );
      return;
    }
    setApiKey('');
    // A new key for the same project keeps its collection; else the setup's last step is left.
    toast.success(t(result.connection.collectionId ? 'connectedToast' : 'connectedSetupToast'));
    onConnected(result.connection);
  };
  const connectProject = guard(() => void connect(), { action: tActions('connectCms') });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !connecting) connectProject();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={id('project')}>{t('projectLabel')}</Label>
        <Input
          id={id('project')}
          aria-describedby={id('hint')}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={project}
          onChange={(e) => setProject(e.target.value)}
          placeholder={t('projectPlaceholder')}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('key')}>{t('keyLabel')}</Label>
        <Input
          id={id('key')}
          // The hint, and why Connect is off while the key is too short.
          aria-describedby={short ? `${id('hint')} ${id('short')}` : id('hint')}
          aria-invalid={short || undefined}
          type="password"
          // Not a sign-in to GetCito: no saved password is offered here.
          autoComplete="new-password"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t('keyPlaceholder')}
        />
      </div>
      <p id={id('hint')} className="text-xs text-muted-foreground">
        {t('keyHint')}
      </p>
      {short && (
        <p id={id('short')} className="text-xs text-amber-700 dark:text-amber-400">
          {t('keyShort')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" className="h-9 gap-2" disabled={!ready || connecting}>
          {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {connecting ? t('connecting') : t('connect')}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9"
            disabled={connecting}
            onClick={onCancel}
          >
            {t('cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

/** The collection pages go to, and which of its fields takes each part of a page. */
function FramerMapping({
  brandId,
  connection,
  focusCollection,
  onSaved,
  onStale,
}: {
  brandId: string;
  connection: FramerConnection;
  /** Just connected: the collection picker, the setup's last step, takes the focus. */
  focusCollection: boolean;
  onSaved: (connection: FramerConnection) => void;
  /** The connection changed (a key refused, replaced or removed): read it again. */
  onStale: () => void;
}) {
  const t = useTranslations('settings.framer');
  const format = useFormatter();
  // Read-only (plan not active): Save opens the upgrade dialog before anything is sent.
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // The saved settings, for the collections read: a save doesn't read them again.
  const saved = useRef(connection);
  useEffect(() => {
    saved.current = connection;
  }, [connection]);
  const stale = useRef(onStale);
  useEffect(() => {
    stale.current = onStale;
  }, [onStale]);
  /** Says what went wrong, and reads the connection again when it changed. */
  const report = (code: FramerError) => {
    if (code === 'subscription') {
      openUpgrade();
      return;
    }
    toast.error(t(`errors.${code}`));
    if (STALE.includes(code)) stale.current();
  };
  const [listed, setListed] = useState<{
    collections: FramerCollection[];
    failed: boolean;
  } | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(connection.collectionId);
  const [map, setMap] = useState<FramerFieldMap>(connection.fieldMap);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // The project's collections, each with its fields.
  useEffect(() => {
    let cancelled = false;
    readFramerCollections(brandId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        report(result.code);
        setListed({ collections: [], failed: true });
        return;
      }
      setListed({ collections: result.collections, failed: false });
      // Only what the pickers can show: a saved part whose field was deleted
      // or changed type in Framer since is left out, so what's saved is what's shown.
      const savedOne = result.collections.find((c) => c.id === saved.current.collectionId);
      if (savedOne) setMap(fittingFramerMap(saved.current.fieldMap, savedOne.fields));
    });
    return () => {
      cancelled = true;
    };
    // report reads the latest onStale through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, t]);

  const collections = listed?.collections ?? [];
  const collection = collections.find((c) => c.id === collectionId) ?? null;
  const fields = collection?.fields ?? [];
  const required = new Set(fields.filter((f) => f.required).map((f) => f.id));
  // Required fields no map fills (an image, a date…), and ones this map leaves to no part.
  const unfillable = collection ? unfillableFramerFields(collection) : [];
  const unmapped = unmappedFramerFields(map, fields);
  // A part every page has that the collection has no field for (no formatted text, say).
  const missing = collection ? missingFramerParts(collection) : [];
  const names = (list: { name: string }[]) => format.list(list.map((f) => f.name));
  const fits =
    !!collection &&
    FRAMER_NEEDED.every((part) => map[part]) &&
    !unfillable.length &&
    !missing.length;

  const save = async () => {
    if (!collection) return;
    setSaving(true);
    setProblems([]);
    const result = await saveFramerTarget(brandId, { collectionId: collection.id, fieldMap: map });
    setSaving(false);
    if (!result.ok) {
      setProblems(result.problems ?? []);
      report(result.code);
      return;
    }
    toast.success(t('saved', { collection: result.connection.collectionName ?? collection.name }));
    onSaved(result.connection);
  };

  /** The API names a part by its key ("metaTitle: …"): the person reads its label. */
  const problemText = (problem: string) => {
    const part = FRAMER_PARTS.find((p) => problem.startsWith(`${p}: `));
    return part ? `${t(`parts.${part}`)}: ${problem.slice(part.length + 2)}` : problem;
  };
  // A collection pages can't go to is marked before it's picked.
  const collectionItems = collections.map((c) => ({
    value: c.id,
    label: unfillableFramerFields(c).length
      ? t('collectionBlocked', { name: c.name })
      : missingFramerParts(c).length
        ? t('collectionIncomplete', { name: c.name })
        : c.name,
  }));

  return (
    <div className="space-y-4">
      {connection.collectionId ? (
        <p className="text-sm text-muted-foreground">
          {t('pagesGoTo', { collection: connection.collectionName ?? connection.collectionId })}
        </p>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('setupStep')}</span>
        </div>
      )}
      {listed === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('loadingCollections')}
        </p>
      ) : listed.failed ? (
        <p className="text-sm text-muted-foreground">{t('collectionsUnavailable')}</p>
      ) : collections.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noCollections')}</p>
      ) : (
        <Picker
          label={t('collectionLabel')}
          items={collectionItems}
          value={collection ? collection.id : null}
          placeholder={t('collectionPlaceholder')}
          autoFocus={focusCollection}
          onChange={(value) => {
            const next = collections.find((c) => c.id === value);
            if (!next || next.id === collectionId) return;
            setCollectionId(next.id);
            // The saved collection gets its saved map back; another, its own suggested one.
            setMap(
              next.id === saved.current.collectionId
                ? fittingFramerMap(saved.current.fieldMap, next.fields)
                : suggestFramerMap(next),
            );
            setProblems([]);
          }}
        />
      )}
      {listed && !listed.failed && collectionId && !collection && (
        <p className="text-sm text-muted-foreground">
          {t('collectionGone', { collection: connection.collectionName ?? collectionId })}
        </p>
      )}

      {collection && (
        <div className="space-y-3 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">{t('fieldsTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('fieldsHint')}</p>
          </div>
          {unfillable.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t('blocked', {
                  collection: collection.name,
                  fields: names(unfillable),
                  count: unfillable.length,
                })}
              </span>
            </div>
          )}
          {missing.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {missing
                  .map((part) => t(`missing.${part}`, { collection: collection.name }))
                  .join(' ')}
              </span>
            </div>
          )}
          {FRAMER_PARTS.map((part) => {
            const needed = FRAMER_NEEDED.includes(part);
            // A field of the part's type that no other part takes.
            const taken = new Set(
              FRAMER_PARTS.filter((other) => other !== part).map((other) => map[other]),
            );
            const choices = fields.filter(
              (f) => f.type === FRAMER_PART_TYPES[part] && !taken.has(f.id),
            );
            const items = [
              ...(needed ? [] : [{ value: NOT_SENT, label: t('notSent') }]),
              ...choices.map((f) => ({
                value: f.id,
                label: required.has(f.id) ? t('fieldRequired', { name: f.name }) : f.name,
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
                    : needed
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
          })}
          {unmapped.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('unmapped', {
                collection: collection.name,
                fields: names(unmapped),
                count: unmapped.length,
              })}
            </p>
          )}
          {map.jsonLd && <p className="text-xs text-muted-foreground">{t('jsonLdHint')}</p>}
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
            disabled={saving || !fits || unmapped.length > 0}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      )}
    </div>
  );
}
