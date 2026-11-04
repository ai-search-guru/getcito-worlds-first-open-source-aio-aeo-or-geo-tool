'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { formatDate, formatDateTime } from '@/lib/format';

interface SentPage {
  page: string;
  citations: number;
  sessions: number;
  aiVisits: number;
}

/** The page's 24-hour range, with its slack (as isHourlyWindow allows). */
const HOURLY_MS = 25 * 60 * 60 * 1000;

/** The range the pages were read over, in days, or hours when it was one day. */
function rangeLabel(from: string | null, to: string | null, allTime: string): string {
  if (!from) return allTime;
  const end = to ?? new Date().toISOString();
  const format = Date.parse(end) - Date.parse(from) <= HOURLY_MS ? formatDateTime : formatDate;
  return `${format(from)} – ${format(end)}`;
}

/**
 * What pages sent from AI Traffic's Pages section are about (AT-006): the
 * list they came from, the range they were read over, and each page with its
 * citations, sessions and AI visits when sent. Copied onto the action at send
 * time, so it still reads after the figures move.
 */
export function TrafficPagesContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.trafficPages');
  const list =
    payload.reason === 'cited_not_clicked' || payload.reason === 'no_ai_traffic'
      ? payload.reason
      : null;
  const window = (payload.window ?? {}) as { from?: unknown; to?: unknown };
  const from = typeof window.from === 'string' ? window.from : null;
  const to = typeof window.to === 'string' ? window.to : null;
  const pages: SentPage[] = Array.isArray(payload.evidence)
    ? (payload.evidence as Record<string, unknown>[]).flatMap((e) =>
        typeof e?.page === 'string'
          ? [
              {
                page: e.page,
                citations: Number(e.citations) || 0,
                sessions: Number(e.sessions) || 0,
                aiVisits: Number(e.aiVisits) || 0,
              },
            ]
          : [],
      )
    : [];

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{t('source')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span>{t('sourceValue', { list: list ? t(`lists.${list}`) : '—' })}</span>
          <Link
            href="/dashboard/traffic"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t('openTraffic')}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">{t('range')}</p>
        <p className="mt-1 tabular-nums">{rangeLabel(from, to, t('rangeAll'))}</p>
      </div>
      {pages.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('pages')}</p>
          <ul className="mt-1.5 space-y-1.5">
            {pages.map((p) => (
              <li key={p.page} className="rounded-md border px-3 py-2 text-xs">
                <p className="truncate font-mono" title={p.page}>
                  {p.page}
                </p>
                <p className="mt-0.5 tabular-nums text-muted-foreground">
                  {t('figures', {
                    citations: p.citations,
                    sessions: p.sessions,
                    aiVisits: p.aiVisits,
                  })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
