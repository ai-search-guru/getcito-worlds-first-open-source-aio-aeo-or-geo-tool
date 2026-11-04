import { describe, expect, it } from 'vitest';
import type { ContentOpportunity } from '@/types';
import { DEFAULT_OPPORTUNITY_SORT, OPPORTUNITY_SORTS, opportunityScope } from './opportunityList';

const opp = (over: Partial<ContentOpportunity>) =>
  ({ clusterId: null, sourceData: null, ...over }) as ContentOpportunity;

describe('Content Opportunities list', () => {
  it('opens on the newest suggestions, with score and oldest still offered', () => {
    expect(DEFAULT_OPPORTUNITY_SORT).toBe('newest');
    expect(OPPORTUNITY_SORTS).toEqual(['newest', 'score', 'oldest']);
  });

  it('tags a cluster opportunity with its topic and prompt count', () => {
    expect(
      opportunityScope(
        opp({
          clusterId: 'c1',
          sourceData: { topicName: 'Coffee subscriptions', prompts: [{}, {}, {}] },
        } as Partial<ContentOpportunity>),
      ),
    ).toEqual({ kind: 'group', count: 3, topic: 'Coffee subscriptions' });
  });

  it('tags an opportunity without a cluster as a single prompt', () => {
    expect(opportunityScope(opp({}))).toEqual({ kind: 'single' });
  });

  it('keeps a group without a topic or prompts list readable', () => {
    expect(opportunityScope(opp({ clusterId: 'c1' }))).toEqual({
      kind: 'group',
      count: 0,
      topic: null,
    });
  });
});

describe('an opportunity sent from an action task (AC-004)', () => {
  it('reads as from that action, not as a single prompt', () => {
    expect(
      opportunityScope({
        clusterId: null,
        sourceData: { fromAction: { actionId: 'a1', actionNo: 12, taskId: 't1' } },
      }),
    ).toEqual({ kind: 'action', actionNo: 12 });
  });
});
