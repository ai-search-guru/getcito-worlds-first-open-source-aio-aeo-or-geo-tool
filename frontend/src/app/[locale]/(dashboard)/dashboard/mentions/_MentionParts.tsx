'use client';

import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { highlightSegments, type MentionKind } from '@/lib/mentionMatch';
import type { Sentiment } from '@/types';

/** The names an answer is highlighted by: your brand's (name, domains) and the competitors'. */
export interface MentionNames {
  brand: string[];
  competitors: string[];
}

/**
 * Your brand in ink, competitors in grey (spec §7): the theme's primary, so
 * a dark mark on light and a light one on dark, in the brand's colors.
 */
export const MARK_CLASS: Record<MentionKind, string> = {
  brand: 'rounded-sm bg-primary px-0.5 font-medium text-primary-foreground',
  competitor: 'rounded-sm bg-muted px-0.5 text-foreground ring-1 ring-inset ring-border',
};

/** A text with the names in it marked. */
export function Highlighted({ text, names }: { text: string; names: MentionNames }) {
  return (
    <>
      {highlightSegments(text, names).map((segment, i) =>
        segment.kind ? (
          <mark key={i} className={MARK_CLASS[segment.kind]}>
            {segment.text}
          </mark>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

/**
 * The same marks inside rendered markdown: every string child is split
 * around the names, and elements are walked into (a link's label, a bold
 * phrase), so a name is marked wherever the answer puts it.
 */
export function highlightChildren(children: ReactNode, names: MentionNames): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') return <Highlighted text={child} names={names} />;
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children !== undefined) {
      return cloneElement(child, undefined, highlightChildren(child.props.children, names));
    }
    return child;
  });
}

const SENTIMENT_CLASS: Record<Sentiment, string> = {
  positive: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  neutral: '',
  negative: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

/** The answer's tone toward your brand, always written out, never colour alone (spec §15). */
export function SentimentPill({
  sentiment,
  className,
}: {
  sentiment: Sentiment | null;
  className?: string;
}) {
  const t = useTranslations('mentions');
  if (!sentiment) {
    return <span className="text-xs text-muted-foreground">{t('table.noSentiment')}</span>;
  }
  return (
    <Badge
      variant="outline"
      className={cn('h-5 px-1.5 text-[11px] font-medium', SENTIMENT_CLASS[sentiment], className)}
    >
      {t(`overview.sentiment.${sentiment}`)}
    </Badge>
  );
}
