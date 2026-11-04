import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

const { NO_TOPIC, needAvailability } = await import('./opportunityAvailability.js');

const clusters = [
  { id: 'c1', topic_id: 't1', prompt_ids: ['p1', 'p2'] },
  { id: 'c2', topic_id: 't1', prompt_ids: ['p3'] },
  { id: 'c3', topic_id: 't1', prompt_ids: ['p4'] },
  { id: 'c4', topic_id: 't2', prompt_ids: ['p5'] },
  { id: 'c5', topic_id: null, prompt_ids: ['p6'] },
  { id: 'c6', topic_id: 't2', prompt_ids: ['p7'] },
];
const opportunities = [
  { id: 'o1', status: 'new', cluster_id: 'c1', related_cluster_ids: ['c4'] },
  { id: 'o2', status: 'dismissed', cluster_id: 'c2', related_cluster_ids: [] },
];
const testedPromptIds = new Set(['p1', 'p3', 'p4', 'p5', 'p6']);

describe('needAvailability', () => {
  const result = needAvailability({ clusters, opportunities, testedPromptIds });

  it('counts the needs with answers and no opportunity, per topic and in all', () => {
    expect(result).toMatchObject({ needs: 6, open: 2, covered: 3, noAnswers: 1 });
    expect(result.topics).toEqual({
      t1: { open: 1, covered: 2, noAnswers: 0 },
      t2: { open: 0, covered: 1, noAnswers: 1 },
      [NO_TOPIC]: { open: 1, covered: 0, noAnswers: 0 },
    });
  });

  it("names the open opportunity each covered prompt's need has, merged ones too", () => {
    expect(result.promptOpportunity).toEqual({ p1: 'o1', p2: 'o1', p5: 'o1' });
  });

  it("doesn't offer a dismissed opportunity for a prompt", () => {
    expect(result.promptOpportunity.p3).toBeUndefined();
  });

  it('reads an empty brand as nothing to write for', () => {
    expect(
      needAvailability({ clusters: [], opportunities: [], testedPromptIds: new Set() }),
    ).toEqual({
      needs: 0,
      open: 0,
      covered: 0,
      noAnswers: 0,
      topics: {},
      promptOpportunity: {},
    });
  });
});
