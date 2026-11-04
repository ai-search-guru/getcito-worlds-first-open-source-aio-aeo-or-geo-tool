import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const promptResultRow = {
  id: 'result-id',
  prompt_id: 'prompt-id',
  brand_id: 'brand-id',
  platform: 'perplexity-web',
  response: 'AI response',
  citations: [],
  mention_count: 0,
  citation_count: 0,
  sentiment: 'neutral',
  visibility_score: 0,
  model_used: null,
  region: null,
  competitor_mentions: null,
  search_queries: [
    {
      query: 'best answer engine monitoring tools',
      engine: 'sonar-pro',
      source_platform: 'perplexity-web',
    },
  ],
  created_at: '2026-07-07T00:00:00.000Z',
};

let promptResultRead: { data: unknown; error: { message: string } | null } = {
  data: promptResultRow,
  error: null,
};

// List reads: the rows each table answers (none by default), and every
// query's calls in order.
let listRows: Record<string, unknown[]> = {};
let listQueries: { table: string; calls: unknown[][] }[] = [];

function fakeQueryBuilder(table: string) {
  const query = { table, calls: [] as unknown[][] };
  listQueries.push(query);
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      query.calls.push([method, ...args]);
      return builder;
    };
  const builder = {
    select: record('select'),
    eq: record('eq'),
    neq: record('neq'),
    not: record('not'),
    is: record('is'),
    gte: record('gte'),
    maybeSingle: async () => promptResultRead,
    in: record('in'),
    order: record('order'),
    range: record('range'),
    limit: record('limit'),
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: listRows[table] ?? [], error: null, count: 0 }),
    single: async () => {
      if (table === 'prompt_results') return { data: promptResultRow, error: null };
      if (table === 'prompts') {
        return {
          data: {
            text: 'Which answer engine monitor should I use?',
            category: null,
            topic_id: null,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };

  return builder;
}

// #508 — a brand tracked broadly but rarely mentioned: most of the 427 rows
// never mention the brand (sentiment analysis is skipped for those), but of
// the 127 that do, 51 are positive.
const insightsAggregatesRow = {
  total_results: 427,
  sum_visibility: 7546,
  total_mentions: 380,
  total_citations: 192,
  positive_count: 51,
  mentioning_results: 127,
  last_checked_at: '2026-07-22T16:59:39.570Z',
  by_model: [],
};

let rpcMock = vi.fn(async () => ({ data: insightsAggregatesRow, error: null }));

// Every RPC the loaders make, by name and arguments.
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

// Empty-but-valid payloads per rollup read, for tests that drive whole loaders.
const emptyRollups: Record<string, unknown> = {
  insights_aggregates_daily: insightsAggregatesRow,
  visible_prompt_stats_daily: { visible_prompts: 0, visible_results: 0, sum_visibility_visible: 0 },
  ai_visibility_aggregates_daily: { answers: 0, by_competitor: [] },
  competitor_aggregates_daily: { brand_row_count: 0 },
  share_of_voice_aggregates_daily: {
    total_brand_mentions: 0,
    total_competitor_mentions: 0,
    by_platform: [],
    by_day: [],
  },
  visibility_rate_trend_daily: [],
};
let rpcByName = false;

let sessionMock: { access_token: string } | null = { access_token: 'access-token' };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => fakeQueryBuilder(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcByName ? Promise.resolve({ data: emptyRollups[name], error: null }) : rpcMock();
    },
    auth: { getSession: async () => ({ data: { session: sessionMock } }) },
  }),
}));

vi.mock('@/lib/actions/topic', () => ({
  getTopicById: vi.fn(async () => ({ id: 'topic-1', name: 'Topic' })),
}));

describe('getPromptResultById', () => {
  afterEach(() => {
    promptResultRead = { data: promptResultRow, error: null };
  });

  it('returns null for a result that does not exist', async () => {
    promptResultRead = { data: null, error: null };
    const { getPromptResultById } = await import('./tracking');

    await expect(getPromptResultById('missing-id')).resolves.toBeNull();
  });

  it('throws when the read fails, so the page can offer a retry (#908)', async () => {
    promptResultRead = { data: null, error: { message: 'statement timeout' } };
    const { getPromptResultById } = await import('./tracking');

    await expect(getPromptResultById('result-id')).rejects.toThrow('statement timeout');
  });

  it('carries observed search queries through to prompt result details', async () => {
    const { getPromptResultById } = await import('./tracking');

    await expect(getPromptResultById('result-id')).resolves.toMatchObject({
      id: 'result-id',
      searchQueries: promptResultRow.search_queries,
    });
  });
});

describe('getTrackingWindow (#999)', () => {
  beforeEach(() => {
    listQueries = [];
    listRows = {
      tracking_runs: [
        {
          started_at: '2026-10-18T23:30:00.000Z',
          completed_at: '2026-10-19T01:15:00.000Z',
          source: 'cron',
        },
        {
          started_at: '2026-10-16T22:00:00.000Z',
          completed_at: '2026-10-16T23:00:00.000Z',
          source: 'cron',
        },
      ],
    };
  });

  afterEach(() => {
    listRows = {};
    listQueries = [];
  });

  it('returns UTC day windows for the latest and previous completed runs', async () => {
    const { getTrackingWindow } = await import('./tracking');
    const window = await getTrackingWindow('brand-id');

    expect(window.runDays).toEqual({ dayFrom: '2026-10-18', dayTo: '2026-10-19' });
    expect(window.previousRunDays).toEqual({ dayFrom: '2026-10-16', dayTo: '2026-10-16' });
    expect(window.lastRunAt).toBe('2026-10-19T01:15:00.000Z');
    expect(listQueries.find((q) => q.table === 'tracking_runs')?.calls).toContainEqual([
      'select',
      'started_at, completed_at',
    ]);
  });
});

describe('Insights 24h rollup routing (#999)', () => {
  beforeEach(() => {
    rpcCalls = [];
    listQueries = [];
    rpcByName = true;
    listRows = {
      tracking_runs: [
        {
          started_at: '2026-10-18T23:30:00.000Z',
          completed_at: '2026-10-19T01:15:00.000Z',
          source: 'cron',
        },
        {
          started_at: '2026-10-16T22:00:00.000Z',
          completed_at: '2026-10-16T23:00:00.000Z',
          source: 'cron',
        },
      ],
    };
  });

  afterEach(() => {
    rpcByName = false;
    listRows = {};
    listQueries = [];
    rpcCalls = [];
  });

  it('uses daily rollups for the latest run and the previous run for deltas', async () => {
    const { getInsightsData } = await import('./tracking');
    const data = await getInsightsData('brand-id', { anchor24h: true });

    expect(data.trackingWindow?.runDays).toEqual({
      dayFrom: '2026-10-18',
      dayTo: '2026-10-19',
    });
    expect(
      rpcCalls.some(
        (call) =>
          call.name === 'insights_aggregates_daily' &&
          call.args.p_day_from === '2026-10-18' &&
          call.args.p_day_to === '2026-10-19',
      ),
    ).toBe(true);
    expect(
      rpcCalls.some(
        (call) =>
          call.name === 'insights_aggregates_daily' &&
          call.args.p_day_from === '2026-10-16' &&
          call.args.p_day_to === '2026-10-16',
      ),
    ).toBe(true);
    expect(rpcCalls.some((call) => call.name === 'insights_aggregates')).toBe(false);
    expect(rpcCalls.some((call) => call.name === 'competitor_aggregates')).toBe(false);
    expect(rpcCalls.some((call) => call.name === 'share_of_voice_aggregates')).toBe(false);
    expect(rpcCalls.some((call) => call.name === 'ai_visibility_aggregates')).toBe(false);
  });

  it('uses topic-scoped daily rollups for a topic-filtered 24h view (#867)', async () => {
    const { getInsightsData } = await import('./tracking');
    await getInsightsData('brand-id', { anchor24h: true, topicId: 'topic-1' });

    expect(
      rpcCalls.some(
        (call) =>
          call.name === 'insights_aggregates_daily' &&
          call.args.p_day_from === '2026-10-18' &&
          call.args.p_day_to === '2026-10-19' &&
          call.args.p_topic_id === 'topic-1',
      ),
    ).toBe(true);
    const dailyCalls = rpcCalls.filter((call) => call.name.endsWith('_daily'));
    expect(dailyCalls.length).toBeGreaterThan(0);
    for (const call of dailyCalls) {
      expect(call.args.p_topic_id).toBe('topic-1');
    }
    expect(rpcCalls.some((call) => call.name === 'insights_aggregates')).toBe(false);
    expect(rpcCalls.some((call) => call.name === 'competitor_aggregates')).toBe(false);
    expect(rpcCalls.some((call) => call.name === 'share_of_voice_aggregates')).toBe(false);
    expect(rpcCalls.some((call) => call.name === 'ai_visibility_aggregates')).toBe(false);
  });

  it('retains the raw fallback when no completed run exists', async () => {
    listRows = {};
    rpcByName = false;
    const { getInsightsData } = await import('./tracking');
    await getInsightsData('brand-id', { anchor24h: true });

    expect(rpcCalls.some((call) => call.name === 'insights_aggregates')).toBe(true);
    expect(rpcCalls.some((call) => call.name === 'insights_aggregates_daily')).toBe(false);
  });
});

describe('getInsightsSummary', () => {
  it('divides positive sentiment by brand-mentioning results, not all results (#508)', async () => {
    rpcMock = vi.fn(async () => ({ data: insightsAggregatesRow, error: null }));
    const { getInsightsSummary } = await import('./tracking');

    const summary = await getInsightsSummary('brand-id');

    // 51/127 ≈ 40%, not the diluted 51/427 ≈ 12% the old formula produced.
    expect(summary.positiveSentimentPct).toBe(40);
  });

  it('renders 0% instead of NaN when the brand is tracked but never mentioned', async () => {
    rpcMock = vi.fn(async () => ({
      data: { ...insightsAggregatesRow, positive_count: 0, mentioning_results: 0 },
      error: null,
    }));
    const { getInsightsSummary } = await import('./tracking');

    const summary = await getInsightsSummary('brand-id');

    expect(summary.positiveSentimentPct).toBe(0);
  });

  it('works out the v2 KPI card rates from the same aggregates (VIS-003)', async () => {
    rpcMock = vi.fn(async () => ({
      data: {
        ...insightsAggregatesRow,
        citation_answers: 171,
        negative_count: 13,
        sum_position: 305,
        position_count: 122,
        kpi_complete: true,
      },
      error: null,
    }));
    const { getInsightsSummary } = await import('./tracking');

    const summary = await getInsightsSummary('brand-id');

    // 171/427 answers cite the domain; 51 positive and 13 negative of 127.
    expect(summary).toMatchObject({
      citationRate: 40,
      negativeSentimentPct: 10,
      netSentiment: 30,
      avgPosition: 2.5,
    });
  });

  it('takes sentiment over the answers naming the brand, as the Mentions page (00191)', async () => {
    rpcMock = vi.fn(async () => ({
      data: {
        ...insightsAggregatesRow,
        // 17 of the 127 answers only cite the brand: always neutral.
        mention_results: 110,
        negative_count: 13,
        kpi_complete: true,
      },
      error: null,
    }));
    const { getInsightsSummary } = await import('./tracking');

    const summary = await getInsightsSummary('brand-id');

    // 51 and 13 of 110: +46% / 12%, net (51 − 13)/110 = 34.5 → 35, rounded once.
    expect(summary).toMatchObject({
      positiveSentimentPct: 46,
      negativeSentimentPct: 12,
      netSentiment: 35,
      mentioningResults: 110,
    });
  });

  it('leaves Net sentiment and Avg. position empty until the rollups are backfilled', async () => {
    rpcMock = vi.fn(async () => ({
      data: {
        ...insightsAggregatesRow,
        citation_answers: 171,
        negative_count: 2,
        sum_position: null,
        position_count: 0,
        kpi_complete: false,
      },
      error: null,
    }));
    const { getInsightsSummary } = await import('./tracking');

    const summary = await getInsightsSummary('brand-id');

    expect(summary).toMatchObject({ netSentiment: null, avgPosition: null, citationRate: 40 });
  });

  it('shows the new rates as empty, not 0, if migration 00131 has not run', async () => {
    rpcMock = vi.fn(async () => ({ data: insightsAggregatesRow, error: null }));
    const { getInsightsSummary } = await import('./tracking');

    const summary = await getInsightsSummary('brand-id');

    expect(summary).toMatchObject({ netSentiment: null, avgPosition: null, citationRate: null });
  });
});

describe('topic-filtered reads (00164)', () => {
  beforeEach(() => {
    rpcCalls = [];
    listQueries = [];
  });
  afterEach(() => {
    rpcByName = false;
    listRows = {};
  });

  it("reads the topic's latest runs lean: each run's prompt and visibility, no count", async () => {
    rpcByName = true;
    listRows = {
      prompts: [
        { id: 'p1', text: 'Best espresso machine under $500?' },
        { id: 'p2', text: 'Cheapest burr grinder?' },
      ],
      prompt_results: [
        { prompt_id: 'p2', visibility_score: 40 },
        { prompt_id: 'p1', visibility_score: 80 },
      ],
    };
    const { getTopicDetail } = await import('./tracking');

    const detail = await getTopicDetail('brand-id', 'topic-1');

    expect(detail.results).toEqual([
      { promptId: 'p2', promptText: 'Cheapest burr grinder?', visibilityScore: 40 },
      { promptId: 'p1', promptText: 'Best espresso machine under $500?', visibilityScore: 80 },
    ]);
    // Not every column, and no count of every answer the topic ever had.
    const runs = listQueries.filter((q) => q.table === 'prompt_results');
    expect(runs).toHaveLength(1);
    expect(runs[0].calls).toEqual([
      ['select', 'prompt_id, visibility_score'],
      ['eq', 'brand_id', 'brand-id'],
      ['neq', 'platform', 'chatgpt-shopping'],
      ['in', 'prompt_id', ['p1', 'p2']],
      ['order', 'created_at', { ascending: false }],
      ['limit', 50],
    ]);
  });

  it('serves the topic detail page from the daily rollups, every call scoped to the topic', async () => {
    rpcByName = true;
    const { getTopicDetail } = await import('./tracking');

    await getTopicDetail('brand-id', 'topic-1');

    expect(rpcCalls.length).toBeGreaterThan(0);
    for (const call of rpcCalls) {
      expect(call.name).toMatch(/_daily$/);
      // Without the topic, a rollup read answers for the whole brand.
      expect(call.args.p_topic_id).toBe('topic-1');
    }
  });

  it('passes the topic along when a topic filter is applied with a day window', async () => {
    rpcByName = true;
    const { getCompetitorComparison, getShareOfVoiceData, getVisibilityRateKpi } =
      await import('./tracking');
    const days = { dayFrom: '2026-09-01', dayTo: '2026-09-30' };

    await getCompetitorComparison('brand-id', { topicId: 'topic-1', days });
    await getShareOfVoiceData('brand-id', { topicId: 'topic-1', days });
    await getVisibilityRateKpi('brand-id', { topicId: 'topic-1', days });

    expect(rpcCalls.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'competitor_aggregates_daily',
        'ai_visibility_aggregates_daily',
        'share_of_voice_aggregates_daily',
        'visible_prompt_stats_daily',
      ]),
    );
    for (const call of rpcCalls) {
      expect(call.name).toMatch(/_daily$/);
      expect(call.args.p_topic_id).toBe('topic-1');
    }
  });

  it('leaves brand-level reads unscoped', async () => {
    rpcByName = true;
    const { getInsightsSummary } = await import('./tracking');

    await getInsightsSummary('brand-id', { days: {} });

    expect(rpcCalls.length).toBeGreaterThan(0);
    for (const call of rpcCalls) {
      expect(call.name).toBe('insights_aggregates_daily');
      expect(call.args.p_topic_id).toBeUndefined();
    }
  });
});

describe('analyzeNewPrompt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionMock = { access_token: 'access-token' };
  });

  it('submits the prompt that was just created and nothing else', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ jobId: 'job-1' })));
    vi.stubGlobal('fetch', fetchMock);
    const { analyzeNewPrompt } = await import('./tracking');

    await expect(analyzeNewPrompt('brand-id', 'new-prompt')).resolves.toEqual({ started: true });

    // The whole point of naming the id: the brand's other unanalyzed prompts —
    // including any still waiting on Cloro's webhook — must not be swept in and
    // paid for twice.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      brandId: 'brand-id',
      promptIds: ['new-prompt'],
    });
  });

  it('reports not-started rather than throwing when the run is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'limit' }), { status: 429 })),
    );
    const { analyzeNewPrompt } = await import('./tracking');

    // The prompt is already saved by this point, so a refusal must stay quiet
    // and leave it for the daily scheduled run.
    await expect(analyzeNewPrompt('brand-id', 'new-prompt')).resolves.toEqual({ started: false });
  });

  it('reports not-started when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const { analyzeNewPrompt } = await import('./tracking');

    await expect(analyzeNewPrompt('brand-id', 'new-prompt')).resolves.toEqual({ started: false });
  });

  it('makes no request at all when there is no session', async () => {
    sessionMock = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { analyzeNewPrompt } = await import('./tracking');

    await expect(analyzeNewPrompt('brand-id', 'new-prompt')).resolves.toEqual({ started: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getPromptVisibilitySummaries', () => {
  afterEach(() => {
    rpcMock = vi.fn(async () => ({ data: insightsAggregatesRow, error: null }));
  });

  it('keeps every prompt of a brand past 1000, reading the summaries a page at a time', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      prompt_id: `p-${i}`,
      runs: 5,
      visible_runs: 1,
      mention_answers: 1,
      citation_answers: 0,
      total_mentions: 2,
      total_citations: 0,
      avg_visibility: 10,
      avg_visibility_visible: 50,
      position_factor: 0.5,
      last_run_at: '2026-10-16T00:00:00.000Z',
    }));
    const ranges: [number, number][] = [];
    // Served as PostgREST would: a ranged request gets its slice, never more
    // than 1000 rows.
    rpcMock = vi.fn(() => {
      let slice: [number, number] = [0, 999];
      const chain = {
        order: () => chain,
        range: (from: number, to: number) => {
          slice = [from, to];
          ranges.push([from, to]);
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: rows.slice(slice[0], slice[1] + 1), error: null }),
      };
      return chain;
    }) as unknown as typeof rpcMock;
    const { getPromptVisibilitySummaries } = await import('./tracking');

    const summaries = await getPromptVisibilitySummaries('brand-id', { days: 90 });

    expect(Object.keys(summaries)).toHaveLength(1200);
    expect(summaries['p-1199'].totalMentions).toBe(2);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});
