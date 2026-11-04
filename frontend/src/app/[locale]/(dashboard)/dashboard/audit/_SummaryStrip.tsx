'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { CATEGORY_META, pct } from '@/components/audit/AuditReport';
import type { AuditOverview, AuditQuota, SiteCoverage } from '@/lib/actions/audits';
import { nextAutoRun } from '@/lib/auditAutoRuns';
import { formatMonthDay } from '@/lib/format';
import { cn } from '@/lib/utils';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `now` to `iso`, in the viewer's time zone. */
export function daysUntil(iso: string, now: Date): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(new Date(iso)) - day(now)) / DAY_MS);
}

/**
 * The summary strip on top of Site Audit (spec §4.4, Insights style): "68
 * site score +4 · 48 pages audited · Lowest: E-E-A-T 36 · Next auto-audit
 * tomorrow · 25 pages", the primary domain on the right.
 */
export function AuditSummaryStrip({
  overview,
  quota,
  now,
  coverage = null,
}: {
  overview: AuditOverview | null;
  quota: AuditQuota | null;
  now: Date;
  /** The site's coverage (customer priorities item 11): "18 of 36 pages audited". */
  coverage?: SiteCoverage | null;
}) {
  const t = useTranslations('audit.strip');
  if (!overview) return null;

  const b = (chunks: React.ReactNode) => <b className="font-semibold">{chunks}</b>;
  const items: React.ReactNode[] = [];
  const score = pct(overview.siteScore);
  if (score !== null) {
    const change = overview.siteScoreChange;
    items.push(
      <>
        {t.rich('siteScore', { b, score })}
        {change !== null && change !== 0 && (
          <span
            className={cn(
              'tabular-nums',
              change > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
            )}
          >
            {change > 0 ? `+${change}` : change}
          </span>
        )}
      </>,
    );
  }
  items.push(
    coverage && coverage.pages > 0
      ? t('pagesOf', { audited: coverage.audited, count: coverage.pages })
      : overview.pages > 0
        ? t('pages', { count: overview.pages })
        : t('noPages'),
  );
  if (overview.lowestCategory) {
    const label =
      CATEGORY_META.find((c) => c.key === overview.lowestCategory?.key)?.label ??
      overview.lowestCategory.key;
    items.push(
      t.rich('lowest', { b, category: label, score: pct(overview.lowestCategory.score) ?? 0 }),
    );
  }
  const auto = quota?.auto;
  if (auto?.enabled) {
    // This month's next run, else next month's first; within a day when its
    // turn has started without it (the next daily sweep takes it).
    const next = nextAutoRun(auto, now);
    const days = daysUntil(next.at, now);
    const when = next.soon
      ? t('withinADay')
      : days <= 0
        ? t('today')
        : days === 1
          ? t('tomorrow')
          : t('onDate', { date: formatMonthDay(next.at) });
    items.push(t.rich('nextAuto', { b, when, count: auto.perRun }));
  } else if (auto && !auto.enabled) {
    items.push(t('autoOff'));
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-xl border bg-card px-4 py-3 text-sm">
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-muted-foreground/50" />
          )}
          <span className="flex items-center gap-1.5 whitespace-nowrap">{item}</span>
        </Fragment>
      ))}
      {overview.primaryHost && (
        <span className="ml-auto text-xs text-muted-foreground">{overview.primaryHost}</span>
      )}
    </div>
  );
}
