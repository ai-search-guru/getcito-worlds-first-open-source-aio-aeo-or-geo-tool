'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getProductMatchScores,
  type ProductPromptMatch,
  type ShoppingFilters,
  type ShoppingProduct,
} from '@/lib/actions/shopping';

/** Prompts compared at once, the most recent first (the action's own cap). */
const MAX_PROMPTS = 20;
/** Missing words shown per prompt. */
const MAX_MISSING = 8;

/**
 * Match with each prompt (#1282, part 1): in an own product's drawer, its
 * keyword match with each prompt it was shown for, the product shown first,
 * and the prompt's words its title lacks. Labelled as our estimate.
 */
export function ProductMatchScores({
  brandId,
  filters,
  product,
}: {
  brandId: string;
  filters: ShoppingFilters;
  product: ShoppingProduct;
}) {
  const t = useTranslations('shopping.matchScore');
  const promptIds = useMemo(
    () =>
      [...new Set(product.appearances.map((a) => a.prompt_id).filter(Boolean))].slice(
        0,
        MAX_PROMPTS,
      ),
    [product],
  );
  const key = `${brandId}|${product.product_title}|${promptIds.join(',')}|${JSON.stringify(filters)}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    matches: ProductPromptMatch[] | null;
  } | null>(null);

  useEffect(() => {
    if (!promptIds.length) return;
    let cancelled = false;
    getProductMatchScores(brandId, product.product_title, promptIds, filters).then(
      (matches) => !cancelled && setLoaded({ key, matches }),
      () => !cancelled && setLoaded({ key, matches: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, brandId, product.product_title, promptIds, filters]);

  const current = loaded?.key === key ? loaded : null;

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{t('title')}</h3>
        <Badge variant="outline" className="text-[10px]">
          {t('estimate')}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{t('description')}</p>
      {!promptIds.length ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : !current ? (
        <Skeleton className="h-24 w-full" />
      ) : !current.matches ? (
        <p className="text-xs text-muted-foreground">{t('unavailable')}</p>
      ) : !current.matches.length ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y">
          {current.matches.map((match) => (
            <li key={match.promptId} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
              <p className="line-clamp-2 text-xs font-medium text-foreground">
                &quot;{match.promptText}&quot;
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
                <span>
                  {t('yours')} <span className="font-semibold text-foreground">{match.score}</span>
                </span>
                {match.top &&
                  (match.top.isThis ? (
                    <span>{t('shownFirstThis')}</span>
                  ) : (
                    <span title={match.top.title}>
                      {t('shownFirst')}{' '}
                      <span className="font-semibold text-foreground">{match.top.score}</span>
                    </span>
                  ))}
              </div>
              {match.missing.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-muted-foreground">{t('missing')}</span>
                  {match.missing.slice(0, MAX_MISSING).map((word) => (
                    <Badge key={word} variant="secondary" className="text-[10px]">
                      {word}
                    </Badge>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
