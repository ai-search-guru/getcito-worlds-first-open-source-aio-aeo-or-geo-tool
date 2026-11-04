'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { getOpportunity, getOpportunityBasket } from '@/lib/actions/content';
import { opportunityLists } from '@/lib/content/opportunityLists';
import type { ContentOpportunity, OpportunityBasket } from '@/types';

/** Fan-out queries listed before the rest fold away. */
const QUERIES_SHOWN = 15;

/**
 * What an action sent from Content Optimization is about (#857): the
 * opportunity's decision and pages, its prompts and fan-out queries, and its
 * brief. Read live from the opportunity rather than copied onto the action,
 * so a brief generated after sending still shows here.
 */
export function OpportunityContext({
  opportunityId,
  pageUrls,
}: {
  opportunityId: string;
  /** The pages of the asset that was sent; all of the opportunity's when it was sent whole. */
  pageUrls?: string[];
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.opportunity');
  const tContent = useTranslations('content');
  const [opportunity, setOpportunity] = useState<ContentOpportunity | null>(null);
  const [basket, setBasket] = useState<OpportunityBasket | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAllQueries, setShowAllQueries] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getOpportunity(opportunityId), getOpportunityBasket(opportunityId)])
      .then(([opp, b]) => {
        if (cancelled) return;
        setOpportunity(opp);
        setBasket(b);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [opportunityId]);

  if (failed) {
    return <p className="text-xs text-muted-foreground">{t('unavailable')}</p>;
  }
  if (!opportunity || !basket) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const { pages, prompts, queries } = opportunityLists(opportunity, basket, pageUrls);
  const brief = opportunity.brief;

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{t('title')}</p>
          <Link
            href={`/dashboard/content/${opportunity.id}`}
            className="text-xs text-primary hover:underline"
          >
            {t('open')}
          </Link>
        </div>
        <p className="mt-1 font-medium">{opportunity.title}</p>
        {opportunity.decision && (
          <p className="mt-1 text-xs text-muted-foreground">
            <Badge variant="secondary" className="mr-1.5 text-[10px]">
              {tContent(`decision.${opportunity.decision}`)}
            </Badge>
            {tContent(`decisionHint.${opportunity.decision}`)}
          </p>
        )}
        {pages.length > 0 && (
          <div className="mt-2 space-y-1">
            {pages.map((p) => (
              <a
                key={p.url}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{p.title || p.url}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <Separator />
      <section>
        <p className="text-xs font-medium text-muted-foreground">{t('brief')}</p>
        {brief ? (
          <div className="mt-2 space-y-2">
            <p className="font-medium">{brief.suggestedTitle}</p>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline" className="text-[10px]">
                {brief.contentType.replace(/-/g, ' ')}
              </Badge>
              <Badge variant="outline" className="text-[10px] tabular-nums">
                {t('words', { count: brief.targetWordCount })}
              </Badge>
            </div>
            <ol className="space-y-1.5 text-xs">
              {brief.outline.map((section, i) => (
                <li key={i}>
                  <p className="font-medium">
                    {i + 1}. {section.heading}
                  </p>
                  {section.keyPoints.length > 0 && (
                    <ul className="ml-4 list-disc text-muted-foreground">
                      {section.keyPoints.map((point, j) => (
                        <li key={j}>{point}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {t.rich('noBrief', {
              link: (chunks) => (
                <Link
                  href={`/dashboard/content/${opportunity.id}`}
                  className="text-primary hover:underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        )}
      </section>

      <Separator />
      <section>
        <p className="text-xs font-medium text-muted-foreground">
          {t('prompts', { count: prompts.length })}
        </p>
        <ul className="mt-2 space-y-1 text-xs">
          {prompts.map((p) => (
            <li key={p.id} className="flex gap-2">
              <span className="text-muted-foreground">•</span>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </section>

      {queries.length > 0 && (
        <>
          <Separator />
          <section>
            <p className="text-xs font-medium text-muted-foreground">
              {t('queries', { count: queries.length })}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {(showAllQueries ? queries : queries.slice(0, QUERIES_SHOWN)).map((q) => (
                <Badge
                  key={q.query}
                  variant="outline"
                  className="gap-1 text-[10px]"
                  title={q.reason}
                >
                  <Search className="h-2.5 w-2.5 shrink-0" />
                  {q.query}
                  <span className="tabular-nums opacity-60">×{q.timesSearched}</span>
                </Badge>
              ))}
            </div>
            {queries.length > QUERIES_SHOWN && (
              <button
                type="button"
                onClick={() => setShowAllQueries((v) => !v)}
                className="mt-1.5 text-xs text-primary hover:underline"
              >
                {showAllQueries ? t('fewerQueries') : t('allQueries', { count: queries.length })}
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
