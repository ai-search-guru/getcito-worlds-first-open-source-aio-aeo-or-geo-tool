'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AskAboutThis } from '@/components/chat/panel/AskAboutThis';
import { ArrowRight, ArrowUp } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CompetitorComparisonEntry, ProviderComparisonRow } from '@/lib/actions/tracking';
import { coverage } from '@/lib/insightsKpis';
import { numberFormat } from '@/lib/numberFormat';
import {
  LOW_SAMPLE_ANSWERS,
  leaderboardCallout,
  leaderboardLines,
  mentionShares,
  type LeaderboardItem,
  type PlatformTableRow,
} from '@/lib/insightsSummary';
import { arrowChange, TONE_TEXT } from './kpiFormat';

/**
 * The leaderboard (VIS-004), as in the v2 mockup: ranks 1 and 2, the brands
 * around yours and "Show all"; each brand's score, change, Coverage and share
 * of voice; and under your row, the gap to the brand ahead and the platform
 * where it leads you most.
 */
export function Leaderboard({
  brands,
  providerRows,
  platforms,
  answers,
  className,
}: {
  /** Brands in rank order, yours included. */
  brands: CompetitorComparisonEntry[];
  providerRows: ProviderComparisonRow[];
  /** The By AI platform rows: only a platform with enough answers can be the lever. */
  platforms: PlatformTableRow[] | null;
  /**
   * Your answers in the period, every score's denominator: under 20 the
   * board is a low sample (VIS-005), and no change is read into it.
   */
  answers?: number;
  className?: string;
}) {
  const t = useTranslations('insights.leaderboard');
  const locale = useLocale();
  const f = numberFormat(locale);
  const lowSample = answers !== undefined && answers < LOW_SAMPLE_ANSWERS;
  // Expanded for this board only: another brand or range starts collapsed.
  const [expandedFor, setExpandedFor] = useState<CompetitorComparisonEntry[] | null>(null);
  const expanded = expandedFor === brands;

  const { items, hidden } = leaderboardLines(
    brands.length,
    brands.findIndex((b) => b.isOwnBrand),
  );
  const lines: LeaderboardItem[] = expanded
    ? brands.map((_, index) => ({ kind: 'brand', index }))
    : items;
  const shares = mentionShares(brands);
  const callout = leaderboardCallout(brands, providerRows, (name) =>
    (platforms ?? []).some((p) => p.name === name && p.status === 'ok'),
  );
  const percent = (value: number | null) => (value === null ? '—' : f.percent(value));

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
            <AskAboutThis
              reference={{ type: 'table', id: 'visibility-leaderboard', label: t('title') }}
            />
          </div>
          <Link
            href="/dashboard/competitors"
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('headToHead')}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {lowSample && (
          <p className="text-xs text-muted-foreground">{t('lowSample', { count: answers! })}</p>
        )}
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1.5">
          {lines.map((line, n) => {
            if (line.kind === 'more') {
              return (
                <li key={`more-${n}`}>
                  <button
                    type="button"
                    onClick={() => setExpandedFor(brands)}
                    aria-label={t('moreLabel', { count: line.count })}
                    className="w-full py-0.5 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t('more', { count: f.number(line.count) })}
                  </button>
                </li>
              );
            }

            const entry = brands[line.index];
            const change = lowSample ? null : arrowChange(entry.scoreChange, locale);
            return (
              <li key={`${line.index}-${entry.competitorId ?? entry.name}`}>
                <div
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2',
                    entry.isOwnBrand && 'border-foreground/20 bg-muted',
                  )}
                >
                  <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">
                    {f.number(line.index + 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {entry.competitorId ? (
                        <Link
                          href={`/dashboard/competitors?competitor=${entry.competitorId}`}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {entry.name}
                        </Link>
                      ) : (
                        <span className="truncate text-sm font-medium">{entry.name}</span>
                      )}
                      {entry.isOwnBrand && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {t('you')}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs tabular-nums text-muted-foreground">
                      {t('coverageSov', {
                        coverage: percent(coverage(entry.visiblePrompts, entry.promptCount)),
                        sov: percent(shares[line.index]),
                      })}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className="block text-sm font-semibold tabular-nums"
                      title={t('scoreDetail', {
                        mentions: f.number(entry.mentionAnswers),
                        citations: f.number(entry.citationAnswers),
                        factor:
                          entry.positionFactor === null ? '—' : f.number(entry.positionFactor, 2),
                      })}
                    >
                      {entry.score === null ? '—' : f.number(entry.score)}
                    </span>
                    {change && (
                      <span
                        className={cn(
                          'block text-[11px] font-medium tabular-nums',
                          TONE_TEXT[change.tone],
                        )}
                      >
                        {change.text}
                      </span>
                    )}
                  </span>
                </div>
                {entry.isOwnBrand && callout && (
                  <p className="ml-7 mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-100 px-2 py-0.5 text-[11.5px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
                    <span>
                      {callout.gap === 0
                        ? t('tiedWith', { rank: f.number(callout.rank) })
                        : t('gapTo', { gap: f.number(callout.gap), rank: f.number(callout.rank) })}
                      {callout.lever && ` · ${t('lever', { platform: callout.lever })}`}
                    </span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpandedFor(expanded ? null : brands)}
            className="mt-1.5 w-full py-1 text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? t('showLess') : t('showAll', { count: f.number(brands.length) })}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
