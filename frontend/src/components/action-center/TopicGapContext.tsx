'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';

/**
 * What a topic gap sent from Insights is about (VIS-010): its source, the
 * topic with a link to it, and the two scores when it was sent. Copied onto
 * the action at send time, so it still reads after the scores move.
 */
export function TopicGapContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.topicGap');
  const topicId = typeof payload.topicId === 'string' ? payload.topicId : null;
  const topicName = typeof payload.topicName === 'string' ? payload.topicName : null;
  const competitor = typeof payload.competitorName === 'string' ? payload.competitorName : null;
  const you = typeof payload.yourScore === 'number' ? payload.yourScore : null;
  const them = typeof payload.competitorScore === 'number' ? payload.competitorScore : null;
  const gap = typeof payload.gap === 'number' ? payload.gap : null;

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{t('source')}</p>
        <p className="mt-1">{t('sourceValue')}</p>
      </div>
      {topicName && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('topic')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span>{topicName}</span>
            {topicId && (
              <Link
                href={`/dashboard/prompts/topics/${topicId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {t('openTopic')}
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      )}
      {you !== null && them !== null && competitor && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('scores')}</p>
          <p className="mt-1 tabular-nums">
            {t('you')} {you.toFixed(1)} · {competitor} {them.toFixed(1)}
            {gap !== null && (
              <span className="ml-2 text-xs text-muted-foreground">
                {t('gap', { gap: gap.toFixed(1) })}
              </span>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
