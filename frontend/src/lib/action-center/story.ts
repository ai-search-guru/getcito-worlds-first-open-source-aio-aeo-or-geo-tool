import type { Signal } from '@/lib/signals/map';
import { signalWhereValue } from '@/lib/signals/detail';
import { SIGNAL_KINDS, isSignalKind } from '@/lib/signals/registry';
import { platformName } from '@/lib/signals/names';
import { formatEstimateRange, sumEstimates, type VolumeEstimate } from '@/lib/volumeEstimate';
import { affectedOf, bareUrl, hostOf, type Affected } from './affected';
import { removedOnly } from './entityCounts';

/**
 * "Why this action?" and "Goal" written from the action's own data (AC-003):
 * which prompts or pages, on which platforms, between which days, and what
 * counts as done by when. "Citations you held consistently are gone." names
 * nothing; "7 prompts in AI Rank Tracker lost their citations to acme.com on
 * ChatGPT and Gemini between Oct 2 and Oct 9." does.
 *
 * Sentences follow the evidence rather than the action's kind: sixty-six
 * kinds rest on a handful of situations (a citation lost, a gap, a
 * competitor ahead, traffic falling, an audit finding), each told by a
 * family of sentences in actionsPage.drawer.story.
 */

export type StoryFamily =
  | 'citationLoss'
  | 'citationGap'
  | 'citationGain'
  | 'visibilityLoss'
  | 'visibilityGap'
  | 'visibilityGain'
  | 'mentionLoss'
  | 'mentionGap'
  | 'competitorBehind'
  | 'competitorAhead'
  | 'trafficLoss'
  | 'trafficGap'
  | 'trafficGain'
  | 'searchLoss'
  | 'searchGap'
  | 'technicalIssue'
  /** AI visitors landing on pages that don't exist (AT-012, AT-013). */
  | 'brokenLinks'
  /** Cited pages no AI search bot read in 30 days (AT-011, AT-013). */
  | 'uncrawledPages';

type Translator = (key: string, values?: Record<string, string | number>) => string;

export interface StoryFormat {
  /** "Oct 9", in the reader's language. */
  day: (date: Date) => string;
  /** "ChatGPT, Gemini, and AIO", in the reader's language. */
  list: (items: string[]) => string;
}

/** Share of the affected items the goal asks back (5 of 7). */
export const GOAL_SHARE = 0.7;
/** Days to the goal when the action has no due date. */
export const GOAL_DAYS = 30;
/** Names listed before "and n more". */
const LIST_MAX = 3;

/** Families whose goal is to keep what is there, or to fix every finding. */
const ALL_OF_THEM: readonly StoryFamily[] = [
  'citationGain',
  'visibilityGain',
  'competitorAhead',
  'trafficGain',
  'technicalIssue',
  'brokenLinks',
  'uncrawledPages',
];

/** Families told about pages first; the rest about prompts first. */
const PAGE_FIRST: readonly StoryFamily[] = [
  'trafficLoss',
  'trafficGap',
  'trafficGain',
  'searchLoss',
  'searchGap',
  'technicalIssue',
  'brokenLinks',
  'uncrawledPages',
];

/** Brand-wide rates, in percent, whose before and after the sentence can quote. */
const RATE_KINDS = ['sharp_drop', 'visibility_slipping'];

/** The situation one signal describes. */
export function storyFamily(signal: Pick<Signal, 'category' | 'kind'>): StoryFamily {
  // Technical, but found on the AI Traffic page, not by Site Audit.
  if (signal.kind === 'broken_citation_target') return 'brokenLinks';
  if (signal.kind === 'cited_page_uncrawled') return 'uncrawledPages';
  const meta = isSignalKind(signal.kind) ? SIGNAL_KINDS[signal.kind] : null;
  const state = meta?.stateKey ?? 'gap';
  const group = meta?.positive
    ? 'gain'
    : state === 'issue'
      ? 'issue'
      : state === 'lost' || state === 'dropped' || state === 'slipping'
        ? 'loss'
        : 'gap';

  switch (signal.category) {
    case 'citation':
      return group === 'gain' ? 'citationGain' : group === 'loss' ? 'citationLoss' : 'citationGap';
    case 'mention':
      return group === 'gain' ? 'visibilityGain' : group === 'loss' ? 'mentionLoss' : 'mentionGap';
    case 'competitor':
      return group === 'gain' ? 'competitorAhead' : 'competitorBehind';
    case 'traffic':
      // Search Console findings are about Google search, not AI visits.
      if (signal.kind.startsWith('gsc_')) return group === 'loss' ? 'searchLoss' : 'searchGap';
      return group === 'gain' ? 'trafficGain' : group === 'loss' ? 'trafficLoss' : 'trafficGap';
    case 'technical':
      return 'technicalIssue';
    default:
      return group === 'gain'
        ? 'visibilityGain'
        : group === 'loss'
          ? 'visibilityLoss'
          : 'visibilityGap';
  }
}

/** The family most of the signals share; on a tie, the first signal's. */
function leadFamily(signals: Signal[]): StoryFamily {
  const counts = new Map<StoryFamily, number>();
  for (const signal of signals) {
    const family = storyFamily(signal);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  let lead = storyFamily(signals[0]);
  for (const [family, count] of counts) if (count > counts.get(lead)!) lead = family;
  return lead;
}

interface Subject {
  entity: 'prompts' | 'pages' | 'topics';
  count: number;
  /** The one item's name, when there is only one. */
  label: string | null;
}

/**
 * What the sentence is about: the prompts, the pages or the topics. A group
 * that counts its prompts without naming them still gives the sentence its
 * number, though the Affected list has no rows for it.
 */
function subjectOf(affected: Affected, family: StoryFamily, signals: Signal[]): Subject | null {
  const unnamed = Math.max(
    0,
    ...signals.map((signal) => {
      const value = signalWhereValue(signal, 'prompts');
      return value?.type === 'prompts' && value.items.length === 0 ? value.total : 0;
    }),
  );
  const prompts: Subject | null =
    affected.promptTotal > 0
      ? {
          entity: 'prompts',
          count: affected.promptTotal,
          label: affected.promptTotal === 1 ? (affected.prompts[0]?.text ?? null) : null,
        }
      : unnamed > 0
        ? { entity: 'prompts', count: unnamed, label: null }
        : null;
  // A page by its address without the scheme: a third-party page keeps its site.
  const pages: Subject | null =
    affected.pageTotal > 0
      ? {
          entity: 'pages',
          count: affected.pageTotal,
          label: affected.pageTotal === 1 ? bareUrl(affected.pages[0]?.url ?? '') || null : null,
        }
      : null;
  const topics: Subject | null =
    affected.topics.length > 0
      ? {
          entity: 'topics',
          count: affected.topics.length,
          label: affected.topics.length === 1 ? affected.topics[0] : null,
        }
      : null;
  return PAGE_FIRST.includes(family) ? (pages ?? prompts ?? topics) : (prompts ?? pages ?? topics);
}

/** "a, b, c and 2 more". */
function listOf(items: string[], t: Translator, format: StoryFormat): string {
  const shown = items.slice(0, LIST_MAX);
  const rest = items.length - shown.length;
  return format.list(rest > 0 ? [...shown, t('more', { count: rest })] : shown);
}

/** A calendar date ("2026-11-09") as that day where the reader is. */
function calendarDay(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  // Noon, not midnight: the same day wherever it is written out — the
  // reader's zone in the drawer, UTC in the API's export (AC-005).
  return new Date(year, month - 1, day, 12);
}

export interface ActionStory {
  family: StoryFamily;
  why: string;
  goal: string;
}

/**
 * The action's Why and Goal from its signals and what they affect. Null for
 * an action no signal supports (one a person sent): it carries its own.
 */
export function actionStory(
  {
    signals,
    volumes,
    createdAt,
    dueDate,
    payload = {},
  }: {
    /** The signals the Affected list was built from. */
    signals: Signal[];
    /** Estimated monthly AI searches per prompt id, when read (PROMPT-013). */
    volumes: Map<string, VolumeEstimate> | null;
    createdAt: string;
    dueDate: string | null;
    /** The action as it reads now (AC-009): what was removed since isn't told. */
    payload?: Record<string, unknown>;
  },
  t: Translator,
  format: StoryFormat,
): ActionStory | null {
  if (signals.length === 0) return null;
  const family = leadFamily(signals);
  // Told from the lead family's signals alone, so the counts match the verb:
  // a competitor's prompts are not "lost citations".
  const mine = signals.filter((signal) => storyFamily(signal) === family);
  const affected = affectedOf(mine, removedOnly(payload));
  const subject = subjectOf(affected, family, mine);

  // The subject: "7 prompts in AI Rank Tracker (28–42k AI searches a month, estimated)".
  // The goal names the same items without their demand.
  let named = '';
  let demand = '';
  if (subject?.entity === 'topics') {
    named = subject.label
      ? t('subject.topic', { label: subject.label })
      : t('subject.topics', { count: subject.count });
  } else if (subject) {
    named = subject.label
      ? t(subject.entity === 'prompts' ? 'subject.prompt' : 'subject.page', {
          label: subject.label,
        })
      : t(`subject.${subject.entity}`, { count: subject.count });
  }
  if (subject?.entity === 'prompts') {
    // "in AI Rank Tracker" only when every signal is about that one topic, or
    // when the prompts are a topic's, counted rather than named.
    const first = mine[0].where.topics;
    const shared =
      first.length === 1 &&
      mine.every(
        (signal) => signal.where.topics.length === 1 && signal.where.topics[0] === first[0],
      )
        ? first[0]
        : null;
    const topic =
      shared ??
      (affected.prompts.length === 0 && affected.topics.length === 1 ? affected.topics[0] : null);
    if (topic) named += t('subject.inTopic', { topic });
    // Only when every prompt is listed: a sum over the first 50 would undercount.
    if (volumes && affected.prompts.length === affected.promptTotal) {
      // An estimate, so a range: the prompts' lows to their highs.
      const total = sumEstimates(
        affected.prompts.flatMap((row) => {
          const estimate = row.id ? volumes.get(row.id) : undefined;
          return estimate ? [estimate] : [];
        }),
      );
      if (total.value > 0) demand = t('subject.volume', { volume: formatEstimateRange(total) });
    }
  }

  // Where: the engines, and the brand's domain for a lost citation.
  const platforms = [...new Set(affected.platforms.map(platformName))];
  const platformsText =
    platforms.length > 0 ? t('platforms', { list: listOf(platforms, t, format) }) : '';
  const domains = [
    ...new Set(affected.lostPages.map(hostOf).filter((host): host is string => !!host)),
  ];
  const domainText = domains.length === 1 ? t('domain', { domain: domains[0] }) : '';

  // When: the days these signals were raised. Not when they were last seen:
  // a lasting finding is seen again every night.
  const times = mine.map((signal) => new Date(signal.detectedAt).getTime()).filter(Number.isFinite);
  let whenText = '';
  if (times.length > 0) {
    const from = format.day(new Date(Math.min(...times)));
    const to = format.day(new Date(Math.max(...times)));
    whenText = from === to ? t('when.day', { day: from }) : t('when.range', { from, to });
  }

  // How much: a brand-wide rate, or the pages' AI visits.
  let fromText = '';
  let rateFrom = '';
  const rate = mine.length === 1 && RATE_KINDS.includes(mine[0].kind) ? mine[0] : null;
  if (rate && rate.previousValue !== null && rate.currentValue !== null) {
    rateFrom = String(rate.previousValue);
    fromText = t('fromToRate', { from: rate.previousValue, to: rate.currentValue });
  }
  const visits = affected.pages.length > 0 && affected.pages.length === affected.pageTotal;
  const counted = visits && affected.pages.every((p) => p.sessions !== null && p.before !== null);
  const before = counted ? affected.pages.reduce((sum, p) => sum + (p.before ?? 0), 0) : null;
  const now = counted ? affected.pages.reduce((sum, p) => sum + (p.sessions ?? 0), 0) : null;
  if (!rate && before !== null && now !== null && family.startsWith('traffic')) {
    fromText = t('fromToVisits', { before, now });
  }

  const competitors = affected.competitors;
  const competitorText =
    competitors.length > 0 ? listOf(competitors, t, format) : t('competitorUnnamed');
  const issues = [...new Set(affected.pages.flatMap((page) => page.issues))];
  const issuesText = issues.length > 0 ? t('issues', { list: listOf(issues, t, format) }) : '';

  // The goal: how many back, by when.
  const target = ALL_OF_THEM.includes(family)
    ? (subject?.count ?? 0)
    : Math.ceil((subject?.count ?? 0) * GOAL_SHARE);
  let scopeText = '';
  if (subject) {
    if (subject.count === 1 || subject.entity === 'topics') {
      scopeText = named;
    } else {
      const noun = t(`noun.${subject.entity}`, { count: subject.count });
      scopeText =
        target >= subject.count
          ? t('scope.all', { count: subject.count, noun })
          : t('scope.some', { target, count: subject.count, noun });
    }
  }
  const goalDate = dueDate
    ? calendarDay(dueDate)
    : new Date(new Date(createdAt).getTime() + GOAL_DAYS * 86_400_000);

  const values = {
    subject: named + demand,
    // Verb agreement: topics read as "prompts in …", plural.
    count: subject ? (subject.entity === 'topics' ? 2 : subject.count) : 0,
    entity: subject?.entity ?? 'prompts',
    domain: domainText,
    platforms: platformsText,
    when: whenText,
    fromTo: fromText,
    competitor: competitorText,
    named: competitors.length > 0 ? 'yes' : 'no',
    competitors: Math.max(1, competitors.length),
    issues: issuesText,
    scope: scopeText,
    date: format.day(goalDate),
    hasFrom: rateFrom ? 'yes' : 'no',
    from: rateFrom,
    hasVisits: before !== null && now !== null ? 'yes' : 'no',
    before: before ?? 0,
    now: now ?? 0,
  };
  const key = subject ? family : `${family}All`;
  return { family, why: t(`why.${key}`, values), goal: t(`goal.${key}`, values) };
}
