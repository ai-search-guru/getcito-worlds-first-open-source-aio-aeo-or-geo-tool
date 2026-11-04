import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the Content plan (CE-014) reads: the brand's pages (00220), its open
 * opportunities for its own pages, and the drafts still being written.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const O9 = '99999999-9999-9999-9999-999999999999';

let reads: Record<string, unknown>;
let rpcResult: unknown;
/** A function's own answer, where a test gives one (else rpcResult). */
let rpcByName: Record<string, { data?: unknown; error?: { message: string } }>;
let rpcCalls: [string, unknown][];
let filters: [string, string, string, unknown][];
/** One row a .maybeSingle() read or write returns, by table (null: none). */
let single: Record<string, unknown>;
let writes: { table: string; op: string; value: unknown; options?: unknown }[];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc: async (name: string, args: unknown) => (
      rpcCalls.push([name, args]),
      name in rpcByName
        ? { data: rpcByName[name].data ?? null, error: rpcByName[name].error ?? null }
        : { data: rpcResult, error: null }
    ),
    from: (table: string) => {
      // A read by id (the hidden opportunities) answers from `${table}#id`.
      let byId = false;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (filters.push([table, 'eq', col, v]), chain),
        in: (col: string, v: unknown) => {
          filters.push([table, 'in', col, v]);
          if (col === 'id') byId = true;
          return chain;
        },
        is: (col: string, v: unknown) => (filters.push([table, 'is', col, v]), chain),
        order: () => chain,
        limit: () => chain,
        upsert: async (value: unknown, options: unknown) => {
          writes.push({ table, op: 'upsert', value, options });
          return { error: null };
        },
        update: (value: unknown) => (writes.push({ table, op: 'update', value }), chain),
        maybeSingle: async () => ({
          data: table in single ? single[table] : null,
          error: null,
        }),
        then: (resolve: (r: unknown) => void) =>
          resolve({
            data: (byId && reads[`${table}#id`]) || reads[table] || [],
            error: null,
          }),
      };
      return chain;
    },
  })),
}));

const readAssignees = vi.hoisted(() => vi.fn());
vi.mock('@/lib/action-center/assignees', () => ({ readAssignees }));
const updateOpportunityStatus = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/content', () => ({ updateOpportunityStatus }));

const getSuggestionSourceStates = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/integrations', () => ({ getSuggestionSourceStates }));
const GA_CONNECTED = { configured: true, connected: true, mapped: true, lastDataAt: '2026-10-20' };

const {
  getContentPlan,
  getContentPlanInsights,
  getPlanPriorities,
  hidePlanRow,
  setPlanRowPriority,
  showPlanRow,
} = await import('./contentPlan');

beforeEach(() => {
  reads = {};
  rpcResult = { days: 30, pages: [] };
  // Read the insights alone: the snippet's conversions as none.
  rpcByName = { brand_ai_conversions: { data: null } };
  rpcCalls = [];
  filters = [];
  single = {};
  writes = [];
  readAssignees.mockReset().mockResolvedValue(new Map());
  updateOpportunityStatus.mockReset().mockResolvedValue({});
  getSuggestionSourceStates.mockReset().mockResolvedValue({ ga: GA_CONNECTED });
});

describe('getContentPlan', () => {
  it('reads the pages, the open opportunities for own pages and the drafts being written', async () => {
    rpcResult = {
      days: 7,
      answers: { cur: 120, prev: 140 },
      prevFrom: '2026-10-07',
      trackedSince: '2026-09-09',
      pages: [
        {
          page: 'https://acme.example/guides/espresso',
          title: 'Espresso guide',
          citations: { cur: 4, prev: 9 },
          platformsDown: ['chatgpt-web'],
          aiVisits: 12,
          // Still in the RPC (00220); the plan no longer reads it.
          overlaps: 1,
          // With conversions on (00291).
          conversions: 3,
        },
      ],
    };
    reads.content_opportunities = [
      {
        id: 'o1',
        title: 'Expand the espresso guide',
        decision: 'expand',
        opportunity_score: '81.10',
        brief: { suggestedTitle: ' The home espresso guide ' },
        source_data: {
          targetPages: [
            { url: '' },
            { url: 'https://acme.example/guides/espresso', title: 'The home espresso guide' },
          ],
          competitorsCited: ['Daily Grind Co.', '', 'Origin Box'],
          visibilityScore: 6,
          prompts: ['p1', 'p2'],
          assets: [
            { key: 'a1', type: 'pillar_guide' },
            { key: 'a2', type: 'backlink' },
          ],
        },
      },
    ];
    reads.content_drafts = [
      {
        id: 'd1',
        author: 'agent',
        created_by: 'u1',
        method: 'create',
        opportunity_id: 'o2',
        source_url: null,
        action_id: 'a1',
      },
    ];
    reads.actions = [{ id: 'a1', assignee_id: 'u2' }];
    readAssignees.mockResolvedValue(
      new Map([['u2', { id: 'u2', fullName: null, avatarUrl: null, email: 'ada@acme.example' }]]),
    );
    reads.content_plan_marks = [
      { row_key: 'page:acme.example/guides/espresso', priority: true, hidden_at: null },
    ];

    await expect(getContentPlan(BRAND, 7)).resolves.toEqual({
      pages: [
        {
          page: 'https://acme.example/guides/espresso',
          title: 'Espresso guide',
          citations: { cur: 4, prev: 9 },
          platformsDown: ['chatgpt-web'],
          aiVisits: 12,
          conversions: 3,
        },
      ],
      answers: { cur: 120, prev: 140 },
      tracking: { prevFrom: '2026-10-07', trackedSince: '2026-09-09' },
      opportunities: [
        {
          id: 'o1',
          title: 'Expand the espresso guide',
          pageTitle: 'The home espresso guide',
          decision: 'expand',
          score: 81.1,
          targetPage: 'https://acme.example/guides/espresso',
          targetTitle: 'The home espresso guide',
          competitorsCited: ['Daily Grind Co.', 'Origin Box'],
          visibility: 6,
          prompts: 2,
          assetType: 'pillar_guide',
        },
      ],
      drafts: [
        {
          id: 'd1',
          author: 'agent',
          isMine: true,
          method: 'create',
          opportunityId: 'o2',
          sourceUrl: null,
          actionId: 'a1',
          // Named as the Action Center names them: the e-mail when there's no name.
          assignee: { id: 'u2', name: 'ada@acme.example' },
        },
      ],
      marks: [{ rowKey: 'page:acme.example/guides/espresso', priority: true, hidden: false }],
    });
    expect(readAssignees).toHaveBeenCalledWith(expect.anything(), BRAND, ['u2']);
    expect(rpcCalls).toEqual([['content_plan_pages', { p_brand_id: BRAND, p_days: 7 }]]);
    expect(filters).toContainEqual(['content_opportunities', 'eq', 'type', 'owned']);
    // An archived draft (00233) leaves the Plan: its row starts afresh.
    expect(filters).toContainEqual(['content_drafts', 'is', 'archived_at', null]);
    expect(filters).toContainEqual([
      'content_opportunities',
      'in',
      'status',
      ['new', 'reviewed', 'sent', 'in_progress'],
    ]);
    expect(filters).toContainEqual([
      'content_drafts',
      'in',
      'status',
      ['draft', 'in_review', 'ready'],
    ]);
  });

  it('reads a page’s conversions as none with conversions off, or from a database before 00291', async () => {
    const pageOf = (over: Record<string, unknown>) => ({
      page: 'https://acme.example/a',
      title: null,
      citations: { cur: 1, prev: 1 },
      platformsDown: [],
      aiVisits: 2,
      ...over,
    });
    rpcResult = {
      days: 30,
      answers: { cur: 1, prev: 1 },
      pages: [pageOf({ conversions: null }), pageOf({}), pageOf({ conversions: 0 })],
    };
    const plan = await getContentPlan(BRAND, 30);
    expect(plan!.pages.map((p) => p.conversions)).toEqual([null, null, 0]);
  });

  it('reads nothing of another organization’s brand, and refuses another period', async () => {
    rpcResult = null;
    await expect(getContentPlan(BRAND, 30)).resolves.toBeNull();
    await expect(getContentPlan(BRAND, 14 as 30)).rejects.toThrow('invalid');
    await expect(getContentPlan('nope', 30)).rejects.toThrow('invalid');
  });
});

describe('the Plan’s row marks (00229)', () => {
  it('reads a hidden opportunity, dismissed with its row, to show it again', async () => {
    rpcResult = { pages: [] };
    reads.content_opportunities = [
      { id: 'o1', title: 'Open one', decision: 'create', opportunity_score: 50, source_data: {} },
    ];
    reads['content_opportunities#id'] = [
      { id: O9, title: 'Hidden one', decision: 'create', opportunity_score: 40, source_data: {} },
    ];
    reads.content_plan_marks = [
      { row_key: `opportunity:${O9}`, priority: false, hidden_at: '2026-10-21T10:00:00Z' },
      // Not an opportunity's id: never read.
      { row_key: 'opportunity:o8', priority: false, hidden_at: '2026-10-21T10:00:00Z' },
    ];
    const plan = await getContentPlan(BRAND, 30);
    expect(plan?.opportunities.map((o) => o.id)).toEqual(['o1', O9]);
    expect(plan?.marks[0]).toEqual({ rowKey: `opportunity:${O9}`, priority: false, hidden: true });
    expect(filters).toContainEqual(['content_opportunities', 'in', 'id', [O9]]);
    // Only while it is still dismissed: one completed or reopened since isn't hidden.
    expect(filters).toContainEqual(['content_opportunities', 'eq', 'status', 'dismissed']);
  });

  it('marks a row as a priority, as the member', async () => {
    await setPlanRowPriority(BRAND, 'page:acme.example/pricing', true);
    expect(writes).toEqual([
      {
        table: 'content_plan_marks',
        op: 'upsert',
        value: expect.objectContaining({
          brand_id: BRAND,
          row_key: 'page:acme.example/pricing',
          priority: true,
          updated_by: 'u1',
        }),
        options: { onConflict: 'brand_id,row_key' },
      },
    ]);
  });

  it('hides an opportunity’s row and dismisses it, keeping the status it had', async () => {
    single.content_opportunities = { status: 'reviewed' };
    await hidePlanRow(BRAND, 'opportunity:22222222-2222-2222-2222-222222222222');
    expect(writes[0]).toMatchObject({
      table: 'content_plan_marks',
      op: 'upsert',
      value: {
        row_key: 'opportunity:22222222-2222-2222-2222-222222222222',
        restore_status: 'reviewed',
      },
    });
    expect((writes[0].value as { hidden_at: string }).hidden_at).toEqual(expect.any(String));
    expect(updateOpportunityStatus).toHaveBeenCalledWith(
      '22222222-2222-2222-2222-222222222222',
      'dismissed',
    );
  });

  it('hides a page’s row without touching any opportunity', async () => {
    await hidePlanRow(BRAND, 'page:acme.example/blog/a');
    expect(writes[0]).toMatchObject({ value: { restore_status: null } });
    expect(updateOpportunityStatus).not.toHaveBeenCalled();
  });

  it('shows a row again, giving its opportunity back the status it had', async () => {
    single.content_plan_marks = { restore_status: 'sent', row_key: 'opportunity:o' };
    single.content_opportunities = { status: 'dismissed' };
    await showPlanRow(BRAND, 'opportunity:22222222-2222-2222-2222-222222222222');
    expect(writes).toEqual([
      {
        table: 'content_plan_marks',
        op: 'update',
        value: expect.objectContaining({ hidden_at: null, restore_status: null, updated_by: 'u1' }),
      },
    ]);
    expect(updateOpportunityStatus).toHaveBeenCalledWith(
      '22222222-2222-2222-2222-222222222222',
      'sent',
    );
  });

  it('leaves an opportunity completed or reopened while hidden as it is', async () => {
    single.content_plan_marks = { restore_status: 'new', row_key: 'opportunity:o' };
    single.content_opportunities = { status: 'completed' };
    await showPlanRow(BRAND, 'opportunity:22222222-2222-2222-2222-222222222222');
    expect(writes).toEqual([
      expect.objectContaining({ table: 'content_plan_marks', op: 'update' }),
    ]);
    expect(updateOpportunityStatus).not.toHaveBeenCalled();
  });

  it('shows nothing it can’t write, and refuses what isn’t a row key', async () => {
    await expect(showPlanRow(BRAND, 'page:acme.example/x')).rejects.toThrow('not_found');
    await expect(setPlanRowPriority('b1', 'page:x', true)).rejects.toThrow('invalid');
    await expect(hidePlanRow(BRAND, '')).rejects.toThrow('invalid');
    // The opportunity comes from the key: one without an id is refused.
    await expect(hidePlanRow(BRAND, 'opportunity:not-an-id')).rejects.toThrow('invalid');
    await expect(showPlanRow(BRAND, 'opportunity:not-an-id')).rejects.toThrow('invalid');
    expect(writes).toEqual([]);
    expect(updateOpportunityStatus).not.toHaveBeenCalled();
  });
});

describe('getPlanPriorities', () => {
  const O1 = '44444444-4444-4444-4444-444444444441';
  const O2 = '44444444-4444-4444-4444-444444444442';

  it('names the opportunities whose Plan rows are a priority', async () => {
    reads.content_plan_marks = [{ row_key: `opportunity:${O2}` }];
    await expect(getPlanPriorities(BRAND, [O1, O2, O1, 'not-an-id'])).resolves.toEqual([O2]);
    expect(filters).toEqual([
      ['content_plan_marks', 'eq', 'brand_id', BRAND],
      ['content_plan_marks', 'eq', 'priority', true],
      ['content_plan_marks', 'in', 'row_key', [`opportunity:${O1}`, `opportunity:${O2}`]],
    ]);
  });

  it('reads nothing without an opportunity to look up', async () => {
    await expect(getPlanPriorities(BRAND, ['x'])).resolves.toEqual([]);
    expect(filters).toEqual([]);
  });
});

describe('getContentPlanInsights', () => {
  it('reads what AI cites and what AI visits brought in, with the snippet’s conversions', async () => {
    const conversions = {
      enabled: true,
      goals: [{ goal: 'demo', count: 2 }],
      journey: { source: 'chatgpt.com', pages: ['/blog', '/pricing'], goal: 'demo', count: 2 },
    };
    rpcByName = { brand_ai_conversions: { data: conversions } };
    rpcResult = {
      days: 30,
      totalCitations: 120,
      citations: [
        { url: 'https://acme.example/vs/hubspot', title: null, own: true, citations: '7' },
      ],
      results: { visits: 40, keyEvents: 5, analytics: true, purchases: false },
    };
    await expect(getContentPlanInsights(BRAND, 30)).resolves.toEqual({
      totalCitations: 120,
      citations: [{ url: 'https://acme.example/vs/hubspot', title: null, own: true, citations: 7 }],
      results: {
        visits: 40,
        keyEvents: 5,
        transactions: 0,
        revenue: 0,
        analytics: true,
        purchases: false,
      },
      conversions,
    });
    expect(rpcCalls).toEqual([
      ['content_plan_insights', { p_brand_id: BRAND, p_days: 30 }],
      ['brand_ai_conversions', { p_brand_id: BRAND, p_days: 30 }],
    ]);
  });

  it('reads the rest when the conversions can’t be read (a database before 00288)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      rpcByName = {
        brand_ai_conversions: {
          error: { message: 'function brand_ai_conversions does not exist' },
        },
      };
      rpcResult = { totalCitations: 3, citations: [], results: { visits: 4 } };
      const read = (await getContentPlanInsights(BRAND, 30))!;
      expect(read.conversions).toBeNull();
      expect(read.results.visits).toBe(4);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('counts Analytics as connected only as AI Traffic does: connected and synced', async () => {
    rpcResult = { totalCitations: 0, citations: [], results: { analytics: true } };
    getSuggestionSourceStates.mockResolvedValue({ ga: { ...GA_CONNECTED, lastDataAt: null } });
    expect((await getContentPlanInsights(BRAND, 30))!.results.analytics).toBe(false);
    getSuggestionSourceStates.mockResolvedValue({ ga: { ...GA_CONNECTED, connected: false } });
    expect((await getContentPlanInsights(BRAND, 30))!.results.analytics).toBe(false);
    // The connection can't be read: the property set says it.
    getSuggestionSourceStates.mockRejectedValue(new Error('down'));
    expect((await getContentPlanInsights(BRAND, 30))!.results.analytics).toBe(true);
  });

  it('reads nothing of another organization’s brand', async () => {
    rpcResult = null;
    await expect(getContentPlanInsights(BRAND, 7)).resolves.toBeNull();
    await expect(getContentPlanInsights(BRAND, 14 as 7)).rejects.toThrow('invalid');
  });
});
