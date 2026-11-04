'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { mentionPlatformLabel } from '@/lib/mentionsHeadline';
import { cn } from '@/lib/utils';

interface Evidence {
  resultId: string;
  promptText: string;
  platform: string;
  sentiment: string | null;
  createdAt: string;
  excerpt: string;
}

const TONE: Record<string, string> = {
  positive: 'text-emerald-700 dark:text-emerald-300',
  negative: 'text-rose-700 dark:text-rose-300',
};

/**
 * What answers sent from the Mentions tab are about (MS-08): their source,
 * how many and how many were negative, and the answers quoted as they read
 * when sent, with their platform, date and tone. Copied onto the action at
 * send time, so it still reads after newer answers come in.
 */
export function MentionReviewContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.mentionReview');
  const locale = useLocale();
  const count = typeof payload.mentionCount === 'number' ? payload.mentionCount : 0;
  const negative = typeof payload.negativeCount === 'number' ? payload.negativeCount : 0;
  const evidence: Evidence[] = Array.isArray(payload.evidence)
    ? (payload.evidence as Record<string, unknown>[]).flatMap((e) =>
        typeof e?.resultId === 'string'
          ? [
              {
                resultId: e.resultId,
                promptText: typeof e.promptText === 'string' ? e.promptText : '',
                platform: typeof e.platform === 'string' ? e.platform : '',
                sentiment: typeof e.sentiment === 'string' ? e.sentiment : null,
                createdAt: typeof e.createdAt === 'string' ? e.createdAt : '',
                excerpt: typeof e.excerpt === 'string' ? e.excerpt : '',
              },
            ]
          : [],
      )
    : [];
  const day = (iso: string) =>
    iso ? new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : '';

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{t('source')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span>{t('sourceValue')}</span>
          <Link
            href="/dashboard/mentions?tab=mentions"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t('openMentions')}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
      {count > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('answers')}</p>
          <p className="mt-1 tabular-nums">
            {negative > 0
              ? t('answersNegative', { count, negative })
              : t('answersValue', { count })}
          </p>
        </div>
      )}
      {evidence.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('quotes')}</p>
          <ul className="mt-1.5 space-y-2">
            {evidence.map((e) => (
              <li key={e.resultId} className="rounded-md border px-3 py-2 text-xs">
                <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {mentionPlatformLabel(e.platform)}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{day(e.createdAt)}</span>
                  {e.sentiment && (
                    <>
                      <span aria-hidden>·</span>
                      <span className={cn('font-medium', TONE[e.sentiment])}>
                        {t(
                          `sentiment.${e.sentiment === 'positive' || e.sentiment === 'negative' ? e.sentiment : 'neutral'}`,
                        )}
                      </span>
                    </>
                  )}
                </p>
                <p className="mt-1 font-medium">{e.promptText}</p>
                {e.excerpt && (
                  <p className="mt-1 leading-relaxed text-muted-foreground">{e.excerpt}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
