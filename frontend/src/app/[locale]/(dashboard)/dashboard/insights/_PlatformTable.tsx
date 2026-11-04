'use client';

import { useLocale, useTranslations } from 'next-intl';
import { AskAboutThis } from '@/components/chat/panel/AskAboutThis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { numberFormat } from '@/lib/numberFormat';
import type { PlatformTableRow } from '@/lib/insightsSummary';
import { TONE_TEXT, upIsGood } from './kpiFormat';

/**
 * "By AI platform" (VIS-008), as in the v2 mockup: per platform, Visibility,
 * its change, Coverage, Share of voice and Avg. position. A platform without
 * enough answers shows why instead of numbers; the row with the biggest drop
 * is tinted. Replaces the Share of Voice donut and trend charts.
 */
export function PlatformTable({
  rows,
  className,
}: {
  rows: PlatformTableRow[];
  className?: string;
}) {
  const t = useTranslations('insights.platforms');
  const locale = useLocale();
  const f = numberFormat(locale);
  // Share-of-voice bars are scaled to the largest share in the table.
  const maxSov = Math.max(0, ...rows.map((r) => r.shareOfVoice ?? 0));

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center gap-1 pb-2">
        <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
        <AskAboutThis
          reference={{ type: 'table', id: 'visibility-by-platform', label: t('title') }}
        />
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm" aria-label={t('tableLabel')}>
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 text-left font-medium">{t('platform')}</th>
              <th className="w-20 px-2 py-2 text-right font-medium">{t('visibility')}</th>
              <th className="w-16 px-2 py-2 text-right font-medium">{t('change')}</th>
              <th className="w-20 px-2 py-2 text-right font-medium">{t('coverage')}</th>
              <th className="w-[34%] px-2 py-2 text-left font-medium">{t('shareOfVoice')}</th>
              <th className="w-16 py-2 pl-2 text-right font-medium">{t('avgPosition')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const change = upIsGood(row.change, { locale });
              return (
                <tr
                  key={row.name}
                  className={cn(
                    'border-b last:border-b-0',
                    row.worst && 'bg-red-50 dark:bg-red-950/30',
                  )}
                >
                  <td className="py-2.5 pr-3 font-medium">
                    {row.name}
                    {row.worst && <span className="sr-only"> ({t('biggestDrop')})</span>}
                  </td>
                  {row.status === 'ok' ? (
                    <>
                      <td className="px-2 py-2.5 text-right font-semibold tabular-nums">
                        {row.visibility === null ? '—' : f.number(row.visibility)}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-2.5 text-right font-medium tabular-nums',
                          change && TONE_TEXT[change.tone],
                        )}
                      >
                        {change?.text ?? '—'}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {row.coverage === null ? '—' : f.percent(row.coverage)}
                      </td>
                      <td className="px-2 py-2.5">
                        {row.shareOfVoice === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full bg-foreground/60"
                                style={{
                                  width: `${maxSov > 0 ? (row.shareOfVoice / maxSov) * 100 : 0}%`,
                                }}
                              />
                            </span>
                            <span className="min-w-10 text-right tabular-nums">
                              {f.percent(row.shareOfVoice)}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pl-2 text-right tabular-nums">
                        {row.avgPosition === null ? '—' : `#${f.number(row.avgPosition)}`}
                      </td>
                    </>
                  ) : (
                    <td colSpan={5} className="px-2 py-2.5">
                      <span className="inline-flex rounded-full bg-muted px-2 py-px text-[11.5px] text-muted-foreground">
                        {row.status === 'noRuns'
                          ? t('noRuns')
                          : t('lowSample', { count: row.runs })}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
