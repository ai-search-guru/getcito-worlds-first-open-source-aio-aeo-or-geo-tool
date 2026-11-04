import { describe, expect, it } from 'vitest';
import {
  answerExcerpt,
  buildImprovePrompt,
  classifyPlatform,
  collectEvidence,
  improveRangeKey,
  isKnownSource,
  sanitizeSuggestions,
  withPageChecks,
} from './promptImprove.js';

const BRAND_DOMAINS = ['acme.com'];

const row = (over = {}) => ({
  mention_count: 0,
  mention_position: null,
  mentioned_entity_count: null,
  citations: [],
  search_queries: [],
  competitor_mentions: [],
  ...over,
});

describe('classifyPlatform', () => {
  it('no rows is no_runs', () => {
    expect(classifyPlatform([], BRAND_DOMAINS).state).toBe('no_runs');
  });

  it('tracked but never mentioned is not_mentioned', () => {
    const r = classifyPlatform([row(), row()], BRAND_DOMAINS);
    expect(r).toMatchObject({ state: 'not_mentioned', runs: 2, mentionedRuns: 0 });
  });

  it('mentioned in fewer than half the runs is not_mentioned, however high it ranked', () => {
    const first = row({ mention_count: 1, mention_position: 1, mentioned_entity_count: 5 });
    const rare = classifyPlatform(
      [...Array(8).fill(first), ...Array.from({ length: 112 }, () => row())],
      BRAND_DOMAINS,
    );
    expect(rare).toMatchObject({ state: 'not_mentioned', runs: 120, mentionedRuns: 8 });
    // Exactly half is enough to be judged on position.
    expect(classifyPlatform([first, row()], BRAND_DOMAINS).state).not.toBe('not_mentioned');
  });

  it('mentioned at an average below #1 is mentioned_late', () => {
    const r = classifyPlatform(
      [
        row({ mention_count: 1, mention_position: 1, mentioned_entity_count: 5 }),
        row({ mention_count: 1, mention_position: 4, mentioned_entity_count: 5 }),
      ],
      BRAND_DOMAINS,
    );
    expect(r).toMatchObject({ state: 'mentioned_late', mentionPosition: 2.5, mentionTotal: 5 });
  });

  it('mentioned with no stored position counts as late, not as doing well', () => {
    expect(classifyPlatform([row({ mention_count: 2 })], BRAND_DOMAINS).state).toBe(
      'mentioned_late',
    );
  });

  it('#1 but not cited is not_cited', () => {
    const r = classifyPlatform(
      [row({ mention_count: 1, mention_position: 1, citations: [{ url: 'https://other.com/a' }] })],
      BRAND_DOMAINS,
    );
    expect(r.state).toBe('not_cited');
  });

  it('#1 but cited late is not_cited', () => {
    const citations = [
      { url: 'https://a.com' },
      { url: 'https://b.com' },
      { url: 'https://c.com' },
      { url: 'https://www.acme.com/page' },
    ];
    const r = classifyPlatform(
      [row({ mention_count: 1, mention_position: 1, citations })],
      BRAND_DOMAINS,
    );
    expect(r).toMatchObject({ state: 'not_cited', citationRank: { rank: 4, total: 4 } });
  });

  it('#1 and cited early is doing_well', () => {
    const citations = [{ url: 'https://shop.acme.com/x' }, { url: 'https://b.com' }];
    const r = classifyPlatform(
      [row({ mention_count: 1, mention_position: 1, citations })],
      BRAND_DOMAINS,
    );
    expect(r.state).toBe('doing_well');
  });
});

describe('collectEvidence', () => {
  const rows = [
    row({
      search_queries: [
        { query: 'best coffee subscription' },
        { query: 'Best Coffee Subscription' },
      ],
      citations: [
        { url: 'https://www.rival.com/plans' },
        { url: 'https://acme.com/subscribe' },
        { url: 'https://reddit.com/r/coffee' },
      ],
      competitor_mentions: [
        { name: 'Rival', mention_count: 2, mention_position: 1 },
        { name: 'Quiet', mention_count: 0 },
      ],
    }),
    row({
      search_queries: [{ query: 'best coffee subscription' }, { query: 'coffee gift box' }],
      citations: [{ url: 'https://rival.com/plans' }],
      competitor_mentions: [{ name: 'Rival', mention_count: 1, mention_position: 3 }],
    }),
  ];
  const ev = collectEvidence(rows, {
    brandName: 'Acme',
    brandDomains: BRAND_DOMAINS,
    competitors: [{ name: 'Rival', domain: 'rival.com' }],
    latestResponse: 'Rival is the top pick. Acme is also good.',
  });

  it('counts each sub-query once per answer, most frequent first', () => {
    expect(ev.fanouts).toEqual([
      { query: 'best coffee subscription', count: 2 },
      { query: 'coffee gift box', count: 1 },
    ]);
  });

  it('splits cited URLs into domains, competitor URLs and brand pages', () => {
    expect(ev.citedDomains[0]).toEqual({ domain: 'rival.com', count: 2, own: false });
    expect(ev.citedDomains.find((d) => d.domain === 'acme.com')?.own).toBe(true);
    expect(ev.competitorUrls.map((u) => u.url)).toContain('https://www.rival.com/plans');
    expect(ev.brandPages).toEqual([{ url: 'https://acme.com/subscribe', count: 1 }]);
  });

  it('keeps only competitors actually named, with their average position', () => {
    expect(ev.competitors).toEqual([{ name: 'Rival', runs: 2, avgPosition: 2 }]);
  });

  it('carries the answer excerpt', () => {
    expect(ev.excerpt).toBe('Rival is the top pick. Acme is also good.');
  });
});

describe('answerExcerpt', () => {
  it('centres a long answer on the brand mention', () => {
    const long = `${'x '.repeat(2000)}Acme wins here ${'y '.repeat(2000)}`;
    const out = answerExcerpt(long, 'Acme');
    expect(out).toContain('Acme wins here');
    expect(out.startsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(1203);
  });
});

describe('sanitizeSuggestions', () => {
  const evidence = {
    fanouts: [{ query: 'best coffee subscription', count: 2 }],
    citedDomains: [{ domain: 'reddit.com', count: 1, own: false }],
    competitorUrls: [{ url: 'https://rival.com/plans', count: 1 }],
    brandPages: [],
    competitors: [],
    excerpt: 'Rival is the top pick for freshness.',
  };
  const platforms = [
    { id: 'perplexity-web', state: 'not_mentioned', evidence },
    { id: 'chatgpt-web', state: 'doing_well', evidence },
  ];
  const base = {
    platform: 'perplexity-web',
    title: 'Answer the sub-query',
    body: 'Publish a comparison page that answers the sub-query directly.',
    confidence: 'high',
  };

  it('keeps real sources and drops invented ones', () => {
    const out = sanitizeSuggestions(
      [
        {
          ...base,
          sources: [
            { type: 'fanout', ref: 'Best coffee subscription' },
            { type: 'fanout', ref: 'invented query' },
            { type: 'competitor_url', ref: 'https://rival.com/plans/' },
            { type: 'answer', ref: '"top pick for freshness"' },
          ],
        },
      ],
      platforms,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'perplexity-web:0', state: 'not_mentioned' });
    expect(out[0].sources.map((s) => s.type)).toEqual(['fanout', 'competitor_url', 'answer']);
  });

  it('drops a suggestion with no real source left', () => {
    const out = sanitizeSuggestions(
      [{ ...base, sources: [{ type: 'domain', ref: 'made-up.com' }] }],
      platforms,
    );
    expect(out).toEqual([]);
  });

  it('drops placeholder text, doing-well and unknown platforms', () => {
    const src = [{ type: 'domain', ref: 'reddit.com' }];
    const out = sanitizeSuggestions(
      [
        { ...base, body: 'Target prompt [0] with a new page about it.', sources: src },
        { ...base, platform: 'chatgpt-web', sources: src },
        { ...base, platform: 'nope', sources: src },
      ],
      platforms,
    );
    expect(out).toEqual([]);
  });

  it('caps a platform at three suggestions', () => {
    const src = [{ type: 'domain', ref: 'reddit.com' }];
    const out = sanitizeSuggestions(
      Array.from({ length: 5 }, () => ({ ...base, sources: src })),
      platforms,
    );
    expect(out.map((s) => s.id)).toEqual([
      'perplexity-web:0',
      'perplexity-web:1',
      'perplexity-web:2',
    ]);
  });
});

describe('isKnownSource', () => {
  it('accepts a domain given as a URL', () => {
    expect(
      isKnownSource(
        { type: 'domain', ref: 'https://www.reddit.com' },
        {
          fanouts: [],
          citedDomains: [{ domain: 'reddit.com' }],
          competitorUrls: [],
          brandPages: [],
          excerpt: '',
        },
      ),
    ).toBe(true);
  });
});

describe('buildImprovePrompt', () => {
  it('lists each actionable platform with its state and evidence', () => {
    const { system, prompt } = buildImprovePrompt({
      promptText: 'best coffee subscription',
      brand: { name: 'Acme', domains: ['acme.com'] },
      platforms: [
        {
          id: 'perplexity-web',
          state: 'mentioned_late',
          mentionPosition: 3,
          mentionTotal: 5,
          citationRank: null,
          evidence: {
            fanouts: [{ query: 'q1', count: 2 }],
            citedDomains: [],
            competitors: [],
            competitorUrls: [],
            brandPages: [],
            excerpt: 'text',
          },
        },
      ],
    });
    expect(system).toContain('Never output placeholders');
    expect(prompt).toContain(
      'Platform "perplexity-web" (Perplexity): MENTIONED LATE — mentioned at avg #3 of 5 brands',
    );
    expect(prompt).toContain('"q1" ×2');
  });

  /** The brand's earlier rounds on the prompt (learning B5), and none without. */
  it('says what earlier Improve rounds on the prompt did, and how their platforms moved', () => {
    const platforms = [
      {
        id: 'gemini-web',
        state: 'not_mentioned',
        evidence: {
          fanouts: [],
          citedDomains: [],
          competitors: [],
          competitorUrls: [],
          brandPages: [],
          excerpt: '',
        },
      },
    ];
    const brand = { name: 'Acme', domains: [] };
    const { prompt } = buildImprovePrompt({
      promptText: 'best coffee subscription',
      brand,
      platforms,
      history: [
        {
          sent: '2026-09-10',
          daysAgo: 48,
          open: false,
          final: true,
          platforms: [
            { id: 'chatgpt-web', verdict: 'improved' },
            { id: 'gemini-web', verdict: 'unchanged' },
          ],
          suggestions: [{ platform: 'gemini-web', title: 'Pitch seriouseats.com', status: 'done' }],
        },
      ],
    });
    expect(prompt).toContain(
      '- Sent 2026-09-10, 48 days ago (completed, final read): ChatGPT improved, Gemini unchanged.\n  Suggestions: [Gemini] "Pitch seriouseats.com" (done)',
    );
    expect(prompt).toContain('Do not suggest again what was done on a platform that did not move');
    expect(
      buildImprovePrompt({ promptText: 'best coffee subscription', brand, platforms }).prompt,
    ).not.toContain('Earlier Improve rounds');
    expect(prompt).not.toContain('too early to read');
    expect(prompt).not.toContain('skipped');
  });

  /** What the team skipped is its call, not a suggestion that waits to be done. */
  it('says which earlier suggestions the team skipped, and not to suggest them again', () => {
    const { prompt } = buildImprovePrompt({
      promptText: 'best coffee subscription',
      brand: { name: 'Acme', domains: [] },
      platforms: [
        {
          id: 'gemini-web',
          state: 'not_mentioned',
          evidence: {
            fanouts: [],
            citedDomains: [],
            competitors: [],
            competitorUrls: [],
            brandPages: [],
            excerpt: '',
          },
        },
      ],
      history: [
        {
          sent: '2026-09-10',
          daysAgo: 48,
          open: false,
          final: true,
          platforms: [{ id: 'gemini-web', verdict: 'unchanged' }],
          suggestions: [
            { platform: 'gemini-web', title: 'Pitch seriouseats.com', status: 'skipped' },
            { platform: 'gemini-web', title: 'Add an FAQ', status: 'not_done' },
          ],
        },
      ],
    });
    expect(prompt).toContain(
      'Suggestions: [Gemini] "Pitch seriouseats.com" (skipped by the team); [Gemini] "Add an FAQ" (not done)',
    );
    expect(prompt).toContain('Do not suggest again what the team skipped.');
  });

  it("keeps an earlier suggestion's own double quotes from closing its quoted title", () => {
    const { prompt } = buildImprovePrompt({
      promptText: 'best coffee subscription',
      brand: { name: 'Acme', domains: [] },
      platforms: [
        {
          id: 'gemini-web',
          state: 'not_mentioned',
          evidence: {
            fanouts: [],
            citedDomains: [],
            competitors: [],
            competitorUrls: [],
            brandPages: [],
            excerpt: '',
          },
        },
      ],
      history: [
        {
          sent: '2026-09-10',
          daysAgo: 48,
          open: false,
          final: true,
          platforms: [{ id: 'gemini-web', verdict: 'improved' }],
          suggestions: [
            {
              platform: 'gemini-web',
              title: 'Answer "is it worth it" on /pricing',
              status: 'done',
            },
          ],
        },
      ],
    });
    expect(prompt).toContain(`[Gemini] "Answer 'is it worth it' on /pricing" (done)`);
  });

  /** A round sent under a week ago has no read of its own yet (learning B5). */
  it('says a round sent days ago is too early to read, not that it did not move', () => {
    const { prompt } = buildImprovePrompt({
      promptText: 'best coffee subscription',
      brand: { name: 'Acme', domains: [] },
      platforms: [
        {
          id: 'gemini-web',
          state: 'not_mentioned',
          evidence: {
            fanouts: [],
            citedDomains: [],
            competitors: [],
            competitorUrls: [],
            brandPages: [],
            excerpt: '',
          },
        },
      ],
      history: [
        {
          sent: '2026-10-26',
          daysAgo: 2,
          open: true,
          final: false,
          platforms: [{ id: 'gemini-web', verdict: 'too_early' }],
          suggestions: [{ platform: 'gemini-web', title: 'Pitch seriouseats.com', status: 'done' }],
        },
        {
          sent: '2026-10-28',
          daysAgo: 0,
          open: true,
          final: false,
          platforms: [{ id: 'chatgpt-web', verdict: 'too_early' }],
          suggestions: [],
        },
      ],
    });
    expect(prompt).toContain(
      '- Sent 2026-10-26, 2 days ago (still open): Gemini too early to read.',
    );
    expect(prompt).toContain('- Sent 2026-10-28, today (still open): ChatGPT too early to read.');
    expect(prompt).toContain(
      'A platform "too early to read" was sent too recently to tell whether it moved: do not count it as not moving.',
    );
  });

  it('says how rarely a not-mentioned platform names the brand', () => {
    const { prompt } = buildImprovePrompt({
      promptText: 'best coffee subscription',
      brand: { name: 'Acme', domains: [] },
      platforms: [
        {
          id: 'gemini-web',
          state: 'not_mentioned',
          runs: 120,
          mentionedRuns: 8,
          evidence: {
            fanouts: [],
            citedDomains: [],
            competitors: [],
            competitorUrls: [],
            brandPages: [],
            excerpt: '',
          },
        },
      ],
    });
    expect(prompt).toContain('NOT MENTIONED — mentioned in only 8 of 120 runs');
  });
});

describe('improveRangeKey', () => {
  it('keys presets by name and custom ranges by their bounds', () => {
    expect(improveRangeKey({ preset: '30d' })).toBe('30d');
    expect(improveRangeKey({ preset: 'custom', from: '2026-10-01', to: '2026-10-05' })).toBe(
      'custom:2026-10-01:2026-10-05',
    );
  });
});

describe('Improve plan limits', () => {
  it('is on every plan, in one AI budget: Starter $5, Growth $25 (5x), Enterprise $50, the trial $2', async () => {
    const { PLANS, TRIAL_AI_BUDGET_USD } = await import('../config/plans.js');
    expect(PLANS.starter.limits.improveMonthlyBudgetUsd).toBe(5);
    expect(TRIAL_AI_BUDGET_USD).toBe(2);
    for (const id of ['starter', 'growth', 'enterprise', 'self_hosted']) {
      expect(PLANS[id].limits.features).toContain('prompt_improve');
    }
    expect(PLANS.growth.limits.improveMonthlyBudgetUsd).toBe(25);
    expect(PLANS.enterprise.limits.improveMonthlyBudgetUsd).toBe(50);
    expect(PLANS.self_hosted.limits.improveMonthlyBudgetUsd).toBe(-1);
  });
});

/** What Site Audit's checks found on the cited pages, read lately (learning C2). */
describe('withPageChecks', () => {
  const evidence = {
    fanouts: [],
    citedDomains: [],
    competitors: [],
    competitorUrls: [
      { url: 'https://rival.com/kettles', count: 3 },
      { url: 'https://other-rival.com/best-kettles', count: 2 },
    ],
    brandPages: [{ url: 'https://acme.com/kettles', count: 1 }],
    excerpt: '',
  };
  const stored = new Map([
    ['rival.com/kettles', { own: false, checks: { 'faq-schema': 'pass', tables: 'pass' } }],
    ['other-rival.com/best-kettles', { own: false, checks: { 'faq-schema': 'pass' } }],
    ['acme.com/kettles', { own: true, checks: { tables: 'pass' } }],
  ]);

  it('names what each page passes and what theirs have that the brand page lacks', () => {
    const shown = withPageChecks(evidence, stored);
    expect(shown.pageChecks.map((p) => [p.url, p.own, p.passes.length])).toEqual([
      ['https://rival.com/kettles', false, 2],
      ['https://other-rival.com/best-kettles', false, 1],
      ['https://acme.com/kettles', true, 1],
    ]);
    // Compared over two competitor pages at least (C1): FAQ schema on both,
    // not on the brand's.
    expect(shown.checkGaps).toHaveLength(1);

    const { prompt } = buildImprovePrompt({
      promptText: 'best kettle',
      brand: { name: 'Acme', domains: [] },
      platforms: [{ id: 'gemini-web', state: 'not_mentioned', evidence: shown }],
    });
    expect(prompt).toContain(
      'Checks on these pages (Site Audit, read lately): https://rival.com/kettles: ',
    );
    expect(prompt).toContain("The competitor pages have and the brand's don't: ");
  });

  it('counts one page cited under two addresses once, at the first', () => {
    const shown = withPageChecks(
      {
        ...evidence,
        competitorUrls: [
          { url: 'https://rival.com/kettles', count: 3 },
          { url: 'https://www.rival.com/kettles?utm_source=chatgpt.com', count: 2 },
        ],
      },
      stored,
    );
    expect(shown.pageChecks.map((p) => p.url)).toEqual([
      'https://rival.com/kettles',
      'https://acme.com/kettles',
    ]);
    // One competitor page is too few to compare (C1): no gap.
    expect(shown.checkGaps).toEqual([]);
  });

  it('leaves the evidence as it was when none of its pages was read', () => {
    expect(withPageChecks(evidence, new Map())).toBe(evidence);
    expect(withPageChecks(evidence, new Map([['other.com/x', { own: false, checks: {} }]]))).toBe(
      evidence,
    );
  });
});
