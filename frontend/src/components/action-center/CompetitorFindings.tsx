'use client';

import { useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import type { CitedPageRead, CompetitorFindings } from '@/lib/action-center/competitorFindings';
import { formatNumber } from '@/lib/format';

/** A page read, as a link: its host and path. */
function PageLink({ page }: { page: CitedPageRead }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.task.competitor');
  const shown = page.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <a
        href={page.url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all underline-offset-2 hover:underline"
      >
        {shown}
        <ArrowUpRight className="ml-0.5 inline h-3 w-3" />
      </a>
      <span className="text-muted-foreground">
        {[
          page.words !== null
            ? t('words', { count: page.words, words: formatNumber(page.words) })
            : null,
          page.cited > 0 ? t('cited', { count: page.cited }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </li>
  );
}

/**
 * What the "Analyze competitor content" task found (learning C1): the checks
 * at least half of the competitor pages AI answers cite pass that the brand's
 * page doesn't, and the pages read; or why nothing was compared.
 */
export function CompetitorFindingsView({ findings }: { findings: CompetitorFindings }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.task.competitor');
  const read = findings.competitorPages.length;

  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium">{t('title')}</p>
      {read === 0 ? (
        <p className="text-muted-foreground">{t(`reasons.${findings.reason ?? 'unreadable'}`)}</p>
      ) : (
        <>
          {!findings.compared ? (
            <p className="text-muted-foreground">{t('tooFew')}</p>
          ) : findings.gaps.length > 0 ? (
            <ul className="space-y-1">
              {findings.gaps.map((gap) => (
                <li key={gap.key} className="flex gap-1.5">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current" />
                  <span>
                    <span className="font-medium">{gap.label}</span>{' '}
                    <span className="text-muted-foreground">
                      {t(findings.yourPage ? 'gap' : 'gapNoPage', {
                        count: gap.competitors,
                        of: gap.of,
                      })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t('noGap')}</p>
          )}
          <div>
            <p className="text-muted-foreground">{t('pages', { count: read })}</p>
            <ul className="mt-0.5 space-y-0.5">
              {findings.competitorPages.map((page) => (
                <PageLink key={page.url} page={page} />
              ))}
            </ul>
          </div>
          <div>
            <p className="text-muted-foreground">{t('yours')}</p>
            {findings.yourPage ? (
              <ul className="mt-0.5">
                <PageLink page={findings.yourPage} />
              </ul>
            ) : (
              <p>{t(findings.yourPageStatus === 'unreadable' ? 'yourUnreadable' : 'noPage')}</p>
            )}
          </div>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t('note')}
        {findings.unreadable > 0 &&
          read > 0 &&
          ` ${t('unreadable', { count: findings.unreadable })}`}
      </p>
    </div>
  );
}
