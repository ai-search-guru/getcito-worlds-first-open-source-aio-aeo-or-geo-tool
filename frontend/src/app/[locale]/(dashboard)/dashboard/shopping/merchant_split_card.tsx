'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { numberFormat } from '@/lib/numberFormat';
import { cn } from '@/lib/utils';
import type {
  MerchantSplitPart,
  MerchantSplitSegment,
  ShoppingMerchantSplit,
} from '@/lib/shoppingMerchantSplit';

/**
 * Each destination's colour. The same steps hold in both themes: checked for
 * lightness, colour-blind separation between neighbours and 3:1 contrast on
 * the light and the dark card. Other resellers, the remainder, stay grey.
 */
const SEGMENT_FILL: Record<MerchantSplitSegment, string> = {
  own_store: 'bg-emerald-600',
  amazon: 'bg-violet-600',
  walmart: 'bg-amber-600',
  ebay: 'bg-sky-600',
  other_marketplace: 'bg-rose-600',
  reseller: 'bg-muted-foreground/40',
};

/** "Where AI sends shoppers" (#1277): the destinations of your products' cards. */
export function MerchantSplitCard({
  split,
  loading,
}: {
  split: ShoppingMerchantSplit | null;
  loading: boolean;
}) {
  const t = useTranslations('shopping.merchantSplit');
  const f = numberFormat(useLocale());
  // A segment with cards never reads 0%.
  const percent = (part: MerchantSplitPart) =>
    part.cards > 0 && part.percent === 0 ? t('underOnePercent') : f.percent(part.percent, 0);
  const describe = (part: MerchantSplitPart) =>
    t('partLabel', {
      destination: t(part.segment),
      cards: t('cards', { count: part.cards }),
      percent: percent(part),
    });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-[132px] w-full" />
        ) : !split || split.classifiedCards === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            <div
              role="img"
              aria-label={split.parts
                .filter((part) => part.cards > 0)
                .map(describe)
                .join('; ')}
              className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
            >
              {split.parts
                .filter((part) => part.cards > 0)
                .map((part) => (
                  <span
                    key={part.segment}
                    title={describe(part)}
                    className={cn('h-full min-w-1 basis-0', SEGMENT_FILL[part.segment])}
                    style={{ flexGrow: part.cards }}
                  />
                ))}
            </div>
            <ul className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              {split.parts.map((part) => (
                <li key={part.segment} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={cn('h-2 w-2 shrink-0 rounded-[2px]', SEGMENT_FILL[part.segment])}
                    />
                    <span className="truncate text-foreground">{t(part.segment)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {t('cards', { count: part.cards })}
                    <span className="ml-2 inline-block w-9 text-right font-medium text-foreground">
                      {percent(part)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {!loading && split && split.unclassifiedCards > 0 && (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            {t('unclassified', { count: split.unclassifiedCards })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
