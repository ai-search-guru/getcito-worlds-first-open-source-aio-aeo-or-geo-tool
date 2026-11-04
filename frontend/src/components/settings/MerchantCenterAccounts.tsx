'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { MERCHANT_CENTER_KIND } from '@/lib/catalog';
import {
  connectSignInAccount,
  listSignInAccounts,
  type SignInAccount,
  type StoreError,
} from '@/lib/catalogClient';
import { useBrandStore } from '@/state/useBrandStore';
import type { CatalogSourcesRead } from './CatalogSourcesCard';

/**
 * The errors Merchant Center says in its own words; the rest are the stores'.
 * `not_configured` is also what the API answers when Composio or Google
 * refuses this server's setup (its `not_set_up`, lib/catalog/stores.js).
 */
export const OWN_ERRORS: readonly StoreError[] = [
  'not_connected',
  'connect_failed',
  'unreachable',
  'duplicate',
  'not_configured',
  'failed',
];

/** An account as the picker names it: its name and id, or its id. */
export function accountLabel(account: SignInAccount): string {
  return account.name ? `${account.name} (${account.id})` : account.id;
}

/**
 * Google Merchant Center, once the workspace has connected it (#1270): the
 * active brand picks one of the accounts its Google sign-in opens, and that
 * account's products are read into the brand's catalog every day, with the
 * issues Merchant Center reports for them. The account then shows in
 * Product catalog, where it is synced or removed. Admins and managers only.
 * On a read-only workspace (plan not active) the accounts show, and picking
 * or adding one opens the upgrade dialog instead.
 *
 * `sources`: the catalog's sources as its card read them; the accounts the
 * brand has already are marked in the picker and can't be picked again.
 */
export function MerchantCenterAccounts({
  onConnected,
  sources,
}: {
  onConnected?: () => void;
  sources?: CatalogSourcesRead | null;
}) {
  const t = useTranslations('settings.merchantCenter');
  const tStores = useTranslations('settings.catalog.stores');
  const { activeBrandId, brands } = useBrandStore();
  const { canManage } = useUserRole();
  const { guard, isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const needsPlan = { action: tActions('connectStores') };
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;

  // The accounts as read for a brand: another brand's never show.
  const [loaded, setLoaded] = useState<{
    brandId: string;
    accounts: SignInAccount[] | null;
    error: StoreError | null;
  } | null>(null);
  // Bumped to read the accounts again (Try again).
  const [reads, setReads] = useState(0);
  // The account picked, with the brand it was picked for: another brand never adds it.
  const [picked, setPicked] = useState<{ brandId: string; id: string } | null>(null);
  // The brand an account is being added to. The ref holds a second click
  // before the button shows it's busy.
  const [adding, setAdding] = useState<string | null>(null);
  const addingRef = useRef(false);

  useEffect(() => {
    if (!activeBrandId || !canManage) return;
    let cancelled = false;
    void listSignInAccounts(activeBrandId, MERCHANT_CENTER_KIND).then((result) => {
      if (cancelled) return;
      setLoaded(
        result.ok
          ? { brandId: activeBrandId, accounts: result.accounts, error: null }
          : { brandId: activeBrandId, accounts: null, error: result.code },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, canManage, reads]);

  /** A failure in Merchant Center's own words where it has them, else the stores'. */
  const errorText = (code: StoreError) =>
    OWN_ERRORS.includes(code) ? t(`errors.${code}`) : tStores(`errors.${code}`);

  const current = loaded?.brandId === activeBrandId ? loaded : null;
  const accounts = current?.accounts ?? null;
  const added = new Set(
    sources?.brandId === activeBrandId
      ? (sources.sources ?? [])
          .filter((source) => source.kind === MERCHANT_CENTER_KIND && source.account)
          .map((source) => source.account!)
      : [],
  );
  const pickedId = picked?.brandId === activeBrandId ? picked.id : null;
  const chosen = accounts?.find((a) => a.id === pickedId && !added.has(a.id)) ?? null;

  const retry = () => {
    setLoaded(null);
    setReads((n) => n + 1);
  };

  const add = async () => {
    // A read-only workspace: the upgrade dialog, not the add.
    if (isLocked) {
      openUpgrade(needsPlan.action);
      return;
    }
    if (!activeBrandId || !brand || !chosen || addingRef.current) return;
    // The brand and account as clicked: switching brands meanwhile changes neither.
    const brandId = activeBrandId;
    const brandName = brand.name;
    const account = chosen;
    addingRef.current = true;
    setAdding(brandId);
    const result = await connectSignInAccount(brandId, MERCHANT_CENTER_KIND, account.id);
    addingRef.current = false;
    setAdding(null);
    // The plan ended while the page was open: the server's refusal opens the upgrade dialog.
    if (!result.ok && result.code === 'subscription') {
      openUpgrade(needsPlan.action);
      return;
    }
    if (!result.ok) {
      toast.error(result.code === 'failed' ? t('addFailed') : errorText(result.code));
      return;
    }
    toast.success(t('connected', { account: accountLabel(account), brand: brandName }));
    setPicked((p) => (p?.brandId === brandId ? null : p));
    onConnected?.();
  };

  if (!brand) return <p className="text-xs text-muted-foreground">{t('noBrand')}</p>;
  if (!canManage)
    return (
      <p className="text-xs text-muted-foreground">{t('managersOnly', { brand: brand.name })}</p>
    );

  const items = (accounts ?? []).map((account) => ({
    value: account.id,
    label: added.has(account.id)
      ? t('alreadyAdded', { account: accountLabel(account) })
      : accountLabel(account),
    disabled: added.has(account.id),
  }));
  // Worth reading again once someone has fixed it: the list failed, or the sign-in opens no account yet.
  const canRetry = current !== null && (current.error !== null || items.length === 0);

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">{t('title', { brand: brand.name })}</p>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      {current === null ? (
        <Skeleton className="h-8 w-full sm:w-80" />
      ) : current.error ? (
        <p className="text-xs text-destructive">{errorText(current.error)}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('none')}</p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            items={items}
            value={chosen?.id ?? null}
            onValueChange={guard(
              (v: string | null) => setPicked(v ? { brandId: brand.id, id: v } : null),
              needsPlan,
            )}
          >
            <SelectTrigger className="h-8 w-full text-xs sm:w-80" aria-label={t('pick')}>
              <SelectValue placeholder={t('pick')} />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="gap-2" disabled={!chosen || adding !== null} onClick={add}>
            {adding === brand.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {t('add')}
          </Button>
        </div>
      )}
      {/* An advanced account is listed with its sub-accounts, and its products are theirs. */}
      {!current?.error && items.length > 1 && (
        <p className="text-xs text-muted-foreground">{t('advanced')}</p>
      )}
      {canRetry && (
        <Button size="sm" variant="outline" className="gap-2" onClick={retry}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
