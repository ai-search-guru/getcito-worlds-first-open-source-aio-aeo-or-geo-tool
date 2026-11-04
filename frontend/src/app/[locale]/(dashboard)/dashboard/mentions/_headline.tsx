'use client';

import { Fragment } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { mentionPlatformLabel, mentionsHeadline } from '@/lib/mentionsHeadline';
import type { MentionsOverview } from '@/lib/mentionsOverview';
import {
  arrowChange,
  dayLabel,
  signedChange,
  signedValue,
  TONE_TEXT,
  type Tone,
} from '../insights/kpiFormat';

/** "Oct 16, 9:40 AM": the 24h view's bounds, in local time. */
function momentLabel(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The window as the summary names it: "Sep 18 – Oct 17", or its moments under two days. */
export function windowRange(w: MentionsOverview['window'], locale: string): string {
  return w.source === 'answers'
    ? `${momentLabel(w.from, locale)} – ${momentLabel(w.to, locale)}`
    : `${dayLabel(w.dayFrom, locale)} – ${dayLabel(w.dayTo, locale)}`;
}

/** The message lookup, as next-intl's `t` for `mentions.overview.headline`. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface HeadlineSentence {
  key: string;
  values: Record<string, string | number>;
  /** The change's colour, for the sentence that has one. */
  tone?: Tone;
}

/**
 * The summary line's sentences as messages, chosen once for the page (with
 * bold and coloured parts) and Copy summary (as plain text), so the two
 * can't drift apart.
 */
export function headlineSentences(
  overview: MentionsOverview,
  brand: string,
  locale: string,
  t: Translate,
): HeadlineSentence[] {
  const { net, lowSample, netChange, mover, companions } = mentionsHeadline(overview);
  const { window: w, current } = overview;
  const period = w.source === 'answers' ? t('period24h') : t('period', { days: w.days });
  const change = arrowChange(netChange, locale);
  const sentences: HeadlineSentence[] = [];

  if (net === null) sentences.push({ key: 'noMentions', values: { brand } });
  else if (change) {
    sentences.push({
      key: 'netChange',
      values: { net: signedValue(net, locale), change: change.text, period },
      tone: change.tone,
    });
  } else if (lowSample) {
    sentences.push({
      key: 'netLowSample',
      values: { net: signedValue(net, locale), count: current.mentions },
    });
  } else sentences.push({ key: 'net', values: { net: signedValue(net, locale) } });

  if (mover) {
    sentences.push({
      key: mover.change < 0 ? 'moverDown' : 'moverUp',
      values: {
        platform: mentionPlatformLabel(mover.platform),
        change: signedChange(mover.change, locale),
      },
    });
  }
  if (companions.length === 1) {
    sentences.push({ key: 'companionsOne', values: { brand, first: companions[0] } });
  } else if (companions.length > 1) {
    sentences.push({
      key: 'companionsTwo',
      values: { brand, first: companions[0], second: companions[1] },
    });
  }
  return sentences;
}

/**
 * The Overview's summary line (MS-06), as in the mockup: net sentiment and
 * its change, the platform behind most of it, and the brands AI names you
 * beside. Written from the aggregates by a fixed template, never an LLM, and
 * says so with the window and the responses it rests on.
 */
export function Headline({ overview, brand }: { overview: MentionsOverview; brand: string }) {
  const t = useTranslations('mentions.overview.headline');
  const locale = useLocale();
  const b = (chunks: React.ReactNode) => <b className="font-semibold">{chunks}</b>;

  return (
    <section
      aria-label={t('label')}
      className="rounded-xl border border-l-[3px] border-l-foreground bg-card px-4 py-3 text-sm"
    >
      <p>
        {headlineSentences(overview, brand, locale, t).map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 && ' '}
            {t.rich(s.key, {
              ...s.values,
              b,
              tone: (chunks) => (
                <span className={cn('font-medium', TONE_TEXT[s.tone ?? 'neutral'])}>{chunks}</span>
              ),
            })}
          </Fragment>
        ))}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('basis', {
          range: windowRange(overview.window, locale),
          answers: overview.current.answers,
          // As Total mentions counts them: every time a response names the brand.
          mentions: overview.current.occurrences,
        })}
      </p>
    </section>
  );
}
