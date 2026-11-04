'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, HelpCircle, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AIProviderAvatar, resolveAIProvider } from '@/components/AiProviderAvatar';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import { CATALOG_SETTINGS_PATH } from '@/lib/content/feedMatch';
import type { ShoppingMarket } from '@/lib/shopping/markets';
import {
  READINESS_CHANNELS,
  channelState,
  copyValues,
  type CheckState,
  type ReadinessItem,
} from '@/lib/shopping/readiness';
import { cn } from '@/lib/utils';

const STATE_ICON: Record<CheckState, ReactNode> = {
  pass: <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />,
  fail: <X className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />,
  unknown: <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden />,
};

const CHANNEL_TONE = {
  showing: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  notShowing: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  notTracked: 'bg-muted text-muted-foreground',
} as const;

/** What the checklist reads that may fail: the catalog sources, and the catalog's products. */
export type ReadinessRead = 'sources' | 'products';

/**
 * Readiness (ECOM-015): the market the shop sells in and what it means for
 * ChatGPT, each AI shopping channel with whether it shows the brand's
 * products, and the checklist scored 0–100, each check with its fix's
 * starting point. `children` comes after: OpenAI's product index, in the US.
 *
 * The checklist waits for what it reads (`loading`). What couldn't be read
 * (`unread`) is said, and the score isn't shown: without those checks it
 * would be another score, not this one. The channel cards read every
 * channel's shelves, whatever channel the page shows (`channelsRead` while
 * they're read, or when they couldn't be).
 */
export function ReadinessTab({
  market,
  tracked,
  ownSlots,
  channelsRead,
  score,
  items,
  loading = false,
  unread = [],
  onProducts,
  children,
}: {
  market: ShoppingMarket;
  /** The channels with shopping answers read. */
  tracked: readonly string[];
  /** The brand's product slots per channel, on every channel's shelves. */
  ownSlots: ReadonlyMap<string, number>;
  /** Those shelves still being read, or not read: `ownSlots` says nothing then. */
  channelsRead?: 'loading' | 'failed';
  score: number | null;
  items: ReadinessItem[];
  /** The catalog sources or products still being read. */
  loading?: boolean;
  /** What couldn't be read. */
  unread?: readonly ReadinessRead[];
  /** Opens the Products tab. */
  onProducts: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations('shopping.readiness');
  return (
    <div className="space-y-6">
      <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        {t(`market.${market}`)}
      </p>

      <section
        aria-label={t('channelsLabel')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        {READINESS_CHANNELS.map((platform) => {
          const state = channelState(platform, tracked, ownSlots);
          return (
            <Card key={platform}>
              <CardContent className="min-w-0 space-y-2 p-3">
                {/* A narrow card wraps a long name rather than letting it run out. */}
                <p className="flex min-w-0 items-start gap-2 text-sm font-medium leading-snug">
                  <AIProviderAvatar
                    provider={resolveAIProvider(platform, platform)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                    plain
                  />
                  <span className="min-w-0 break-words">
                    {PLATFORM_LABELS[platform] ?? platform}
                  </span>
                </p>
                {channelsRead === 'loading' ? (
                  <Skeleton className="h-5 w-24 rounded-full" />
                ) : (
                  <span
                    className={cn(
                      'inline-flex max-w-full rounded-full px-2 py-0.5 text-xs font-medium',
                      channelsRead === 'failed' ? CHANNEL_TONE.notTracked : CHANNEL_TONE[state],
                    )}
                  >
                    {t(`channels.${channelsRead === 'failed' ? 'unread' : state}`)}
                  </span>
                )}
                <p className="text-xs text-muted-foreground">
                  {t(`sources.${platform === 'chatgpt-shopping' ? `chatgpt_${market}` : platform}`)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
            {t('title')}
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              score !== null &&
              !unread.length && (
                <span className="text-2xl font-bold tabular-nums">
                  {score}
                  <span className="text-sm font-normal text-muted-foreground"> / 100</span>
                </span>
              )
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('lead')}</p>
        </CardHeader>
        <CardContent className="px-0">
          {!loading &&
            unread.map((read) => (
              <p
                key={read}
                role="status"
                className="mx-6 mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
                  aria-hidden
                />
                {t(`unread.${read}`)}
              </p>
            ))}
          {loading ? (
            <div className="space-y-2 border-t px-6 py-3" aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y border-t">
              {items.map((item) => {
                const values = copyValues(item);
                return (
                  <li key={item.key} className="flex items-start gap-3 px-6 py-3">
                    <span className="mt-0.5 shrink-0">{STATE_ICON[item.state]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{t(`checks.${item.key}.title`, values)}</p>
                      <p className="text-xs text-muted-foreground">
                        {t(`checks.${item.key}.${item.state}`, values)}
                      </p>
                    </div>
                    {item.action === 'products' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 text-xs"
                        onClick={onProducts}
                      >
                        {t('view')}
                      </Button>
                    ) : item.action === 'settings' ? (
                      <Link
                        href={CATALOG_SETTINGS_PATH}
                        className="inline-flex h-7 shrink-0 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted"
                      >
                        {t('connect')}
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      {children}
    </div>
  );
}
