'use client';

import { Fragment } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Copy, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TONE_TEXT } from './kpiFormat';
import { summaryContext, summaryFacts, summaryText, type SummaryInput } from './summaryFormat';

/**
 * The summary line above the KPI cards (VIS-006), as in the v2 mockup: the
 * Visibility score and change, the rank and the gap to the neighbouring
 * brand, the platforms that moved most, and what the change compares. A fixed
 * template over numbers the page already shows; Copy puts the same line on
 * the clipboard as text.
 */
export function SummaryLine(props: SummaryInput) {
  const t = useTranslations('insights.summary');
  const tCompare = useTranslations('insights.compare');
  const input = { ...props, locale: useLocale() };

  const facts = summaryFacts(input, t);
  const context = summaryContext(input, t, tCompare);
  if (facts.length === 0 && !context) return null;

  const copy = async () => {
    try {
      // Missing outside a secure context (e.g. a self-hosted install over http).
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(summaryText(facts, context));
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  return (
    <section
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl border bg-card px-3.5 py-2.5 text-[13.5px]"
    >
      <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {facts.map((fact, i) => (
        <Fragment key={fact.key}>
          {i > 0 && (
            <span className="text-muted-foreground/40" aria-hidden>
              •
            </span>
          )}
          <span>
            {fact.parts.map((part, j) => (
              <Fragment key={j}>
                {j > 0 && ' '}
                <span
                  className={cn(
                    'tabular-nums',
                    part.bold && 'font-semibold',
                    part.tone && ['font-medium', TONE_TEXT[part.tone]],
                  )}
                >
                  {part.text}
                </span>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
      <span className="flex-1" />
      {context && (
        <span className="text-xs text-muted-foreground" title={tCompare('hint')}>
          {context}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={t('copy')}
        title={t('copy')}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}
