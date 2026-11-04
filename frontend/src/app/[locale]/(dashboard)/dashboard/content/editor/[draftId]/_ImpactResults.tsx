'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { resultSources, resultTotals, type ContentResults } from '@/lib/content/impact';
import { formatNumber } from '@/lib/format';
import { conversionRate } from '@/lib/trafficConversions';

/**
 * The Impact tab's results from AI visits (spec §7): what visitors from AI
 * assistants did after landing on the page — Google Analytics' key events,
 * and orders and revenue when the property reports purchases — and, per AI
 * source, the visits it sent with what they did. Without Analytics, the
 * visits per source, and where to connect it.
 */
export function ImpactResults({ results }: { results: ContentResults }) {
  const t = useTranslations('contentEditor.editor.impact.results');
  const totals = resultTotals(results.sources);
  const rows = resultSources(results.sources);
  const revenue = results.analytics && results.purchases;
  const rate = conversionRate({
    aiVisits: totals.sessions,
    keyEvents: totals.keyEvents,
    keyEventSessions: totals.keyEventSessions,
  });

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">
        {t('title')} <span className="font-normal">· {t('subtitle')}</span>
      </h4>

      {results.analytics ? (
        <div className="grid grid-cols-2 gap-2">
          <ResultCard label={t('keyEvents')} value={formatNumber(totals.keyEvents)} />
          <ResultCard
            label={t('rate')}
            value={rate.kind === 'rate' ? `${formatNumber(rate.pct)}%` : '—'}
            hint={
              rate.kind === 'low'
                ? t('rateLow', { sessions: totals.sessions })
                : rate.kind === 'unknown'
                  ? t('rateUnknown')
                  : undefined
            }
          />
          {revenue && (
            <>
              <ResultCard label={t('orders')} value={formatNumber(totals.transactions)} />
              <ResultCard label={t('revenue')} value={formatNumber(Math.round(totals.revenue))} />
            </>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {t('needsAnalytics')}{' '}
          <Link
            href="/dashboard/traffic"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {t('openTraffic')}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
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
                {t('columns.visits')}
              </th>
              {results.analytics && (
                <th scope="col" className="py-1.5 text-right font-medium">
                  {t('columns.keyEvents')}
                </th>
              )}
              {revenue && (
                <th scope="col" className="py-1.5 text-right font-medium">
                  {t('columns.revenue')}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((row) => (
              <tr key={row.name ?? 'other'} className="border-b last:border-b-0">
                <th scope="row" className="py-1.5 text-left font-normal">
                  {row.name ?? t('other')}
                </th>
                <td className="py-1.5 text-right">{formatNumber(row.visits)}</td>
                {results.analytics && (
                  <td className="py-1.5 text-right">{formatNumber(row.keyEvents)}</td>
                )}
                {revenue && (
                  <td className="py-1.5 text-right">{formatNumber(Math.round(row.revenue))}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows.length > 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {results.analytics ? t('legend') : t('legendVisits')}
        </p>
      )}
    </section>
  );
}

function ResultCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2" title={hint}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
