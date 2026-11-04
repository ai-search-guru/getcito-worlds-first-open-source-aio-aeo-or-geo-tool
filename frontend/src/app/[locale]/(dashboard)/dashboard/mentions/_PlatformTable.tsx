'use client';

import { useLocale, useTranslations } from 'next-intl';
import { AskAboutThis } from '@/components/chat/panel/AskAboutThis';
import { AIProviderAvatar, resolveAIProvider } from '@/components/AiProviderAvatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { numberFormat } from '@/lib/numberFormat';
import {
  mentionPlatformLabel,
  platformDisagreement,
  platformNetChange,
  wholeNet,
} from '@/lib/mentionsHeadline';
import {
  isLowSample,
  mentionRate,
  sentimentSplit,
  type MentionPlatformRow,
} from '@/lib/mentionsOverview';
import { arrowChange, signedValue, TONE_TEXT } from '../insights/kpiFormat';
import { SentimentSplitBar } from './_SentimentSplit';

/**
 * "By AI platform" (MS-06), as in the mockup: per platform, Mentions, Mention
 * rate, the sentiment split and Net sentiment with its change. A platform
 * with negative net sentiment is tinted, and a note says when platforms
 * disagree. Fewer than 20 mentions is a "Low sample": no change, no tint.
 */
export function PlatformTable({
  rows,
  className,
}: {
  rows: MentionPlatformRow[];
  className?: string;
}) {
  const t = useTranslations('mentions.overview.platforms');
  const locale = useLocale();
  const f = numberFormat(locale);
  // Platforms answered only in the window before have nothing to show now.
  const shown = rows.filter((r) => r.answers > 0);
  const disagreement = platformDisagreement(shown);

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center gap-1 pb-2">
        <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
        <AskAboutThis
          reference={{ type: 'table', id: 'mentions-by-platform', label: t('title') }}
        />
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm" aria-label={t('tableLabel')}>
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 text-left font-medium">{t('platform')}</th>
              <th className="w-20 px-2 py-2 text-right font-medium">{t('mentions')}</th>
              <th className="w-16 px-2 py-2 text-right font-medium">{t('rate')}</th>
              <th className="w-[30%] px-2 py-2 text-left font-medium">{t('sentiment')}</th>
              <th className="w-24 py-2 pl-2 text-right font-medium">{t('net')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const rate = mentionRate(row);
              const split = sentimentSplit(row);
              const net = wholeNet(row);
              const low = isLowSample(row);
              const change = arrowChange(platformNetChange(row), locale);
              const negative = !low && net !== null && net < 0;
              return (
                <tr
                  key={row.platform}
                  className={cn(
                    'border-b last:border-b-0',
                    negative && 'bg-red-50 dark:bg-red-950/30',
                  )}
                >
                  <td className="py-2.5 pr-3 font-medium">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <AIProviderAvatar
                        provider={resolveAIProvider(row.platform, row.platform)}
                        className="h-5 w-5"
                      />
                      {mentionPlatformLabel(row.platform)}
                    </span>
                    {negative && <span className="sr-only"> ({t('negativeNet')})</span>}
                  </td>
                  {/* Every time it names the brand, as Total mentions counts them. */}
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {f.number(row.occurrences)}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {rate === null ? '—' : f.percent(rate, 0)}
                  </td>
                  <td className="px-2 py-2.5">
                    {split ? (
                      <SentimentSplitBar split={split} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pl-2 text-right tabular-nums">
                    {net === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="inline-flex flex-col items-end leading-tight">
                        <span
                          className={cn(
                            'font-semibold',
                            low
                              ? 'text-muted-foreground'
                              : TONE_TEXT[net > 0 ? 'good' : net < 0 ? 'bad' : 'neutral'],
                          )}
                        >
                          {signedValue(net, locale)}
                          {change && (
                            <span
                              className={cn('ml-1 text-[11px] font-medium', TONE_TEXT[change.tone])}
                            >
                              {change.text}
                            </span>
                          )}
                        </span>
                        {low && (
                          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                            {t('lowSample')}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {disagreement && (
          <p className="mt-3 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t('disagree', {
              high: mentionPlatformLabel(disagreement.high.platform),
              highNet: signedValue(disagreement.high.net, locale),
              low: mentionPlatformLabel(disagreement.low.platform),
              lowNet: signedValue(disagreement.low.net, locale),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
