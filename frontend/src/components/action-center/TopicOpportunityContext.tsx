'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useMemo } from 'react';
import { guessedVolumeEstimate } from '@/lib/volumeEstimate';
import {
  EstimateBadge,
  EstimateNoteTooltip,
  EstimateRange,
  createEstimateNoteHandle,
} from '@/components/prompts/VolumeEstimate';

interface SuggestedPrompt {
  text: string;
  volume: number;
}

/**
 * What an Opportunities topic sent from Insights is about (VIS-011): its
 * source, the topic with a link to it, the plan it follows and the suggested
 * prompts with their demand when it was sent. Copied onto the action at send
 * time, so it still reads after the suggestions are refreshed.
 */
export function TopicOpportunityContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.topicOpportunity');
  // One method note for the suggestions' ranges, however many were sent.
  const suggestionNote = useMemo(() => createEstimateNoteHandle(), []);
  const topicId = typeof payload.topicId === 'string' ? payload.topicId : null;
  const topicName = typeof payload.topicName === 'string' ? payload.topicName : null;
  const demand = typeof payload.demand === 'number' ? payload.demand : null;
  const plan = payload.plan === 'G05' ? 'planExpand' : payload.plan === 'G16' ? 'planNew' : null;
  const suggestions: SuggestedPrompt[] = Array.isArray(payload.suggestions)
    ? (payload.suggestions as Record<string, unknown>[]).flatMap((s) =>
        typeof s?.text === 'string' ? [{ text: s.text, volume: Number(s.volume) || 0 }] : [],
      )
    : [];

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
      {plan && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('plan')}</p>
          <p className="mt-1">{t(plan)}</p>
        </div>
      )}
      {suggestions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('demand')}</p>
          {demand !== null && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
              {/* The suggestions' AI-guessed demand: a grey range (PROMPT-013),
                  with the badge that says it is an estimate and from where. */}
              <span>
                {t.rich('demandValue', {
                  count: suggestions.length,
                  range: () => (
                    <EstimateRange
                      estimate={guessedVolumeEstimate(demand, null)}
                      kind="total"
                      perMonth
                    />
                  ),
                })}
              </span>
              <EstimateBadge estimate={guessedVolumeEstimate(demand, null)} kind="total" />
            </p>
          )}
          <ul className="mt-1.5 space-y-1 text-xs">
            {suggestions.map((s) => (
              <li key={s.text} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">{s.text}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  <EstimateRange
                    estimate={guessedVolumeEstimate(s.volume, null)}
                    handle={suggestionNote}
                    perMonth
                  />
                </span>
              </li>
            ))}
          </ul>
          <EstimateNoteTooltip handle={suggestionNote} />
        </div>
      )}
    </section>
  );
}
