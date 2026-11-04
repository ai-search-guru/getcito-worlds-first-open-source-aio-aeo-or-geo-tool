import { describe, expect, it } from 'vitest';
import {
  MERGED_KEPT,
  answersSameQuestion,
  findSameQuestion,
  mergeOpportunity,
  mergeQueries,
  planSameQuestionMerges,
  questionKey,
} from './opportunitySameQuestion.js';

// One open opportunity per question. The pair below is the dev database's:
// two open opportunities for "What are the best coffee subscription services
// in 2026?", whose baskets overlap 0.15–0.50, under the 0.6 basket threshold.

const QUESTION = 'What are the best coffee subscription services in 2026?';

const row = (over = {}) => ({
  id: 'o1',
  brand_id: 'b1',
  title: 'Defend the coffee subscription comparison',
  status: 'new',
  source: 'system',
  created_at: '2026-10-11T00:00:00Z',
  prompt_id: 'p1',
  cluster_id: 'c1',
  related_cluster_ids: [],
  opportunity_score: 60,
  impact: 'medium',
  source_data: {
    promptText: QUESTION,
    prompts: [
      QUESTION,
      'Which specialty coffee subscriptions ship internationally?',
      'Best monthly coffee bean subscription for offices',
    ],
    estAiVolume: 4973,
    visibilityScore: 34,
    scoreComponents: { demand: 61, visibilityGap: 66, competitorGap: 28, intent: 80 },
    queries: {
      included: 2,
      excluded: 1,
      top: [{ query: 'best coffee subscription', timesSearched: 4 }],
    },
    keywords: ['best coffee subscription'],
  },
  ...over,
});

const second = (over = {}) =>
  row({
    id: 'o2',
    title: 'Expand the coffee subscription guide into a 2026 ranking',
    created_at: '2026-10-13T00:00:00Z',
    cluster_id: 'c2',
    opportunity_score: 72,
    source_data: {
      promptText: QUESTION,
      prompts: [QUESTION, 'Best single-origin coffee subscription services'],
      estAiVolume: 145000,
      visibilityScore: 20,
      scoreComponents: { demand: 86, visibilityGap: 80, competitorGap: 30, intent: 80 },
      queries: {
        included: 3,
        excluded: 0,
        top: [
          { query: 'best coffee subscription', timesSearched: 2 },
          { query: 'coffee subscription reddit', timesSearched: 5 },
        ],
      },
      keywords: ['coffee subscription services'],
    },
    ...over,
  });

describe('questionKey', () => {
  it('ignores case, punctuation, years and extra spaces', () => {
    expect(questionKey(QUESTION)).toBe('what are the best coffee subscription services in');
    expect(questionKey('what are the BEST coffee subscription services in 2025')).toBe(
      questionKey(QUESTION),
    );
    expect(questionKey('Best coffee subscriptions (2025-2026)')).toBe('best coffee subscriptions');
    expect(questionKey('Best coffee subscriptions for 3 people')).not.toBe(
      questionKey('Best coffee subscriptions for 4 people'),
    );
    expect(questionKey(null)).toBe('');
  });
});

describe('answersSameQuestion', () => {
  it('matches the same question in other words of a year, its prompt and a shared cluster', () => {
    const other = second();
    expect(
      answersSameQuestion(
        { question: 'What are the best coffee subscription services in 2027' },
        other,
      ),
    ).toBe(true);
    expect(answersSameQuestion({ question: 'Other', promptId: 'p1' }, other)).toBe(true);
    expect(answersSameQuestion({ question: 'Other', clusterIds: ['c2'] }, other)).toBe(true);
    expect(
      answersSameQuestion(
        { question: 'Other', clusterIds: ['c3'] },
        second({ related_cluster_ids: ['c3'] }),
      ),
    ).toBe(true);
  });

  it('never matches an "Another angle" opportunity', () => {
    const angle = second({
      source_data: { ...second().source_data, alternativeOf: { id: 'o1', title: 'Original' } },
    });
    expect(
      answersSameQuestion({ question: QUESTION, promptId: 'p1', clusterIds: ['c2'] }, angle),
    ).toBe(false);
    expect(findSameQuestion({ question: QUESTION }, [angle])).toBe(null);
  });

  it("doesn't match a different question in another cluster", () => {
    expect(
      answersSameQuestion(
        { question: 'Best espresso machines under $500?', promptId: 'p9', clusterIds: ['c9'] },
        second(),
      ),
    ).toBe(false);
    // An opportunity without a question (a task about several prompts) matches only by cluster.
    expect(
      answersSameQuestion({ question: QUESTION }, second({ source_data: {}, prompt_id: null })),
    ).toBe(false);
  });
});

describe('findSameQuestion', () => {
  it('only takes an open opportunity, the one furthest along first', () => {
    const candidate = { question: QUESTION };
    expect(
      findSameQuestion(candidate, [row({ status: 'done' }), row({ status: 'dismissed' })]),
    ).toBe(null);
    expect(findSameQuestion(candidate, [row(), second({ status: 'in_progress' })]).id).toBe('o2');
    // Then the one with work on it, then the higher score.
    expect(findSameQuestion(candidate, [row(), second()], { withDrafts: new Set(['o1']) }).id).toBe(
      'o1',
    );
    expect(findSameQuestion(candidate, [row(), second()]).id).toBe('o2');
  });
});

describe('mergeOpportunity', () => {
  it('joins prompts, AI searches and sources, keeps the stronger signal and records the merge', () => {
    const update = mergeOpportunity(
      row(),
      second(),
      { source: 'system', opportunityId: 'o2' },
      '2026-10-31T00:00:00Z',
    );
    expect(update.source_data.prompts).toEqual([
      QUESTION,
      'Which specialty coffee subscriptions ship internationally?',
      'Best monthly coffee bean subscription for offices',
      'Best single-origin coffee subscription services',
    ]);
    expect(update.source_data.queries.top).toEqual([
      { query: 'best coffee subscription', timesSearched: 6 },
      { query: 'coffee subscription reddit', timesSearched: 5 },
    ]);
    expect(update.source_data.keywords).toEqual([
      'best coffee subscription',
      'coffee subscription services',
    ]);
    // The stronger signal: the second scored higher.
    expect(update).toMatchObject({ opportunity_score: 72, related_cluster_ids: ['c2'] });
    expect(update.source_data).toMatchObject({ estAiVolume: 145000, visibilityScore: 20 });
    expect(update.source_data.merged).toEqual([
      { source: 'system', opportunityId: 'o2', at: '2026-10-31T00:00:00Z' },
    ]);
    // What the target is stays: its question and its text.
    expect(update.source_data.promptText).toBe(QUESTION);
  });

  it('keeps its own signal and score when what joins has none, and its results in view', () => {
    const update = mergeOpportunity(
      row(),
      {
        opportunity_score: 90,
        impact: 'high',
        source_data: { promptText: QUESTION, actions: { all: 'a7' } },
      },
      { source: 'action', taskId: 't1' },
    );
    // The score stays with the signal its breakdown shows; the impact is the higher.
    expect(update).toMatchObject({ opportunity_score: 60, impact: 'high' });
    expect(update.source_data.estAiVolume).toBe(4973);
    expect(update.source_data.pastActions).toEqual(['a7']);
  });

  it('keeps the latest merges only', () => {
    let current = row();
    for (let i = 0; i < MERGED_KEPT + 3; i += 1) {
      current = { ...current, ...mergeOpportunity(current, {}, { source: 'manual', n: i }) };
    }
    expect(current.source_data.merged).toHaveLength(MERGED_KEPT);
    expect(current.source_data.merged.at(-1).n).toBe(MERGED_KEPT + 2);
  });

  it('counts the AI searches of a cluster both hold once', () => {
    // The kept one holds c2 already (merged before); the duplicate on c2 carries c2's basket again.
    const update = mergeOpportunity(row({ related_cluster_ids: ['c2'] }), second(), {
      source: 'system',
      opportunityId: 'o2',
    });
    expect(update.source_data.queries.top).toEqual([
      { query: 'coffee subscription reddit', timesSearched: 5 },
      { query: 'best coffee subscription', timesSearched: 4 },
    ]);
  });

  it('adds up AI searches by query', () => {
    expect(mergeQueries(undefined, undefined)).toBeUndefined();
    expect(mergeQueries({ top: [{ query: 'a', timesSearched: 1 }] }, null)).toEqual({
      included: 1,
      excluded: 0,
      top: [{ query: 'a', timesSearched: 1 }],
    });
  });
});

describe('planSameQuestionMerges', () => {
  it("merges the dev database's pair into the one with the draft, and leaves the rest", () => {
    const plans = planSameQuestionMerges(
      [
        row(),
        second(),
        row({ id: 'o3', status: 'archived' }),
        row({
          id: 'o4',
          prompt_id: 'p4',
          cluster_id: 'c4',
          source_data: { promptText: 'Best espresso machines under $500?' },
        }),
      ],
      { withDrafts: new Set(['o1']), at: '2026-10-31T00:00:00Z' },
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].keep.id).toBe('o1');
    expect(plans[0].merge.map((r) => r.id)).toEqual(['o2']);
    expect(plans[0].update.related_cluster_ids).toEqual(['c2']);
    expect(plans[0].update.source_data.merged).toEqual([
      expect.objectContaining({ opportunityId: 'o2', title: second().title }),
    ]);
  });

  it('groups by the prompt when its words changed, and leaves questions that only share a cluster today', () => {
    const plans = planSameQuestionMerges([
      row({ source_data: { promptText: 'Coffee subscriptions, edited' } }),
      second(),
      // Another question of the first one's cluster, with an opportunity on an older cluster.
      row({
        id: 'o6',
        prompt_id: 'p6',
        cluster_id: 'c6',
        source_data: { promptText: 'Best monthly coffee bean subscription for offices' },
      }),
    ]);
    expect(plans).toHaveLength(1);
    // Neither has work: the higher score stays.
    expect(plans[0].keep.id).toBe('o2');
    expect(plans[0].merge.map((r) => r.id)).toEqual(['o1']);
  });

  it('leaves an "Another angle" opportunity beside its original', () => {
    const angle = row({
      id: 'o7',
      created_at: '2026-10-20T00:00:00Z',
      source_data: { ...row().source_data, alternativeOf: { id: 'o1', title: 'Original' } },
    });
    expect(planSameQuestionMerges([row(), angle])).toEqual([]);
    const plans = planSameQuestionMerges([row(), second(), angle]);
    expect(plans).toHaveLength(1);
    expect([plans[0].keep, ...plans[0].merge].map((r) => r.id).sort()).toEqual(['o1', 'o2']);
  });

  it('counts the searches of one cluster once when two rows on it merge', () => {
    // Both made from cluster c1, so both baskets are c1's.
    const basket = {
      included: 1,
      excluded: 0,
      top: [{ query: 'best coffee subscription', timesSearched: 4 }],
    };
    const plans = planSameQuestionMerges([
      row({ source_data: { ...row().source_data, queries: basket } }),
      row({
        id: 'o8',
        prompt_id: 'p8',
        created_at: '2026-10-20T00:00:00Z',
        opportunity_score: 10,
        source_data: { promptText: 'Coffee subscriptions, reworded', queries: basket },
      }),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0].update.source_data.queries.top).toEqual([
      { query: 'best coffee subscription', timesSearched: 4 },
    ]);
  });

  it('chains three on one question into one group', () => {
    const plans = planSameQuestionMerges([
      row(),
      second(),
      row({
        id: 'o5',
        cluster_id: 'c5',
        created_at: '2026-10-20T00:00:00Z',
        opportunity_score: 10,
      }),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0].merge.map((r) => r.id).sort()).toEqual(['o1', 'o5']);
  });
});
