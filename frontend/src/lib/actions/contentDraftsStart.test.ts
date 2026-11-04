import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftStart } from '@/lib/content/drafts';

/**
 * New content and Start (CE-003, CE-015): what a page can start from, and
 * the draft each start opens, with the prompts it should answer.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const OPPORTUNITY = '44444444-4444-4444-4444-444444444444';
const PROMPT = '55555555-5555-5555-5555-555555555555';
const TOPIC = '66666666-6666-6666-6666-666666666666';

interface Call {
  table: string;
  op: string;
  value?: unknown;
  filters: [string, string, unknown][];
}
let calls: Call[];
// What a read of each table returns: a row for maybeSingle, rows otherwise.
let reads: Record<string, unknown>;
let rpcCalls: { fn: string; args: unknown }[];
let rpcRows: unknown;
let rpcError: { code: string; message: string } | null;

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
// The server's writes: a draft linked to an action (CE-022).
const admin = vi.hoisted(() => ({
  inserts: [] as { table: string; value: Record<string, unknown> }[],
  result: { data: { id: 'action-draft' }, error: null } as {
    data: { id: string } | null;
    error: { code: string; message: string } | null;
  },
  onInsert: null as (() => void) | null,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (value: Record<string, unknown>) => {
        admin.inserts.push({ table, value });
        admin.onInsert?.();
        return { select: () => ({ single: async () => admin.result }) };
      },
    }),
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'jwt' } } }),
    },
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return { data: rpcError ? null : rpcRows, error: rpcError };
    },
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const result = () =>
        call.op === 'insert'
          ? { data: { id: 'new-draft' }, error: null }
          : call.op === 'update'
            ? { data: null, error: null }
            : { data: reads[table] ?? null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (call.filters.push(['eq', col, v]), chain),
        in: (col: string, v: unknown) => (call.filters.push(['in', col, v]), chain),
        is: (col: string, v: unknown) => (call.filters.push(['is', col, v]), chain),
        contains: (col: string, v: unknown) => (call.filters.push(['contains', col, v]), chain),
        order: () => chain,
        limit: () => chain,
        insert: (value: unknown) => ((call.op = 'insert'), (call.value = value), chain),
        update: (value: unknown) => ((call.op = 'update'), (call.value = value), chain),
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (resolve: (r: unknown) => void) => resolve(result()),
      };
      return chain;
    },
  })),
}));

const {
  getDraftForPrompt,
  getOpportunityDrafts,
  createContentDraft,
  getContentOverlap,
  getContentStartOptions,
  importContentPage,
  sendContentDraftToActionCenter,
  startAgentWriting,
  startDraftFromAction,
} = await import('./contentDrafts');

const inserted = () => calls.find((call) => call.op === 'insert')?.value as Record<string, unknown>;

beforeEach(() => {
  calls = [];
  reads = {};
  rpcCalls = [];
  rpcRows = [];
  rpcError = null;
  admin.inserts = [];
  admin.result = { data: { id: 'action-draft' }, error: null };
  admin.onInsert = null;
});

describe('getContentStartOptions', () => {
  it('lists open opportunities, active prompts and the topics that have some', async () => {
    reads = {
      content_opportunities: [
        {
          id: OPPORTUNITY,
          title: 'Create a CRM page for real estate',
          decision: 'create',
          brief: { suggestedTitle: ' CRM for real estate teams ' },
          assetType: 'solution_page',
        },
        // Written before opportunities had assets.
        {
          id: 'o2',
          title: 'Refresh the pricing page',
          decision: 'refresh',
          brief: null,
          assetType: null,
        },
      ],
      // Counted in the database: a big brand's topics past the listed prompts too.
      topics: [
        { id: TOPIC, name: 'Real estate', prompts: [{ count: 640 }] },
        { id: 't2', name: 'Empty topic', prompts: [{ count: 0 }] },
      ],
    };
    // The prompts, marked where the brand already shows (00230), not seen first.
    rpcRows = {
      prompts: [
        { id: PROMPT, text: 'best crm for realtors', seen: false },
        { id: 'p2', text: 'crm pricing', seen: true },
      ],
      seen: 7,
    };
    await expect(getContentStartOptions(BRAND)).resolves.toEqual({
      opportunities: [
        {
          id: OPPORTUNITY,
          title: 'Create a CRM page for real estate',
          decision: 'create',
          pageTitle: 'CRM for real estate teams',
          assetType: 'solution_page',
        },
        {
          id: 'o2',
          title: 'Refresh the pricing page',
          decision: 'refresh',
          pageTitle: null,
          assetType: null,
        },
      ],
      prompts: [
        { id: PROMPT, text: 'best crm for realtors', seen: false },
        { id: 'p2', text: 'crm pricing', seen: true },
      ],
      // Every seen prompt, past the listed ones too.
      promptsSeen: 7,
      topics: [{ id: TOPIC, name: 'Real estate', promptCount: 640 }],
    });
    expect(rpcCalls).toEqual([
      {
        fn: 'content_start_prompts',
        args: { p_brand_id: BRAND, p_days: 30, p_limit: 500 },
      },
    ]);
    expect(calls.find((call) => call.table === 'content_opportunities')!.filters).toEqual([
      ['eq', 'brand_id', BRAND],
      ['in', 'status', ['new', 'reviewed', 'sent', 'in_progress']],
    ]);
    expect(calls.find((call) => call.table === 'prompts')).toBeUndefined();
    expect(calls.find((call) => call.table === 'topics')!.filters).toEqual([
      ['eq', 'brand_id', BRAND],
      ['eq', 'is_active', true],
      ['eq', 'prompts.is_active', true],
    ]);
  });

  it('lists every active prompt, none seen, before the function exists', async () => {
    rpcError = { code: 'PGRST202', message: 'Could not find the function' };
    reads = {
      prompts: [
        { id: PROMPT, text: 'best crm for realtors' },
        { id: 'p2', text: 'crm pricing' },
      ],
    };
    const options = await getContentStartOptions(BRAND);
    expect(options.prompts).toEqual([
      { id: PROMPT, text: 'best crm for realtors', seen: false },
      { id: 'p2', text: 'crm pricing', seen: false },
    ]);
    expect(options.promptsSeen).toBe(0);
    expect(calls.find((call) => call.table === 'prompts')!.filters).toEqual([
      ['eq', 'prompt_sets.brand_id', BRAND],
      ['eq', 'is_active', true],
    ]);
  });

  it('lists no prompts for a brand that isn’t the member’s, and says so when the read fails', async () => {
    rpcRows = null;
    await expect(getContentStartOptions(BRAND)).resolves.toMatchObject({
      prompts: [],
      promptsSeen: 0,
    });
    rpcError = { code: '57014', message: 'canceling statement due to statement timeout' };
    await expect(getContentStartOptions(BRAND)).rejects.toThrow('statement timeout');
  });

  it('throws on a payload the schema doesn’t know, rather than list no prompts', async () => {
    rpcRows = { prompts: 'not a list', seen: 'x' };
    await expect(getContentStartOptions(BRAND)).rejects.toThrow();
  });
});

describe('getOpportunityDrafts', () => {
  it('maps each opportunity to the latest draft not yet published started from it', async () => {
    reads = {
      content_drafts: [
        { id: 'd9', opportunity_id: OPPORTUNITY },
        { id: 'd3', opportunity_id: OPPORTUNITY },
        { id: 'd4', opportunity_id: 'o2' },
      ],
    };
    await expect(
      getOpportunityDrafts(BRAND, [OPPORTUNITY, OPPORTUNITY, 'not-an-id']),
    ).resolves.toEqual({
      [OPPORTUNITY]: 'd9',
      o2: 'd4',
    });
    expect(calls).toEqual([
      {
        table: 'content_drafts',
        op: 'select',
        filters: [
          ['eq', 'brand_id', BRAND],
          ['in', 'opportunity_id', [OPPORTUNITY]],
          ['in', 'status', ['draft', 'in_review', 'ready']],
          // An archived draft is set aside (00233): Send to Editor again.
          ['is', 'archived_at', null],
        ],
      },
    ]);
  });

  it('reads nothing without an opportunity to look up', async () => {
    await expect(getOpportunityDrafts(BRAND, [])).resolves.toEqual({});
    await expect(getOpportunityDrafts('x', [OPPORTUNITY])).resolves.toEqual({});
    expect(calls).toEqual([]);
  });
});

describe('getDraftForPrompt', () => {
  it('finds the latest draft not yet published among those for the prompt', async () => {
    reads = { content_drafts: { id: 'd7' } };
    await expect(getDraftForPrompt(BRAND, PROMPT)).resolves.toBe('d7');
    expect(calls).toEqual([
      {
        table: 'content_drafts',
        op: 'select',
        filters: [
          ['eq', 'brand_id', BRAND],
          ['contains', 'prompt_ids', [PROMPT]],
          ['in', 'status', ['draft', 'in_review', 'ready']],
          ['is', 'archived_at', null],
        ],
      },
    ]);
  });

  it("is null when there is none, and doesn't read for an id that isn't one", async () => {
    await expect(getDraftForPrompt(BRAND, PROMPT)).resolves.toBeNull();
    await expect(getDraftForPrompt(BRAND, 'not-an-id')).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe('createContentDraft', () => {
  const start = (over: Partial<DraftStart> = {}): DraftStart => ({
    method: 'create',
    title: 'CRM for real estate teams',
    pageType: 'solution_page',
    source: { kind: 'opportunity', id: OPPORTUNITY },
    ...over,
  });

  it('starts a new page from an opportunity, with its clusters’ prompts and the title as H1', async () => {
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: null,
        cluster_id: 'c1',
        related_cluster_ids: ['c2'],
      },
      prompt_cluster_members: [{ prompt_id: PROMPT }, { prompt_id: 'p2' }, { prompt_id: PROMPT }],
    };
    await expect(createContentDraft(BRAND, start({ title: 'CRM <for> agents' }))).resolves.toBe(
      'new-draft',
    );
    expect(calls.find((call) => call.table === 'content_opportunities')!.filters).toEqual([
      ['eq', 'id', OPPORTUNITY],
      ['eq', 'brand_id', BRAND],
    ]);
    expect(calls.find((call) => call.table === 'prompt_cluster_members')!.filters).toEqual([
      ['in', 'cluster_id', ['c1', 'c2']],
    ]);
    expect(inserted()).toEqual({
      brand_id: BRAND,
      created_by: 'u1',
      method: 'create',
      title: 'CRM <for> agents',
      page_type: 'solution_page',
      // Start's guess: it follows the page until someone picks a type.
      page_type_source: 'detected',
      body_html: '<h1>CRM &lt;for&gt; agents</h1>',
      opportunity_id: OPPORTUNITY,
      prompt_ids: [PROMPT, 'p2'],
      source_url: null,
      // Made in the editor (00463, W4-10).
      origin: 'editor',
      conversation_id: null,
    });
  });

  it('keeps a type the person picked as theirs', async () => {
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: PROMPT,
        cluster_id: null,
        related_cluster_ids: [],
      },
    };
    await createContentDraft(BRAND, start({ typePicked: true }));
    expect(inserted()).toMatchObject({ page_type: 'solution_page', page_type_source: 'user' });
  });

  it('is made in the editor unless said, and in a chat of the person’s with its id (00463)', async () => {
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: PROMPT,
        cluster_id: null,
        related_cluster_ids: [],
      },
    };
    await createContentDraft(BRAND, start());
    expect(inserted()).toMatchObject({ origin: 'editor', conversation_id: null });
    calls.length = 0;
    const CHAT = 'cccccccc-0000-4000-8000-000000000001';
    await createContentDraft(BRAND, start({ origin: 'chat', conversationId: CHAT }));
    expect(inserted()).toMatchObject({ origin: 'chat', conversation_id: CHAT });
  });

  it('takes the prompts its card counts when its clusters have no members (editor UX review 2026-11-03)', async () => {
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: PROMPT,
        cluster_id: 'c1',
        related_cluster_ids: [],
        source_data: {
          prompts: ['Best CRM for real estate teams', 'CRM for agents', 'CRM for agents', ''],
        },
      },
      prompt_cluster_members: [],
      prompts: [
        { id: 'p2', text: 'Best CRM for real estate teams' },
        { id: PROMPT, text: 'CRM for agents' },
      ],
    };
    await createContentDraft(BRAND, start());
    const byWords = calls.find((call) => call.table === 'prompts')!;
    expect(byWords.filters).toEqual([
      ['eq', 'prompt_sets.brand_id', BRAND],
      ['in', 'text', ['Best CRM for real estate teams', 'CRM for agents']],
    ]);
    // Its own prompt first, each once.
    expect(inserted()).toMatchObject({ opportunity_id: OPPORTUNITY, prompt_ids: [PROMPT, 'p2'] });
  });

  it('keeps its own prompt when its clusters are empty and its card lists none', async () => {
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: PROMPT,
        cluster_id: 'c1',
        related_cluster_ids: [],
        source_data: {},
      },
      prompt_cluster_members: [],
    };
    await createContentDraft(BRAND, start());
    expect(calls.some((call) => call.table === 'prompts')).toBe(false);
    expect(inserted()).toMatchObject({ prompt_ids: [PROMPT] });
  });

  it('takes the one prompt of an opportunity with no clusters', async () => {
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: PROMPT,
        cluster_id: null,
        related_cluster_ids: [],
      },
    };
    await createContentDraft(BRAND, start());
    expect(calls.some((call) => call.table === 'prompt_cluster_members')).toBe(false);
    expect(inserted()).toMatchObject({ opportunity_id: OPPORTUNITY, prompt_ids: [PROMPT] });
  });

  it('starts from a prompt of the brand’s, its long text cut to a title', async () => {
    reads = { prompts: { id: PROMPT } };
    await createContentDraft(
      BRAND,
      start({ title: `${'word '.repeat(80)}end`, source: { kind: 'prompt', id: PROMPT } }),
    );
    expect(calls[0]).toMatchObject({
      table: 'prompts',
      filters: [
        ['eq', 'prompt_sets.brand_id', BRAND],
        ['eq', 'id', PROMPT],
      ],
    });
    const row = inserted();
    expect((row.title as string).length).toBeLessThanOrEqual(300);
    expect(row).toMatchObject({ opportunity_id: null, prompt_ids: [PROMPT] });
  });

  it('starts from a topic, with its active prompts', async () => {
    reads = { prompts: [{ id: PROMPT }, { id: 'p2' }] };
    await createContentDraft(BRAND, start({ source: { kind: 'topic', id: TOPIC } }));
    expect(calls[0].filters).toEqual([
      ['eq', 'prompt_sets.brand_id', BRAND],
      ['eq', 'topic_id', TOPIC],
      ['eq', 'is_active', true],
    ]);
    expect(inserted()).toMatchObject({ prompt_ids: [PROMPT, 'p2'] });
  });

  it('opens content to optimize as checked against the draft allow-list', async () => {
    await createContentDraft(
      BRAND,
      start({
        method: 'optimize',
        title: 'Pricing',
        pageType: 'pricing',
        source: { kind: 'content' },
        bodyHtml: '<h1>Pricing</h1><p onclick="x()">Plans</p><script>alert(1)</script>',
      }),
    );
    expect(inserted()).toMatchObject({
      method: 'optimize',
      body_html: '<h1>Pricing</h1><p>Plans</p>',
      opportunity_id: null,
      prompt_ids: [],
    });
  });

  it('keeps an optimized page’s own length for its Length rule (F)', async () => {
    const page = `<h1>Pricing</h1><p>${'Plans &amp; prices. '.repeat(10)}</p>`;
    await createContentDraft(
      BRAND,
      start({
        method: 'optimize',
        title: 'Pricing',
        pageType: 'pricing',
        source: { kind: 'content' },
        bodyHtml: page,
      }),
    );
    // "Pricing Plans x prices. …": the words, one space between blocks.
    expect(inserted()).toMatchObject({ rules: { importLength: 167 } });
  });

  it('keeps the live page’s length when Start optimizes it, and sets none without it (F)', async () => {
    const page = `<h1>Pricing</h1><p>${'Plans &amp; prices. '.repeat(10)}</p>`;
    reads = {
      content_opportunities: { id: OPPORTUNITY, prompt_id: PROMPT, cluster_id: null },
      prompts: [{ id: PROMPT }],
    };
    await createContentDraft(
      BRAND,
      start({ method: 'optimize', bodyHtml: page, sourceUrl: 'https://northwind.example/pricing' }),
    );
    expect(inserted()).toMatchObject({ rules: { importLength: 167 } });

    // A page whose live text couldn't be read starts with its title only: no rules.
    calls.length = 0;
    await createContentDraft(BRAND, start({ method: 'optimize' }));
    expect(inserted()).not.toHaveProperty('rules');
  });

  it('starts a page brought in with the prompts its title and headings speak to', async () => {
    reads = {
      prompts: [
        { id: 'p1', text: 'Pricing plans for small teams?' },
        { id: 'p2', text: 'Best espresso grinder' },
        { id: 'p3', text: 'Pricing of espresso machines' },
      ],
    };
    await createContentDraft(
      BRAND,
      start({
        method: 'optimize',
        title: 'Pricing',
        pageType: 'pricing',
        source: { kind: 'content' },
        bodyHtml: '<h1>Pricing</h1><h2>Plans for small teams</h2><p>From 12 a month.</p>',
      }),
    );
    // p3 shares one word only.
    expect(inserted()).toMatchObject({ prompt_ids: ['p1'] });
  });

  it('writes nothing for a source the member can’t read, or a start that isn’t valid', async () => {
    await expect(createContentDraft(BRAND, start())).rejects.toThrow('not_found');
    await expect(
      createContentDraft(BRAND, start({ source: { kind: 'topic', id: TOPIC } })),
    ).rejects.toThrow('not_found');
    await expect(
      createContentDraft(BRAND, start({ pageType: 'landing' as DraftStart['pageType'] })),
    ).rejects.toThrow('invalid');
    await expect(createContentDraft('nope', start())).rejects.toThrow('invalid');
    expect(calls.some((call) => call.op === 'insert')).toBe(false);
  });
});

describe('getContentOverlap', () => {
  it('checks the source’s prompts against the brand’s cited pages', async () => {
    reads = { prompts: [{ id: PROMPT }, { id: 'p2' }, { id: PROMPT }] };
    rpcRows = [
      {
        page: 'https://acme.example/guides/espresso/',
        title: 'Espresso guide',
        prompts_in_common: 2,
        citations: '4',
        gsc_position: '3.5',
      },
      {
        page: 'https://acme.example/blog/x',
        title: null,
        prompts_in_common: 1,
        citations: 1,
        gsc_position: null,
      },
    ];
    await expect(getContentOverlap(BRAND, { kind: 'topic', id: TOPIC })).resolves.toEqual({
      totalPrompts: 2,
      pages: [
        {
          url: 'https://acme.example/guides/espresso/',
          title: 'Espresso guide',
          promptsInCommon: 2,
          citations: 4,
          gscPosition: 3.5,
        },
        {
          url: 'https://acme.example/blog/x',
          title: null,
          promptsInCommon: 1,
          citations: 1,
          gscPosition: null,
        },
      ],
    });
    expect(rpcCalls).toEqual([
      { fn: 'content_page_overlap', args: { p_brand_id: BRAND, p_prompt_ids: [PROMPT, 'p2'] } },
    ]);
  });

  it('has nothing to check for content to optimize, or a source with no prompts', async () => {
    await expect(getContentOverlap(BRAND, { kind: 'content' })).resolves.toEqual({
      totalPrompts: 0,
      pages: [],
    });
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: null,
        cluster_id: null,
        related_cluster_ids: [],
      },
    };
    await expect(
      getContentOverlap(BRAND, { kind: 'opportunity', id: OPPORTUNITY }),
    ).resolves.toEqual({ totalPrompts: 0, pages: [] });
    expect(rpcCalls).toEqual([]);
  });
});

describe('optimizing an existing page instead (overlap check)', () => {
  it('keeps the page’s address and starts the draft with its title as H1', async () => {
    reads = { prompts: [{ id: PROMPT }] };
    await createContentDraft(BRAND, {
      method: 'optimize',
      title: 'Espresso guide',
      pageType: 'buying_guide',
      source: { kind: 'topic', id: TOPIC },
      sourceUrl: 'https://acme.example/guides/espresso/',
    });
    expect(inserted()).toMatchObject({
      method: 'optimize',
      body_html: '<h1>Espresso guide</h1>',
      source_url: 'https://acme.example/guides/espresso/',
      prompt_ids: [PROMPT],
    });
  });

  it('refuses an address that isn’t a web page’s', async () => {
    await expect(
      createContentDraft(BRAND, {
        method: 'optimize',
        title: 'x',
        pageType: 'guide',
        source: { kind: 'content' },
        sourceUrl: 'javascript:alert(1)',
      }),
    ).rejects.toThrow('invalid');
    expect(calls).toEqual([]);
  });
});

describe('importContentPage', () => {
  const answer = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('asks the API to read the page, with the member’s session', async () => {
    const fetchMock = answer(200, {
      url: 'https://northwind.example/pricing',
      title: 'Pricing',
      html: '<h1>Pricing</h1>',
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(importContentPage(BRAND, ' northwind.example/pricing ')).resolves.toEqual({
      page: {
        url: 'https://northwind.example/pricing',
        title: 'Pricing',
        html: '<h1>Pricing</h1>',
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/content-pages\/import$/);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
    expect(JSON.parse(init.body as string)).toEqual({
      brandId: BRAND,
      url: 'northwind.example/pricing',
    });
    vi.unstubAllGlobals();
  });

  it('names why the page couldn’t be read, and an unknown answer as failed', async () => {
    vi.stubGlobal('fetch', answer(422, { code: 'http_error', status: 404 }));
    await expect(importContentPage(BRAND, 'https://northwind.example/x')).resolves.toEqual({
      error: 'http_error',
      status: 404,
    });
    vi.stubGlobal('fetch', answer(500, { code: 'something_new' }));
    await expect(importContentPage(BRAND, 'https://northwind.example/x')).resolves.toEqual({
      error: 'failed',
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await expect(importContentPage(BRAND, 'https://northwind.example/x')).resolves.toEqual({
      error: 'failed',
    });
    vi.unstubAllGlobals();
  });

  it('asks for nothing with a malformed brand or an empty address', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(importContentPage('nope', 'https://x.example')).resolves.toEqual({
      error: 'invalid_url',
    });
    await expect(importContentPage(BRAND, '  ')).resolves.toEqual({ error: 'invalid_url' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('sendContentDraftToActionCenter', () => {
  it('asks the API to send the draft, with the member’s session', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ actionId: 'a1', actionNo: 214, created: true }), {
          status: 201,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendContentDraftToActionCenter(BRAND, OPPORTUNITY)).resolves.toEqual({
      actionId: 'a1',
      actionNo: 214,
      created: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/action-center\/content-drafts$/);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
    expect(JSON.parse(init.body as string)).toEqual({ brandId: BRAND, draftId: OPPORTUNITY });
    vi.unstubAllGlobals();
  });

  it('returns why it failed, and sends nothing for a malformed id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ details: 'Draft not found' }), { status: 404 }),
      ),
    );
    await expect(sendContentDraftToActionCenter(BRAND, OPPORTUNITY)).resolves.toEqual({
      error: 'Draft not found',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendContentDraftToActionCenter(BRAND, 'nope')).resolves.toEqual({
      error: 'invalid',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('startDraftFromAction', () => {
  const ACTION = '77777777-7777-7777-7777-777777777777';
  const TASK = '88888888-8888-8888-8888-888888888888';
  const PAGE = 'https://northwind.example/forecasting';
  const DELETED_PROMPT = '99999999-9999-9999-9999-999999999999';
  const action = (payload: Record<string, unknown> = {}) => ({
    id: ACTION,
    payload: {
      title: 'Pipeline forecasting',
      pages: [PAGE, 'https://northwind.example/pricing'],
      promptIds: [PROMPT, DELETED_PROMPT, 'not-an-id'],
      opportunityId: OPPORTUNITY,
      ...payload,
    },
  });
  const start = (page: string | null = PAGE) =>
    startDraftFromAction(BRAND, ACTION, TASK, { page, title: 'Recover visibility' });

  it('writes the draft for the page, linked to the action, and starts the task', async () => {
    reads = {
      actions: action({ title: undefined }),
      action_tasks: { id: TASK, task_key: 'optimize_content', status: 'todo' },
      content_drafts: [],
      brands: { site_type: 'b2b', industry: 'Software', shopping_mode_enabled: false },
      prompts: [{ id: PROMPT }],
      content_opportunities: { id: OPPORTUNITY },
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            url: PAGE,
            title: 'Forecasting',
            html: '<h1>Forecasting</h1><p onclick="x()">Forecast every deal.</p>',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(start()).resolves.toEqual({
      draftId: 'action-draft',
      created: true,
      importFailed: false,
    });
    expect(
      JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string),
    ).toEqual({ brandId: BRAND, url: PAGE });
    // A deleted action starts no work.
    expect(calls.find((call) => call.table === 'actions')!.filters).toContainEqual([
      'is',
      'deleted_at',
      null,
    ]);
    // An archived draft is set aside: Start writes a new one rather than reopen it.
    expect(calls.find((call) => call.table === 'content_drafts')!.filters).toContainEqual([
      'is',
      'archived_at',
      null,
    ]);
    expect(admin.inserts).toEqual([
      {
        table: 'content_drafts',
        value: expect.objectContaining({
          brand_id: BRAND,
          created_by: 'u1',
          author: 'user',
          method: 'optimize',
          title: 'Forecasting',
          page_type_source: 'detected',
          body_html: '<h1>Forecasting</h1><p>Forecast every deal.</p>',
          source_url: PAGE,
          opportunity_id: OPPORTUNITY,
          prompt_ids: [PROMPT],
          action_id: ACTION,
          // The live page's own length, raised to the Length rule's least.
          rules: expect.objectContaining({ importLength: 100 }),
          // Made from an Action Center task (00463, W4-10).
          origin: 'action_center',
        }),
      },
    ]);
    // Only the brand's prompts, read through the member's session.
    expect(calls.find((call) => call.table === 'prompts')!.filters).toEqual([
      ['eq', 'prompt_sets.brand_id', BRAND],
      ['in', 'id', [PROMPT, DELETED_PROMPT]],
    ]);
    expect(rpcCalls).toEqual([
      { fn: 'content_draft_snapshot', args: { p_draft_id: 'action-draft', p_origin: 'import' } },
    ]);
    const taskUpdate = calls.find((call) => call.table === 'action_tasks' && call.op === 'update');
    expect(taskUpdate).toMatchObject({
      value: { status: 'in_progress' },
      filters: [
        ['eq', 'action_id', ACTION],
        ['eq', 'id', TASK],
      ],
    });
    vi.unstubAllGlobals();
  });

  it('opens the draft already written for that work, writing nothing', async () => {
    reads = {
      actions: action(),
      action_tasks: { id: TASK, task_key: 'refresh_content', status: 'in_progress' },
      content_drafts: [
        {
          id: 'd-pricing',
          method: 'optimize',
          source_url: 'https://northwind.example/pricing',
          status: 'draft',
        },
        { id: 'd-page', method: 'optimize', source_url: PAGE, status: 'ready' },
      ],
    };
    await expect(start()).resolves.toEqual({
      draftId: 'd-page',
      created: false,
      importFailed: false,
    });
    expect(admin.inserts).toEqual([]);
  });

  it('starts a new page with its title when the live page can’t be read, and a create task has no page', async () => {
    reads = {
      actions: action(),
      action_tasks: { id: TASK, task_key: 'create_content_draft', status: 'completed' },
      content_drafts: [{ id: 'd-page', method: 'optimize', source_url: PAGE, status: 'draft' }],
      brands: { site_type: 'b2b', industry: null, shopping_mode_enabled: false },
      prompts: [],
      content_opportunities: null,
    };
    await expect(start(null)).resolves.toMatchObject({ created: true, importFailed: false });
    expect(admin.inserts[0].value).toMatchObject({
      method: 'create',
      title: 'Pipeline forecasting',
      body_html: '<h1>Pipeline forecasting</h1>',
      source_url: null,
      opportunity_id: null,
    });
    // A task already past To do keeps its status.
    expect(calls.some((call) => call.table === 'action_tasks' && call.op === 'update')).toBe(false);

    admin.inserts = [];
    reads.action_tasks = { id: TASK, task_key: 'optimize_content', status: 'todo' };
    reads.content_drafts = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 502 })),
    );
    await expect(start()).resolves.toMatchObject({ created: true, importFailed: true });
    expect(admin.inserts[0].value).toMatchObject({
      title: 'Pipeline forecasting',
      body_html: '<h1>Pipeline forecasting</h1>',
      source_url: PAGE,
    });

    // The page's address tells its type, even when the page can't be read.
    admin.inserts = [];
    await expect(start('https://northwind.example/pricing')).resolves.toMatchObject({
      created: true,
    });
    expect(admin.inserts[0].value).toMatchObject({
      page_type: 'pricing',
      source_url: 'https://northwind.example/pricing',
    });
    vi.unstubAllGlobals();
  });

  it('refuses a page the action doesn’t name, a task that isn’t writing, or an unreadable action', async () => {
    reads = {
      actions: action(),
      action_tasks: { id: TASK, task_key: 'optimize_content', status: 'todo' },
    };
    await expect(start('https://elsewhere.example/')).resolves.toEqual({ error: 'invalid' });
    reads.action_tasks = { id: TASK, task_key: 'create_content_draft', status: 'todo' };
    await expect(start(PAGE)).resolves.toEqual({ error: 'invalid' });
    reads.action_tasks = { id: TASK, task_key: 'publish_content', status: 'todo' };
    await expect(start(null)).resolves.toEqual({ error: 'invalid' });
    reads.actions = null;
    await expect(start(null)).resolves.toEqual({ error: 'not_found' });
    await expect(
      startDraftFromAction(BRAND, 'nope', TASK, { page: null, title: '' }),
    ).resolves.toEqual({ error: 'invalid' });
    expect(admin.inserts).toEqual([]);
  });

  // The work's draft was archived: the read skips it (as the DB's filter
  // does) and the one-per-work key counts only drafts not archived (00233),
  // so Start writes a new one rather than fail on the archived one's key.
  it('writes a new draft for work whose draft was archived', async () => {
    reads = {
      actions: action({ pages: [] }),
      action_tasks: { id: TASK, task_key: 'create_content_draft', status: 'todo' },
      content_drafts: [],
      brands: null,
      prompts: [],
      content_opportunities: null,
    };
    await expect(start(null)).resolves.toEqual({
      draftId: 'action-draft',
      created: true,
      importFailed: false,
    });
    expect(calls.find((call) => call.table === 'content_drafts')!.filters).toContainEqual([
      'is',
      'archived_at',
      null,
    ]);
    expect(admin.inserts).toHaveLength(1);
  });

  it('opens the draft another start wrote at the same time', async () => {
    reads = {
      actions: action({ pages: [] }),
      action_tasks: { id: TASK, task_key: 'create_content_draft', status: 'todo' },
      content_drafts: [],
      brands: null,
      prompts: [],
      content_opportunities: null,
    };
    admin.result = { data: null, error: { code: '23505', message: 'duplicate key' } };
    admin.onInsert = () => {
      reads.content_drafts = [
        { id: 'd-first', method: 'create', source_url: null, status: 'draft' },
      ];
    };
    await expect(start(null)).resolves.toEqual({
      draftId: 'd-first',
      created: false,
      importFailed: false,
    });
  });
});

describe('startAgentWriting', () => {
  const request = {
    sources: { promptIds: [], fanouts: [], pages: [], queries: [], headings: [], length: 3000 },
    rules: [],
    textRules: [],
    locked: [],
  };

  it('starts the API’s Content Agent with the member’s session', async () => {
    const fetchMock = vi.fn(async () => new Response('{"started":true}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startAgentWriting(OPPORTUNITY, BRAND, request)).resolves.toEqual({
      started: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/api/content-drafts/${OPPORTUNITY}/write$`));
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
    expect(JSON.parse(init.body as string)).toEqual({ brandId: BRAND, ...request });
    vi.unstubAllGlobals();
  });

  it('says why it didn’t start, and sends nothing for a malformed id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"code":"ai_budget"}', { status: 429 })),
    );
    await expect(startAgentWriting(OPPORTUNITY, BRAND, request)).resolves.toEqual({
      error: 'ai_budget',
    });
    // A Fix open rules still under way on the draft.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"code":"running"}', { status: 409 })),
    );
    await expect(startAgentWriting(OPPORTUNITY, BRAND, request)).resolves.toEqual({
      error: 'running',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"code":"something_new"}', { status: 500 })),
    );
    await expect(startAgentWriting(OPPORTUNITY, BRAND, request)).resolves.toEqual({
      error: 'failed',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(startAgentWriting('nope', BRAND, request)).resolves.toEqual({ error: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
