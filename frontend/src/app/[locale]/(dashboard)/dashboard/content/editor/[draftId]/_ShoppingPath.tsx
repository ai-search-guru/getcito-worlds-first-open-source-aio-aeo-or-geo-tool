'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Lock, LockOpen, Plus, RefreshCw, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingDots } from '@/components/ui/loading-dots';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import {
  buildDraftShoppingPath,
  getDraftShoppingPath,
  saveDraftShoppingPath,
  searchCatalogProducts,
  type CatalogProductHit,
} from '@/lib/actions/shoppingPath';
import {
  choicesOf,
  leftOutReason,
  placementOf,
  priceText,
  withAdded,
  withLocked,
  withRemoved,
  type NoPathReason,
  type ShoppingPath,
} from '@/lib/content/shoppingPath';
import { pagePath } from '@/lib/content/overlap';

// Where the product dialog and the tests read it.
export { priceText };

type PathState =
  | { status: 'loading' }
  | { status: 'failed' }
  | {
      status: 'ready';
      path: ShoppingPath | null;
      none: NoPathReason | null;
      /** A path is kept, but not one this tab reads: built anew, as none would be. */
      unreadable?: boolean;
    };

/** Why a draft has no path that a new pick may change: the topic, or a reason not known here. */
const PICK_AGAIN: readonly (NoPathReason | null)[] = [null, 'no_match', 'other'];

/**
 * Brief › Shopping path (shopping path, part 3): on an online shop, the
 * category page and the catalog products this page links, picked by the
 * API for its topic (in stock, accepted by Merchant Center), with where each
 * goes. The person locks, swaps, removes or adds a product; Pick again
 * builds it anew, their choices kept. Shown for a page type that takes one
 * on an e-commerce brand. `onPathChange` follows each change saved or
 * built, and one found made meanwhile: the Shopping rules read it again.
 * On a read-only workspace (plan not active) the path shows, and each
 * change or new pick opens the upgrade dialog instead.
 */
export function ShoppingPathSection({
  draftId,
  brandId,
  pageType,
  onPathChange,
}: {
  draftId: string;
  brandId: string;
  pageType: string | null;
  onPathChange?: () => void;
}) {
  const t = useTranslations('contentEditor.editor.shopping');
  const [state, setState] = useState<PathState>({ status: 'loading' });
  const [busy, setBusy] = useState<'build' | 'save' | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  // The catalog's products for what's typed; 'failed' when the search failed.
  const [hits, setHits] = useState<CatalogProductHit[] | 'failed' | null>(null);
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const needsPlan = { action: tActions('changeShoppingPath') };

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const read = await getDraftShoppingPath(draftId);
      setState(
        read
          ? { status: 'ready', path: read.path, none: null, unreadable: read.unreadable }
          : { status: 'failed' },
      );
    } catch (err) {
      console.error('Failed to read the shopping path:', err);
      setState({ status: 'failed' });
    }
  }, [draftId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Add product: the catalog's products whose name holds what's typed.
  useEffect(() => {
    if (!adding || query.trim().length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCatalogProducts(brandId, query).then(
        (found) => {
          if (!cancelled) setHits(found);
        },
        (err) => {
          console.error('Failed to search the catalog:', err);
          if (!cancelled) setHits('failed');
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [adding, query, brandId]);

  /**
   * The person's choices in `next`, saved over `from`, the path they were
   * made on: the path as saved, or null when it changed meanwhile.
   */
  const persist = async (from: ShoppingPath, next: ShoppingPath) => {
    const saved = await saveDraftShoppingPath(
      draftId,
      { builtAt: from.builtAt, savedAt: from.savedAt ?? null },
      choicesOf(next),
    );
    // Saved, or changed meanwhile: the path kept isn't the one read either way.
    onPathChange?.();
    if ('error' in saved) {
      // A build or another change since it was read: shown as it is now, not overwritten.
      toast.error(t('changed'));
      void load();
      return null;
    }
    return saved.path;
  };

  /**
   * Builds the path again from the catalog, after `change` (made on `from`)
   * is saved when there's one. The saved change is shown whether the build
   * then works or not.
   */
  const build = guard(async (change?: { from: ShoppingPath; next: ShoppingPath }) => {
    setBusy('build');
    try {
      if (change) {
        const saved = await persist(change.from, change.next);
        if (!saved) return;
        setState({ status: 'ready', path: saved, none: null });
      }
      const result = await buildDraftShoppingPath(draftId, brandId);
      if (!('error' in result)) {
        setState({ status: 'ready', path: result.path, none: result.path ? null : result.reason });
        onPathChange?.();
      } else if (result.error === 'changed') {
        toast.error(t('changed'));
        void load();
        onPathChange?.();
      } else {
        toast.error(t(result.error === 'rate_limited' ? 'rateLimited' : 'buildFailed'));
      }
    } catch (err) {
      console.error('Failed to build the shopping path:', err);
      toast.error(t('saveFailed'));
    } finally {
      setBusy(null);
    }
  }, needsPlan);

  /** Saves a change made here (a lock, a removal), shown at once; put back when it fails. */
  const save = guard(async (from: ShoppingPath, next: ShoppingPath) => {
    const before = state;
    setState({ status: 'ready', path: next, none: null });
    setBusy('save');
    try {
      const saved = await persist(from, next);
      if (saved) setState({ status: 'ready', path: saved, none: null });
    } catch (err) {
      console.error('Failed to save the shopping path:', err);
      toast.error(t('saveFailed'));
      setState(before);
    } finally {
      setBusy(null);
    }
  }, needsPlan);

  const header = (path: ShoppingPath | null) => (
    <div className="flex items-center gap-2">
      <ShoppingBag className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <span className="flex-1" />
      {path && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={busy !== null}
          onClick={() => void build()}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {busy === 'build' ? t('building') : t('rebuild')}
        </Button>
      )}
    </div>
  );

  if (state.status === 'loading') {
    return (
      <div className="flex justify-center py-4" aria-busy="true">
        <LoadingDots className="text-muted-foreground" />
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {t('loadError')}
        <button type="button" className="font-medium underline" onClick={() => void load()}>
          {t('retry')}
        </button>
      </p>
    );
  }

  const { path, none, unreadable } = state;
  if (!path) {
    return (
      <section className="space-y-2 rounded-lg border p-3" aria-label={t('title')}>
        {header(null)}
        <p className="text-xs text-muted-foreground">
          {none ? t(`noPath.${none}`) : unreadable ? t('unreadable') : t('empty')}
        </p>
        {PICK_AGAIN.includes(none) && (
          <Button size="sm" disabled={busy !== null} onClick={() => void build()}>
            {busy === 'build' ? t('building') : t('build')}
          </Button>
        )}
      </section>
    );
  }

  const locked = new Set(path.locked);
  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label={t('title')}>
      {header(path)}
      <p className="text-xs text-muted-foreground">{t('description')}</p>

      <div className="space-y-1 rounded-md border p-2.5">
        <p className="text-xs text-muted-foreground">{t('category')}</p>
        {path.categories.length ? (
          path.categories.map((category, index) => (
            // Two categories may share a page: the place keeps them apart.
            <div key={`${index}:${category.name}`} className="space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">{category.name}</span>
                {category.url && (
                  <a
                    href={category.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 text-xs text-muted-foreground underline underline-offset-4 [overflow-wrap:anywhere]"
                  >
                    {pagePath(category.url)}
                  </a>
                )}
              </div>
              <p className="text-xs">{t('categoryPlace')}</p>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{t('noCategory')}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t('products', { count: path.products.length })}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          aria-expanded={adding}
          disabled={busy !== null}
          onClick={guard(() => {
            setAdding(!adding);
            setQuery('');
          }, needsPlan)}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('add')}
        </Button>
      </div>

      {adding && (
        <div className="space-y-1.5">
          <Input
            type="search"
            value={query}
            maxLength={100}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {hits === 'failed' && (
            <p className="text-xs text-muted-foreground" role="alert">
              {t('searchFailed')}
            </p>
          )}
          {Array.isArray(hits) && hits.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('searchEmpty')}</p>
          )}
          {Array.isArray(hits) && hits.length > 0 && (
            <ul className="divide-y rounded-md border">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="w-full px-2.5 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                    disabled={busy !== null}
                    aria-label={t('addThis', { title: hit.title })}
                    onClick={() => {
                      setAdding(false);
                      setQuery('');
                      void build({ from: path, next: withAdded(path, hit.id) });
                    }}
                  >
                    {hit.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {path.products.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('noProducts')}</p>
      ) : (
        <ul className="space-y-2">
          {path.products.map((product, index) => {
            // The page type as it is now: it may have changed since the path was built.
            const place = placementOf(pageType ?? path.pageType, index);
            const isLocked = locked.has(product.id);
            const price = priceText(product);
            return (
              <li key={product.id} className="flex items-start gap-2.5 rounded-md border p-2.5">
                {product.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a store's own image, any host
                  <img
                    src={product.image}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-md border object-cover"
                  />
                ) : (
                  <div className="h-11 w-11 shrink-0 rounded-md bg-muted" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {product.url ? (
                      <a
                        href={product.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium hover:underline"
                      >
                        {product.title}
                      </a>
                    ) : (
                      <span className="text-sm font-medium">{product.title}</span>
                    )}
                    {price && <span className="text-xs text-muted-foreground">{price}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span
                      className={
                        product.availability === 'limited_availability'
                          ? 'rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400'
                          : 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400'
                      }
                    >
                      {product.availability === 'limited_availability'
                        ? t('stock.limited_availability')
                        : t('stock.in_stock')}
                    </span>
                    {product.issues.length > 0 && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                        {t('issues', {
                          count: product.issues.length,
                          first: product.issues[0].attribute ?? product.issues[0].code,
                        })}
                      </span>
                    )}
                    {isLocked && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {t('locked')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(`place.${place.key}`, { n: place.n })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    // One name, its state pressed or not; the tooltip says what a click does.
                    aria-label={t('lock', { title: product.title })}
                    aria-pressed={isLocked}
                    title={
                      isLocked
                        ? t('unlock', { title: product.title })
                        : t('lock', { title: product.title })
                    }
                    disabled={busy !== null}
                    onClick={() => void save(path, withLocked(path, product.id, !isLocked))}
                  >
                    {isLocked ? (
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    aria-label={t('swapLabel', { title: product.title })}
                    disabled={busy !== null}
                    onClick={() => void build({ from: path, next: withRemoved(path, product.id) })}
                  >
                    {t('swap')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    aria-label={t('removeLabel', { title: product.title })}
                    disabled={busy !== null}
                    onClick={() => void save(path, withRemoved(path, product.id))}
                  >
                    {t('remove')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {path.leftOut.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('leftOut')}</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {path.leftOut.map((item, index) => (
              <li key={`${index}:${item.id}`}>
                {item.title ?? t('untitled')} · {t(`reason.${leftOutReason(item.reason)}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('lockHint')}</p>
    </section>
  );
}
