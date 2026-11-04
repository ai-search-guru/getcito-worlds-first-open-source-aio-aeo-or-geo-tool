'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { numberFormat } from '@/lib/numberFormat';
import {
  attributeShares,
  changeOf,
  shareOf,
  type MentionsPerception,
  type PerceptionGap,
} from '@/lib/mentionsPerception';
import { TONE_TEXT, upIsGood } from '../insights/kpiFormat';

/** A count's change against the window before, as "+12%"; neutral in tone, since more isn't better here. */
function Change({ now, before }: { now: number; before: number }) {
  const locale = useLocale();
  const raw = changeOf(now, before);
  const change = upIsGood(raw === null ? null : Math.round(raw), { percent: true, locale });
  if (!change) return <span className="text-muted-foreground">—</span>;
  return <span className={TONE_TEXT.neutral}>{change.text}</span>;
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
      <span
        className="block h-full rounded-full bg-foreground/60"
        style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }}
      />
    </span>
  );
}

/**
 * "What AI associates with you" (MS-09): the brand's top terms, each with
 * the responses it comes in, its share of the responses naming the brand and its change
 * against the window before.
 */
export function TermsCard({
  perception,
  brand,
  className,
}: {
  perception: MentionsPerception;
  brand: string;
  className?: string;
}) {
  const t = useTranslations('mentions.perception.terms');
  const f = numberFormat(useLocale());
  const mentions = perception.entities.find((e) => e.isBrand)?.mentions ?? 0;
  const max = Math.max(0, ...perception.brandTerms.map((term) => term.answers));

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('title', { brand })}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('note')}</p>
      </CardHeader>
      <CardContent>
        {perception.brandTerms.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <table className="w-full text-sm" aria-label={t('tableLabel')}>
            <tbody>
              {perception.brandTerms.map((term) => {
                const share = shareOf(term.answers, mentions);
                return (
                  <tr key={term.term} className="border-b last:border-b-0">
                    <td className="py-1.5 pr-3 font-medium">{term.term}</td>
                    <td className="w-[40%] px-2 py-1.5">
                      <Bar value={term.answers} max={max} />
                    </td>
                    <td
                      className="w-24 px-2 py-1.5 text-right text-xs text-muted-foreground tabular-nums"
                      title={
                        share === null
                          ? undefined
                          : t('share', { share: f.percent(share, 0), brand })
                      }
                    >
                      {t('responses', { count: term.answers })}
                    </td>
                    <td className="w-14 py-1.5 pl-2 text-right text-xs tabular-nums">
                      <Change now={term.answers} before={term.previousAnswers} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Brand × attribute" (MS-09): each attribute's share of each brand's
 * mentions, the brand and up to four competitors, the cell shaded by share.
 */
export function HeatmapCard({
  perception,
  className,
}: {
  perception: MentionsPerception;
  className?: string;
}) {
  const t = useTranslations('mentions.perception.heatmap');
  const f = numberFormat(useLocale());
  const rows = attributeShares(perception);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('note')}</p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <table className="w-full min-w-[420px] text-sm" aria-label={t('tableLabel')}>
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium">{t('attribute')}</th>
                {perception.entities.map((e) => (
                  <th key={e.entity} className="px-2 py-2 text-center font-medium">
                    <span className="line-clamp-2 normal-case tracking-normal">
                      {e.isBrand ? t('you') : e.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.term} className="border-b last:border-b-0">
                  <td className="py-1.5 pr-3 font-medium">{row.term}</td>
                  {row.shares.map((share, i) => (
                    <td
                      key={perception.entities[i].entity}
                      className="px-2 py-1.5 text-center text-xs tabular-nums"
                      // The share as a neutral tint (the brand has no colour on this
                      // page, only ink), readable on both themes.
                      style={
                        share
                          ? {
                              backgroundColor: `rgba(120, 113, 108, ${Math.min(0.45, share / 150)})`,
                            }
                          : undefined
                      }
                    >
                      {share === null ? '—' : f.percent(share, 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Frequently mentioned with" (MS-09): the competitors AI names in the same
 * responses as the brand, and the change against the window before (is the
 * AI's consideration set around you changing?).
 */
export function CoMentionsCard({
  perception,
  className,
}: {
  perception: MentionsPerception;
  className?: string;
}) {
  const t = useTranslations('mentions.perception.coMentions');
  const shown = perception.coMentions.filter((c) => c.coMentions > 0);
  const max = Math.max(0, ...shown.map((c) => c.coMentions));

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <table className="w-full text-sm" aria-label={t('tableLabel')}>
            <tbody>
              {shown.map((c) => (
                <tr key={c.competitorId} className="border-b last:border-b-0">
                  <td className="py-1.5 pr-3 font-medium">{c.name}</td>
                  <td className="w-[45%] px-2 py-1.5">
                    <Bar value={c.coMentions} max={max} />
                  </td>
                  <td className="w-24 px-2 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                    {t('responses', { count: c.coMentions })}
                  </td>
                  <td className="w-14 py-1.5 pl-2 text-right text-xs tabular-nums">
                    <Change now={c.coMentions} before={c.previousCoMentions} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted-foreground">{t('note')}</p>
      </CardContent>
    </Card>
  );
}

/** The biggest gap (spec §9): where a competitor is associated and you are not. */
export function GapNote({ gap, brand }: { gap: PerceptionGap; brand: string }) {
  const t = useTranslations('mentions.perception.gap');
  const f = numberFormat(useLocale());
  const values = {
    term: gap.term,
    competitor: gap.competitor,
    competitorShare: f.percent(gap.competitorShare, 0),
    brand,
  };
  return (
    <p
      className={cn(
        'rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900',
        'dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200',
      )}
    >
      <b className="font-semibold">{t('title')}: </b>
      {gap.brandRank === null
        ? t('unplaced', values)
        : t('ranked', {
            ...values,
            brandShare: f.percent(gap.brandShare, 0),
            rank: gap.brandRank,
          })}
    </p>
  );
}
