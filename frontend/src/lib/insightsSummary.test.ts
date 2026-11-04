import { describe, expect, it } from 'vitest';
import { computeAiVisibilityScore } from './visibilityScore';
import {
  leaderboardCallout,
  leaderboardLines,
  mentionShares,
  parsePlatformRows,
  platformChanges,
  platformMovers,
  platformTable,
  rankSummary,
  type PlatformChange,
  type PlatformRow,
} from './insightsSummary';

const row = (
  model_used: string | null,
  platform: string | null,
  win: 'cur' | 'prev',
  answers: number,
  mentions: number,
  extra: Partial<PlatformRow> = {},
): PlatformRow => ({
  model_used,
  platform,
  win,
  answers,
  mention_answers: mentions,
  citation_answers: 0,
  sum_inv_position: null,
  position_count: 0,
  sum_position: null,
  visible_prompt_ids: [],
  active_prompt_ids: [],
  ...extra,
});

// Model slugs fold into platform names, as resolveProvider does.
const platformOf = (model: string | null, platform: string | null) =>
  platform === 'google-aimode' ? 'Google AI Mode' : model?.startsWith('gpt-') ? 'ChatGPT' : 'Other';

const score = (answers: number, mentions: number) =>
  computeAiVisibilityScore({
    answers,
    mentionAnswers: mentions,
    citationAnswers: 0,
    positionFactor: null,
  })!;

describe('platformChanges', () => {
  it('scores each platform in both windows, folding model slugs together', () => {
    const changes = platformChanges(
      [
        row('gpt-5-mini', null, 'cur', 50, 10),
        row('gpt-4o', null, 'cur', 50, 10),
        row('gpt-5-mini', null, 'prev', 100, 40),
        row(null, 'google-aimode', 'cur', 100, 60),
        row(null, 'google-aimode', 'prev', 100, 20),
      ],
      platformOf,
    );

    expect(changes.map((c) => c.name)).toEqual(['Google AI Mode', 'ChatGPT']);
    const chatgpt = changes[1];
    expect(chatgpt.cur).toBe(score(100, 20));
    expect(chatgpt.change).toBe(Math.round((score(100, 20) - score(100, 40)) * 10) / 10);
  });

  it('leaves out platforms not answered in both windows', () => {
    expect(platformChanges([row('gpt-5-mini', null, 'cur', 30, 5)], platformOf)).toEqual([]);
  });

  it('leaves out a change over fewer than 20 answers in either window', () => {
    const changes = platformChanges(
      [
        row('gpt-4o', null, 'cur', 40, 4),
        row('gpt-4o', null, 'prev', 19, 15),
        row(null, 'google-aimode', 'cur', 20, 10),
        row(null, 'google-aimode', 'prev', 20, 2),
      ],
      platformOf,
    );

    expect(changes.map((c) => c.name)).toEqual(['Google AI Mode']);
  });
});

describe('platformMovers', () => {
  const change = (name: string, c: number) => ({ name, cur: 0, prev: 0, change: c });

  it('names the biggest rise and the biggest drop', () => {
    const sorted = [change('A', 16.1), change('B', 2), change('C', -1), change('D', -3.2)];

    expect(platformMovers(sorted)).toEqual({ up: sorted[0], down: sorted[3] });
  });

  it('names nothing when nothing moved that way', () => {
    expect(platformMovers([change('A', 0), change('B', -1)])).toEqual({
      up: null,
      down: change('B', -1),
    });
    expect(platformMovers([])).toEqual({ up: null, down: null });
  });
});

describe('rankSummary', () => {
  const brand = (name: string, score: number, isOwnBrand = false) => ({ name, score, isOwnBrand });

  it('gives the gap to the brand directly ahead', () => {
    expect(
      rankSummary([brand('Semrush', 36.3), brand('Peec AI', 18.3), brand('GetCito', 17.4, true)]),
    ).toEqual({
      rank: 3,
      count: 3,
      neighbour: { name: 'Peec AI', gap: 0.9, side: 'behind' },
    });
  });

  it('gives the lead over the runner-up when first', () => {
    expect(rankSummary([brand('GetCito', 78.8, true), brand('Demo Coffee Co', 61.9)])).toEqual({
      rank: 1,
      count: 2,
      neighbour: { name: 'Demo Coffee Co', gap: 16.9, side: 'ahead' },
    });
  });

  it('has no rank alone on the leaderboard', () => {
    expect(rankSummary([brand('GetCito', 78.8, true)])).toBeNull();
  });
});

describe('parsePlatformRows', () => {
  it('reads the RPC payload and refuses rollups not yet backfilled', () => {
    expect(
      parsePlatformRows({
        complete: true,
        platforms: [{ model_used: 'gpt-4o', platform: null, win: 'prev', answers: '3' }],
      }),
    ).toEqual([
      {
        model_used: 'gpt-4o',
        platform: null,
        win: 'prev',
        answers: 3,
        mention_answers: 0,
        citation_answers: 0,
        sum_inv_position: null,
        position_count: 0,
        sum_position: null,
        visible_prompt_ids: [],
        active_prompt_ids: [],
      },
    ]);
    expect(parsePlatformRows({ complete: false, platforms: [] })).toBeNull();
  });

  it('reads the 00133 position sum and prompt ids', () => {
    expect(
      parsePlatformRows({
        complete: true,
        platforms: [
          {
            model_used: 'gpt-4o',
            win: 'cur',
            sum_position: '12',
            visible_prompt_ids: ['p1'],
            active_prompt_ids: ['p1', 'p2'],
          },
        ],
      })?.[0],
    ).toMatchObject({
      sum_position: 12,
      visible_prompt_ids: ['p1'],
      active_prompt_ids: ['p1', 'p2'],
    });
  });
});

describe('platformTable', () => {
  const change = (name: string, c: number): PlatformChange => ({
    name,
    cur: 0,
    prev: 0,
    change: c,
  });

  it('folds model slugs and fills each column from the current window', () => {
    const [chatgpt] = platformTable(
      [
        row('gpt-5-mini', null, 'cur', 30, 6, {
          sum_inv_position: 2,
          position_count: 4,
          sum_position: 10,
          visible_prompt_ids: ['p1', 'p2'],
          active_prompt_ids: ['p1', 'p2', 'p3', 'p4'],
        }),
        // The same prompts on another ChatGPT model count once.
        row('gpt-4o', null, 'cur', 30, 6, {
          sum_inv_position: 1,
          position_count: 2,
          sum_position: 8,
          visible_prompt_ids: ['p2', 'p3'],
          active_prompt_ids: ['p1', 'p2', 'p3', 'p4', 'p5'],
        }),
        row('gpt-4o', null, 'prev', 60, 50),
      ],
      [change('ChatGPT', -3.2)],
      [{ provider: 'ChatGPT', sov: 41.5 }],
      platformOf,
    );

    expect(chatgpt).toEqual({
      name: 'ChatGPT',
      status: 'ok',
      runs: 60,
      visibility: computeAiVisibilityScore({
        answers: 60,
        mentionAnswers: 12,
        citationAnswers: 0,
        positionFactor: 3 / 6,
      }),
      change: -3.2,
      coverage: 60,
      shareOfVoice: 41.5,
      avgPosition: 3,
      worst: true,
    });
  });

  it('shows why instead of numbers below 20 answers or without runs', () => {
    const table = platformTable(
      [
        row(null, 'google-aimode', 'prev', 50, 10),
        row('claude-sonnet', null, 'cur', 12, 6),
        row('gpt-4o', null, 'cur', 40, 4),
      ],
      [change('Other', -5)],
      [{ provider: 'Other', sov: 80 }],
      platformOf,
    );

    expect(table.map((r) => [r.name, r.status, r.runs])).toEqual([
      ['ChatGPT', 'ok', 40],
      ['Other', 'lowSample', 12],
      ['Google AI Mode', 'noRuns', 0],
    ]);
    // A low-sample row has no values, so its drop doesn't tint it.
    expect(table[1]).toMatchObject({ visibility: null, change: null, shareOfVoice: null });
    expect(table.some((r) => r.worst)).toBe(false);
  });

  it('sorts by Visibility and tints only the biggest drop', () => {
    const table = platformTable(
      [row('gpt-4o', null, 'cur', 40, 4), row(null, 'google-aimode', 'cur', 40, 30)],
      [change('ChatGPT', -1), change('Google AI Mode', -4)],
      [],
      platformOf,
    );

    expect(table.map((r) => [r.name, r.worst])).toEqual([
      ['Google AI Mode', true],
      ['ChatGPT', false],
    ]);
    expect(table[0].shareOfVoice).toBeNull();
  });
});

describe('leaderboardLines', () => {
  const lines = (count: number, own: number) => {
    const { items, hidden } = leaderboardLines(count, own);
    return {
      lines: items.map((i) => (i.kind === 'brand' ? i.index + 1 : `${i.count} more`)),
      hidden,
    };
  };

  it('shows ranks 1 and 2, then the brands around yours, as in the mockup', () => {
    expect(lines(20, 5)).toEqual({ lines: [1, 2, '2 more', 5, 6, 7], hidden: 15 });
  });

  it('shows at least five brands when the brand is near the top', () => {
    expect(lines(8, 0)).toEqual({ lines: [1, 2, 3, 4, 5], hidden: 3 });
    expect(lines(8, 1)).toEqual({ lines: [1, 2, 3, 4, 5], hidden: 3 });
    expect(lines(8, 2)).toEqual({ lines: [1, 2, 3, 4, 5], hidden: 3 });
    expect(lines(8, 3)).toEqual({ lines: [1, 2, 3, 4, 5], hidden: 3 });
  });

  it('shows the brand directly ahead when last, and fills up from the top', () => {
    expect(lines(8, 7)).toEqual({ lines: [1, 2, 3, '3 more', 7, 8], hidden: 3 });
    // One brand in between is shown, not folded into "1 more".
    expect(lines(6, 5)).toEqual({ lines: [1, 2, 3, 4, 5, 6], hidden: 0 });
    expect(lines(20, 4)).toEqual({ lines: [1, 2, 3, 4, 5, 6], hidden: 14 });
  });

  it('lists short boards whole, and starts from the top without the brand', () => {
    expect(lines(5, 4)).toEqual({ lines: [1, 2, 3, 4, 5], hidden: 0 });
    expect(lines(8, -1)).toEqual({ lines: [1, 2, 3, 4, 5], hidden: 3 });
  });
});

describe('mentionShares', () => {
  it("gives each brand's share of every brand's mentions", () => {
    expect(
      mentionShares([{ totalMentions: 377 }, { totalMentions: 189 }, { totalMentions: 252 }]),
    ).toEqual([46.1, 23.1, 30.8]);
    expect(mentionShares([{ totalMentions: 0 }, { totalMentions: 0 }])).toEqual([null, null]);
  });
});

describe('leaderboardCallout', () => {
  const brand = (name: string, score: number, isOwnBrand = false) => ({ name, score, isOwnBrand });
  const board = [
    brand('Semrush', 36.3),
    brand('Peec AI', 18.3),
    brand('GetCito', 17.4, true),
    brand('Otterly', 16.8),
  ];
  const rows = [
    { provider: 'ChatGPT', 'Peec AI': 60, GetCito: 30 },
    { provider: 'Gemini', 'Peec AI': 50, GetCito: 45 },
    { provider: 'Grok', 'Peec AI': 90, GetCito: 0 },
  ];

  it('gives the gap to the brand ahead and where it leads most', () => {
    expect(leaderboardCallout(board, rows, (p) => p !== 'Grok')).toEqual({
      rank: 2,
      gap: 0.9,
      lever: 'ChatGPT',
    });
  });

  it('names no lever where the brand ahead leads nowhere', () => {
    expect(leaderboardCallout(board, rows, () => false)?.lever).toBeNull();
  });

  it('reads a tie with the brand ahead as a gap of 0', () => {
    const level = [brand('Peec AI', 18.3), brand('GetCito', 18.3, true)];
    expect(leaderboardCallout(level, rows, (p) => p !== 'Grok')).toEqual({
      rank: 1,
      gap: 0,
      lever: 'ChatGPT',
    });
  });

  it('counts a platform without a row for a brand as 0 there', () => {
    expect(
      leaderboardCallout(board, [{ provider: 'Copilot', 'Peec AI': 12 }], () => true)?.lever,
    ).toBe('Copilot');
  });

  it('has no callout in first place, even when level with second', () => {
    expect(
      leaderboardCallout([brand('GetCito', 20, true), brand('Peec AI', 20)], rows, () => true),
    ).toBeNull();
  });
});
