'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Tags } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import {
  listCategoryPages,
  resetCategoryPage,
  setCategoryPage,
  type CategoryPage,
  type CategoryPageError,
} from '@/lib/catalogClient';
import { useBrandStore } from '@/state/useBrandStore';

/** A page's address as the table shows it: its path, or the whole address off the root. */
export function shortAddress(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return pathname === '/' && !search ? url : `${pathname}${search}`;
  } catch {
    return url;
  }
}

/**
 * Category pages (shopping path, 00350): each catalog category of the
 * active brand and its page on the site, matched by the API or set by a
 * person, so a buying guide or a comparison links to it. Shown once the
 * brand's catalog has categories, and under its heading when they can't be
 * read. Admins and managers change a page, set none, or put it back to the
 * match; members see the table. On a read-only workspace (plan not active)
 * the table shows, and changing a page opens the upgrade dialog instead.
 *
 * `refreshKey`: changed by the page to read the categories again (the
 * catalog's sources read again: a feed added or synced, a file uploaded).
 */
export function CatalogCategoryPages({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useTranslations('settings.catalog.categories');
  const { activeBrandId } = useBrandStore();
  const { canManage } = useUserRole();
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const needsPlan = { action: tActions('changeCategoryPages') };

  // The categories as read for a brand: another brand's never show.
  const [loaded, setLoaded] = useState<{
    brandId: string;
    categories: CategoryPage[] | null;
  } | null>(null);
  const [reads, setReads] = useState(0);
  // The category being changed, on the brand it was opened for, and what's typed for it.
  const [editing, setEditing] = useState<{ brandId: string; name: string } | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    void listCategoryPages(activeBrandId).then((result) => {
      if (cancelled) return;
      setLoaded({ brandId: activeBrandId, categories: result.ok ? result.value : null });
    });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, reads, refreshKey]);

  const current = loaded?.brandId === activeBrandId ? loaded : null;
  if (!activeBrandId) return null;
  if (current === null) return <Skeleton className="h-24 w-full" />;
  // No catalog categories yet: nothing to match.
  if (current.categories?.length === 0) return null;
  // Another brand's row is never open here.
  const open = editing?.brandId === activeBrandId ? editing.name : null;

  const done = async (
    result: { ok: true } | { ok: false; code: CategoryPageError },
  ): Promise<void> => {
    setBusy(false);
    // The plan ended while the page was open: the server's refusal opens the upgrade dialog.
    if (!result.ok && result.code === 'subscription') {
      openUpgrade(needsPlan.action);
      return;
    }
    if (!result.ok) {
      toast.error(t(`errors.${result.code}`));
      return;
    }
    toast.success(t('saved'));
    setEditing(null);
    setReads((n) => n + 1);
  };
  const save = guard(async (category: string, value: string | null) => {
    setBusy(true);
    await done(await setCategoryPage(activeBrandId, category, value));
  }, needsPlan);
  const reset = guard(async (category: string) => {
    setBusy(true);
    await done(await resetCategoryPage(activeBrandId, category));
  }, needsPlan);

  return (
    <section aria-labelledby="catalog-category-pages" className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Tags className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p id="catalog-category-pages" className="font-medium">
            {t('title')}
          </p>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </div>
      {current.categories === null ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : (
        <div className="relative overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('category')}</th>
                <th className="px-3 py-2 font-medium">{t('productsHeading')}</th>
                <th className="px-3 py-2 font-medium">{t('pageHeading')}</th>
                {canManage && (
                  <th className="px-3 py-2 font-medium">
                    <span className="sr-only">{t('actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {current.categories.map((category) => (
                <tr key={category.name} className="border-t align-top">
                  <td className="px-3 py-2 font-medium">{category.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t('products', { products: category.products, inStock: category.inStock })}
                  </td>
                  <td
                    className="px-3 py-2"
                    colSpan={canManage && open === category.name ? 2 : undefined}
                  >
                    {open === category.name ? (
                      <form
                        className="flex flex-col gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void save(category.name, url.trim());
                        }}
                      >
                        <Input
                          type="url"
                          inputMode="url"
                          value={url}
                          maxLength={2048}
                          placeholder={t('urlPlaceholder')}
                          aria-label={t('urlLabel', { category: category.name })}
                          onChange={(e) => setUrl(e.target.value)}
                          autoFocus
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button type="submit" size="sm" disabled={busy || !url.trim()}>
                            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                            {t('save')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void save(category.name, null)}
                          >
                            {t('setNone')}
                          </Button>
                          {category.how === 'manual' ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void reset(category.name)}
                            >
                              {t('useMatch')}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setEditing(null)}
                          >
                            {t('cancel')}
                          </Button>
                        </div>
                      </form>
                    ) : category.page ? (
                      <a
                        href={category.page.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4 [overflow-wrap:anywhere]"
                        title={category.page.title ?? undefined}
                      >
                        {shortAddress(category.page.url)}
                      </a>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      >
                        {t('noPage')}
                      </Badge>
                    )}
                    {open !== category.name && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t(`how.${category.how ?? 'none'}`)}
                      </p>
                    )}
                  </td>
                  {canManage && open !== category.name && (
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={t('changeLabel', { category: category.name })}
                        onClick={guard(() => {
                          setEditing({ brandId: activeBrandId, name: category.name });
                          setUrl(category.page?.url ?? '');
                        }, needsPlan)}
                      >
                        {t('change')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
