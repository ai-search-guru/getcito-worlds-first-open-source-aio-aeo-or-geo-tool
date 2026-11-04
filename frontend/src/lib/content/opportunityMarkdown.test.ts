import { describe, expect, it } from 'vitest';
import type { ContentBrief, ContentOpportunity } from '@/types';
import { sumEstimates, keywordVolumeEstimate } from '@/lib/volumeEstimate';
import { opportunityToMarkdown } from './opportunityMarkdown';

const base: ContentOpportunity = {
  id: 'opp-1',
  brandId: 'brand-1',
  clusterId: 'cluster-1',
  decision: 'expand',
  title: 'Compare the top running shoes for flat feet',
  description: 'Shoppers ask engines which shoes suit flat feet.',
  type: 'owned',
  impact: 'high',
  opportunityScore: 86.6,
  status: 'new',
  sourceData: {
    clusterLabel: 'Shoes for flat feet',
    topicName: 'Running shoes',
    estAiVolume: 37320,
    questionVolume: 18660,
    visibilityScore: 0,
    competitorsCited: ['Rival One', 'Rival Two'],
    prompts: ['Best shoes for flat feet?', 'Running shoes for overpronation'],
    queries: { included: 2, excluded: 5, top: [{ query: 'flat feet shoes', timesSearched: 9 }] },
    scoreComponents: { demand: 30, visibilityGap: 25, competitorGap: 20, intent: 11.6 },
    targetPages: [
      {
        url: 'https://example.com/guides/flat-feet',
        title: 'Flat feet guide',
        aiCitations: 0,
        gaSessions: 0,
        lastmod: null,
      },
    ],
    assets: [
      {
        key: 'a1',
        type: 'comparison_page',
        channel: 'owned',
        decision: 'expand',
        title: 'Flat feet shoe comparison',
        pages: [],
      },
    ],
  },
  createdAt: '2026-10-05T08:00:00.000Z',
  updatedAt: '2026-10-05T08:00:00.000Z',
};

const brief: ContentBrief = {
  suggestedTitle: 'The 10 best running shoes for flat feet',
  contentType: 'Comparison',
  targetWordCount: 2200,
  outline: [
    { heading: 'What flat feet need', keyPoints: ['Arch support', 'Stability'] },
    { heading: 'The shoes', keyPoints: [] },
  ],
  targetKeywords: ['flat feet', 'stability shoes'],
  competitorInsights: 'Rivals list shoes without fit advice.',
  callToAction: 'Find your fit',
};

describe('opportunityToMarkdown', () => {
  it('writes the opportunity in page order', () => {
    const md = opportunityToMarkdown(base, brief);

    const order = [
      '# Compare the top running shoes for flat feet',
      '- Score: 87',
      '## Target pages',
      '## Recommended assets',
      '## Score breakdown',
      '## Source data',
      '## Prompts',
      '## Fan-out queries',
      '## Content brief',
      '## Brief outline',
      '## Competitor insights',
    ];
    const positions = order.map((s) => md.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(md).toContain('- Flat feet shoe comparison (Comparison page, Owned, Expand)');
    // No current estimate given: its question's volume kept on it, half to twice.
    expect(md).toContain(
      '- Est. AI volume: 9.3–38k/mo\n- Volume type: Estimate, kept when it was made or last updated\n- Volume confidence: Low\n- Volume of: Its related prompt, one of 2 prompts',
    );
    expect(md).not.toContain('18,660');
    expect(md).toContain('- Visibility: 0%');
    expect(md).toContain('1. What flat feet need\n   - Arch support\n   - Stability\n2. The shoes');
  });

  it("keeps no volume for a group that kept only its prompts' sum", () => {
    const sd = { ...base.sourceData, questionVolume: undefined };
    const md = opportunityToMarkdown({ ...base, sourceData: sd }, brief);
    expect(md).not.toContain('Est. AI volume');
    // A single prompt's sum is that prompt's own.
    const single = opportunityToMarkdown({ ...base, clusterId: null, sourceData: sd }, brief);
    expect(single).toContain('- Est. AI volume: 18–75k/mo');
  });

  it("writes its question's current estimate when the page has it (PROMPT-013)", () => {
    const now = new Date('2026-10-20T00:00:00Z');
    const volume = sumEstimates([
      keywordVolumeEstimate(10000, 0.5, '2026-10-01T00:00:00Z', now),
      keywordVolumeEstimate(6000, 0.5, '2026-10-01T00:00:00Z', now),
    ]);
    const md = opportunityToMarkdown(base, brief, [], undefined, volume);
    expect(md).toContain(
      '- Est. AI volume: 5.9–10.1k/mo\n- Volume type: Estimate\n- Volume confidence: Medium',
    );
  });

  it("names each asset's type as the page does", () => {
    const md = opportunityToMarkdown(base, brief, [], (type) =>
      type === 'comparison_page' ? 'Comparison' : null,
    );
    expect(md).toContain('- Flat feet shoe comparison (Comparison, Owned, Expand)');
  });

  it('copies the opportunity and its source data before a brief exists', () => {
    const md = opportunityToMarkdown(
      { ...base, clusterId: null, decision: null, sourceData: { promptText: 'Best shoes?' } },
      null,
      [{ query: 'best shoes 2026' }],
    );

    expect(md).toContain('- Related prompt: Best shoes?');
    expect(md).toContain('## Fan-out queries\n\n- best shoes 2026');
    expect(md).not.toContain('## Content brief');
    expect(md).not.toContain('## Target pages');
    expect(md).not.toContain('Decision:');
  });
});

describe('an opportunity sent from an action task (AC-004)', () => {
  it("copies the task's where, why, steps and check", () => {
    const md = opportunityToMarkdown(
      {
        ...base,
        sourceData: {
          fromAction: {
            actionId: 'a1',
            actionNo: 29,
            taskId: 't1',
            task: {
              where: 'acme.example/pricing',
              why: 'Cited #2 until Oct 12.',
              how: ['Add a table.', 'Update the title.'],
              doneWhen: 'Cited again within 14 days.',
              effort: '~2h',
              role: 'Content writer',
            },
          },
        },
      },
      null,
    );
    expect(md).toContain(
      [
        '## From a task in AC-29',
        '',
        '- Where: acme.example/pricing',
        '- Why: Cited #2 until Oct 12.',
        '1. Add a table.',
        '2. Update the title.',
        '- Done when: Cited again within 14 days.',
        '- Effort: ~2h · Content writer',
      ].join('\n'),
    );
  });
});
