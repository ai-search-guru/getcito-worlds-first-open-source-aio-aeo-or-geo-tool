import { describe, expect, it } from 'vitest';
import type { PromptResultWithText } from '@/lib/actions/tracking';
import { groupByPlatform } from './grouping';

function result(overrides: Partial<PromptResultWithText>): PromptResultWithText {
  return {
    id: 'result-id',
    promptId: 'prompt-id',
    brandId: 'brand-id',
    platform: 'chatgpt-web',
    response: 'response text',
    citations: [],
    mentionCount: 0,
    citationCount: 0,
    sentiment: 'neutral',
    visibilityScore: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    promptText: 'Where should I buy running shoes?',
    ...overrides,
  };
}

describe('groupByPlatform', () => {
  it('keeps model slug drift in one platform group and uses latest metadata', () => {
    const groups = groupByPlatform([
      result({
        id: 'older-run',
        modelUsed: 'gpt-5-5',
        region: 'US',
        mentionCount: 1,
        citationCount: 2,
        visibilityScore: 40,
        createdAt: '2026-06-01T00:00:00.000Z',
      }),
      result({
        id: 'latest-run',
        modelUsed: 'gpt-5-3-mini',
        region: 'CA',
        mentionCount: 3,
        citationCount: 4,
        visibilityScore: 80,
        createdAt: '2026-06-02T00:00:00.000Z',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'chatgpt-web',
      platform: 'chatgpt-web',
      modelUsed: 'gpt-5-3-mini',
      region: 'CA',
      avgScore: 60,
      totalMentions: 4,
      totalCitations: 6,
    });
    expect(groups[0].results.map((r) => r.id)).toEqual(['latest-run', 'older-run']);
  });

  it('keeps genuinely distinct platforms separate even when model slugs match', () => {
    const groups = groupByPlatform([
      result({
        id: 'chatgpt-run',
        platform: 'chatgpt-web',
        modelUsed: 'gpt-5-3-mini',
        visibilityScore: 70,
      }),
      result({
        id: 'grok-run',
        platform: 'grok-web',
        modelUsed: 'gpt-5-3-mini',
        visibilityScore: 65,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.key).sort()).toEqual(['chatgpt-web', 'grok-web']);
  });
});
