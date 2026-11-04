import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * VIS-001: the Visibility card, the "View breakdown" panel and the
 * leaderboard's own row must show the same number and the same change for
 * the same filters. All three are fed the same aggregate payloads here; they
 * used to disagree because the panel scored a 1,000-row sample over its own
 * windows, and the leaderboard compared All time with a 7-day window.
 */

type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];

// Current window: 1,800 answers; previous window: 1,600.
const visibilityPayload = (answers: number, mentions: number, citations: number) => ({
  answers,
  mention_answers: mentions,
  citation_answers: citations,
  position_factor: 0.5,
  by_competitor: [],
});
const CUR = visibilityPayload(1800, 540, 180);
let PREV = visibilityPayload(1600, 400, 176);

// The Mentions card's aggregates: insights_aggregates(_daily).
const summaryPayload = (results: number, mentions: number) => ({
  total_results: results,
  sum_visibility: 0,
  total_mentions: mentions,
  total_citations: 0,
  positive_count: 0,
  mentioning_results: 0,
  last_checked_at: null,
  by_model: [],
});
const SUMMARY_CUR = summaryPayload(1800, 710);
let SUMMARY_PREV = summaryPayload(1600, 500);

// insights_same_prompt_compare[_daily] (VIS-002): the prompts answered in both
// windows score lower than the full current window, which the new prompts lift.
const sameTotals = (answers: number, mentions: number, totalMentions: number) => ({
  ...visibilityPayload(answers, mentions, 50),
  by_competitor: [
    {
      competitor_id: 'c1',
      name: 'Peec AI',
      mention_answers: 60,
      citation_answers: 10,
      position_factor: 0.4,
    },
  ],
  total_mentions: totalMentions,
  total_citations: 50,
  positive_count: 20,
  mentioning_answers: mentions,
});
const SAME_PAYLOAD = {
  complete: true,
  same_prompts: 200,
  new_prompts: 509,
  dropped_prompts: 3,
  cur: sameTotals(800, 220, 300),
  prev: sameTotals(780, 200, 260),
};
let SAME: unknown = null;
let SAME_ERROR: { message: string } | null = null;

const groups = {
  groups: [
    {
      prompt_id: 'p1',
      platform: 'chatgpt',
      answers: 900,
      mention_answers: 300,
      citation_answers: 100,
      sum_inv_position: 150,
      position_count: 300,
      mentions: 410,
    },
    {
      prompt_id: 'p2',
      platform: 'gemini',
      answers: 900,
      mention_answers: 240,
      citation_answers: 80,
      sum_inv_position: 120,
      position_count: 240,
      mentions: 300,
    },
  ],
  prompts: [
    { id: 'p1', text: 'best rank tracker', topic_id: null, topic_name: null },
    { id: 'p2', text: 'geo tools', topic_id: null, topic_name: null },
  ],
};

const competitorAgg = {
  brand_row_count: 1800,
  brand_sum_visibility: 0,
  brand_total_mentions: 710,
  brand_total_citations: 180,
  brand_prompt_count: 2,
  brand_visible_prompts: 2,
  by_competitor: [],
  by_brand_provider: [],
  by_competitor_provider: [],
};

/** Which window a call reads: the previous one starts before the current one. */
const isPrev = (args: Record<string, unknown>) =>
  args.p_day_from === '2026-08-16' || args.p_date_from === '2026-10-12T06:00:00.000Z';

function rpc(name: string, args: Record<string, unknown>) {
  calls.push({ name, args });
  let data: unknown = null;
  if (name.startsWith('ai_visibility_aggregates')) data = isPrev(args) ? PREV : CUR;
  else if (name === 'insights_breakdown_groups') data = groups;
  else if (name.startsWith('visibility_rate_trend')) data = [];
  else if (name.startsWith('competitor_aggregates')) data = competitorAgg;
  else if (name.startsWith('insights_aggregates')) data = isPrev(args) ? SUMMARY_PREV : SUMMARY_CUR;
  else if (name.startsWith('insights_same_prompt_compare')) {
    if (SAME_ERROR) return Promise.resolve({ data: null, error: SAME_ERROR });
    data = SAME;
  }
  return Promise.resolve({ data, error: null });
}

function table() {
  const result = { data: [] as unknown[], error: null };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    single: async () => ({ data: { name: 'GetCito', logo_url: null }, error: null }),
    then: (resolve: (v: typeof result) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => table(), rpc }),
}));
vi.mock('@/lib/actions/topic', () => ({ getTopicById: vi.fn() }));

const {
  getVisibilityRateTrend,
  getInsightsBreakdown,
  getCompetitorComparison,
  getInsightsSummary,
} = await import('./tracking');
const { parseSamePromptComparison, withPromptComparison } =
  await import('@/lib/insightsSamePrompts');

const thirtyDays = {
  dateFrom: '2026-09-15T00:00:00.000Z',
  days: { dayFrom: '2026-09-15', dayTo: '2026-10-14' },
};

describe('Visibility parity (VIS-001)', () => {
  beforeEach(() => {
    calls = [];
    PREV = visibilityPayload(1600, 400, 176);
    SUMMARY_PREV = summaryPayload(1600, 500);
    SAME = null;
  });

  it('shows the same number and change on the card, the panel and the leaderboard', async () => {
    const card = (await getVisibilityRateTrend('b1', thirtyDays)).summary;
    const panel = await getInsightsBreakdown('b1', 'visibility', thirtyDays);
    const own = (await getCompetitorComparison('b1', thirtyDays)).brands.find((e) => e.isOwnBrand)!;

    expect(card.change).not.toBeNull();
    expect(panel.curTotal).toBe(card.rate);
    expect(panel.prevTotal).toBe(card.prevRate);
    expect(panel.delta).toBe(card.change);
    expect(own.score).toBe(card.rate);
    expect(own.scoreChange).toBe(card.change);
    expect(panel.windowDays).toBe(30);
  });

  it('labels the change with the whole days it was measured against', async () => {
    const card = (await getVisibilityRateTrend('b1', thirtyDays)).summary;

    expect(card.prevFrom).toBe('2026-08-16');
    expect(card.prevTo).toBe('2026-09-14');
  });

  it('reads the panel slices in Postgres over the card’s whole days', async () => {
    await getInsightsBreakdown('b1', 'visibility', thirtyDays);

    const groupCalls = calls.filter((c) => c.name === 'insights_breakdown_groups');
    expect(groupCalls.map((c) => [c.args.p_day_from, c.args.p_day_to])).toEqual([
      ['2026-09-15', '2026-10-14'],
      ['2026-08-16', '2026-09-14'],
    ]);
  });

  it('shows no change anywhere for All time', async () => {
    const allTime = { days: {} };
    const card = (await getVisibilityRateTrend('b1', allTime)).summary;
    const panel = await getInsightsBreakdown('b1', 'visibility', allTime);
    const own = (await getCompetitorComparison('b1', allTime)).brands.find((e) => e.isOwnBrand)!;

    expect(card.change).toBeNull();
    expect(panel).toMatchObject({ prevTotal: null, delta: null, windowDays: null });
    expect(panel.curTotal).toBe(card.rate);
    // The leaderboard used to compare all time with the trailing 7 days.
    expect(own.scoreChange).toBeNull();
    expect(calls.filter((c) => c.name === 'insights_breakdown_groups')).toHaveLength(1);
  });

  it('uses the anchored 24h window and the topic on the raw path', async () => {
    const anchored = {
      dateFrom: '2026-10-13T06:00:00.000Z',
      dateTo: '2026-10-14T06:00:00.000Z',
      topicId: 'topic-1',
    };
    const card = (await getVisibilityRateTrend('b1', anchored)).summary;
    const panel = await getInsightsBreakdown('b1', 'visibility', anchored);

    expect(panel.delta).toBe(card.change);
    const groupCalls = calls.filter((c) => c.name === 'insights_breakdown_groups');
    expect(
      groupCalls.map((c) => [c.args.p_date_from, c.args.p_date_to, c.args.p_topic_id]),
    ).toEqual([
      ['2026-10-13T06:00:00.000Z', '2026-10-14T06:00:00.000Z', 'topic-1'],
      ['2026-10-12T06:00:00.000Z', '2026-10-13T06:00:00.000Z', 'topic-1'],
    ]);
  });

  it('says there is nothing to compare when the previous window had no answers', async () => {
    PREV = visibilityPayload(0, 0, 0);
    const card = (await getVisibilityRateTrend('b1', thirtyDays)).summary;
    const panel = await getInsightsBreakdown('b1', 'visibility', thirtyDays);

    expect(card.change).toBeNull();
    expect(panel).toMatchObject({ prevTotal: null, delta: null, windowDays: 30 });
    expect(panel.rootCause).toContain('No answers in one of the two 30-day windows');
  });

  it('matches the Mentions card, which shows no change without previous answers', async () => {
    const withPrev = await getInsightsBreakdown('b1', 'mentions', thirtyDays);
    const cardWithPrev = await getInsightsSummary('b1', thirtyDays);
    expect(withPrev).toMatchObject({ curTotal: 710, prevTotal: 500, delta: 210 });
    expect(withPrev.deltaPct).toBe(cardWithPrev.mentionsChange);

    SUMMARY_PREV = summaryPayload(0, 0);
    const panel = await getInsightsBreakdown('b1', 'mentions', thirtyDays);
    const card = await getInsightsSummary('b1', thirtyDays);
    expect(card.mentionsChange).toBeNull();
    expect(panel).toMatchObject({ curTotal: 710, prevTotal: null, delta: null, deltaPct: null });
  });
});

describe('Same prompts parity (VIS-002)', () => {
  beforeEach(() => {
    calls = [];
    PREV = visibilityPayload(1600, 400, 176);
    SUMMARY_PREV = summaryPayload(1600, 500);
    SAME = SAME_PAYLOAD;
    SAME_ERROR = null;
  });

  /** What the page gets: the cards, re-measured on the shared prompts. */
  async function cards(samePrompts: boolean) {
    const [trend, summary, competitors] = await Promise.all([
      getVisibilityRateTrend('b1', thirtyDays),
      getInsightsSummary('b1', thirtyDays),
      getCompetitorComparison('b1', thirtyDays),
    ]);
    return withPromptComparison(
      { trend, summary, competitors, sov: { overallSovChange: null }, coverage: null },
      parseSamePromptComparison(SAME),
      samePrompts,
    );
  }

  it('shows the same change on the card, the panel and the leaderboard', async () => {
    const card = await cards(true);
    const panel = await getInsightsBreakdown('b1', 'visibility', thirtyDays);
    const mentions = await getInsightsBreakdown('b1', 'mentions', thirtyDays);
    const own = card.competitors.brands.find((e) => e.isOwnBrand)!;

    expect(panel.comparison).toEqual({
      basis: 'same',
      samePrompts: 200,
      newPrompts: 509,
      droppedPrompts: 3,
    });
    expect(panel.delta).not.toBeNull();
    expect(panel.delta).toBe(card.trend!.summary.change);
    expect(own.scoreChange).toBe(panel.delta);
    expect(mentions.deltaPct).toBe(card.summary.mentionsChange);
    expect(mentions).toMatchObject({ comparedCur: 300, prevTotal: 260, delta: 40 });
    // The numbers themselves still cover every prompt.
    expect(panel.curTotal).toBe(card.trend!.summary.rate);
    expect(mentions.curTotal).toBe(710);
  });

  it('compares all prompts when the switch is off, and still counts the new ones', async () => {
    const card = await cards(false);
    const panel = await getInsightsBreakdown('b1', 'visibility', {
      ...thirtyDays,
      samePrompts: false,
    });

    expect(panel.comparison?.basis).toBe('all');
    expect(panel.comparison?.newPrompts).toBe(509);
    expect(panel.delta).toBe(card.trend!.summary.change);
    expect(panel.comparedCur).toBe(panel.curTotal);
  });

  it('compares all prompts until the rollups are backfilled', async () => {
    SAME = { ...SAME_PAYLOAD, complete: false };
    const card = await cards(true);
    const panel = await getInsightsBreakdown('b1', 'visibility', thirtyDays);

    expect(card.comparison).toBeNull();
    expect(panel.comparison).toBeNull();
    expect(panel.delta).toBe(card.trend!.summary.change);
  });

  it('compares all prompts in the panel when the shared-prompt read fails', async () => {
    SAME_ERROR = { message: 'canceling statement due to statement timeout' };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const card = (await getVisibilityRateTrend('b1', thirtyDays)).summary;
    const panel = await getInsightsBreakdown('b1', 'visibility', thirtyDays);

    expect(panel.comparison).toBeNull();
    expect(panel.delta).toBe(card.change);
    expect(panel.comparedCur).toBe(panel.curTotal);
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('reads the shared prompts over the card\u2019s whole days', async () => {
    await getInsightsBreakdown('b1', 'visibility', thirtyDays);

    const call = calls.find((c) => c.name === 'insights_same_prompt_compare_daily')!;
    expect(call.args).toMatchObject({
      p_cur_from: '2026-09-15',
      p_cur_to: '2026-10-14',
      p_prev_from: '2026-08-16',
      p_prev_to: '2026-09-14',
    });
  });
});
