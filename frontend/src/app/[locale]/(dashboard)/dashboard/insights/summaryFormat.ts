import type { CompetitorComparisonData, VisibilityRateTrendData } from '@/lib/actions/tracking';
import type { PromptComparison } from '@/lib/insightsSamePrompts';
import {
  LOW_SAMPLE_ANSWERS,
  platformMovers,
  rankSummary,
  type PlatformChange,
} from '@/lib/insightsSummary';
import { numberFormat } from '@/lib/numberFormat';
import { formatWindowBound, upIsGood, type Tone } from './kpiFormat';

/**
 * What the summary line says (VIS-006), built once for both the screen and
 * Copy, so the two can't drift apart. Each fact is a run of parts; a part
 * is bold (the number or name to read first) or toned (a change).
 */

export interface SummaryPart {
  text: string;
  bold?: boolean;
  tone?: Tone;
}

export interface SummaryFact {
  key: string;
  parts: SummaryPart[];
}

/** The message lookup, as next-intl's `t` for `insights.summary`. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface SummaryInput {
  trend: VisibilityRateTrendData | null;
  competitors: CompetitorComparisonData | null;
  comparison: PromptComparison | null;
  platformChanges: PlatformChange[] | null;
  /** The period's answers: under 20, the score is a low sample (VIS-005). */
  answers?: number;
  /** The UI's locale, for every number (VIS-005); English when left out. */
  locale?: string;
}

/** The line's facts, left to right; a fact without its data is left out. */
export function summaryFacts(input: SummaryInput, t: Translate): SummaryFact[] {
  const facts: SummaryFact[] = [];
  const locale = input.locale ?? 'en';
  const f = numberFormat(locale);
  const lowSample = input.answers !== undefined && input.answers < LOW_SAMPLE_ANSWERS;

  // No score without the trend: a missing read must not read as 0. Under 20
  // answers the score says so, and no change is read into so few.
  if (input.trend) {
    const change = lowSample ? null : upIsGood(input.trend.summary.change, { locale });
    facts.push({
      key: 'visibility',
      parts: [
        { text: f.number(input.trend.summary.rate), bold: true },
        { text: t('visibility') },
        ...(change ? [{ text: change.text, tone: change.tone }] : []),
        ...(lowSample ? [{ text: t('lowSample', { count: input.answers! }) }] : []),
      ],
    });
  }

  const rank = input.competitors ? rankSummary(input.competitors.brands) : null;
  if (rank) {
    const { neighbour } = rank;
    facts.push({
      key: 'rank',
      parts: [
        { text: t('rank', { rank: f.number(rank.rank) }), bold: true },
        { text: `${t('ofCount', { count: f.number(rank.count) })} ·` },
        ...(neighbour.side === 'tied'
          ? [{ text: t('tied', { name: neighbour.name }) }]
          : [
              { text: t('pts', { value: f.number(neighbour.gap) }), bold: true },
              {
                text:
                  neighbour.side === 'behind'
                    ? t('behind', { name: neighbour.name })
                    : t('ahead', { name: neighbour.name }),
              },
            ]),
      ],
    });
  }

  const { up, down } = platformMovers(input.platformChanges ?? []);
  for (const [key, label, mover] of [
    ['up', t('upMost'), up],
    ['down', t('downMost'), down],
  ] as const) {
    if (!mover) continue;
    const moved = upIsGood(mover.change, { locale })!;
    facts.push({
      key,
      parts: [
        { text: label },
        { text: mover.name, bold: true },
        { text: moved.text, tone: moved.tone },
      ],
    });
  }

  return facts;
}

/** What the change compares: the previous window and the prompts left out or in. */
export function summaryContext(
  input: SummaryInput,
  t: Translate,
  tCompare: Translate,
): string | null {
  const { trend, comparison } = input;
  const parts = [
    trend && trend.summary.change !== null && trend.summary.prevFrom
      ? t('vs', {
          from: formatWindowBound(trend.summary.prevFrom, input.locale),
          to: formatWindowBound(trend.summary.prevTo, input.locale),
        })
      : null,
    comparison && comparison.newPrompts > 0
      ? tCompare(comparison.basis === 'same' ? 'newExcluded' : 'newIncluded', {
          count: comparison.newPrompts,
        })
      : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The whole line as one line of text, for Copy. */
export function summaryText(facts: SummaryFact[], context: string | null): string {
  return [...facts.map((f) => f.parts.map((p) => p.text).join(' ')), context]
    .filter(Boolean)
    .join(' · ');
}
