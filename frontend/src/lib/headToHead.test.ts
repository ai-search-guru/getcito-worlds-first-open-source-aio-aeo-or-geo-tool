import { describe, expect, it } from 'vitest';

import {
  competitorScoreIn,
  headToHeadFromRollups,
  type HeadToHeadRollupEngine,
  type HeadToHeadRollupGroup,
  type HeadToHeadRollups,
} from './headToHead';

const COMP = 'comp-1';
const prompts: HeadToHeadRollups['prompts'] = [
  { id: 'p1', text: 'best crm for startups', category: 'comparison' },
  { id: 'p2', text: 'how to pick a crm', category: null },
];
const provider = (model: string | null, platform: string | null) =>
  platform === 'chatgpt' ? 'ChatGPT' : (model ?? 'Unknown');

function group(overrides: Partial<HeadToHeadRollupGroup>): HeadToHeadRollupGroup {
  return {
    prompt_id: 'p1',
    platform: 'chatgpt',
    model_used: null,
    region: 'US',
    runs: 1,
    brand_total: 0,
    comp_total: 0,
    latest_at: '2026-10-01T00:00:00+00:00',
    ...overrides,
  };
}

function engine(overrides: Partial<HeadToHeadRollupEngine>): HeadToHeadRollupEngine {
  return {
    platform: 'chatgpt',
    model_used: null,
    brand_count: 1,
    brand_total: 0,
    comp_count: 0,
    comp_total: 0,
    ...overrides,
  };
}

const rollups = (r: Partial<HeadToHeadRollups>): HeadToHeadRollups => ({
  groups: [],
  engines: [],
  prompts,
  ...r,
});

const mention = (score: number, id = COMP) => [{ competitor_id: id, visibility_score: score }];

describe('competitorScoreIn', () => {
  it('returns the score when the competitor is listed, 0 when listed without one', () => {
    expect(competitorScoreIn(mention(40), COMP)).toBe(40);
    expect(competitorScoreIn([{ competitor_id: COMP }], COMP)).toBe(0);
  });

  it('returns null when the answer does not list the competitor', () => {
    expect(competitorScoreIn(mention(40, 'other'), COMP)).toBeNull();
    expect(competitorScoreIn(null, COMP)).toBeNull();
  });
});

describe('headToHeadFromRollups', () => {
  it('averages each prompt, engine, model and region group over its runs', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [
          group({
            runs: 2,
            brand_total: 100,
            comp_total: 60,
            latest_at: '2026-10-02T00:00:00+00:00',
          }),
          group({ region: 'GB', brand_total: 10, comp_total: 50 }),
        ],
      }),
      provider,
    );

    expect(data.groups).toHaveLength(2);
    expect(data.groups.find((g) => g.region === 'US')).toMatchObject({
      promptId: 'p1',
      promptText: 'best crm for startups',
      promptCategory: 'comparison',
      platform: 'ChatGPT',
      rawPlatform: 'chatgpt',
      rawModelUsed: null,
      runs: 2,
      brandScore: 50,
      competitorScore: 30,
      diff: 20,
      latestAt: '2026-10-02T00:00:00+00:00',
    });
  });

  it('lists the most recently run groups first', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [
          group({ prompt_id: 'p1', latest_at: '2026-10-01T00:00:00+00:00' }),
          group({ prompt_id: 'p2', latest_at: '2026-10-05T00:00:00+00:00' }),
        ],
      }),
      provider,
    );
    expect(data.groups.map((g) => g.promptId)).toEqual(['p2', 'p1']);
  });

  it('averages the competitor over the answers that list it, the brand over every answer', () => {
    // Two answers: the competitor is listed (30) in one, missing in the other.
    const data = headToHeadFromRollups(
      rollups({
        groups: [group({ runs: 2, brand_total: 100, comp_total: 30 })],
        engines: [engine({ brand_count: 2, brand_total: 100, comp_count: 1, comp_total: 30 })],
      }),
      provider,
    );
    expect(data.groups[0].competitorScore).toBe(15);
    expect(data.competitorAvg).toBe(30);
    expect(data.brandAvg).toBe(50);
  });

  it('breaks the averages down by display provider', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [group({ brand_total: 80, comp_total: 20 })],
        engines: [
          engine({ brand_total: 80, comp_count: 1, comp_total: 20 }),
          engine({
            platform: null,
            model_used: 'Gemini',
            brand_total: 20,
            comp_count: 1,
            comp_total: 60,
          }),
        ],
      }),
      provider,
    );
    expect(data.platformRows).toEqual([
      { platform: 'ChatGPT', brandScore: 80, competitorScore: 20, diff: 60 },
      { platform: 'Gemini', brandScore: 20, competitorScore: 60, diff: -40 },
    ]);
  });

  it('ranks gaps and strengths by group average, worst and best first', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [
          group({ prompt_id: 'p1', brand_total: 10, comp_total: 60 }),
          group({ prompt_id: 'p2', brand_total: 30, comp_total: 40 }),
          group({ prompt_id: 'p2', region: 'GB', brand_total: 90, comp_total: 10 }),
          group({ prompt_id: 'p1', region: 'GB', brand_total: 20, comp_total: 20 }),
        ],
      }),
      provider,
    );
    expect(data.gaps.map((g) => [g.promptId, g.diff])).toEqual([
      ['p1', -50],
      ['p2', -10],
    ]);
    expect(data.strengths.map((g) => [g.promptId, g.diff])).toEqual([['p2', 80]]);
  });

  it('counts answers without a prompt in the averages, which only the engines carry', () => {
    // An answer without a prompt (90) and one with (10): one group, both averaged.
    const data = headToHeadFromRollups(
      rollups({
        groups: [group({ brand_total: 10 })],
        engines: [engine({ brand_count: 2, brand_total: 100 })],
      }),
      provider,
    );
    expect(data.groups).toHaveLength(1);
    expect(data.brandAvg).toBe(50);
  });

  it('reads numbers sent as strings, as Postgres numerics arrive', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [
          group({ runs: '2' as never, brand_total: '50.5' as never, comp_total: '0' as never }),
        ],
        engines: [engine({ brand_count: '2' as never, brand_total: '101' as never })],
      }),
      provider,
    );
    expect(data.groups[0].brandScore).toBeCloseTo(25.25);
    expect(data.brandAvg).toBe(51);
  });
});
