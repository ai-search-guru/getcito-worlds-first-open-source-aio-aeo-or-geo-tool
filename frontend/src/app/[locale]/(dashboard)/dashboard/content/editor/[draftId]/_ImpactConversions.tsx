'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import {
  conversionCards,
  conversionSources,
  journeyPages,
  type ContentConversions,
  type ResultCard,
} from '@/lib/content/conversions';
import { siteTypeOf } from '@/lib/content/pageTypes';
import { formatNumber } from '@/lib/format';
import { getPlatformName, isNamedPlatform } from '@/lib/trafficPlatforms';
import { useBrandStore } from '@/state/useBrandStore';

/** An amount in its currency, in the app's number format; the code itself where it isn't one. */
function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${formatNumber(Math.round(value))} ${currency}`;
  }
}

/**
 * The Live page tab's conversions from AI journeys through the page (spec §7,
 * CE-017): the goals the brand's kind of site counts (signups and demo forms,
 * orders, revenue and units, or bookings, revenue and newsletter signups),
 * per AI source the journey started from, and the most frequent journeys,
 * this page outlined. From the AI Traffic snippet; with conversions off,
 * where to turn them on, and what they counted before.
 */
export function ImpactConversions({
  conversions,
  brandId,
}: {
  conversions: ContentConversions;
  brandId: string;
}) {
  const t = useTranslations('contentEditor.editor.impact.conversions');
  const brand = useBrandStore((s) => s.brands.find((b) => b.id === brandId));
  const site = brand ? siteTypeOf(brand) : 'b2b';
  const cards = conversionCards(conversions, site);
  const sources = conversionSources(conversions);
  // Off, what they counted before still shows, under the note.
  const counted = conversions.goals.length > 0;

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">
        {t('title')} <span className="font-normal">· {t('subtitle')}</span>
      </h4>

      {!conversions.enabled && (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {t('off')}{' '}
          <Link
            href={`/dashboard/brands/${brandId}/settings?tab=tracking`}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {t('turnOn')}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </p>
      )}
      {(conversions.enabled || counted) && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {cards.map((card) => (
              <div key={card.key} className="rounded-lg border px-3 py-2">
                <p className="text-xs text-muted-foreground">{t(`cards.${card.key}`)}</p>
                <CardValue card={card} />
              </div>
            ))}
          </div>

          {sources.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('none')}</p>
          ) : (
            <table className="w-full text-xs">
              <caption className="sr-only">{t('bySource')}</caption>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-1.5 text-left font-medium">
                    {t('columns.source')}
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    {t('columns.conversions')}
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {sources.map((row) => (
                  <tr key={row.name ?? 'other'} className="border-b last:border-b-0">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {row.name ?? t('other')}
                    </th>
                    <td className="py-1.5 text-right">{formatNumber(row.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {conversions.journeys.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">{t('journeys')}</p>
              <ol className="space-y-1.5">
                {conversions.journeys.map((journey, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {isNamedPlatform(journey.source)
                          ? getPlatformName(journey.source)
                          : t('other')}
                      </span>
                      {journeyPages(journey.pages, conversions.page).map((page, j) => (
                        <Fragment key={j}>
                          <ChevronRight
                            aria-hidden
                            className="h-3 w-3 shrink-0 text-muted-foreground/60"
                          />
                          {page === null ? (
                            <span className="text-muted-foreground">…</span>
                          ) : page === conversions.page ? (
                            <span className="rounded-md border border-foreground px-1.5 py-0.5 font-medium">
                              {t('thisPage')}
                            </span>
                          ) : (
                            <span
                              title={page}
                              className="min-w-0 truncate rounded-md border px-1.5 py-0.5 text-muted-foreground"
                            >
                              {page}
                            </span>
                          )}
                        </Fragment>
                      ))}
                      <ChevronRight
                        aria-hidden
                        className="h-3 w-3 shrink-0 text-muted-foreground/60"
                      />
                      <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        {t(`goals.${journey.goal}`)}
                      </span>
                    </span>
                    <span className="shrink-0 pt-0.5 tabular-nums text-muted-foreground">
                      {formatNumber(journey.count)}
                      <span className="sr-only">
                        {' '}
                        {t('journeyCount', { count: journey.count })}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground">{t('legend')}</p>
        </>
      )}
    </section>
  );
}

function CardValue({ card }: { card: ResultCard }) {
  if (card.key !== 'revenue') {
    return <p className="text-lg font-semibold tabular-nums">{formatNumber(card.value)}</p>;
  }
  if (card.value.length === 0) return <p className="text-lg font-semibold">—</p>;
  return (
    <>
      {card.value.map(({ currency, value }) => (
        <p key={currency} className="text-lg font-semibold tabular-nums">
          {money(value, currency)}
        </p>
      ))}
    </>
  );
}
