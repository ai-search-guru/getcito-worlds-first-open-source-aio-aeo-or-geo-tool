import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import type { Signal } from '@/lib/signals/map';
import { actionStory, storyFamily, type StoryFamily } from './story';
import type { VolumeEstimate } from '@/lib/volumeEstimate';

// Days are read where the reader is; pin it so the fixtures' days hold anywhere.
process.env.TZ = 'UTC';

// The real English copy, behind the plain (key, values) shape the helpers take.
const story = createTranslator({
  locale: 'en',
  messages,
  namespace: 'actionCenter.actionsPage.drawer.story',
});
const t = (key: string, values?: Record<string, string | number>) =>
  story(key as Parameters<typeof story>[0], values);
const format = {
  day: (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  list: (items: string[]) =>
    new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(items),
};

const signal = (over: Partial<Signal> = {}): Signal =>
  ({
    id: 's1',
    category: 'citation',
    kind: 'lost_citations',
    impact: 'high',
    status: 'new',
    source: ['ai_results'],
    detectedAt: '2026-10-09T12:00:00Z',
    lastDetectedAt: '2026-10-09T12:00:00Z',
    resolvedAt: null,
    previousValue: null,
    currentValue: null,
    changeValue: null,
    payload: {},
    kpiKeys: [],
    actionId: 'a1',
    where: { platforms: [], regions: [], topics: [] },
    ...over,
  }) as Signal;

/** A prompt's volume as an estimate (PROMPT-013): ±20% around it, medium. */
const est = (value: number): VolumeEstimate => ({
  basis: 'keywords',
  value,
  low: value * 0.8,
  high: value * 1.2,
  confidence: 'medium',
  measured: 3,
  keywords: 5,
  rate: 0.45,
  asOf: '2026-10-10T00:00:00Z',
  stale: false,
});

const tell = (
  signals: Signal[],
  opts: { volumes?: Map<string, VolumeEstimate>; dueDate?: string | null } = {},
) =>
  actionStory(
    {
      signals,
      volumes: opts.volumes ?? null,
      createdAt: '2026-10-09T12:00:00Z',
      dueDate: opts.dueDate ?? null,
    },
    t,
    format,
  );

/** Seven prompts in one topic losing their citations, as in the spec. */
const lostSeven = Array.from({ length: 7 }, (_, i) =>
  signal({
    id: `s${i}`,
    detectedAt:
      i === 0 ? '2026-10-02T12:00:00Z' : i === 6 ? '2026-10-09T12:00:00Z' : '2026-10-05T12:00:00Z',
    // Seen again every night since: not when they were lost.
    lastDetectedAt: '2026-10-15T12:00:00Z',
    payload: {
      promptId: `p${i}`,
      promptText: `Prompt ${i}`,
      lostUrls: [{ url: 'https://www.acme.example/blog/best-tools', position: 2 }],
    },
    where: {
      platforms: i % 2 ? ['chatgpt-web'] : ['gemini-web', 'google-aio'],
      regions: ['US'],
      topics: ['AI Rank Tracker'],
    },
  }),
);

describe('actionStory', () => {
  it('names the prompts, their topic and demand, the domain, the platforms and the days', () => {
    const volumes = new Map(lostSeven.map((_, i) => [`p${i}`, est(5_000)]));
    const told = tell(lostSeven, { volumes })!;

    expect(told.family).toBe('citationLoss');
    expect(told.why).toBe(
      '7 prompts in AI Rank Tracker (28–42k AI searches a month, estimated) lost their citations to acme.example on Gemini, Google AI Overviews, and ChatGPT between Oct 2 and Oct 9.',
    );
    // 70% of 7, rounded up; 30 days after the action was raised.
    expect(told.goal).toBe('Citations back on ≥5 of 7 prompts by Nov 8.');
  });

  it('dates the goal by the due date when the action has one', () => {
    expect(tell(lostSeven, { dueDate: '2026-11-20' })!.goal).toBe(
      'Citations back on ≥5 of 7 prompts by Nov 20.',
    );
  });

  it('leaves the demand out when it covers only some of the prompts', () => {
    const grouped = signal({
      category: 'visibility',
      kind: 'prompt_visibility_gap',
      payload: {
        entity: 'prompts',
        targets: [{ id: 'p1', label: 'One' }],
      },
      currentValue: 60,
    });
    const told = tell([grouped], { volumes: new Map([['p1', est(9_000)]]) })!;
    expect(told.why).toBe('Your brand is missing from AI answers to 60 prompts on Oct 9.');
    expect(told.goal).toBe('In AI answers to ≥42 of 60 prompts by Nov 8.');
  });

  it('quotes a single prompt and agrees with it', () => {
    const told = tell([lostSeven[6]])!;
    expect(told.why).toBe(
      '“Prompt 6” in AI Rank Tracker lost its citations to acme.example on Gemini and Google AI Overviews on Oct 9.',
    );
    expect(told.goal).toBe('Citations back on “Prompt 6” in AI Rank Tracker by Nov 8.');
  });

  it('names the competitor ahead and the prompts it leads on', () => {
    const told = tell([
      signal({
        category: 'competitor',
        kind: 'competitor_leads',
        payload: {
          competitorName: 'Profound',
          positions: [
            {
              promptId: 'p1',
              promptText: 'One',
              platform: 'chatgpt-web',
              competitor: { now: 1, before: 2 },
              you: { now: 4, before: 3 },
            },
            {
              promptId: 'p2',
              promptText: 'Two',
              platform: 'chatgpt-web',
              competitor: { now: 1, before: 1 },
              you: { now: null, before: null },
            },
          ],
        },
      }),
    ])!;
    expect(told.why).toBe('Profound is ahead of you on 2 prompts on ChatGPT on Oct 9.');
    expect(told.goal).toBe('Ahead of Profound on both prompts by Nov 8.');
  });

  it("quotes the pages' AI visits before and after, and asks them back", () => {
    const told = tell(
      [
        signal({
          category: 'traffic',
          kind: 'ai_traffic_drop',
          detectedAt: '2026-10-02T12:00:00Z',
          payload: {
            entity: 'pages',
            targets: [
              { id: '/subscriptions', label: '/subscriptions', before: 40, now: 32 },
              { id: '/gifts', label: '/gifts', before: 30, now: 18 },
            ],
          },
        }),
      ],
      { dueDate: '2026-11-20' },
    )!;
    expect(told.why).toBe('AI visits to 2 pages fell from 70 to 50 on Oct 2.');
    expect(told.goal).toBe('AI visits to 2 pages back to 70 by Nov 20.');
  });

  it('names an audit finding and asks every page fixed', () => {
    const told = tell([
      signal({
        category: 'technical',
        kind: 'crawler_blocked',
        payload: {
          entity: 'pages',
          targets: [
            {
              id: 'https://acme.example/pricing',
              label: 'https://acme.example/pricing',
              issues: [{ check: 'robots_ai_bots', label: 'robots.txt blocks AI bots' }],
            },
          ],
        },
      }),
    ])!;
    // By its address: a page elsewhere keeps its site.
    expect(told.why).toBe(
      'Site Audit flagged acme.example/pricing: robots.txt blocks AI bots on Oct 9.',
    );
    expect(told.goal).toBe('Issues fixed on acme.example/pricing by Nov 8.');
  });

  it("tells AI Traffic's page findings by what visitors and bots found, not as Site Audit's (AT-013)", () => {
    const broken = tell([
      signal({
        category: 'technical',
        kind: 'broken_citation_target',
        payload: {
          entity: 'pages',
          targets: [
            { id: '/old-menu', label: '/old-menu', visits: 2, redirectTo: '/menu' },
            { id: '/gift-box', label: '/gift-box', visits: 1, redirectTo: '/gifts' },
          ],
        },
        currentValue: 2,
      }),
    ])!;
    expect(broken.family).toBe('brokenLinks');
    expect(broken.why).toBe("AI visitors landed on 2 pages on Oct 9, and they don't exist.");
    expect(broken.goal).toBe('Working redirects for both pages by Nov 8.');

    const unread = tell([
      signal({
        category: 'technical',
        kind: 'cited_page_uncrawled',
        payload: {
          entity: 'pages',
          targets: [{ id: '/guides/espresso', label: '/guides/espresso' }],
        },
        currentValue: 1,
      }),
    ])!;
    expect(unread.family).toBe('uncrawledPages');
    expect(unread.why).toBe(
      'AI answers cite /guides/espresso, and no AI search bot read it in the last 30 days.',
    );
    expect(unread.goal).toBe('AI search bots reading /guides/espresso again by Nov 8.');
  });

  it('quotes a brand-wide rate when nothing narrower is affected', () => {
    const told = tell([
      signal({
        category: 'visibility',
        kind: 'sharp_drop',
        previousValue: 34,
        currentValue: 18,
        where: { platforms: ['gemini-web'], regions: [], topics: [] },
      }),
    ])!;
    expect(told.why).toBe('Your AI visibility fell from 34% to 18% on Gemini on Oct 9.');
    expect(told.goal).toBe('AI visibility back to 34% on Gemini by Nov 8.');
  });

  it('tells the story most of the signals share', () => {
    const competitor = signal({
      id: 'c1',
      category: 'competitor',
      kind: 'competitor_momentum',
      payload: { competitorName: 'Profound' },
    });
    expect(tell([competitor, ...lostSeven.slice(0, 2)])!.family).toBe('citationLoss');
  });

  it('is null for an action no signal supports', () => {
    expect(tell([])).toBeNull();
  });
});

describe('what the review found', () => {
  const leads = (over: Partial<Signal> = {}) =>
    signal({
      id: 'c1',
      category: 'competitor',
      kind: 'competitor_leads',
      payload: {
        positions: ['p8', 'p9'].map((id) => ({
          promptId: id,
          promptText: id,
          platform: 'chatgpt-web',
          competitor: { now: 1, before: 1 },
          you: { now: 3, before: 3 },
        })),
      },
      ...over,
    });

  it("counts only the lead family's prompts", () => {
    const told = tell([...lostSeven.slice(0, 3), leads()])!;
    expect(told.family).toBe('citationLoss');
    expect(told.why).toMatch(/^3 prompts in AI Rank Tracker lost their citations/);
    expect(told.goal).toBe('Citations back on all 3 prompts by Nov 8.');
  });

  it('writes an unnamed competitor in lower case mid-sentence', () => {
    expect(tell([leads()])!.why).toBe(
      'A competitor is ahead of you on 2 prompts on ChatGPT on Oct 9.',
    );
    const ahead = tell([leads({ kind: 'competitor_overtaken' })])!;
    expect(ahead.why).toBe('You moved ahead of a competitor on 2 prompts on ChatGPT on Oct 9.');
    expect(ahead.goal).toBe('Still ahead of a competitor on both prompts through Nov 8.');
  });

  it('does not put the prompts in a topic only some of them are in', () => {
    const other = signal({
      ...lostSeven[1],
      id: 'x',
      payload: { promptId: 'px', promptText: 'Elsewhere' },
      where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
    });
    expect(tell([lostSeven[0], other])!.why).toMatch(/^2 prompts lost their citations/);
  });

  it("counts a topic's prompts it names none of", () => {
    const told = tell([
      signal({
        category: 'visibility',
        kind: 'topic_gap',
        currentValue: 30,
        payload: { entity: 'topics', prompts: 12, targets: [{ id: 't1', label: 'Office coffee' }] },
      }),
    ])!;
    expect(told.why).toBe(
      'Your brand is missing from AI answers to 12 prompts in Office coffee on Oct 9.',
    );
    expect(told.goal).toBe('In AI answers to ≥9 of 12 prompts by Nov 8.');
  });

  it('formats every sentence, for each kind of subject', () => {
    const errors: string[] = [];
    const strict = createTranslator({
      locale: 'en',
      messages,
      namespace: 'actionCenter.actionsPage.drawer.story',
      onError: (error) => errors.push(error.message),
    });
    const copy = messages.actionCenter.actionsPage.drawer.story;
    for (const group of ['why', 'goal'] as const) {
      for (const key of Object.keys(copy[group])) {
        for (const entity of ['prompts', 'pages', 'topics']) {
          for (const count of [1, 2]) {
            const text = strict(`${group}.${key}` as Parameters<typeof strict>[0], {
              subject: 'S',
              count,
              entity,
              domain: '',
              platforms: '',
              when: '',
              fromTo: '',
              competitor: 'C',
              named: count === 1 ? 'yes' : 'no',
              competitors: count,
              issues: '',
              scope: 'SC',
              date: 'D',
              hasFrom: 'yes',
              from: '3',
              hasVisits: count === 1 ? 'yes' : 'no',
              before: 1,
              now: 2,
            });
            expect(text).not.toContain(`${group}.${key}`);
          }
        }
      }
    }
    expect(errors).toEqual([]);
  });
});

describe('storyFamily', () => {
  it.each<[Signal['category'], string, StoryFamily]>([
    ['citation', 'owned_page_citation_lost', 'citationLoss'],
    ['citation', 'third_party_citation_gap', 'citationGap'],
    ['citation', 'first_citation', 'citationGain'],
    ['visibility', 'lost_mentions', 'visibilityLoss'],
    ['visibility', 'topic_gap', 'visibilityGap'],
    ['visibility', 'prompt_gain', 'visibilityGain'],
    ['mention', 'uncited_mentions', 'mentionGap'],
    ['competitor', 'competitor_surge', 'competitorBehind'],
    ['competitor', 'competitor_overtaken', 'competitorAhead'],
    ['traffic', 'ai_traffic_slipping', 'trafficLoss'],
    ['traffic', 'ai_landing_underperforming', 'trafficGap'],
    ['traffic', 'ai_landing_page_winner', 'trafficGain'],
    ['traffic', 'gsc_decline', 'searchLoss'],
    ['traffic', 'gsc_low_ctr', 'searchGap'],
    ['technical', 'weak_entity', 'technicalIssue'],
  ])('reads %s/%s as %s', (category, kind, family) => {
    expect(storyFamily({ category, kind } as Signal)).toBe(family);
  });

  it('has a Why and a Goal for every family, with and without a subject', () => {
    const families: StoryFamily[] = [
      'citationLoss',
      'citationGap',
      'citationGain',
      'visibilityLoss',
      'visibilityGap',
      'visibilityGain',
      'mentionLoss',
      'mentionGap',
      'competitorBehind',
      'competitorAhead',
      'trafficLoss',
      'trafficGap',
      'trafficGain',
      'searchLoss',
      'searchGap',
      'technicalIssue',
    ];
    const copy = messages.actionCenter.actionsPage.drawer.story;
    for (const family of families) {
      for (const key of [family, `${family}All`]) {
        expect(copy.why).toHaveProperty(key);
        expect(copy.goal).toHaveProperty(key);
      }
    }
  });
});
