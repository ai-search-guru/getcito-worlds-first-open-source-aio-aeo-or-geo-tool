'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink, Quote } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import { getSiteIconUrl } from '@/lib/siteIcon';
import { formatDate } from '@/lib/format';
import type { ProductAiSays } from '@/lib/shopping/aiSays';

/**
 * "What AI says" on a product's page (ECOM-012, V1): quotes from the answers
 * that showed it, and the sources they cited. `says`: undefined while it's
 * read, null when it couldn't be.
 */
export function AiSaysCard({ says }: { says: ProductAiSays | null | undefined }) {
  const t = useTranslations('shopping.detail.says');
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('title')}</CardTitle>
        {says && says.answers > 0 && (
          <p className="text-sm text-muted-foreground">{t('lead', { count: says.answers })}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {says === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : says === null ? (
          <p className="text-sm text-muted-foreground">{t('failed')}</p>
        ) : says.answers === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <>
            {says.quotes.length ? (
              <ul className="space-y-3">
                {says.quotes.map((quote) => (
                  <li key={quote.text} className="flex gap-2.5">
                    <Quote
                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60"
                      aria-hidden
                    />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm">{quote.text}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[
                          PLATFORM_LABELS[quote.platform] ?? quote.platform,
                          quote.promptText ? t('asked', { prompt: quote.promptText }) : null,
                          formatDate(quote.at),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('unnamed')}</p>
            )}
            {says.sources.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t('sources')}</p>
                <ul className="space-y-1">
                  {says.sources.map((source) => (
                    <li key={source.url} className="flex min-w-0 items-center gap-2 text-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a source's favicon */}
                      <img
                        src={getSiteIconUrl(source.domain, 32)}
                        alt=""
                        className="h-3.5 w-3.5 shrink-0 rounded-sm"
                        loading="lazy"
                      />
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-w-0 items-center gap-1 hover:underline"
                      >
                        <span className="truncate">{source.title || source.domain}</span>
                        <ExternalLink
                          className="h-3 w-3 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </a>
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                        {t('cited', { count: source.answers })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
