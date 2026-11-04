'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShoppingBag } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ShoppingProducts } from '@/lib/actions/shopping';
import {
  PRODUCT_VIEWS,
  readinessPoints,
  viewCounts,
  viewRows,
  type ProductRow,
  type ProductView,
} from '@/lib/shopping/products';
import { priceText } from '@/lib/shopping/price';

/** Rows shown before "Show more". */
const ROWS_SHOWN = 50;

function readinessTone(score: number): string {
  if (score >= 80)
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (score >= 50) return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400';
}

function Readiness({ row }: { row: ProductRow }) {
  const t = useTranslations('shopping.products.readiness');
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        closeDelay={0}
        render={
          <button
            type="button"
            className={cn(
              'inline-flex h-6 min-w-9 items-center justify-center rounded-md border px-1.5 text-xs font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              readinessTone(row.readiness),
            )}
            aria-label={t('label', { score: row.readiness })}
          />
        }
      >
        {row.readiness}
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-1">
        <p className="font-medium">{t('label', { score: row.readiness })}</p>
        {row.missing.length ? (
          row.missing.map((check) => (
            <p key={check} className="opacity-90">
              {t('missing', {
                check: t(`checks.${check}`),
                points: readinessPoints(check, row.unknown),
              })}
            </p>
          ))
        ) : (
          <p className="opacity-90">{t('complete')}</p>
        )}
        {row.unknown?.map((check) => (
          <p key={check} className="opacity-90">
            {t('unknown', { check: t(`checks.${check}`) })}
          </p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function ProductCell({ row }: { row: ProductRow }) {
  const { product } = row;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/50">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- catalog images from the brand's store
          <img
            src={product.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <ShoppingBag className="h-4 w-4 text-muted-foreground/40" aria-hidden />
        )}
      </div>
      <div className="min-w-0">
        <Link
          href={`/dashboard/shopping/products/${product.id}`}
          className="block truncate text-sm font-medium hover:underline"
          title={product.title}
        >
          {product.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {[
            product.category?.split('>').at(-1)?.trim(),
            product.price !== null ? priceText(product.price, product.currency) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </div>
  );
}

/**
 * The Products table (ECOM-007): the brand's catalog, each product with the
 * shelves it was on, its win rate (#1 or #2) and average place, the AI
 * visits its page got, the orders they led to and their revenue, and its
 * readiness. Views: never shown, shown but not clicked, clicked but not
 * bought, and the top sellers from AI.
 */
export function ProductsTable({
  products,
  loading,
}: {
  products: ShoppingProducts | null;
  loading: boolean;
}) {
  const t = useTranslations('shopping.products');
  const [view, setView] = useState<ProductView>('all');
  const [shown, setShown] = useState(ROWS_SHOWN);

  if (loading || !products) {
    return <Skeleton className="h-[320px] w-full" />;
  }
  const rows = viewRows(products.rows, view);
  const counts = viewCounts(products.rows, products.total);

  return (
    <section className="space-y-3" aria-label={t('label')}>
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label={t('viewsLabel')}
      >
        {PRODUCT_VIEWS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => {
              setView(id);
              setShown(ROWS_SHOWN);
            }}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              view === id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(`views.${id}`)}
            <span className="tabular-nums opacity-70">{formatNumber(counts[id])}</span>
          </button>
        ))}
      </div>
      {products.total > products.rows.length && (
        <p className="text-xs text-muted-foreground">
          {t('capped', {
            shown: formatNumber(products.rows.length),
            total: formatNumber(products.total),
          })}
        </p>
      )}
      <Card className="py-0">
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {t(`empty.${view}`)}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t('columns.product')}</TableHead>
                <TableHead className="text-right">{t('columns.shelves')}</TableHead>
                <TableHead className="text-right">{t('columns.winRate')}</TableHead>
                <TableHead className="text-right">{t('columns.avgRank')}</TableHead>
                <TableHead className="text-right">{t('columns.aiVisits')}</TableHead>
                <TableHead className="text-right">{t('columns.orders')}</TableHead>
                <TableHead className="text-right">{t('columns.revenue')}</TableHead>
                <TableHead className="pr-4 text-right">{t('columns.readiness')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, shown).map((row) => (
                <TableRow key={row.product.id}>
                  <TableCell className="max-w-[180px] pl-4 xl:max-w-[360px]">
                    <ProductCell row={row} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(row.shelves)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.winRate === null ? '—' : `${Math.round(row.winRate * 100)}%`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.avgRank === null ? '—' : row.avgRank.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(row.aiVisits)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(row.orders)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.orders && row.revenue !== null
                      ? priceText(Math.round(row.revenue), row.currency)
                      : '—'}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Readiness row={row} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {rows.length > shown && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + ROWS_SHOWN)}>
            {t('more', { count: rows.length - shown })}
          </Button>
        </div>
      )}
    </section>
  );
}
