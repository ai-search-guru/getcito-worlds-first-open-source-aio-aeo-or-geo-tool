'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight, Minus, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { resultTrend, type ActionResult } from '@/lib/shopping/recheck';
import { cn } from '@/lib/utils';

/**
 * What a done Products action did, 7 days on (ECOM-018): on the product's
 * page a card, in the Categories table a line under the category's name.
 */

const actionHref = (result: ActionResult) =>
  `/dashboard/action-center/actions?action=${result.actionId}`;

const TREND = {
  better: {
    icon: TrendingUp,
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400',
  },
  worse: {
    icon: TrendingDown,
    tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400',
  },
  same: { icon: Minus, tone: 'bg-muted text-muted-foreground' },
  // No shelf read the week before: nothing to compare yet.
  new: { icon: Sparkles, tone: 'border-primary/30 bg-primary/10 text-primary' },
} as const;

export function ActionResultCard({ result }: { result: ActionResult }) {
  const t = useTranslations('shopping.recheck');
  const trend = resultTrend(result);
  const done = formatDate(result.completedAt);
  const Trend = trend ? TREND[trend].icon : null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{t('title', { number: result.actionNo })}</CardTitle>
          {trend && Trend && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
                TREND[trend].tone,
              )}
            >
              <Trend className="h-3.5 w-3.5" aria-hidden />
              {t(`trend.${trend}`)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {result.after === null
            ? t('pending', { done, ready: formatDate(result.readyAt) })
            : result.partial
              ? t('tooMany', { done })
              : result.after.shelves === 0
                ? t('noRuns', { done })
                : trend === 'new'
                  ? t('resultNew', { after: result.after.on, afterShelves: result.after.shelves })
                  : t('result', {
                      after: result.after.on,
                      afterShelves: result.after.shelves,
                      before: result.before.on,
                      beforeShelves: result.before.shelves,
                    })}
        </p>
        <Link
          href={actionHref(result)}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0 gap-1.5')}
        >
          {t('open')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

/** None when the category has no done action. */
export function ActionResultLine({ result }: { result: ActionResult | undefined }) {
  const t = useTranslations('shopping.recheck');
  if (!result) return null;
  const trend = resultTrend(result);
  return (
    <Link
      href={actionHref(result)}
      className={cn(
        'block truncate text-xs hover:underline',
        trend === 'better'
          ? 'text-emerald-700 dark:text-emerald-400'
          : trend === 'worse'
            ? 'text-amber-700 dark:text-amber-400'
            : 'text-muted-foreground',
      )}
    >
      {result.after === null
        ? t('shortPending', { number: result.actionNo, ready: formatDate(result.readyAt) })
        : result.partial
          ? t('shortTooMany', { number: result.actionNo })
          : result.after.shelves === 0
            ? t('shortNoRuns', { number: result.actionNo })
            : trend === 'new'
              ? t('shortNew', {
                  number: result.actionNo,
                  after: result.after.on,
                  afterShelves: result.after.shelves,
                })
              : t('short', {
                  number: result.actionNo,
                  before: result.before.on,
                  beforeShelves: result.before.shelves,
                  after: result.after.on,
                  afterShelves: result.after.shelves,
                })}
    </Link>
  );
}
