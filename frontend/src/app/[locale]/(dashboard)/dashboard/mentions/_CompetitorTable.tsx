'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { numberFormat } from '@/lib/numberFormat';
import { mentionRate, type MentionsOverview } from '@/lib/mentionsOverview';
import { InfoTip } from '../insights/_KpiCards';

/**
 * "Competitor framing" (MS-06): your brand, then each competitor with its
 * mentions, its rate over the same responses, and how many of its mentions
 * name you too. Mentions only: sentiment is measured toward your brand alone,
 * and the KPI cards above show yours, so a sentiment column read "—" for
 * every competitor. The strength and weakness columns come with the themes.
 */
export function CompetitorTable({
  overview,
  brand,
  className,
}: {
  overview: Pick<MentionsOverview, 'current' | 'competitors'>;
  brand: string;
  className?: string;
}) {
  const t = useTranslations('mentions.overview.competitors');
  const locale = useLocale();
  const f = numberFormat(locale);
  const { current: cur } = overview;
  const ownRate = mentionRate(cur);
  const rateOf = (mentions: number) => (cur.answers > 0 ? (mentions * 100) / cur.answers : null);
  const competitors = [...overview.competitors].sort((a, b) => b.mentions - a.mentions);
  const pct = (n: number | null) => (n === null ? '—' : f.percent(n, 1));

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm" aria-label={t('tableLabel')}>
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 text-left font-medium">{t('brand')}</th>
              <th className="w-24 px-2 py-2 text-right font-medium">{t('mentions')}</th>
              <th className="w-20 px-2 py-2 text-right font-medium">{t('rate')}</th>
              <th className="w-44 py-2 pl-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  {t('alsoNamesYou')}
                  <InfoTip content={t('alsoNamesYouTip', { brand })} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b bg-muted/40 last:border-b-0">
              <td className="py-2.5 pr-3 font-semibold">
                <span className="inline-flex items-center gap-2">
                  {brand}
                  <span className="rounded-md bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">
                    {t('you')}
                  </span>
                </span>
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums">{f.number(cur.mentions)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{pct(ownRate)}</td>
              {/* A question about competitors: left empty for you, not "—". */}
              <td className="py-2.5 pl-2" />
            </tr>
            {competitors.map((c) => (
              <tr key={c.competitorId} className="border-b last:border-b-0">
                <td className="py-2.5 pr-3">{c.name}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{f.number(c.mentions)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{pct(rateOf(c.mentions))}</td>
                <td className="py-2.5 pl-2 text-right tabular-nums">
                  {f.number(c.coMentions)}
                  {c.mentions > 0 && (
                    <span className="text-muted-foreground">
                      {' · '}
                      {f.percent((c.coMentions * 100) / c.mentions, 0)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {competitors.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">{t('none')}</p>
        )}
      </CardContent>
    </Card>
  );
}
