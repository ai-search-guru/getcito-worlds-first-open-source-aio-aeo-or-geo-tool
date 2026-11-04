'use client';

import { useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import type { WinningFindings } from '@/lib/action-center/winningFindings';
import { formatNumber } from '@/lib/format';

/** A page as a link: its host and path. */
function PageUrl({ url }: { url: string }) {
  const shown = url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all underline-offset-2 hover:underline"
    >
      {shown}
      <ArrowUpRight className="ml-0.5 inline h-3 w-3" />
    </a>
  );
}

/**
 * What "Find what sets your winning pages apart" found (learning C4): the
 * Site Audit checks most of the brand's winning pages pass and most of its
 * other audited pages don't, the winning pages, and the other pages missing
 * the most of those checks; or why nothing was compared.
 */
export function WinningFindingsView({ findings }: { findings: WinningFindings }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.task.winning');
  const winners = findings.winningPages.length;
  const labelOf = new Map(findings.patterns.map((p) => [p.key, p.label]));

  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium">{t('title')}</p>
      {winners === 0 ? (
        <p className="text-muted-foreground">{t(`reasons.${findings.reason ?? 'no_winner'}`)}</p>
      ) : (
        <>
          {findings.patterns.length > 0 ? (
            <ul className="space-y-1">
              {findings.patterns.map((pattern) => (
                <li key={pattern.key} className="flex gap-1.5">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current" />
                  <span>
                    <span className="font-medium">{pattern.label}</span>{' '}
                    <span className="text-muted-foreground">
                      {t('pattern', {
                        winners: pattern.winners,
                        ofWinners: pattern.ofWinners,
                        others: pattern.others,
                        ofOthers: pattern.ofOthers,
                      })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t('noPattern')}</p>
          )}
          <div>
            <p className="text-muted-foreground">{t('winners', { count: winners })}</p>
            <ul className="mt-0.5 space-y-0.5">
              {findings.winningPages.map((page) => (
                <li key={page.url} className="flex flex-wrap items-baseline gap-x-2">
                  <PageUrl url={page.url} />
                  <span className="text-muted-foreground">
                    {[
                      t(page.source === 'read' ? 'fromRead' : 'fromAudit'),
                      page.words !== null
                        ? t('words', { count: page.words, words: formatNumber(page.words) })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {findings.missingPages.length > 0 && (
            <div>
              <p className="text-muted-foreground">{t('missing')}</p>
              <ul className="mt-0.5 space-y-0.5">
                {findings.missingPages.map((page) => (
                  <li key={page.url} className="flex flex-wrap items-baseline gap-x-2">
                    <PageUrl url={page.url} />
                    <span className="text-muted-foreground">
                      {t('missingLine', {
                        checks: page.missing.map((key) => labelOf.get(key) ?? key).join(', '),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted-foreground">{t('compared', { count: findings.others })}</p>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t('note')}
        {findings.unreadable > 0 &&
          winners > 0 &&
          ` ${t('unreadable', { count: findings.unreadable })}`}
      </p>
    </div>
  );
}
