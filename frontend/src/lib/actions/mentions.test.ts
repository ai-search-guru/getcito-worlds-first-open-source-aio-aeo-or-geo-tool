import { beforeEach, describe, expect, it, vi } from 'vitest';

let result: { data: unknown; error: { code?: string; message: string } | null };
const rpc = vi.fn(async () => result);
// A table read: every filter call is recorded, and the read ends in maybeSingle
// with the result set for that table (tableResult for any other).
let tableResult: { data: unknown; error: { message: string } | null };
let tableResults: Record<string, { data: unknown; error: { message: string } | null }> = {};
const tableCalls: unknown[][] = [];
function query(table: string) {
  const q = {
    select: (...args: unknown[]) => (tableCalls.push(['select', ...args]), q),
    eq: (...args: unknown[]) => (tableCalls.push(['eq', ...args]), q),
    order: (...args: unknown[]) => (tableCalls.push(['order', ...args]), q),
    limit: (...args: unknown[]) => (tableCalls.push(['limit', ...args]), q),
    maybeSingle: async () => tableResults[table] ?? tableResult,
  };
  return q;
}
const from = vi.fn((table: string) => (tableCalls.push(['from', table]), query(table)));
let session: { access_token: string } | null = { access_token: 'tok' };
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc,
    from,
    auth: { getSession: async () => ({ data: { session } }) },
  })),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import {
  exportMentions,
  getMentionResponse,
  getMentionsOverview,
  getMentionsPerception,
  listMentions,
  overrideMentionSentiment,
  sendMentionsToActionCenter,
} from './mentions';
import { DEFAULT_MENTIONS_TABLE } from '@/lib/mentionsList';

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async () => result);
  from.mockClear();
  tableCalls.length = 0;
  result = { data: null, error: null };
  tableResult = { data: null, error: null };
  tableResults = {};
});

describe('getMentionsOverview', () => {
  it('reads the window and filters in one call', async () => {
    result = {
      data: {
        window: { from: 'f', to: 't', days: 7, source: 'days' },
        current: { answers: 8, mentions: 6 },
        previous: null,
        platforms: [],
        daily: [],
        competitors: [],
      },
      error: null,
    };
    const overview = await getMentionsOverview('b1', {
      from: '2026-10-10T00:00:00.000Z',
      platform: 'gemini-web',
      topicId: 't1',
      search: 'pricing',
    });
    expect(rpc).toHaveBeenCalledWith('mentions_overview', {
      p_brand_id: 'b1',
      p_date_from: '2026-10-10T00:00:00.000Z',
      p_date_to: undefined,
      p_platform: 'gemini-web',
      p_region: undefined,
      p_topic_id: 't1',
      p_search: 'pricing',
    });
    expect(overview?.current).toMatchObject({ answers: 8, mentions: 6 });
  });

  it('is null before the migration has run', async () => {
    result = { data: null, error: { code: 'PGRST202', message: 'not found' } };
    await expect(getMentionsOverview('b1', { from: 'f' })).resolves.toBeNull();
  });

  it('is null for a caller outside the organization', async () => {
    await expect(getMentionsOverview('b1', { from: 'f' })).resolves.toBeNull();
  });

  it('throws on any other error', async () => {
    result = { data: null, error: { code: '57014', message: 'statement timeout' } };
    await expect(getMentionsOverview('b1', { from: 'f' })).rejects.toThrow('statement timeout');
  });
});

describe('listMentions', () => {
  it('reads a page with the table controls and cuts each answer to its excerpt', async () => {
    result = {
      data: {
        total: 214,
        prompts: 12,
        rows: [
          {
            id: 'r1',
            created_at: '2026-10-16T11:28:06Z',
            prompt_id: 'p1',
            prompt_text: 'Best espresso beans?',
            topic_id: 't1',
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
            group_key: null,
            group_count: null,
          },
        ],
      },
      error: null,
    };
    tableResult = {
      data: { name: 'Acme Coffee', brand_domains: [{ domain: 'acme.com' }] },
      error: null,
    };
    const list = await listMentions(
      'b1',
      { from: '2026-10-10T00:00:00.000Z', platform: 'gemini-web' },
      { ...DEFAULT_MENTIONS_TABLE, sentiment: 'negative', competitor: 'c1', sort: 'co_mentions' },
      2,
    );
    expect(rpc).toHaveBeenCalledWith('mentions_list', {
      p_brand_id: 'b1',
      p_date_from: '2026-10-10T00:00:00.000Z',
      p_date_to: undefined,
      p_platform: 'gemini-web',
      p_region: undefined,
      p_topic_id: undefined,
      p_search: undefined,
      p_sentiment: 'negative',
      p_competitor_id: 'c1',
      p_sort: 'co_mentions',
      p_group: undefined,
      p_limit: 100,
      p_offset: 200,
    });
    expect(tableCalls).toContainEqual(['eq', 'id', 'b1']);
    expect(list).toMatchObject({
      total: 214,
      prompts: 12,
      brandTerms: ['Acme Coffee', 'acme.com'],
    });
    expect(list?.rows[0]).toEqual({
      id: 'r1',
      createdAt: '2026-10-16T11:28:06Z',
      promptId: 'p1',
      promptText: 'Best espresso beans?',
      topicId: 't1',
      topicName: 'Beans',
      platform: 'gemini-web',
      model: 'gemini-2.5-flash',
      region: 'DE',
      sentiment: 'negative',
      occurrences: 2,
      position: 2,
      brandsNamed: 4,
      coMentioned: [{ competitorId: 'c1', name: 'Crema Club', position: 1 }],
      excerpt: 'Try Crema Club first. Acme Coffee is pricier.',
      groupKey: null,
      groupCount: null,
    });
    expect(list?.rows[0]).not.toHaveProperty('response');
  });

  it('is null before the migration has run, and throws on other errors', async () => {
    result = { data: null, error: { code: 'PGRST202', message: 'not found' } };
    await expect(listMentions('b1', { from: 'f' }, DEFAULT_MENTIONS_TABLE, 0)).resolves.toBeNull();
    result = { data: null, error: { code: '57014', message: 'statement timeout' } };
    await expect(listMentions('b1', { from: 'f' }, DEFAULT_MENTIONS_TABLE, 0)).rejects.toThrow(
      'statement timeout',
    );
  });
});

describe('exportMentions', () => {
  // A page of the list for an offset: `total` mentions, ids m0…, 100 a page; with
  // `overlap`, the pages after the first start that many rows early.
  const pages = (total: number, overlap = 0) =>
    rpc.mockImplementation((async (_fn: string, args: { p_offset: number }) => {
      const start = Math.max(0, args.p_offset - (args.p_offset > 0 ? overlap : 0));
      const ids = Array.from({ length: Math.max(0, Math.min(100, total - start)) }, (_, i) => i);
      return {
        data: {
          total,
          prompts: 3,
          rows: ids.map((i) => ({ id: `m${start + i}`, response: 'Acme Coffee is good.' })),
        },
        error: null,
      };
    }) as never);

  it('reads every page under the filters, ungrouped, and cuts each answer to its excerpt', async () => {
    pages(250);
    tableResult = { data: { name: 'Acme Coffee', brand_domains: [] }, error: null };
    const list = await exportMentions(
      'b1',
      { from: '2026-10-10T00:00:00.000Z' },
      { ...DEFAULT_MENTIONS_TABLE, sentiment: 'negative', group: 'prompt' },
    );
    expect(rpc.mock.calls.map((c) => (c as unknown[])[1])).toEqual(
      [0, 100, 200].map((offset) =>
        expect.objectContaining({
          p_sentiment: 'negative',
          p_group: undefined,
          p_limit: 100,
          p_offset: offset,
        }),
      ),
    );
    expect(list).toMatchObject({ total: 250, prompts: 3, brandTerms: ['Acme Coffee'] });
    expect(list?.rows).toHaveLength(250);
    expect(list?.rows[249]).toMatchObject({ id: 'm249', excerpt: 'Acme Coffee is good.' });
    expect(list?.rows[0]).not.toHaveProperty('response');
  });

  it('stops at 5,000 mentions, and keeps each answer once when the pages shift', async () => {
    pages(12_345, 1);
    const list = await exportMentions('b1', { from: 'f' }, DEFAULT_MENTIONS_TABLE);
    expect(rpc).toHaveBeenCalledTimes(50);
    expect(list?.total).toBe(12_345);
    // An answer stored after the first page shifts the rest by one: its repeat is dropped.
    expect(list?.rows).toHaveLength(4999);
    expect(new Set(list?.rows.map((r) => r.id)).size).toBe(list?.rows.length);
  });

  it('is null before the migration has run, and throws when a later page fails', async () => {
    result = { data: null, error: { code: 'PGRST202', message: 'not found' } };
    await expect(exportMentions('b1', { from: 'f' }, DEFAULT_MENTIONS_TABLE)).resolves.toBeNull();

    rpc.mockImplementation((async (_fn: string, args: { p_offset: number }) =>
      args.p_offset === 0
        ? { data: { total: 150, prompts: 1, rows: [] }, error: null }
        : { data: null, error: { code: '57014', message: 'statement timeout' } }) as never);
    await expect(exportMentions('b1', { from: 'f' }, DEFAULT_MENTIONS_TABLE)).rejects.toThrow(
      'statement timeout',
    );
  });
});

describe('getMentionResponse', () => {
  it("reads the answer's text, citations and latest correction within the brand", async () => {
    tableResults.prompt_results = {
      data: { response: 'Hello', citations: [{ url: 'https://a.com', title: 'A' }] },
      error: null,
    };
    tableResults.sentiment_overrides = {
      data: {
        sentiment: 'positive',
        previous_sentiment: 'negative',
        note: 'Praises the roast',
        user_name: 'Demo User',
        created_at: '2026-10-17T10:00:00Z',
      },
      error: null,
    };
    await expect(getMentionResponse('b1', 'r1')).resolves.toEqual({
      response: 'Hello',
      citations: [{ url: 'https://a.com', title: 'A' }],
      override: {
        sentiment: 'positive',
        previousSentiment: 'negative',
        note: 'Praises the roast',
        userName: 'Demo User',
        createdAt: '2026-10-17T10:00:00Z',
      },
    });
    expect(tableCalls).toEqual(
      expect.arrayContaining([
        ['from', 'prompt_results'],
        ['eq', 'id', 'r1'],
        ['eq', 'brand_id', 'b1'],
        ['from', 'sentiment_overrides'],
        ['eq', 'result_id', 'r1'],
        ['order', 'created_at', { ascending: false }],
        ['limit', 1],
      ]),
    );
  });

  it('has no correction when there is none, or the table is not there yet', async () => {
    tableResults.prompt_results = { data: { response: 'Hi', citations: [] }, error: null };
    await expect(getMentionResponse('b1', 'r1')).resolves.toMatchObject({ override: null });
    tableResults.sentiment_overrides = {
      data: null,
      error: { message: 'relation does not exist' },
    };
    await expect(getMentionResponse('b1', 'r1')).resolves.toMatchObject({ override: null });
  });

  it("is null when the answer isn't readable", async () => {
    await expect(getMentionResponse('b1', 'r1')).resolves.toBeNull();
  });
});

describe('overrideMentionSentiment', () => {
  it('corrects the sentiment with a note and returns the correction', async () => {
    result = {
      data: {
        changed: true,
        previous: 'negative',
        sentiment: 'positive',
        override: {
          sentiment: 'positive',
          previous_sentiment: 'negative',
          note: 'Praises the roast',
          user_name: 'Demo User',
          created_at: '2026-10-17T10:00:00Z',
        },
      },
      error: null,
    };
    await expect(
      overrideMentionSentiment('r1', 'positive', '  Praises the roast '),
    ).resolves.toEqual({
      changed: true,
      sentiment: 'positive',
      override: expect.objectContaining({ previousSentiment: 'negative', userName: 'Demo User' }),
    });
    expect(rpc).toHaveBeenCalledWith('override_mention_sentiment', {
      p_result_id: 'r1',
      p_sentiment: 'positive',
      p_note: 'Praises the roast',
    });
  });

  it('sends no note when it is blank, and says when nothing changed', async () => {
    result = { data: { changed: false, override: null }, error: null };
    await expect(overrideMentionSentiment('r1', 'neutral', '   ')).resolves.toEqual({
      changed: false,
      sentiment: 'neutral',
      override: null,
    });
    expect(rpc).toHaveBeenCalledWith('override_mention_sentiment', {
      p_result_id: 'r1',
      p_sentiment: 'neutral',
      p_note: undefined,
    });
  });

  it.each([
    ['42501', 'forbidden'],
    ['22023', 'invalid'],
    ['P0002', 'missing'],
    ['57014', 'unknown'],
  ])('reads error %s as %s', async (code, kind) => {
    result = { data: null, error: { code, message: 'nope' } };
    await expect(overrideMentionSentiment('r1', 'negative')).resolves.toEqual({
      error: kind,
      message: 'nope',
    });
  });
});

describe('sendMentionsToActionCenter', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    session = { access_token: 'tok' };
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('posts the answers and their excerpts as the signed-in user', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ actionId: 'a1', actionNo: 62, created: true }), {
        status: 201,
      }),
    );
    await expect(
      sendMentionsToActionCenter('b1', [
        { id: 'r1', excerpt: '…Acme…' },
        { id: 'r2', excerpt: '' },
      ]),
    ).resolves.toEqual({ actionId: 'a1', actionNo: 62, created: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/mentions/action');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({
      brandId: 'b1',
      resultIds: ['r1', 'r2'],
      excerpts: { r1: '…Acme…', r2: '' },
    });
  });

  it("returns the server's error instead of throwing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Failed', details: 'No answers naming the brand' }), {
        status: 404,
      }),
    );
    await expect(sendMentionsToActionCenter('b1', [{ id: 'r1', excerpt: '' }])).resolves.toEqual({
      error: 'No answers naming the brand',
    });
    session = null;
    await expect(sendMentionsToActionCenter('b1', [{ id: 'r1', excerpt: '' }])).resolves.toEqual({
      error: 'Not authenticated',
    });
  });
});

describe('getMentionsPerception', () => {
  it('reads the window and filters in one call', async () => {
    result = {
      data: {
        window: { from: 'f', to: 't', days: 30 },
        entities: [{ entity: 'brand', name: 'Acme', is_brand: true, mentions: 10 }],
        brand_terms: [],
        attributes: [],
        co_mentions: [],
      },
      error: null,
    };
    const perception = await getMentionsPerception('b1', {
      from: '2026-10-10T00:00:00.000Z',
      region: 'DE',
      search: 'beans',
    });
    expect(rpc).toHaveBeenCalledWith('mentions_perception', {
      p_brand_id: 'b1',
      p_date_from: '2026-10-10T00:00:00.000Z',
      p_date_to: undefined,
      p_platform: undefined,
      p_region: 'DE',
      p_topic_id: undefined,
      p_search: 'beans',
    });
    expect(perception?.entities[0]).toMatchObject({ name: 'Acme', isBrand: true, mentions: 10 });
  });

  it('is null before the migration has run, and throws on other errors', async () => {
    result = { data: null, error: { code: 'PGRST202', message: 'not found' } };
    await expect(getMentionsPerception('b1', { from: 'f' })).resolves.toBeNull();
    result = { data: null, error: { code: '57014', message: 'statement timeout' } };
    await expect(getMentionsPerception('b1', { from: 'f' })).rejects.toThrow('statement timeout');
  });
});
