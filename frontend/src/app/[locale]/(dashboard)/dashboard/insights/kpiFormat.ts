/**
 * How the Insights KPI cards (VIS-003) write their values and changes, and
 * whether a change is good news. Kept apart from the cards so the rules are
 * tested on their own.
 */

import { numberFormat } from '@/lib/numberFormat';

/** Whether a change is good news, bad news, or neither (counts like tracked prompts). */
export type Tone = 'good' | 'bad' | 'neutral';

/** Text colour for each tone, in both themes. */
export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-red-600 dark:text-red-400',
  neutral: 'text-muted-foreground',
};

export interface Change {
  text: string;
  tone: Tone;
}

const MINUS = '−';

/**
 * The writers below take the UI's locale (VIS-005); English when left out,
 * which is also what the tests read.
 */

/** A change: "+1.5", "−3.2", "±0". */
export function signedChange(n: number, locale = 'en'): string {
  return numberFormat(locale).signed(n);
}

/** A value that can be negative, like Net sentiment: "+34", "−6", "0". */
export function signedValue(n: number, locale = 'en'): string {
  return n === 0 ? numberFormat(locale).number(0) : signedChange(n, locale);
}

/**
 * A change where up is good (most cards). `percent` writes a relative change
 * as a percent in the locale's way: "+18%", "+%18".
 */
export function upIsGood(
  change: number | null,
  { percent = false, locale = 'en' }: { percent?: boolean; locale?: string } = {},
): Change | null {
  if (change === null) return null;
  const f = numberFormat(locale);
  const text =
    change === 0
      ? '±0'
      : percent
        ? `${change > 0 ? '+' : MINUS}${f.percent(Math.abs(change))}`
        : f.signed(change);
  return { text, tone: change > 0 ? 'good' : change < 0 ? 'bad' : 'neutral' };
}

/** Avg. position: a lower number is better, shown as an arrow up when it improves. */
export function lowerIsGood(change: number | null, locale = 'en'): Change | null {
  if (change === null) return null;
  if (change === 0) return { text: '±0', tone: 'neutral' };
  return {
    text: `${change < 0 ? '↑' : '↓'}${numberFormat(locale).number(Math.abs(change))}`,
    tone: change < 0 ? 'good' : 'bad',
  };
}

/** A score change on the leaderboard, as in the v2 mockup: "↑ 4.1", "↓ 1.1", "±0". */
export function arrowChange(change: number | null, locale = 'en'): Change | null {
  if (change === null) return null;
  if (change === 0) return { text: '±0', tone: 'neutral' };
  const abs = Math.round(Math.abs(change) * 10) / 10;
  return {
    text: `${change > 0 ? '↑' : '↓'} ${numberFormat(locale).number(abs)}`,
    tone: change > 0 ? 'good' : 'bad',
  };
}

/** A rate card's sample: how many answers its rate is taken over, and which ones. */
export interface RateSample {
  count: number;
  /** 'all' answers, those that 'named' the brand, or those that 'placed' it. */
  of: 'all' | 'named' | 'placed';
}

/**
 * Each rate card's sample (VIS-005: "Every rate comes with its sample size;
 * under 20 is Low sample"). Net sentiment is a share of the answers that name
 * the brand and Avg. position an average over those that place it, so they
 * can rest on far fewer answers than the period has.
 */
export function rateSamples(s: {
  totalResults: number;
  mentioningResults: number;
  positionedResults: number;
}): Record<
  'visibility' | 'shareOfVoice' | 'citationRate' | 'netSentiment' | 'avgPosition',
  RateSample
> {
  const all: RateSample = { count: s.totalResults, of: 'all' };
  return {
    visibility: all,
    shareOfVoice: all,
    citationRate: all,
    netSentiment: { count: s.mentioningResults, of: 'named' },
    avgPosition: { count: s.positionedResults, of: 'placed' },
  };
}

/** A 'YYYY-MM-DD' UTC day as "Sep 29", in the UI's locale. */
export function dayLabel(day: string, locale = 'en'): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * A comparison-window bound for the "vs <range>" label. Whole-day windows
 * come as 'YYYY-MM-DD' UTC days and are shown as those days; the 24h and
 * topic views come as timestamps and are shown in local time.
 */
export function formatWindowBound(value: string, locale = 'en'): string {
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(dayOnly ? `${value}T00:00:00Z` : value).toLocaleDateString(locale, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    ...(dayOnly ? { timeZone: 'UTC' } : {}),
  });
}
