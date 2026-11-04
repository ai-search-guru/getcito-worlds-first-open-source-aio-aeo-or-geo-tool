import { describe, expect, it } from 'vitest';
import type { TopicCompetitors } from './insightsTopics';
import {
  contentLeft,
  gapWeight,
  opportunities,
  RELEVANCE_THRESHOLD,
  secondaryBlock,
  topicStandings,
  type Opportunity,
  type OpportunityStanding,
  type OpportunitySuggestion,
} from './insightsOpportunities';

const suggestion = (
  id: string,
  over: Partial<OpportunitySuggestion> = {},
): OpportunitySuggestion => ({
  id,
  text: `prompt ${id}`,
  topicId: null,
  topicName: null,
  estVolume: 1000,
  relevance: 0.8,
  ...over,
});

const unknown = (): OpportunityStanding => ({ kind: 'unknown' });

const comps = (mentions: number) => ({
  mentionAnswers: mentions,
  citationAnswers: 0,
  sumInvPosition: 0,
  positionCount: 0,
});

const topic = (
  topicId: string,
  answers: number,
  you: number,
  competitors: Record<string, number>,
): TopicCompetitors => ({
  topicId,
  name: topicId,
  prompts: 3,
  answers,
  brand: comps(you),
  competitors: Object.fromEntries(Object.entries(competitors).map(([id, m]) => [id, comps(m)])),
});

describe('opportunities', () => {
  it('groups suggestions sharing a topic into one item, a lone one stays a prompt', () => {
    const result = opportunities(
      [
        suggestion('a', { topicId: 't1', topicName: 'GEO tools', estVolume: 30_000 }),
        suggestion('b', { topicId: 't1', topicName: 'GEO tools', estVolume: 62_000 }),
        suggestion('c', { topicId: 't2', topicName: 'Pricing', estVolume: 38_400 }),
      ],
      unknown,
    );

    expect(result).toEqual({
      status: 'ready',
      items: [
        expect.objectContaining({
          kind: 'topic',
          title: 'GEO tools',
          volume: 92_000,
          // Track adds the biggest first, so a plan that fills up keeps those.
          suggestionIds: ['b', 'a'],
        }),
        expect.objectContaining({
          kind: 'prompt',
          title: 'prompt c',
          volume: 38_400,
          suggestionIds: ['c'],
        }),
      ],
    });
  });

  it('never lists a suggestion under the relevance threshold', () => {
    const result = opportunities(
      [
        suggestion('a', { topicId: 't1', topicName: 'GEO tools', relevance: 0.9 }),
        suggestion('b', { topicId: 't1', topicName: 'GEO tools', relevance: 0.5 }),
        suggestion('c', { relevance: RELEVANCE_THRESHOLD }),
        suggestion('d', { relevance: 0.59 }),
      ],
      unknown,
    );

    // 'b' doesn't count toward its topic, so 'a' is a prompt on its own.
    expect(result.status === 'ready' && result.items.map((i) => [i.kind, i.suggestionIds])).toEqual(
      [
        ['prompt', ['a']],
        ['prompt', ['c']],
      ],
    );
  });

  it('ranks by relevance × demand × gap', () => {
    const standings: Record<string, OpportunityStanding> = {
      behind: { kind: 'competitor', name: 'Peec AI', score: 44, gap: 30 },
      lead: { kind: 'you' },
    };
    const result = opportunities(
      [
        // 0.8 × 10k × 1.3 = 10.4k
        suggestion('behind', { topicId: 'behind', estVolume: 10_000 }),
        // 0.8 × 12k = 9.6k
        suggestion('plain', { topicId: 'plain', estVolume: 12_000 }),
        // 0.8 × 20k × 0.5 = 8k
        suggestion('lead', { topicId: 'lead', estVolume: 20_000 }),
        // 1.0 × 9k = 9k
        suggestion('apt', { topicId: 'apt', estVolume: 9_000, relevance: 1 }),
      ],
      (id) => standings[id ?? ''] ?? { kind: 'unknown' },
    );

    expect(result.status === 'ready' && result.items.map((i) => i.key)).toEqual([
      'behind',
      'plain',
      'apt',
      'lead',
    ]);
  });

  it('tells apart no suggestions, unrated ones and none relevant', () => {
    expect(opportunities([], unknown)).toEqual({ status: 'empty' });
    expect(opportunities([suggestion('a', { relevance: null })], unknown)).toEqual({
      status: 'unrated',
    });
    expect(opportunities([suggestion('a', { relevance: 0.3 })], unknown)).toEqual({
      status: 'noneRelevant',
    });
  });

  it('has no volume when no suggestion has an estimate, never 0 (VIS-005)', () => {
    const result = opportunities([suggestion('a', { estVolume: null })], unknown);
    expect(result.status === 'ready' && result.items[0].volume).toBeNull();
  });

  it('groups by topic name when a suggestion has no topic id', () => {
    const result = opportunities(
      [suggestion('a', { topicName: 'GEO tools' }), suggestion('b', { topicName: 'geo tools ' })],
      unknown,
    );
    expect(result.status === 'ready' && result.items).toEqual([
      expect.objectContaining({ kind: 'topic', title: 'GEO tools', topicId: null }),
    ]);
  });
});

describe('topicStandings', () => {
  const names = { c1: 'Peec AI' };

  it('reads the leader over every competitor, not only the trend’s', () => {
    // 0.6 × 20% = 12.0 for you, 0.6 × 60% = 36.0 for Peec AI.
    const standingOf = topicStandings([topic('t1', 100, 20, { c1: 60 })], names, new Set(['t1']));
    expect(standingOf('t1')).toEqual({ kind: 'competitor', name: 'Peec AI', score: 36, gap: 24 });
  });

  it('knows when you lead', () => {
    const standingOf = topicStandings([topic('t1', 100, 60, { c1: 20 })], names, new Set(['t1']));
    expect(standingOf('t1')).toEqual({ kind: 'you' });
  });

  it('leaves the leader unnamed when the name is not known', () => {
    const standingOf = topicStandings([topic('t1', 100, 20, { c9: 60 })], names, new Set(['t1']));
    expect(standingOf('t1')).toMatchObject({ kind: 'competitor', name: null, score: 36 });
  });

  it('calls a topic with no tracked prompts not tracked', () => {
    const standingOf = topicStandings([], names, new Set());
    expect(standingOf('new-topic')).toEqual({ kind: 'notTracked' });
  });

  it('does not guess for a tracked topic with too few answers or no map', () => {
    expect(topicStandings([topic('t1', 12, 1, { c1: 9 })], names, new Set(['t1']))('t1')).toEqual({
      kind: 'unknown',
    });
    expect(topicStandings(null, names, new Set(['t1']))('t1')).toEqual({ kind: 'unknown' });
    expect(topicStandings(null, names, new Set())(null)).toEqual({ kind: 'unknown' });
  });

  it('calls nothing untracked when which topics you track is unknown', () => {
    expect(topicStandings([], names, null)('new-topic')).toEqual({ kind: 'unknown' });
  });
});

describe('gapWeight', () => {
  it('weighs a competitor’s lead up, yours down', () => {
    expect(gapWeight({ kind: 'competitor', name: null, score: 44, gap: 25 })).toBe(1.25);
    expect(gapWeight({ kind: 'you' })).toBe(0.5);
    expect(gapWeight({ kind: 'notTracked' })).toBe(1);
  });
});

describe('contentLeft', () => {
  it('takes what this page wrote off the month’s remaining suggestions', () => {
    expect(contentLeft({ limit: 10, remaining: 3 }, 1)).toBe(2);
  });

  it('is null without a monthly limit or a quota read', () => {
    expect(contentLeft({ limit: -1, remaining: 0 }, 4)).toBeNull();
    expect(contentLeft(null, 0)).toBeNull();
  });
});

describe('secondaryBlock', () => {
  const item = (over: Partial<Opportunity>): Opportunity => ({
    kind: 'prompt',
    key: 'k',
    title: 'prompt',
    topicId: 't1',
    suggestionIds: ['s1'],
    volume: 1000,
    standing: { kind: 'unknown' },
    ...over,
  });

  it('sends a topic once it is saved', () => {
    expect(secondaryBlock(item({ kind: 'topic' }), 0)).toBeNull();
    expect(secondaryBlock(item({ kind: 'topic', topicId: null }), null)).toBe('needsTopic');
  });

  it('writes content only for a topic you track, within the month’s quota', () => {
    expect(secondaryBlock(item({}), 2)).toBeNull();
    expect(secondaryBlock(item({}), null)).toBeNull();
    expect(secondaryBlock(item({ standing: { kind: 'notTracked' } }), 2)).toBe('trackFirst');
    expect(secondaryBlock(item({ topicId: null }), 2)).toBe('trackFirst');
    expect(secondaryBlock(item({}), 0)).toBe('contentLimit');
  });
});
