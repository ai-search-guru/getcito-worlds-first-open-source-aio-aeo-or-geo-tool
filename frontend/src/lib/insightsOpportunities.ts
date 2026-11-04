import { topicHeatmap, type TopicCompetitors } from '@/lib/insightsTopics';

/**
 * Opportunities (VIS-011), as in the v2 mockup: what to track next, from the
 * stored prompt suggestions. Suggestions sharing a topic make one topic item
 * ("23 prompts · ~186k/mo", Track 23), a lone one a prompt item ("~38.4k/mo
 * · not tracked", Track). Ranked by relevance × demand × gap; a suggestion
 * under the relevance threshold is never listed, and relevance is never shown.
 */

/** Spec v2 decision: fixed, not a per-brand setting. */
export const RELEVANCE_THRESHOLD = 0.6;

export interface OpportunitySuggestion {
  id: string;
  text: string;
  topicId: string | null;
  topicName: string | null;
  estVolume: number | null;
  /** 0–1; null on suggestions generated before they were rated (00138). */
  relevance: number | null;
}

/**
 * Where you stand in an item's topic: a competitor leads it or you do (on
 * 20+ answers, as the heat map reads it), none of your prompts track it yet,
 * or it's tracked but not measured in this view.
 */
export type OpportunityStanding =
  | { kind: 'competitor'; name: string | null; score: number; gap: number }
  | { kind: 'you' }
  | { kind: 'notTracked' }
  | { kind: 'unknown' };

export interface Opportunity {
  kind: 'topic' | 'prompt';
  key: string;
  /** The topic's name, or the prompt's text. */
  title: string;
  topicId: string | null;
  /** What Track adds, highest volume first. */
  suggestionIds: string[];
  /**
   * Monthly AI search volume: the prompt's, or the sum of the topic's; null
   * when none of them has an estimate (shown as nothing, never "~0/mo").
   */
  volume: number | null;
  standing: OpportunityStanding;
}

export type OpportunitiesResult =
  | { status: 'ready'; items: Opportunity[] }
  /** No suggestions stored. */
  | { status: 'empty' }
  /** Stored, but generated before suggestions were rated. */
  | { status: 'unrated' }
  /** Rated, and none clears the threshold. */
  | { status: 'noneRelevant' };

/**
 * Each topic's standing, read from the heat map's data over every live
 * competitor (not only the trend's). `topics` is null where the map isn't
 * loaded (24h, a topic selected, rollups not backfilled): a tracked topic is
 * then 'unknown', never a guess. `trackedTopicIds` is null when which topics
 * you track isn't known: no topic is called untracked then.
 */
export function topicStandings(
  topics: TopicCompetitors[] | null,
  competitorNames: Record<string, string>,
  trackedTopicIds: ReadonlySet<string> | null,
): (topicId: string | null) => OpportunityStanding {
  const ids = [...new Set((topics ?? []).flatMap((t) => Object.keys(t.competitors)))];
  const rows = new Map(
    topics ? topicHeatmap(topics, ['you', ...ids]).map((row) => [row.topicId, row]) : [],
  );

  return (topicId) => {
    if (!topicId) return { kind: 'unknown' };
    const row = rows.get(topicId);
    if (row?.status === 'lead') return { kind: 'you' };
    if (row?.status === 'behind') {
      return {
        kind: 'competitor',
        name: competitorNames[row.leader] ?? null,
        score: Math.max(...row.scores),
        gap: -row.gap!,
      };
    }
    return row || !trackedTopicIds || trackedTopicIds.has(topicId)
      ? { kind: 'unknown' }
      : { kind: 'notTracked' };
  };
}

/**
 * The gap in "relevance × demand × gap": a topic a competitor leads weighs
 * more the further ahead they are (a 25-point lead is 1.25×), one you lead
 * weighs half, and one not measured as is.
 */
export function gapWeight(standing: OpportunityStanding): number {
  if (standing.kind === 'competitor') return 1 + standing.gap / 100;
  if (standing.kind === 'you') return 0.5;
  return 1;
}

const groupKey = (s: OpportunitySuggestion) =>
  s.topicId ?? (s.topicName?.trim() ? `name:${s.topicName.trim().toLowerCase()}` : `id:${s.id}`);

/** The card's items, best first. */
export function opportunities(
  suggestions: OpportunitySuggestion[],
  standingOf: (topicId: string | null) => OpportunityStanding,
): OpportunitiesResult {
  if (suggestions.length === 0) return { status: 'empty' };
  const rated = suggestions.filter((s) => s.relevance !== null);
  if (rated.length === 0) return { status: 'unrated' };
  const relevant = rated.filter((s) => s.relevance! >= RELEVANCE_THRESHOLD);
  if (relevant.length === 0) return { status: 'noneRelevant' };

  const groups = new Map<string, OpportunitySuggestion[]>();
  for (const s of relevant) {
    const key = groupKey(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const ranked = [...groups].map(([key, members]) => {
    const sorted = [...members].sort((a, b) => (b.estVolume ?? 0) - (a.estVolume ?? 0));
    const topicId = sorted[0].topicId;
    const isTopic = sorted.length > 1;
    const standing = standingOf(topicId);
    const estimated = sorted.filter((s) => s.estVolume !== null);
    const volume =
      estimated.length > 0 ? estimated.reduce((sum, s) => sum + s.estVolume!, 0) : null;
    const relevance = sorted.reduce((sum, s) => sum + s.relevance!, 0) / sorted.length;
    const item: Opportunity = {
      kind: isTopic ? 'topic' : 'prompt',
      key,
      title: isTopic ? (sorted.find((s) => s.topicName)?.topicName ?? '') : sorted[0].text,
      topicId,
      suggestionIds: sorted.map((s) => s.id),
      volume,
      standing,
    };
    return { item, relevance, rank: relevance * (volume ?? 0) * gapWeight(standing) };
  });

  ranked.sort(
    (a, b) =>
      b.rank - a.rank || b.relevance - a.relevance || a.item.title.localeCompare(b.item.title),
  );
  return { status: 'ready', items: ranked.map((r) => r.item) };
}

/**
 * Content suggestions left this month, less the ones this page has written
 * since it loaded (CONTENT-001). Null when the plan has no monthly limit or
 * the quota couldn't be read: the server still enforces it.
 */
export function contentLeft(
  quota: { limit: number; remaining: number } | null | undefined,
  spent: number,
): number | null {
  if (!quota || quota.limit === -1) return null;
  return quota.remaining - spent;
}

/** Why an item's second button (Send action / Suggest content) is off; null when it can be used. */
export type SecondaryBlock = 'needsTopic' | 'trackFirst' | 'contentLimit' | null;

export function secondaryBlock(item: Opportunity, left: number | null): SecondaryBlock {
  if (item.kind === 'topic') return item.topicId ? null : 'needsTopic';
  // Content is written from the answers of the topic's tracked prompts
  // (the server's opportunity generator), so an untracked topic has none.
  if (!item.topicId || item.standing.kind === 'notTracked') return 'trackFirst';
  return left !== null && left <= 0 ? 'contentLimit' : null;
}
