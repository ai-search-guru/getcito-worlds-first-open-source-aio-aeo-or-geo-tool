'use client';

import { Fragment, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Sparkles, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { journeyPages, type PlanConversions } from '@/lib/content/conversions';
import type { PageType } from '@/lib/content/drafts';
import type { MixRow, PlanResults } from '@/lib/content/planMix';
import type { PlanPeriod } from '@/lib/content/plan';
import { formatNumber } from '@/lib/format';
import { getPlatformName, isNamedPlatform } from '@/lib/trafficPlatforms';
import { cn } from '@/lib/utils';

/** Goals on the strip: the four with the most conversions. */
const STRIP_GOALS = 4;

/**
 * The AI results strip (CE-014): what visitors from AI assistants did on the
 * site in the period. Key events need Google Analytics; orders and revenue
 * show when its property reports purchases. With conversions on (CE-017),
 * the goals the AI Traffic snippet followed them to, and the top journey.
 */
export function AiResultsStrip({
  results,
  conversions = null,
  days,
}: {
  results: PlanResults;
  /** The snippet's conversions, or null when they couldn't be read. */
  conversions?: PlanConversions | null;
  days: PlanPeriod;
}) {
  const t = useTranslations('contentEditor.plan.results');
  const parts = [t('visits', { count: results.visits, value: formatNumber(results.visits) })];
  if (results.analytics) {
    parts.push(
      t('keyEvents', { count: results.keyEvents, value: formatNumber(results.keyEvents) }),
    );
    if (results.purchases) {
      parts.push(
        t('orders', { count: results.transactions, value: formatNumber(results.transactions) }),
        t('revenue', { value: formatNumber(Math.round(results.revenue)) }),
      );
    }
  }
  const goals = conversions?.goals.slice(0, STRIP_GOALS) ?? [];
  for (const { goal, count } of goals) {
    parts.push(t(`goals.${goal}`, { count, value: formatNumber(count) }));
  }
  const journey = conversions?.journey ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm">
      <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{t('label', { days })}</span>
      <span className="font-medium">{parts.join(' · ')}</span>
      {!results.analytics && (
        <span className="text-muted-foreground">
          {t.rich(goals.length > 0 ? 'needsAnalyticsMore' : 'needsAnalytics', {
            link: (chunks) => (
              <Link
                href="/dashboard/traffic"
                className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </span>
      )}
      {journey && (
        <p className="flex w-full min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>{t('topJourney')}</span>
          <span className="rounded-md bg-muted px-1.5 py-0.5">
            {isNamedPlatform(journey.source) ? getPlatformName(journey.source) : t('otherSource')}
          </span>
          {journeyPages(journey.pages).map((page, i) => (
            <Fragment key={i}>
              <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              {page === null ? (
                <span>…</span>
              ) : (
                <span title={page} className="min-w-0 truncate rounded-md border px-1.5 py-0.5">
                  {page}
                </span>
              )}
            </Fragment>
          ))}
          <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            {t(`journeyGoals.${journey.goal}`)}
          </span>
          <span>
            · {t('journeyCount', { count: journey.count, value: formatNumber(journey.count) })}
          </span>
        </p>
      )}
    </div>
  );
}

/** The two shares as two bars on one scale: AI's light above, the brand's dark below. */
function MixBars({
  aiShare,
  yourShare,
  scale,
}: {
  aiShare: number;
  yourShare: number;
  scale: number;
}) {
  const width = (share: number) => `${Math.min(100, (share / scale) * 100)}%`;
  return (
    <span aria-hidden className="flex flex-col gap-1">
      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span
          data-bar="ai"
          className="block h-full rounded-full bg-muted-foreground/40"
          style={{ width: width(aiShare) }}
        />
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span
          data-bar="yours"
          className="block h-full rounded-full bg-foreground"
          style={{ width: width(yourShare) }}
        />
      </span>
    </span>
  );
}

/**
 * "What AI cites in your topics" (CE-014): per page type, the share of AI
 * citations (light bar) and the type's share of the brand's own cited pages
 * (dark bar), two mixes of 100 each drawn to one scale, with a gap flagged
 * in amber. A row
 * filters the priority list to its type; clicking it again clears it. While
 * the section is closed, a line under its bar names the type filtering the
 * list and clears it.
 */
export function PageTypeMix({
  rows,
  covered,
  selected,
  onSelect,
}: {
  rows: MixRow[];
  /** The share of all the period's citations the shares are of, in whole percent. */
  covered: number;
  selected: PageType | null;
  onSelect: (type: PageType | null) => void;
}) {
  const t = useTranslations('contentEditor.plan.mix');
  const tTypes = useTranslations('contentEditor.pageTypes');
  // Closed until opened, as Tracked Prompts' usage header: the list is the
  // page's work. Kept mounted while closed, so it opens at once.
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  // The largest share, AI's or the brand's, fills the track; the others are
  // drawn to its scale, so neither bar runs past it.
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.aiShare, r.yourShare)));
  const gaps = rows.filter((r) => r.gap).length;

  return (
    <section aria-labelledby="plan-mix-title" className="overflow-hidden rounded-xl border bg-card">
      {/* The whole bar opens it: "Show" and a chevron pointing down say so. */}
      <h2 className="text-sm font-medium">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="group flex w-full cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <span id="plan-mix-title">{t('title')}</span>
          {!open && rows.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {t('collapsed', { types: rows.length, gaps })}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-xs font-medium text-foreground group-hover:underline">
            {open ? t('hide') : t('show')}
            <ChevronDown
              aria-hidden
              className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
            />
          </span>
        </button>
      </h2>
      {/* Closed, the rows that filter the list are out of sight: say which one does. */}
      {!open && selected && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>{t('filteredBy', { type: tTypes(selected) })}</span>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="inline-flex items-center gap-1 rounded font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
            {t('clearFilter')}
          </button>
        </div>
      )}
      <div id={bodyId} className={cn('border-t', !open && 'hidden')}>
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-3 px-4 pt-2.5 pb-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-sm bg-muted-foreground/40" />
              {t('aiShare')}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-sm bg-foreground" />
              {t('yourShare')}
            </span>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.pageType}>
                <button
                  type="button"
                  aria-pressed={selected === row.pageType}
                  onClick={() => onSelect(selected === row.pageType ? null : row.pageType)}
                  className={cn(
                    'grid w-full grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,12rem)_1fr_5.5rem_8rem]',
                    selected === row.pageType && 'bg-muted/60',
                  )}
                >
                  <span className="truncate">{tTypes(row.pageType)}</span>
                  <MixBars aiShare={row.aiShare} yourShare={row.yourShare} scale={scale} />
                  <span className="text-right text-xs tabular-nums text-muted-foreground">
                    {t('shares', { ai: row.aiShare, yours: row.yourShare })}
                    {/* On a phone the gap goes under the shares. */}
                    {row.gap && (
                      <span className="block font-medium text-amber-700 sm:hidden dark:text-amber-400">
                        {t('gap', { count: row.pages })}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'hidden text-right text-xs sm:block',
                      row.gap
                        ? 'font-medium text-amber-700 dark:text-amber-400'
                        : 'text-muted-foreground',
                    )}
                  >
                    {row.gap ? t('gap', { count: row.pages }) : t('pages', { count: row.pages })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && covered < 100 && (
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
            {t('covered', { pct: covered })}
          </p>
        )}
      </div>
    </section>
  );
}
