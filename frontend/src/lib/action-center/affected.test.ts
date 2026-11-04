import { describe, expect, it } from 'vitest';
import type { Signal } from '@/lib/signals/map';
import {
  affectedChips,
  affectedCounts,
  affectedOf,
  affectedSummary,
  affectedTotal,
  demandPromptIds,
  leaderText,
  type Affected,
} from './affected';

const signal = (over: Partial<Signal> = {}): Signal =>
  ({
    id: 's1',
    category: 'citation',
    kind: 'lost_citations',
    impact: 'high',
    status: 'new',
    source: ['ai_results'],
    detectedAt: '2026-10-09T00:00:00Z',
    lastDetectedAt: '2026-10-09T00:00:00Z',
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

describe('affectedOf', () => {
  it('lists each lost prompt with where it was lost, the page lost and what is cited instead', () => {
    const affected = affectedOf([
      signal({
        payload: {
          promptId: 'p1',
          promptText: 'Which tools track AI search?',
          lostUrls: [{ url: 'https://acme.example/blog/best-tools', position: 2 }],
          citedNow: [{ url: 'https://profound.com/features', position: 1 }],
        },
        where: { platforms: ['chatgpt-web', 'gemini-web'], regions: ['US'], topics: [] },
      }),
      // A second finding on the same prompt, on another platform: one row.
      signal({
        id: 's2',
        payload: { promptId: 'p1', promptText: 'Which tools track AI search?' },
        where: { platforms: ['google-aio'], regions: ['US'], topics: [] },
      }),
      signal({
        id: 's3',
        payload: { promptId: 'p2', promptText: 'Best AI rank tracker?' },
        where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
      }),
    ]);

    expect(affected.prompts).toEqual([
      {
        id: 'p1',
        text: 'Which tools track AI search?',
        platforms: ['chatgpt-web', 'gemini-web', 'google-aio'],
        lostPages: ['https://acme.example/blog/best-tools'],
        citedInstead: ['https://profound.com/features'],
        leaders: [],
        topics: [],
      },
      {
        id: 'p2',
        text: 'Best AI rank tracker?',
        platforms: ['chatgpt-web'],
        lostPages: [],
        citedInstead: [],
        leaders: [],
        topics: [],
      },
    ]);
    expect(affected.promptTotal).toBe(2);
    expect(affected.platforms).toEqual(['chatgpt-web', 'gemini-web', 'google-aio']);
    expect(affected.lostPages).toEqual(['https://acme.example/blog/best-tools']);
  });

  it('names the prompts a competitor is ahead on, platform by platform', () => {
    const affected = affectedOf([
      signal({
        category: 'competitor',
        kind: 'competitor_leads',
        payload: {
          competitorName: 'Profound',
          positions: [
            {
              promptId: 'p1',
              promptText: 'Best AI rank tracker?',
              platform: 'chatgpt-web',
              competitor: { now: 1, before: 2 },
              you: { now: 4, before: 3 },
            },
          ],
        },
      }),
    ]);

    expect(affected.prompts[0]).toMatchObject({
      id: 'p1',
      platforms: ['chatgpt-web'],
      leaders: [{ competitor: 'Profound', platform: 'chatgpt-web', them: 1, you: 4 }],
    });
    expect(affected.competitors).toEqual(['Profound']);
  });

  it('counts the prompts a grouped finding names beyond its first ones', () => {
    const affected = affectedOf([
      signal({
        category: 'visibility',
        kind: 'prompt_visibility_gap',
        currentValue: 60,
        payload: {
          entity: 'prompts',
          targets: [
            { id: 'p1', label: 'One' },
            { id: 'p2', label: 'Two' },
          ],
        },
      }),
    ]);
    expect(affected.prompts.map((p) => p.text)).toEqual(['One', 'Two']);
    expect(affected.promptTotal).toBe(60);
  });

  it('lists AI-traffic pages with their visits and where they came from', () => {
    const affected = affectedOf([
      signal({
        category: 'traffic',
        kind: 'ai_traffic_drop',
        payload: {
          entity: 'pages',
          targets: [{ id: '/subscriptions', label: '/subscriptions', before: 40, now: 32 }],
          referrals: [
            {
              page: '/subscriptions',
              source: 'analytics',
              sessions: 32,
              before: 40,
              platforms: [{ platform: 'chatgpt.com', sessions: 22, before: 31 }],
            },
          ],
        },
      }),
    ]);
    expect(affected.pages).toEqual([
      {
        url: '/subscriptions',
        sessions: 32,
        before: 40,
        platforms: ['chatgpt.com'],
        issues: [],
      },
    ]);
    expect(affected.pageTotal).toBe(1);
  });

  it('takes an Improve action’s prompt and platforms from what was sent', () => {
    const affected = affectedOf([], {
      promptId: 'p9',
      promptText: 'What are the best coffee subscriptions?',
      platforms: [
        { id: 'gemini-web', label: 'Gemini', state: 'no_runs' },
        { id: 'perplexity-web', label: 'Perplexity', state: 'not_mentioned' },
      ],
    });
    expect(affected.prompts).toEqual([
      expect.objectContaining({
        id: 'p9',
        platforms: ['gemini-web', 'perplexity-web'],
      }),
    ]);
  });

  it('lists a mention review’s first prompt once, though it is its first target too', () => {
    const payload = {
      promptText: 'Best coffee subscriptions?',
      promptIds: ['p1', 'p2'],
      targetEntity: 'prompts',
      targetCount: 2,
      targets: ['Best coffee subscriptions?', 'Cheapest beans online?'],
    };
    const affected = affectedOf([], payload);
    expect(affected.prompts.map((p) => p.text)).toEqual([
      'Best coffee subscriptions?',
      'Cheapest beans online?',
    ]);
    expect(affected.promptTotal).toBe(2);
    // Removed since (AC-009): gone by its text, the label the action kept for it.
    const left = affectedOf([], {
      ...payload,
      targetCount: 1,
      removedKeys: ['p1'],
      removedLabels: ['Best coffee subscriptions?'],
    });
    expect(left.prompts.map((p) => p.text)).toEqual(['Cheapest beans online?']);
    expect(left.promptTotal).toBe(1);
  });

  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const P9 = '99999999-9999-4999-8999-999999999999';
  const keptPrompt = (key: string, label: string, removed = false) => ({
    type: 'prompts',
    key,
    label,
    removed,
  });

  it('lists what the action kept, with what the signals say of each, as its count says', () => {
    const signals = [
      signal({
        payload: { promptId: P1, promptText: 'Which tools track AI search?' },
        where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
      }),
      // A signal the nightly pass added later, about a prompt the action never had.
      signal({
        id: 's2',
        payload: { promptId: P9, promptText: 'Cheapest AI rank tracker?' },
        where: { platforms: ['gemini-web'], regions: [], topics: [] },
      }),
    ];
    const kept = [
      keptPrompt(P1, 'Which tools track AI search?'),
      // Kept, but no signal names it now: a plain row.
      keptPrompt(P2, 'Best AI rank tracker?'),
    ];
    const affected = affectedOf(signals, { targetEntity: 'prompts', targetCount: 2 }, kept);
    expect(affected.prompts.map((p) => [p.id, p.text, p.platforms])).toEqual([
      [P1, 'Which tools track AI search?', ['chatgpt-web']],
      [P2, 'Best AI rank tracker?', []],
    ]);
    // The heading and the rows agree.
    expect(affected.promptTotal).toBe(2);

    // An action made before 00244 kept its first ones: the count says the rest.
    expect(
      affectedOf(signals, { targetEntity: 'prompts', targetCount: 60 }, kept).promptTotal,
    ).toBe(60);
  });

  it('lists none the action lost since, even when it lost them all', () => {
    const signals = [signal({ payload: { promptId: P9, promptText: 'Not the action’s?' } })];
    const affected = affectedOf(signals, { targetEntity: 'prompts', targetCount: 0 }, [
      keptPrompt(P1, 'Paused one?', true),
    ]);
    expect(affected.prompts).toEqual([]);
    expect(affected.promptTotal).toBe(0);
  });

  it('keeps a prompt kept by its text without an id, and matches a text only to a row without one', () => {
    // A topic opportunity keeps its prompts' texts: no id, no link, no volume read.
    const byText = affectedOf(
      [],
      { targetEntity: 'prompts', targetCount: 2, targets: ['Best beans?'] },
      [keptPrompt('Best beans?', 'Best beans?'), keptPrompt('Best grinder?', 'Best grinder?')],
    );
    expect(byText.prompts.map((p) => [p.id, p.text])).toEqual([
      [null, 'Best beans?'],
      [null, 'Best grinder?'],
    ]);

    // A copy of a kept prompt's text in another topic is another prompt.
    const copies = affectedOf(
      [signal({ payload: { promptId: P9, promptText: 'Best beans?' } })],
      { targetEntity: 'prompts', targetCount: 1 },
      [keptPrompt(P1, 'Best beans?')],
    );
    expect(copies.prompts.map((p) => p.id)).toEqual([P1]);
  });

  it('merges a prompt named by its id and by its text into one row', () => {
    const affected = affectedOf(
      [
        signal({
          payload: { promptId: P1, promptText: 'Best beans?' },
          where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
        }),
        signal({
          id: 's2',
          payload: { promptText: 'Best beans?' },
          where: { platforms: ['gemini-web'], regions: [], topics: [] },
        }),
      ],
      { targetEntity: 'prompts', targetCount: 1 },
      [keptPrompt(P1, 'Best beans?')],
    );
    expect(affected.prompts.map((p) => [p.id, p.platforms])).toEqual([
      [P1, ['chatgpt-web', 'gemini-web']],
    ]);
  });

  it('matches pages by address and keeps competitors by name', () => {
    const pages = affectedOf(
      [],
      {
        targetEntity: 'pages',
        targetCount: 2,
        targets: [{ label: 'https://acme.example/a/' }, { label: 'https://acme.example/old' }],
      },
      [
        { type: 'pages', key: 'https://acme.example/a', label: null, removed: false },
        { type: 'pages', key: 'https://acme.example/b', label: null, removed: false },
        { type: 'pages', key: 'https://acme.example/old', label: null, removed: true },
      ],
    );
    expect(pages.pages.map((p) => p.url)).toEqual([
      'https://acme.example/a/',
      'https://acme.example/b',
    ]);
    expect(pages.pageTotal).toBe(2);

    const competitors = affectedOf(
      [],
      { targetEntity: 'competitors', targets: ['Profound', 'Gone Inc'] },
      [
        { type: 'competitors', key: 'c1', label: 'Profound', removed: false },
        { type: 'competitors', key: 'c2', label: 'Gone Inc', removed: true },
      ],
    );
    expect(competitors.competitors).toEqual(['Profound']);
  });

  it('builds from the signals when there is no kept list of its kind, or none can be read', () => {
    const signals = [signal({ payload: { promptId: P1, promptText: 'Which tools?' } })];
    const payload = { targetEntity: 'prompts', targetCount: 1 };
    expect(affectedOf(signals, payload, null).prompts).toHaveLength(1);
    expect(affectedOf(signals, payload, []).prompts).toHaveLength(1);
    expect(
      affectedOf(signals, payload, [
        { type: 'competitors', key: 'c1', label: 'Profound', removed: false },
      ]).prompts,
    ).toHaveLength(1);
  });

  it("reads demand for the rows' prompts and those the signals name outside the kept list", () => {
    const signals = [
      signal({ payload: { promptId: P1, promptText: 'Which tools track AI search?' } }),
      // Named by the signals (and so by the Why), never kept by the action.
      signal({ id: 's2', payload: { promptId: P9, promptText: 'Cheapest AI rank tracker?' } }),
      // Removed since: in neither.
      signal({ id: 's3', payload: { promptId: P2, promptText: 'Best AI rank tracker?' } }),
    ];
    const payload = { targetEntity: 'prompts', targetCount: 1, removedKeys: [P2] };
    const affected = affectedOf(signals, payload, [
      keptPrompt(P1, 'Which tools track AI search?'),
      keptPrompt(P2, 'Best AI rank tracker?', true),
    ]);
    expect(affected.prompts.map((p) => p.id)).toEqual([P1]);
    expect(demandPromptIds(affected, signals, payload)).toEqual([P1, P9]);
  });

  it('is empty for an action with nothing to list', () => {
    expect(affectedOf([], {})).toMatchObject({ prompts: [], pages: [], promptTotal: 0 });
  });
});

describe('affectedCounts', () => {
  it('counts the pages that lost a citation with the listed ones, once each', () => {
    const affected = affectedOf([
      signal({
        payload: {
          promptId: 'p1',
          promptText: 'One',
          lostUrls: [{ url: 'https://acme.example/a' }, { url: 'https://acme.example/b' }],
        },
        where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
      }),
      signal({
        id: 's2',
        payload: {
          promptId: 'p2',
          promptText: 'Two',
          lostUrls: [{ url: 'https://acme.example/a' }],
        },
      }),
    ]);
    expect(affectedCounts(affected)).toEqual({
      prompts: 2,
      pages: 2,
      platforms: 1,
      competitors: 0,
      topics: 0,
    });
    expect(affectedTotal(affected)).toBe(2);
  });
});

describe('leaderText', () => {
  const t = (key: string, values?: Record<string, string | number>) =>
    `${key}(${Object.values(values ?? {}).join(',')})`;

  it('names the competitor, both positions and the platform', () => {
    expect(
      leaderText({ competitor: 'Trade Coffee', platform: 'chatgpt-web', them: 1, you: 4 }, t),
    ).toBe('aheadValue(Trade Coffee,#1,ChatGPT,#4)');
  });

  it('says so when the brand is not named', () => {
    expect(
      leaderText({ competitor: 'Trade Coffee', platform: 'gemini-web', them: 2, you: null }, t),
    ).toBe('aheadNotNamed(Trade Coffee,#2,Gemini)');
  });
});

describe('what the review found', () => {
  it('does not count a bare prompt count on top of the rows it lists', () => {
    const affected = affectedOf([
      signal({
        category: 'mention',
        kind: 'uncited_mentions',
        payload: {
          promptIds: ['p1', 'p2'],
          mentions: [
            { promptId: 'p1', promptText: 'One', platforms: ['chatgpt-web'], answers: 3 },
            { promptId: 'p2', promptText: 'Two', platforms: ['gemini-web'], answers: 1 },
          ],
        },
        currentValue: 2,
      }),
    ]);
    expect(affected.prompts).toHaveLength(2);
    expect(affected.promptTotal).toBe(2);
  });

  it('counts a platform once whether it is an engine or the site visits came from', () => {
    const affected = affectedOf([
      signal({
        payload: { promptId: 'p1', promptText: 'One' },
        where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
      }),
      signal({
        id: 's2',
        category: 'traffic',
        kind: 'ai_traffic_drop',
        payload: {
          entity: 'pages',
          targets: [{ id: '/a', label: '/a', before: 10, now: 5 }],
          referrals: [
            {
              page: '/a',
              sessions: 5,
              before: 10,
              platforms: [{ platform: 'chatgpt.com', sessions: 5, before: 10 }],
            },
          ],
        },
      }),
    ]);
    expect(affectedCounts(affected).platforms).toBe(1);
  });

  it('keeps visits one signal recorded when another names the page without them', () => {
    const affected = affectedOf([
      signal({
        category: 'traffic',
        kind: 'ai_traffic_drop',
        payload: { entity: 'pages', targets: [{ id: '/a', label: '/a', before: 40, now: 32 }] },
      }),
      signal({
        id: 's2',
        category: 'traffic',
        kind: 'ai_traffic_slipping',
        payload: { entity: 'pages', targets: [{ id: '/a', label: '/a' }] },
      }),
    ]);
    expect(affected.pages[0]).toMatchObject({ sessions: 32, before: 40 });
  });

  it("names a single-prompt signal's topic, which tells copies of one prompt apart", () => {
    const affected = affectedOf([
      signal({
        payload: { promptId: 'p1', promptText: 'Same text' },
        where: { platforms: [], regions: [], topics: ['Coffee subscriptions'] },
      }),
      signal({
        id: 's2',
        payload: { promptId: 'p2', promptText: 'Same text' },
        where: { platforms: [], regions: [], topics: ['Office coffee'] },
      }),
    ]);
    expect(affected.prompts.map((p) => p.topics)).toEqual([
      ['Coffee subscriptions'],
      ['Office coffee'],
    ]);
  });
});

describe('affectedChips', () => {
  const lost = signal({
    payload: { promptId: 'p1', promptText: 'One' },
    where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
  });

  it('opens the Signals tab for signals and Affected for the rest', () => {
    const chips = affectedChips([lost], affectedOf([lost]), 'a1');
    expect(chips).toEqual([
      { entity: 'signals', count: 1, tab: 'signals' },
      { entity: 'prompts', count: 1, tab: 'affected' },
      { entity: 'platforms', count: 1, tab: 'affected' },
    ]);
  });

  it("counts all the action's signals once none supports it any more", () => {
    const resolved = { ...lost, status: 'resolved' } as Signal;
    const chips = affectedChips([resolved], affectedOf([resolved]), 'a1');
    expect(chips[0]).toEqual({ entity: 'signals', count: 1, tab: 'signals' });
  });
});

describe('affectedSummary', () => {
  const affected = (over: Partial<Affected>): Affected => ({
    prompts: [],
    pages: [],
    promptTotal: 0,
    pageTotal: 0,
    platforms: [],
    lostPages: [],
    competitors: [],
    topics: [],
    ...over,
  });
  const prompt = (text: string) => ({
    id: null,
    text,
    platforms: [],
    lostPages: [],
    citedInstead: [],
    leaders: [],
    topics: [],
  });

  it("names the tab's rows, and counts a group past the 50 it names", () => {
    expect(
      affectedSummary(
        affected({
          prompts: [prompt('Best coffee subscription?')],
          promptTotal: 62,
          pages: [
            {
              url: 'https://acme.example/pricing',
              sessions: null,
              before: null,
              platforms: [],
              issues: [],
            },
          ],
          pageTotal: 1,
          competitors: ['Trade Coffee'],
        }),
      ),
    ).toEqual({ count: 63, items: ['Best coffee subscription?', 'https://acme.example/pricing'] });
  });

  it('names the competitors and topics when there are no rows, as the tab lists them', () => {
    expect(
      affectedSummary(affected({ competitors: ['Trade Coffee'], topics: ['Subscriptions'] })),
    ).toEqual({ count: 2, items: ['Trade Coffee', 'Subscriptions'] });
    expect(affectedSummary(affected({}))).toEqual({ count: 0, items: [] });
  });
});
