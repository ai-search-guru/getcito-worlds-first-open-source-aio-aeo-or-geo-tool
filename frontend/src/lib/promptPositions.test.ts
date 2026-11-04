import { describe, expect, it } from 'vitest';

import { PLANS, type Plan } from '@/config/plans';
import {
  POSITION_PLATFORMS,
  brandCitationPosition,
  brandCitedPage,
  countRuns,
  platformAccess,
  summarizePositions,
  windowDays,
  type PositionAnswer,
} from './promptPositions';
import { positionTone } from './positionTone';

const accessFor = (plan: Plan) =>
  Object.fromEntries(POSITION_PLATFORMS.map((p) => [p.id, platformAccess(plan, p.id)]));

describe('POSITION_PLATFORMS', () => {
  it('lists ChatGPT, then Microsoft Copilot, and Perplexity last', () => {
    expect(POSITION_PLATFORMS.map((p) => p.label)).toEqual([
      'ChatGPT',
      'Microsoft Copilot',
      'Google AI Overviews',
      'Google AI Mode',
      'Gemini',
      'Grok',
      'Claude',
      'Perplexity',
    ]);
  });
});

describe('platformAccess', () => {
  it('locks Starter to ChatGPT and Microsoft Copilot, with Grok and Claude behind sales', () => {
    const access = accessFor(PLANS.starter);
    expect(access['chatgpt-web']).toEqual({ state: 'included' });
    expect(access['copilot-web']).toEqual({ state: 'included' });
    for (const id of ['google-aio', 'google-aimode', 'gemini-web', 'perplexity-web']) {
      expect(access[id]).toEqual({ state: 'locked', requiredPlan: 'growth' });
    }
    expect(access['grok-web']).toEqual({ state: 'locked', requiredPlan: 'enterprise' });
    expect(access.claude).toEqual({ state: 'locked', requiredPlan: 'enterprise' });
  });

  it('includes the other scrapers on Growth and leaves Grok and Claude to sales', () => {
    const access = accessFor(PLANS.growth);
    for (const p of POSITION_PLATFORMS.filter((p) => p.id !== 'claude' && p.id !== 'grok-web')) {
      expect(access[p.id]).toEqual({ state: 'included' });
    }
    expect(access['grok-web']).toEqual({ state: 'locked', requiredPlan: 'enterprise' });
    expect(access.claude).toEqual({ state: 'locked', requiredPlan: 'enterprise' });
  });

  it('leaves Grok to sales on Enterprise too', () => {
    expect(platformAccess(PLANS.enterprise, 'grok-web')).toEqual({
      state: 'locked',
      requiredPlan: 'enterprise',
    });
  });

  it('includes Claude on Enterprise only when the customer override enables it', () => {
    expect(platformAccess(PLANS.enterprise, 'claude')).toEqual({
      state: 'locked',
      requiredPlan: 'enterprise',
    });
    const overridden: Plan = {
      ...PLANS.enterprise,
      limits: { ...PLANS.enterprise.limits, allowedModels: ['claude-sonnet-5'] },
    };
    expect(platformAccess(overridden, 'claude')).toEqual({ state: 'included' });
  });

  it('includes everything when self-hosted', () => {
    const access = accessFor(PLANS.self_hosted);
    expect(Object.values(access).every((a) => a.state === 'included')).toBe(true);
  });
});

describe('positionTone', () => {
  it('splits a list into thirds', () => {
    expect(positionTone(1, 9)).toBe('Early');
    expect(positionTone(3, 9)).toBe('Early');
    expect(positionTone(5, 9)).toBe('Mid');
    expect(positionTone(7, 9)).toBe('Late');
    expect(positionTone(5, 5)).toBe('Late');
  });

  it('calls the only entry Early', () => {
    expect(positionTone(1, 1)).toBe('Early');
  });
});

describe('brandCitedPage', () => {
  const brand = ['acme.example'];
  const cite = (url: string, title?: string) => ({ url, title });

  it('is the brand page cited in the most answers, whatever its address carries', () => {
    expect(
      brandCitedPage(
        [
          [
            cite('https://rival.example/a'),
            cite('https://acme.example/guide?utm_source=chatgpt.com'),
          ],
          [
            cite('https://www.acme.example/guide/', 'The guide'),
            cite('https://acme.example/pricing'),
          ],
          // Twice in one answer counts once.
          [cite('https://blog.acme.example/x'), cite('https://blog.acme.example/x#top')],
        ],
        brand,
      ),
    ).toEqual({ url: 'https://acme.example/guide', title: 'The guide', answers: 2 });
  });

  it('breaks a tie for the newest answer, the first list', () => {
    expect(
      brandCitedPage(
        [[cite('https://acme.example/new')], [cite('https://acme.example/old')]],
        brand,
      ),
    ).toMatchObject({ url: 'https://acme.example/new', answers: 1 });
  });

  it('is null with no source of the brand, or no domains', () => {
    expect(brandCitedPage([[cite('https://rival.example/a')], null, 'x'], brand)).toBeNull();
    expect(brandCitedPage([[cite('https://acme.example/a')]], [])).toBeNull();
  });
});

describe('brandCitationPosition', () => {
  const cites = (...urls: (string | null)[]) => urls.map((url) => ({ url, title: '' }));

  it('ranks the first own-domain source among the sources with a URL', () => {
    const result = brandCitationPosition(
      cites('https://a.com', null, 'https://blog.acme.com/x', 'https://www.acme.com/y'),
      ['acme.com'],
    );
    expect(result).toEqual({ rank: 2, total: 3 });
  });

  it('does not match the domain inside another site', () => {
    expect(
      brandCitationPosition(cites('https://notacme.com', 'https://x.com/?u=acme.com'), [
        'https://www.acme.com/',
      ]),
    ).toBeNull();
  });

  it('returns null without domains or citations', () => {
    expect(brandCitationPosition(cites('https://acme.com'), [])).toBeNull();
    expect(brandCitationPosition(null, ['acme.com'])).toBeNull();
  });
});

describe('windowDays', () => {
  it('drops the partial first date of a rolling window when nothing landed in it', () => {
    const days = windowDays('2026-10-03T14:00:00.000Z', '2026-10-10T14:00:00.000Z', new Set());
    expect(days).toEqual([
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ]);
  });

  it('keeps the partial first date when an answer landed in it', () => {
    const days = windowDays(
      '2026-10-03T14:00:00.000Z',
      '2026-10-10T14:00:00.000Z',
      new Set(['2026-10-03']),
    );
    expect(days[0]).toBe('2026-10-03');
    expect(days).toHaveLength(8);
  });

  it('keeps every date of a whole-day custom range', () => {
    expect(windowDays('2026-10-01T00:00:00.000Z', '2026-10-03T23:59:59.999Z', new Set())).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });

  it("counts the viewer's days: a whole-day range in Istanbul stays three days", () => {
    expect(
      windowDays(
        '2026-09-30T21:00:00.000Z',
        '2026-10-03T20:59:59.999Z',
        new Set(),
        'Europe/Istanbul',
      ),
    ).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('returns no days, rather than failing, for a window that ends before it starts', () => {
    expect(windowDays('2026-10-05T00:00:00.000Z', '2026-10-03T00:00:00.000Z', new Set())).toEqual(
      [],
    );
  });
});

describe('countRuns', () => {
  it('counts answers a few hours apart as one run and a day apart as two', () => {
    expect(
      countRuns([
        '2026-10-08T02:01:00Z',
        '2026-10-08T02:40:00Z',
        '2026-10-08T04:10:00Z',
        '2026-10-09T02:05:00Z',
      ]),
    ).toBe(2);
  });

  it('counts nothing for no answers', () => {
    expect(countRuns([])).toBe(0);
  });
});

function answer(over: Partial<PositionAnswer> & { createdAt: string }): PositionAnswer {
  return {
    platform: 'chatgpt-web',
    region: 'us',
    mentioned: false,
    mentions: 0,
    mentionPosition: null,
    mentionTotal: null,
    sentiment: null,
    cited: false,
    citations: 0,
    citation: null,
    ...over,
  };
}

const included = { state: 'included' } as const;
const growthOnly = { state: 'locked', requiredPlan: 'growth' } as const;
const PLATFORMS = [
  { id: 'chatgpt-web' as const, label: 'ChatGPT', access: included },
  { id: 'perplexity-web' as const, label: 'Perplexity', access: included },
  { id: 'google-aio' as const, label: 'Google AI Overviews', access: growthOnly },
];
const WEEK = { from: '2026-10-04T00:00:00.000Z', to: '2026-10-10T23:59:59.999Z' };

describe('summarizePositions', () => {
  it("counts the answers, mentions and citations the Prompts table's columns count", () => {
    const { summary } = summarizePositions(
      [
        answer({
          createdAt: '2026-10-08T02:00:00Z',
          mentioned: true,
          mentions: 3,
          cited: true,
          citations: 2,
        }),
        answer({ createdAt: '2026-10-08T02:20:00Z', mentioned: true, mentions: 1 }),
        answer({ createdAt: '2026-10-09T02:00:00Z', platform: 'perplexity-web' }),
        // A locked engine's answer is not the panel's, nor counted.
        answer({
          createdAt: '2026-10-09T02:00:00Z',
          platform: 'google-aio',
          mentioned: true,
          mentions: 5,
        }),
      ],
      PLATFORMS,
      WEEK,
    );
    expect(summary).toMatchObject({
      answers: 3,
      mentionedAnswers: 2,
      citedAnswers: 1,
      mentions: 4,
      citations: 2,
      runs: 2,
      mentionedDays: 1,
    });
  });

  it("files an answer under the viewer's day, not the UTC one", () => {
    const late = answer({ createdAt: '2026-10-08T22:30:00Z', mentioned: true, mentionPosition: 1 });
    const utc = summarizePositions([late], PLATFORMS, WEEK);
    const istanbul = summarizePositions([late], PLATFORMS, WEEK, 'Europe/Istanbul');
    expect(utc.platforms[0].days[0].day).toBe('2026-10-08');
    // 22:30 UTC is 01:30 the next morning in Istanbul (UTC+3).
    expect(istanbul.platforms[0].days[0].day).toBe('2026-10-09');
    expect(istanbul.summary.mentionedDays).toBe(1);
  });

  it('counts a day once however many answers it has, and keeps every answer', () => {
    const { platforms } = summarizePositions(
      [
        answer({ createdAt: '2026-10-08T02:00:00Z' }),
        answer({
          createdAt: '2026-10-08T09:00:00Z',
          cited: true,
          citation: { rank: 2, total: 8 },
        }),
        answer({ createdAt: '2026-10-08T15:00:00Z' }),
      ],
      PLATFORMS,
      WEEK,
    );
    const chatgpt = platforms[0];
    expect(chatgpt.runs).toBe(3);
    expect(chatgpt.trackedDays).toBe(1);
    expect(chatgpt.citedDays).toBe(1);
    expect(chatgpt.days[0].answers).toHaveLength(3);
    expect(chatgpt.days[0].answers.filter((a) => a.cited)).toHaveLength(1);
  });

  it('never counts a day without an answer as not mentioned', () => {
    const { summary } = summarizePositions(
      [
        answer({ createdAt: '2026-10-05T02:00:00Z', mentioned: true, mentionPosition: 1 }),
        answer({ createdAt: '2026-10-06T02:00:00Z' }),
        answer({ createdAt: '2026-10-07T02:00:00Z', mentioned: true, mentionPosition: 3 }),
        answer({ createdAt: '2026-10-08T02:00:00Z' }),
        answer({ createdAt: '2026-10-09T02:00:00Z', cited: true }),
      ],
      PLATFORMS,
      WEEK,
    );
    expect(summary.days).toHaveLength(7);
    expect(summary.trackedDays).toBe(5);
    expect(summary.mentionedDays).toBe(2);
    expect(summary.citedDays).toBe(1);
    expect(summary.untrackedDays).toBe(2);
  });

  it('merges engines into one run and one day for the summary, but not per engine', () => {
    const { summary, platforms } = summarizePositions(
      [
        answer({ createdAt: '2026-10-08T02:00:00Z', mentioned: true, mentionPosition: 2 }),
        answer({
          createdAt: '2026-10-08T02:30:00Z',
          platform: 'perplexity-web',
          mentioned: true,
          mentionPosition: 4,
        }),
      ],
      PLATFORMS,
      WEEK,
    );
    expect(summary.runs).toBe(1);
    expect(summary.mentionedDays).toBe(1);
    expect(summary.mentionPosition).toEqual({ best: 2, worst: 4, avg: 3, count: 2 });
    expect(platforms[0].runs).toBe(1);
    expect(platforms[1].runs).toBe(1);
  });

  it('gives a locked engine no data even when answers exist for it', () => {
    const { platforms, summary } = summarizePositions(
      [answer({ createdAt: '2026-10-08T02:00:00Z', platform: 'google-aio', mentioned: true })],
      PLATFORMS,
      WEEK,
    );
    expect(platforms[2].runs).toBe(0);
    expect(platforms[2].latest).toBeNull();
    expect(summary.trackedDays).toBe(0);
  });

  it('flags a mention seen earlier in the window when the latest answer has none', () => {
    const { platforms } = summarizePositions(
      [
        answer({ createdAt: '2026-10-09T20:00:00Z', mentioned: true, mentionPosition: 1 }),
        answer({ createdAt: '2026-10-10T02:00:00Z' }),
      ],
      PLATFORMS,
      WEEK,
    );
    expect(platforms[0].latest?.mentioned).toBe(false);
    expect(platforms[0].mentionedEarlier).toBe(true);
    expect(platforms[0].citedEarlier).toBe(false);
  });

  it('leaves position and sentiment empty rather than inventing them', () => {
    const { platforms } = summarizePositions(
      [answer({ createdAt: '2026-10-08T02:00:00Z', mentioned: true, cited: true })],
      PLATFORMS,
      WEEK,
    );
    const latest = platforms[0].latest!;
    expect(latest.mention).toBeNull();
    expect(latest.citation).toBeNull();
    expect(latest.sentiment).toBeNull();
    expect(platforms[0].sentiment.unavailable).toBe(1);
    expect(platforms[0].mentionPosition).toBeNull();
  });
});
