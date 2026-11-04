import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * The Mentions & Sentiment API/MCP reads (MS-13): each checks the brand is the
 * key's organization's before calling the page's database functions as the
 * service role, and returns the page's figures; the correction goes through
 * override_mention_sentiment for the key's owner (00223).
 */

type Result = { data: unknown; error: { code?: string; message: string } | null };

let tables: Record<string, Result> = {};
const filters: unknown[][] = [];
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<Result>>();

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: (...args: unknown[]) => (filters.push([table, ...args]), chain),
    order: () => chain,
    limit: () => chain,
    in: (...args: unknown[]) => (filters.push([table, 'in', ...args]), chain),
    maybeSingle: async () => tables[table] ?? { data: null, error: null },
    then: (resolve: (v: Result) => void) => resolve(tables[table] ?? { data: [], error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
  },
}));

const {
  getMentionCompetitorsFor,
  getMentionFor,
  getMentionsPerceptionFor,
  getMentionsSummaryFor,
  listMentionsFor,
  mentionsFiltersFromUrl,
  overrideMentionSentimentFor,
} = await import('./mentions');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const brand = {
  data: { id: 'b1', name: 'Acme Coffee', brand_domains: [{ domain: 'acme.com' }] },
  error: null,
};

const totals = (over: Record<string, number>) => ({
  answers: 0,
  mentions: 0,
  occurrences: 0,
  positive: 0,
  negative: 0,
  position_sum: 0,
  position_count: 0,
  prompts: 0,
  prompts_with_mentions: 0,
  ...over,
});

const overview = {
  window: {
    from: '2026-09-17T09:00:00Z',
    to: '2026-10-17T09:00:00Z',
    days: 30,
    source: 'days',
    day_from: '2026-10-16',
    day_to: '2026-10-17',
  },
  current: totals({
    answers: 400,
    mentions: 100,
    occurrences: 130,
    positive: 48,
    negative: 14,
    position_sum: 150,
    position_count: 100,
    prompts: 20,
    prompts_with_mentions: 15,
  }),
  previous: totals({
    answers: 400,
    mentions: 80,
    occurrences: 104,
    positive: 40,
    negative: 8,
    prompts: 20,
    prompts_with_mentions: 12,
  }),
  platforms: [
    {
      platform: 'gemini-web',
      answers: 100,
      mentions: 50,
      positive: 15,
      negative: 18,
      prev_answers: 100,
      prev_mentions: 50,
      prev_positive: 16,
      prev_negative: 10,
    },
  ],
  daily: [
    { day: '2026-10-17', answers: 10, mentions: 4, occurrences: 6, positive: 2, negative: 1 },
  ],
  competitors: [
    { competitor_id: 'c2', name: 'Origin Box', mentions: 90, co_mentions: 36, prev_mentions: 0 },
    { competitor_id: 'c1', name: 'Crema Club', mentions: 260, co_mentions: 41, prev_mentions: 200 },
  ],
};

beforeEach(() => {
  tables = { brands: brand };
  filters.length = 0;
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});

describe('mentionsFiltersFromUrl', () => {
  it('reads the page filters from the query string, and needs a brand', () => {
    expect(
      mentionsFiltersFromUrl(
        new URL('http://x/api/mcp/mentions/summary?brand_id=b1&platform=gemini-web&search=beans'),
      ),
    ).toEqual({
      brandId: 'b1',
      dateFrom: undefined,
      dateTo: undefined,
      platform: 'gemini-web',
      region: undefined,
      topicId: undefined,
      search: 'beans',
    });
    expect(mentionsFiltersFromUrl(new URL('http://x/api/mcp/mentions/summary'))).toBeNull();
  });
});

describe('getMentionsSummaryFor', () => {
  it("reads the Overview for the key's brand, 30 days back by default", async () => {
    rpc.mockResolvedValue({ data: overview, error: null });
    const before = Date.now();
    const summary = await getMentionsSummaryFor(auth, {
      brandId: 'b1',
      dateTo: '2026-10-17',
      platform: 'gemini-web',
    });

    expect(filters).toContainEqual(['brands', 'organization_id', 'org-1']);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('mentions_overview');
    expect(args).toMatchObject({
      p_brand_id: 'b1',
      p_date_to: '2026-10-17T23:59:59.999Z',
      p_platform: 'gemini-web',
    });
    const from = Date.parse(String(args.p_date_from));
    expect(before - from).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
    expect(before - from).toBeLessThan(30 * 86_400_000 + 1000);

    expect(summary?.brand).toEqual({ id: 'b1', name: 'Acme Coffee' });
    expect(summary?.current).toEqual({
      trackedResponses: 400,
      mentions: 100,
      mentionRate: 25,
      timesNamed: 130,
      trackedPrompts: 20,
      promptsWithMentions: 15,
      averagePosition: 1.5,
      sentiment: {
        positive: 48,
        neutral: 38,
        negative: 14,
        positivePct: 48,
        neutralPct: 38,
        negativePct: 14,
        net: 34,
        lowSample: false,
      },
    });
    // Without the shared prompts (before 00195), the windows' totals.
    expect(summary?.changes).toEqual({
      mentionsPct: 25,
      mentionRatePoints: 5,
      promptsWithMentionsPct: 25,
      netSentimentPoints: -6,
      basis: null,
    });
    expect(summary?.headline).toEqual({
      mover: { platform: 'gemini-web', label: 'Gemini', change: -18 },
      companions: ['Crema Club', 'Origin Box'],
    });
    expect(summary?.platforms[0]).toMatchObject({
      label: 'Gemini',
      mentionRate: 50,
      netSentiment: -6,
      netSentimentChange: -18,
      lowSample: false,
    });
    expect(summary?.daily).toEqual([
      {
        day: '2026-10-16',
        trackedResponses: 0,
        mentions: 0,
        timesNamed: 0,
        mentionRate: null,
        netSentiment: null,
      },
      {
        day: '2026-10-17',
        trackedResponses: 10,
        mentions: 4,
        timesNamed: 6,
        mentionRate: 40,
        netSentiment: 25,
      },
    ]);
  });

  it("reads nothing for a brand outside the key's organization", async () => {
    tables = { brands: { data: null, error: null } };
    await expect(getMentionsSummaryFor(auth, { brandId: 'b9' })).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    await expect(
      getMentionsSummaryFor({ ...auth, organizationId: null }, { brandId: 'b1' }),
    ).resolves.toBeNull();
  });

  it('marks a low sample and reads no change into it', async () => {
    rpc.mockResolvedValue({
      data: {
        ...overview,
        current: totals({ answers: 12, mentions: 3, occurrences: 4, positive: 2 }),
        previous: totals({
          answers: 400,
          mentions: 80,
          occurrences: 100,
          positive: 40,
          negative: 8,
        }),
      },
      error: null,
    });
    const summary = await getMentionsSummaryFor(auth, { brandId: 'b1' });
    expect(summary?.current.sentiment).toMatchObject({ net: 67, lowSample: true });
    expect(summary?.changes).toEqual({
      mentionsPct: -96,
      mentionRatePoints: null,
      promptsWithMentionsPct: null,
      netSentimentPoints: null,
      basis: null,
    });
  });
  it("reads no rate change from a window before under 20 responses, as the page's card", async () => {
    rpc.mockResolvedValue({
      data: { ...overview, previous: totals({ answers: 10, mentions: 1 }) },
      error: null,
    });
    const summary = await getMentionsSummaryFor(auth, { brandId: 'b1' });
    expect(summary?.changes.mentionRatePoints).toBeNull();
    expect(summary?.changes.netSentimentPoints).toBeNull();
  });

  // 00195: as the page's cards, each change on the prompts both windows
  // answered; the figures stay the whole windows'.
  it('takes every change on the prompts both windows answered, and says which', async () => {
    rpc.mockResolvedValue({
      data: {
        ...overview,
        same: {
          prompts: 18,
          new_prompts: 2,
          dropped_prompts: 1,
          current: totals({
            answers: 360,
            mentions: 90,
            occurrences: 120,
            positive: 45,
            negative: 9,
            prompts_with_mentions: 14,
          }),
          previous: totals({
            answers: 360,
            mentions: 72,
            occurrences: 80,
            positive: 36,
            negative: 7,
            prompts_with_mentions: 10,
          }),
        },
      },
      error: null,
    });
    const summary = await getMentionsSummaryFor(auth, { brandId: 'b1' });
    expect(summary?.current.timesNamed).toBe(130);
    expect(summary?.changes).toEqual({
      // 120 against 80 times named, on the shared prompts.
      mentionsPct: 50,
      // 25% against 20% of the shared prompts' responses.
      mentionRatePoints: 5,
      promptsWithMentionsPct: 40,
      // +40 against +40 on the shared prompts.
      netSentimentPoints: 0,
      basis: { sharedPrompts: 18, newPrompts: 2, droppedPrompts: 1 },
    });
  });
});

describe('getMentionCompetitorsFor', () => {
  it('lists competitors by mentions, with their share and the same-response count', async () => {
    rpc.mockResolvedValue({ data: overview, error: null });
    const result = await getMentionCompetitorsFor(auth, { brandId: 'b1' });
    expect(result?.brand).toEqual({
      id: 'b1',
      name: 'Acme Coffee',
      mentions: 100,
      shareOfResponses: 25,
    });
    expect(result?.competitors).toEqual([
      {
        competitorId: 'c1',
        name: 'Crema Club',
        mentions: 260,
        shareOfResponses: 65,
        sameResponseAsYou: 41,
        previousMentions: 200,
        mentionsChangePct: 30,
      },
      {
        competitorId: 'c2',
        name: 'Origin Box',
        mentions: 90,
        shareOfResponses: 22.5,
        sameResponseAsYou: 36,
        previousMentions: 0,
        mentionsChangePct: null,
      },
    ]);
  });
});

describe('listMentionsFor', () => {
  it("reads the page asked for with the table's filters, each answer cut to its excerpt", async () => {
    rpc.mockResolvedValue({
      data: {
        total: 214,
        prompts: 12,
        rows: [
          {
            id: 'r1',
            created_at: '2026-10-16T11:28:06Z',
            prompt_id: 'p1',
            prompt_text: 'Best espresso beans?',
            topic_name: 'Beans',
            platform: 'gemini-web',
            model_used: 'gemini-2.5-flash',
            region: 'DE',
            sentiment: 'negative',
            mention_count: 2,
            mention_position: 2,
            mentioned_entity_count: 4,
            co_mentioned: [{ competitor_id: 'c1', name: 'Crema Club', mention_position: 1 }],
            response: 'Try **Crema Club** first. Acme Coffee is pricier.',
          },
        ],
      },
      error: null,
    });
    const list = await listMentionsFor(auth, {
      brandId: 'b1',
      sentiment: 'negative',
      competitorId: 'none',
      sort: 'co_mentions',
      page: 3,
    });
    expect(rpc.mock.calls[0][0]).toBe('mentions_list');
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_sentiment: 'negative',
      p_competitor_id: 'none',
      p_sort: 'co_mentions',
      p_limit: 100,
      p_offset: 200,
    });
    expect(list).toEqual({
      total: 214,
      prompts: 12,
      page: 3,
      pageSize: 100,
      mentions: [
        {
          id: 'r1',
          createdAt: '2026-10-16T11:28:06Z',
          prompt: 'Best espresso beans?',
          promptId: 'p1',
          topic: 'Beans',
          platform: 'gemini-web',
          platformLabel: 'Gemini',
          model: 'gemini-2.5-flash',
          region: 'DE',
          sentiment: 'negative',
          timesNamed: 2,
          position: 2,
          brandsNamed: 4,
          coMentioned: ['Crema Club'],
          excerpt: 'Try Crema Club first. Acme Coffee is pricier.',
        },
      ],
    });
  });

  it('starts at the first page, newest first, and throws on a database error', async () => {
    rpc.mockResolvedValueOnce({ data: { total: 0, prompts: 0, rows: [] }, error: null });
    await listMentionsFor(auth, { brandId: 'b1', page: 0 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_sort: 'newest', p_offset: 0 });

    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    });
    await expect(listMentionsFor(auth, { brandId: 'b1' })).rejects.toThrow('statement timeout');
  });
});

describe('getMentionFor', () => {
  const answer = {
    id: 'r1',
    brand_id: 'b1',
    created_at: '2026-10-16T11:28:06Z',
    platform: 'gemini-web',
    model_used: 'gemini-2.5-flash',
    region: 'DE',
    sentiment: 'negative',
    mention_count: 2,
    mention_position: 2,
    mentioned_entity_count: 3,
    // Stored at tracking time: Crema Club has since been renamed; Origin Box wasn't named.
    competitor_mentions: [
      { competitor_id: 'c3', name: 'Sample Beans', mention_count: 2, mention_position: 3 },
      { competitor_id: 'c1', name: 'Crema', mention_count: 1, mention_position: 1 },
      { competitor_id: 'c2', name: 'Origin Box', mention_count: 0 },
    ],
    response: 'Try Crema Club first. Acme Coffee is pricier.',
    citations: [{ url: 'https://acme.com/beans', title: 'Beans' }],
    prompts: { text: 'Best espresso beans?' },
    brands: { organization_id: 'org-1' },
  };

  it('returns the full response, the competitors it names and its latest correction', async () => {
    tables = {
      prompt_results: { data: answer, error: null },
      competitors: { data: [{ id: 'c1', name: 'Crema Club' }], error: null },
      sentiment_overrides: {
        data: {
          sentiment: 'neutral',
          previous_sentiment: 'negative',
          note: 'Comparison, not criticism',
          user_name: 'Demo User',
          created_at: '2026-10-17T10:00:00Z',
        },
        error: null,
      },
    };
    const mention = await getMentionFor(auth, 'r1');
    expect(filters).toContainEqual(['prompt_results', 'brands.organization_id', 'org-1']);
    expect(filters).toContainEqual(['competitors', 'brand_id', 'b1']);
    expect(filters).toContainEqual(['competitors', 'in', 'id', ['c3', 'c1']]);
    expect(mention).toMatchObject({
      id: 'r1',
      prompt: 'Best espresso beans?',
      platformLabel: 'Gemini',
      sentiment: 'negative',
      // As the Mentions table lists them: current names, in the answer's order.
      competitorsNamed: ['Crema Club', 'Sample Beans'],
      response: 'Try Crema Club first. Acme Coffee is pricier.',
      citations: [{ url: 'https://acme.com/beans', title: 'Beans' }],
      sentimentOverride: {
        sentiment: 'neutral',
        previousSentiment: 'negative',
        note: 'Comparison, not criticism',
        userName: 'Demo User',
      },
    });
    expect(mention).not.toHaveProperty('brands');
  });

  it("is null for an answer outside the key's organization", async () => {
    tables = { prompt_results: { data: null, error: null } };
    await expect(getMentionFor(auth, 'r9')).resolves.toBeNull();
    tables = {
      prompt_results: { data: { ...answer, brands: { organization_id: 'org-2' } }, error: null },
    };
    await expect(getMentionFor(auth, 'r1')).resolves.toBeNull();
  });
});

describe('getMentionsPerceptionFor', () => {
  it("returns the terms with their share, each attribute's shares and the biggest gap", async () => {
    rpc.mockResolvedValue({
      data: {
        window: { from: 'f', to: 't', days: 30 },
        entities: [
          { entity: 'brand', name: 'Acme Coffee', is_brand: true, mentions: 50, prev_mentions: 40 },
          { entity: 'c1', name: 'Crema Club', is_brand: false, mentions: 80, prev_mentions: 60 },
        ],
        brand_terms: [{ term: 'fresh roast', answers: 20, prev_answers: 10 }],
        attributes: [
          {
            term: 'enterprise',
            values: [
              { entity: 'brand', answers: 5 },
              { entity: 'c1', answers: 48 },
            ],
          },
        ],
        co_mentions: [
          { competitor_id: 'c1', name: 'Crema Club', co_mentions: 30, prev_co_mentions: 20 },
        ],
      },
      error: null,
    });
    const perception = await getMentionsPerceptionFor(auth, { brandId: 'b1' });
    expect(rpc.mock.calls[0][0]).toBe('mentions_perception');
    expect(perception?.brandTerms).toEqual([
      { term: 'fresh roast', responses: 20, sharePct: 40, previousResponses: 10 },
    ]);
    expect(perception?.attributes).toEqual([{ term: 'enterprise', sharePct: [10, 60] }]);
    expect(perception?.coMentions).toEqual([
      { competitorId: 'c1', name: 'Crema Club', responses: 30, previousResponses: 20 },
    ]);
    expect(perception?.biggestGap).toEqual({
      term: 'enterprise',
      competitor: 'Crema Club',
      competitorShare: 60,
      brandShare: 10,
      brandRank: 2,
    });
  });
});

describe('overrideMentionSentimentFor', () => {
  it("corrects as the key's owner once the answer is the organization's", async () => {
    tables = { prompt_results: { data: { id: 'r1' }, error: null } };
    rpc.mockResolvedValue({
      data: {
        changed: true,
        previous: 'negative',
        sentiment: 'neutral',
        override: {
          sentiment: 'neutral',
          previous_sentiment: 'negative',
          note: 'Comparison',
          user_name: 'Demo User',
          created_at: '2026-10-17T10:00:00Z',
        },
      },
      error: null,
    });
    const result = await overrideMentionSentimentFor(auth, 'r1', 'neutral', '  Comparison  ');
    expect(rpc).toHaveBeenCalledWith('override_mention_sentiment', {
      p_result_id: 'r1',
      p_sentiment: 'neutral',
      p_note: 'Comparison',
      p_user_id: 'user-1',
    });
    expect(result).toMatchObject({
      changed: true,
      previous: 'negative',
      sentiment: 'neutral',
      override: { userName: 'Demo User', note: 'Comparison' },
    });
  });

  it("reads another organization's answer as missing, and maps the database's refusals", async () => {
    tables = { prompt_results: { data: null, error: null } };
    await expect(overrideMentionSentimentFor(auth, 'r9', 'neutral')).resolves.toEqual({
      error: 'missing',
      message: 'Answer not found',
    });
    expect(rpc).not.toHaveBeenCalled();

    tables = { prompt_results: { data: { id: 'r1' }, error: null } };
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Only admins and managers can correct a sentiment' },
    });
    await expect(overrideMentionSentimentFor(auth, 'r1', 'neutral')).resolves.toEqual({
      error: 'forbidden',
      message: 'Only admins and managers can correct a sentiment',
    });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '22023', message: 'This answer does not name the brand' },
    });
    await expect(overrideMentionSentimentFor(auth, 'r1', 'neutral')).resolves.toMatchObject({
      error: 'invalid',
    });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'timeout' } });
    await expect(overrideMentionSentimentFor(auth, 'r1', 'neutral')).rejects.toThrow('timeout');
  });
});

describe('a Selected-brands key (BRAND-ACCESS)', () => {
  // Shared with the key's owner: another brand, not b1.
  const selected: McpAuthContext = { ...auth, role: 'manager', brandAccess: ['b2'] };
  const params = { brandId: 'b1' };

  it('reads no Mentions function for a brand not shared with its owner', async () => {
    rpc.mockResolvedValue({ data: overview, error: null });
    await expect(getMentionsSummaryFor(selected, params)).resolves.toBeNull();
    await expect(getMentionCompetitorsFor(selected, params)).resolves.toBeNull();
    await expect(listMentionsFor(selected, params)).resolves.toBeNull();
    await expect(getMentionsPerceptionFor(selected, params)).resolves.toBeNull();
    // The functions (00434) run with the service role here, which they don't check.
    expect(rpc).not.toHaveBeenCalled();

    await expect(
      getMentionsSummaryFor({ ...selected, brandAccess: ['b1'] }, params),
    ).resolves.not.toBeNull();
    expect(rpc).toHaveBeenCalledWith('mentions_overview', expect.anything());
  });

  it("reads an answer of such a brand as missing, and doesn't correct it", async () => {
    tables = {
      prompt_results: {
        data: { id: 'r1', brand_id: 'b1', brands: { organization_id: 'org-1' } },
        error: null,
      },
    };
    await expect(getMentionFor(selected, 'r1')).resolves.toBeNull();
    await expect(overrideMentionSentimentFor(selected, 'r1', 'neutral')).resolves.toEqual({
      error: 'missing',
      message: 'Answer not found',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
