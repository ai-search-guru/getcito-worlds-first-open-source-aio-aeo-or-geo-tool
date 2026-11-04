'use client';

import { useTranslations } from 'next-intl';
import { ArrowDown, Check, ExternalLink, HelpCircle, Minus, ShoppingBag, X } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import type { ShoppingProductDetail } from '@/lib/actions/shopping';
import type { ProductAiSays } from '@/lib/shopping/aiSays';
import { formatNumber } from '@/lib/format';
import { priceText } from '@/lib/shopping/price';
import { readinessPoints } from '@/lib/shopping/products';
import type { ComparisonState } from '@/lib/shopping/productDetail';
import { productPlan } from '@/lib/shopping/actionPlan';
import { cn } from '@/lib/utils';
import { ActionPlan } from './_ActionPlan';
import { ActionResultCard } from './_ActionResult';
import { AiSaysCard } from './_AiSays';

const platformName = (platform: string) => PLATFORM_LABELS[platform] ?? platform;

const STATE_ICON: Record<ComparisonState, React.ReactNode> = {
  match: <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />,
  missing: <X className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />,
  weaker: <ArrowDown className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />,
  info: <Minus className="h-4 w-4 text-muted-foreground" aria-hidden />,
};

/**
 * A product's page (ECOM-011), drawn: its header with its AI visits and
 * orders, "Why not your product?" beside the winner, what AI says about it
 * (ECOM-012), its last done action 7 days on (ECOM-018), where it shows, and
 * its readiness.
 */
export function ProductDetailView({
  detail,
  brandId,
  aiSays,
}: {
  detail: ShoppingProductDetail;
  /** The brand, to send the actions with; none, no actions. */
  brandId?: string;
  /** What AI says, read after the rest: undefined while it's read, null when it couldn't be. */
  aiSays?: ProductAiSays | null;
}) {
  const t = useTranslations('shopping.detail');
  const tReady = useTranslations('shopping.products.readiness');
  const { product, focus } = detail;
  const onShelves = detail.shelves.filter((line) => line.rank !== null).length;
  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex min-w-0 items-start gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted/50">
            {product.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- catalog images from the brand's store
              <img
                src={product.image}
                alt=""
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <ShoppingBag className="h-6 w-6 text-muted-foreground/40" aria-hidden />
            )}
          </div>
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{product.title}</h1>
            <p className="text-sm text-muted-foreground">
              {[
                product.price !== null ? priceText(product.price, product.currency) : null,
                product.category?.split('>').at(-1)?.trim(),
                t('onShelves', { count: onShelves, total: detail.shelves.length }),
                t('readiness', { score: detail.readiness.score }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {product.url && (
            <a
              href={product.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: 'outline' }), 'ml-auto shrink-0 gap-1.5')}
            >
              {t('viewPage')}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
      </HeaderWithAiUsage>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [t('ai.visits'), formatNumber(detail.ai.visits)],
          [t('ai.orders'), formatNumber(detail.ai.orders)],
          [
            t('ai.revenue'),
            detail.ai.orders && detail.ai.revenue !== null
              ? priceText(Math.round(detail.ai.revenue), detail.ai.currency)
              : '—',
          ],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('why.title')}</CardTitle>
          {focus?.winner ? (
            <p className="text-sm text-muted-foreground">
              {t('why.picked', {
                prompt: focus.promptText,
                platform: platformName(focus.platform),
                winner: focus.winner.title,
              })}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {detail.shelves.length ? t('why.leads') : t('why.noQuestions')}
            </p>
          )}
        </CardHeader>
        {focus?.winner && (
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6" />
                  <TableHead>{t('why.you')}</TableHead>
                  <TableHead>{t('why.winner')}</TableHead>
                  <TableHead className="pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.comparison.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="pl-6 font-medium">
                      <span className="flex items-center gap-2">
                        {STATE_ICON[row.state]}
                        {t(`why.rows.${row.key}`)}
                        {/* The icon's state, for a screen reader. */}
                        <span className="sr-only">, {t(`why.states.${row.state}`)}</span>
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.you ??
                        (row.state === 'match' ? '✓' : row.state === 'missing' ? '✕' : '—')}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.winner ?? '—'}
                    </TableCell>
                    <TableCell className="min-w-[140px] whitespace-normal pr-6 text-xs text-muted-foreground">
                      {row.note ? t(`notes.${row.note.key}`, row.note.values) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      <AiSaysCard says={aiSays} />

      {detail.result && <ActionResultCard result={detail.result} />}

      {brandId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('actions.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('actions.lead')}</p>
          </CardHeader>
          <CardContent>
            <ActionPlan
              brandId={brandId}
              target={{ type: 'product', id: product.id }}
              plan={productPlan(detail)}
              promptIds={[...new Set(detail.shelves.map((line) => line.promptId))]}
            />
          </CardContent>
        </Card>
      )}

      {detail.shelves.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('shelves.title')}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">{t('shelves.question')}</TableHead>
                  <TableHead>{t('shelves.place')}</TableHead>
                  <TableHead className="text-right">{t('shelves.match')}</TableHead>
                  <TableHead className="pr-6">{t('shelves.missing')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.shelves.map((line) => (
                  <TableRow key={`${line.promptId}:${line.platform}`}>
                    <TableCell className="max-w-[320px] pl-6">
                      <p className="truncate text-sm" title={line.promptText}>
                        {line.promptText}
                      </p>
                      <p className="text-xs text-muted-foreground">{platformName(line.platform)}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {line.rank === null ? (
                        <span className="text-amber-700 dark:text-amber-400">
                          {t('shelves.absent')}
                        </span>
                      ) : (
                        `#${line.rank}`
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{line.score}</TableCell>
                    <TableCell className="max-w-[220px] whitespace-normal pr-6 text-xs text-muted-foreground">
                      <span className="line-clamp-2">
                        {line.missing.slice(0, 6).join(', ') || '—'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {tReady('label', { score: detail.readiness.score })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {detail.readiness.missing.length ? (
            detail.readiness.missing.map((check) => (
              <p key={check} className="flex items-center gap-2">
                <X className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
                {tReady('missing', {
                  check: tReady(`checks.${check}`),
                  points: readinessPoints(check, detail.readiness.unknown),
                })}
              </p>
            ))
          ) : (
            <p className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {tReady('complete')}
            </p>
          )}
          {detail.readiness.unknown.map((check) => (
            <p key={check} className="flex items-center gap-2 text-muted-foreground">
              <HelpCircle className="h-4 w-4 shrink-0" aria-hidden />
              {tReady('unknown', { check: tReady(`checks.${check}`) })}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
