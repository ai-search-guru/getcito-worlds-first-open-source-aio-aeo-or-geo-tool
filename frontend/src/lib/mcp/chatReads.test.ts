// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * Chat's Wave 1 reads (W1-16, CHAT-20 §9): each scoped to the caller's
 * organization, the plan's platforms only, with `data_as_of` (§15a), and
 * nothing secret: e-mails for Admins only, no key or credential, no AI
 * budget in dollars.
 */

const ORG = 'org-1';
const BRAND = 'brand-1';

const reads = vi.hoisted(() => ({
  selects: [] as { table: string; columns: string }[],
  filters: [] as { table: string; column: string; value: unknown }[],
  answers: {} as Record<string, unknown>,
  org: { plan: 'starter', subscription_status: 'active', plan_overrides: null } as unknown,
}));

function from(table: string) {
  const chain: Record<string, unknown> = {
    select: (columns: string) => {
      reads.selects.push({ table, columns });
      return chain;
    },
    eq: (column: string, value: unknown) => {
      reads.filters.push({ table, column, value });
      return chain;
    },
    in: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () =>
      table === 'organizations'
        ? { data: reads.org, error: null }
        : { data: reads.answers[table] ?? null, error: null },
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: reads.answers[table] ?? [], error: null }).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from } }));
vi.mock('@/lib/supabase/scoped', () => ({
  dbClient: vi.fn(),
  withDbClient: (_client: unknown, fn: () => Promise<unknown>) => fn(),
}));
const mocks = vi.hoisted(() => ({
  brandAllowed: vi.fn(),
  getPromptVolumesFor: vi.fn(),
  getVisibilitySummaryFor: vi.fn(),
  getQueryFanout: vi.fn(),
  getPromptResults: vi.fn(),
  getTrackingWindow: vi.fn(),
  getKpiSnapshots: vi.fn(),
  getGettingStarted: vi.fn(),
  getTrafficGoogleTotals: vi.fn(),
  readMemberEmails: vi.fn(),
  readPrecedenceContext: vi.fn(),
  brandAccessFor: vi.fn(),
  readMemberBrandAccess: vi.fn(),
}));
vi.mock('@/lib/brandAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/brandAccess')>()),
  brandAccessFor: mocks.brandAccessFor,
  readMemberBrandAccess: mocks.readMemberBrandAccess,
}));
vi.mock('./data', () => ({
  brandAllowed: mocks.brandAllowed,
  getPromptVolumesFor: mocks.getPromptVolumesFor,
  getVisibilitySummaryFor: mocks.getVisibilitySummaryFor,
}));
vi.mock('@/lib/actions/fanout', () => ({ getQueryFanout: mocks.getQueryFanout }));
vi.mock('@/lib/actions/tracking', () => ({
  getPromptResults: mocks.getPromptResults,
  getTrackingWindow: mocks.getTrackingWindow,
}));
vi.mock('@/lib/actions/kpis', () => ({ getKpiSnapshots: mocks.getKpiSnapshots }));
vi.mock('@/lib/actions/gettingStarted', () => ({ getGettingStarted: mocks.getGettingStarted }));
vi.mock('@/lib/actions/traffic', () => ({ getTrafficGoogleTotals: mocks.getTrafficGoogleTotals }));
vi.mock('@/lib/memberEmails', () => ({ readMemberEmails: mocks.readMemberEmails }));
vi.mock('@/lib/chat/precedenceContext', () => ({
  readPrecedenceContext: mocks.readPrecedenceContext,
}));
vi.mock('./productVisibility', () => ({ merchantCenterOffered: async () => false }));

const { getFanoutsFor, listAiAnswersFor, getPromptInsightsFor } = await import('./promptReads');
const { getOverviewSummaryFor } = await import('./overviewReads');
const { getActionCenterKpisFor, getOnboardingProgressFor } = await import('./actionCenterReads');
const { getGaSummaryFor, getGscSummaryFor } = await import('./googleReads');
const { getChatPolicyFor, getPlanFactsFor, listConnectionsFor, listMembersFor } =
  await import('./workspaceReads');

const auth = (role: McpAuthContext['role'] = 'manager'): McpAuthContext => ({
  userId: 'u1',
  email: null,
  organizationId: ORG,
  role,
  apiKeyId: 'agent-internal',
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  reads.selects = [];
  reads.filters = [];
  reads.answers = {};
  reads.org = { plan: 'starter', subscription_status: 'active', plan_overrides: null };
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.brandAllowed.mockResolvedValue(true);
  mocks.brandAccessFor.mockResolvedValue('all');
  mocks.readMemberBrandAccess.mockResolvedValue(new Map());
});
afterEach(() => vi.unstubAllEnvs());

describe('a brand outside the organization', () => {
  it('reads nothing, from every brand read', async () => {
    mocks.brandAllowed.mockResolvedValue(false);
    mocks.getPromptVolumesFor.mockResolvedValue(null);
    mocks.getVisibilitySummaryFor.mockResolvedValue(null);
    const params = { brandId: 'other' };
    for (const read of [
      getFanoutsFor(auth(), params),
      listAiAnswersFor(auth(), { ...params, promptId: 'p1' }),
      getPromptInsightsFor(auth(), params),
      getOverviewSummaryFor(auth(), params),
      getActionCenterKpisFor(auth(), params),
      getOnboardingProgressFor(auth(), params),
      getGscSummaryFor(auth(), params),
      getGaSummaryFor(auth(), params),
    ]) {
      expect(await read).toBeNull();
    }
    expect(mocks.getQueryFanout).not.toHaveBeenCalled();
    expect(mocks.getPromptResults).not.toHaveBeenCalled();
  });
});

describe('Prompts reads', () => {
  it("reads fan-outs from the plan's platforms only, with when their data last came in", async () => {
    reads.answers.prompt_results = { created_at: '2026-10-29T06:00:00Z' };
    mocks.getQueryFanout.mockResolvedValue({
      totalObserved: 3,
      truncated: false,
      engines: [
        {
          platform: 'copilot-web',
          answers: 4,
          answersWithFanout: 3,
          subQueries: 2,
          lastFanoutAt: null,
        },
      ],
      subQueries: [
        {
          query: 'best crm',
          engines: ['copilot-web'],
          timesSearched: 3,
          sourcedPrompts: [{}],
          tracked: true,
          trackedPromptId: 'p1',
        },
      ],
      promptCoverage: [],
    });
    const fanouts = await getFanoutsFor(auth(), { brandId: BRAND });
    // Starter reads ChatGPT and Copilot: the rows are theirs from the start, so every count is.
    expect(mocks.getQueryFanout).toHaveBeenCalledWith(BRAND, {
      days: 30,
      platforms: ['chatgpt-web', 'copilot-web'],
    });
    expect(fanouts).toMatchObject({
      total_observed: 3,
      engines: [{ platform: 'copilot-web', answers_with_fanout: 3 }],
      sub_queries: [{ query: 'best crm', times_searched: 3, tracked: true }],
      sub_queries_total: 1,
      data_as_of: '2026-10-29T06:00:00Z',
    });
  });

  it("gives a prompt's newest answers, shortened, on the plan's platforms", async () => {
    mocks.getPromptResults.mockResolvedValue({
      total: 2,
      results: [
        {
          id: 'r1',
          platform: 'chatgpt-web',
          response: 'x'.repeat(2000),
          createdAt: '2026-10-29T05:00:00Z',
          mentionCount: 1,
          citationCount: 0,
          sentiment: 'positive',
          visibilityScore: 62,
        },
        {
          id: 'r2',
          platform: 'gemini-web',
          response: 'hidden',
          createdAt: '2026-10-29T06:00:00Z',
          mentionCount: 0,
          citationCount: 0,
          sentiment: 'neutral',
          visibilityScore: 0,
        },
      ],
    });
    const read = await listAiAnswersFor(auth(), {
      brandId: BRAND,
      promptId: 'p1',
      platform: 'chatgpt-web',
    });
    // More than asked: the plan's platforms still fill the page once the rest are left out.
    expect(mocks.getPromptResults).toHaveBeenCalledWith(BRAND, {
      promptId: 'p1',
      platform: 'chatgpt-web',
      dateFrom: undefined,
      dateTo: undefined,
      limit: 50,
    });
    expect(read?.answers).toHaveLength(1);
    expect(read?.answers[0].answer).toHaveLength(1501);
    expect(read?.data_as_of).toBe('2026-10-29T05:00:00Z');
  });

  it("sums the Insights tab's volume, by intent, with the most demanded prompts first", async () => {
    mocks.getPromptVolumesFor.mockResolvedValue([
      {
        prompt_id: 'p1',
        prompt_text: 'a',
        intent: 'commercial',
        est_ai_volume: 100,
        fetched_at: '2026-10-20T00:00:00Z',
      },
      {
        prompt_id: 'p2',
        prompt_text: 'b',
        intent: 'informational',
        est_ai_volume: 300,
        fetched_at: '2026-10-28T00:00:00Z',
      },
      {
        prompt_id: 'p3',
        prompt_text: 'c',
        intent: 'commercial',
        est_ai_volume: 50,
        fetched_at: null,
      },
    ]);
    const insights = await getPromptInsightsFor(auth(), { brandId: BRAND, limit: 2 });
    expect(insights).toMatchObject({
      prompts_with_volume: 3,
      truncated: false,
      total_est_ai_volume: 450,
      by_intent: { commercial: 2, informational: 1 },
      data_as_of: '2026-10-28T00:00:00Z',
    });
    expect(insights?.top.map((p) => p.prompt_id)).toEqual(['p2', 'p1']);
  });
});

describe('Overview, KPIs and Getting started', () => {
  it('gives the overview with when tracking last ran, as its data_as_of', async () => {
    mocks.getVisibilitySummaryFor.mockResolvedValue({ results: 10 });
    mocks.getTrackingWindow.mockResolvedValue({
      lastRunAt: '2026-10-29T04:00:00Z',
      nextRunAt: '2026-10-30T04:00:00Z',
    });
    expect(await getOverviewSummaryFor(auth(), { brandId: BRAND })).toEqual({
      results: 10,
      last_run_at: '2026-10-29T04:00:00Z',
      next_run_at: '2026-10-30T04:00:00Z',
      data_as_of: '2026-10-29T04:00:00Z',
    });
  });

  it("reads the KPIs page's snapshots and Getting started's steps", async () => {
    mocks.getKpiSnapshots.mockResolvedValue({
      configured: true,
      kpis: [
        {
          key: 'ai_visibility',
          category: 'visibility',
          unit: 'percent',
          direction: 'up',
          timeframe: '30d',
          value: 42,
          change: 3,
          changeKind: 'points',
          trend: [],
          target: 50,
          progress: 84,
          status: 'at_risk',
        },
      ],
    });
    mocks.getTrackingWindow.mockResolvedValue({ lastRunAt: '2026-10-29T04:00:00Z' });
    const kpis = await getActionCenterKpisFor(auth(), { brandId: BRAND });
    expect(kpis).toMatchObject({
      configured: true,
      kpis: [
        { key: 'ai_visibility', value: 42, target: 50, status: 'at_risk', change_kind: 'points' },
      ],
      data_as_of: '2026-10-29T04:00:00Z',
    });
    expect(kpis?.kpis[0]).not.toHaveProperty('trend');

    mocks.getGettingStarted.mockResolvedValue({
      active: true,
      skipped: false,
      done: 1,
      total: 2,
      steps: [
        {
          key: 'competitors',
          stage: 'setup',
          state: 'done',
          progress: null,
          updatedAt: '2026-10-28T00:00:00Z',
        },
        { key: 'kpis', stage: 'setup', state: 'open', progress: null, updatedAt: null },
      ],
    });
    expect(await getOnboardingProgressFor(auth(), { brandId: BRAND })).toMatchObject({
      done: 1,
      total: 2,
      data_as_of: '2026-10-28T00:00:00Z',
    });
  });
});

describe('Google reads', () => {
  // The Google sign-in the brand uses (00470): the Account's, for every brand.
  const connected = [
    { provider: 'google-search-console', account: { id: 'a1', label: null, status: 'connected' } },
    { provider: 'google-analytics', account: { id: 'a2', label: null, status: 'connected' } },
  ];

  it('say a source is not connected: no connection, or no property picked', async () => {
    reads.answers.brands = { gsc_property: null, ga_property_id: '123' };
    reads.answers.brand_integrations = [
      { provider: 'google-search-console', account: { status: 'connected' } },
      { provider: 'google-analytics', account: { status: 'disconnected' } },
    ];
    expect(await getGscSummaryFor(auth(), { brandId: BRAND })).toEqual({
      connected: false,
      days: 28,
      data_as_of: null,
      source_lag: '2–3 days',
    });
    expect(await getGaSummaryFor(auth(), { brandId: BRAND })).toMatchObject({ connected: false });
    expect(mocks.getTrafficGoogleTotals).not.toHaveBeenCalled();
    // The brand's own sign-ins, not the Account's row.
    expect(reads.filters).toContainEqual({
      table: 'brand_integrations',
      column: 'brand_id',
      value: BRAND,
    });
    expect(reads.selects.some((read) => read.table === 'integration_connections')).toBe(false);
  });

  it('say a source is not connected when the brand uses no Google sign-in', async () => {
    reads.answers.brands = { gsc_property: 'sc-domain:x', ga_property_id: '123' };
    reads.answers.brand_integrations = [];
    expect(await getGscSummaryFor(auth(), { brandId: BRAND })).toMatchObject({ connected: false });
    expect(await getGaSummaryFor(auth(), { brandId: BRAND })).toMatchObject({ connected: false });
  });

  it("reads Search Console's latest reported days for a short range, as the page does", async () => {
    reads.answers.brands = { gsc_property: 'sc-domain:x', ga_property_id: '123' };
    reads.answers.brand_integrations = connected;
    reads.answers.gsc_query_stats = { date: '2026-10-27' };
    mocks.getTrafficGoogleTotals.mockResolvedValue({
      ga: null,
      gsc: { since: '2026-10-21', until: '2026-10-27', clicks: 120, prevClicks: 100 },
    });
    expect(await getGscSummaryFor(auth(), { brandId: BRAND, days: 7 })).toMatchObject({
      connected: true,
      clicks: 120,
      previous_clicks: 100,
      until: '2026-10-27',
      data_as_of: '2026-10-27',
    });
    expect(mocks.getTrafficGoogleTotals.mock.calls[0][2]).toEqual({
      ga: false,
      gsc: true,
      gscLatestDays: 7,
    });
    await getGscSummaryFor(auth(), { brandId: BRAND, days: 28 });
    expect(mocks.getTrafficGoogleTotals.mock.calls[1][2]).toMatchObject({ gscLatestDays: null });
  });

  it("reads Analytics' sessions to the last day it reported", async () => {
    reads.answers.brands = { gsc_property: null, ga_property_id: '123' };
    reads.answers.brand_integrations = connected;
    reads.answers.ga_ai_traffic_stats = { date: '2026-10-28' };
    mocks.getTrafficGoogleTotals.mockResolvedValue({
      gsc: null,
      ga: {
        sessions: 900,
        aiSessions: 40,
        aiEngagedSessions: 30,
        aiKeyEvents: 5,
        aiKeyEventSessions: 4,
        aiRevenue: 0,
        organic: { sessions: 500, engagedSessions: 0, keyEvents: 0, keyEventSessions: 0 },
      },
    });
    expect(await getGaSummaryFor(auth(), { brandId: BRAND })).toMatchObject({
      connected: true,
      ai_sessions: 40,
      organic_sessions: 500,
      data_as_of: '2026-10-28',
      source_lag: '1 day',
    });
  });
});

describe('Workspace reads', () => {
  it('give e-mails to Admins only', async () => {
    reads.answers.profiles = [
      { id: 'u1', full_name: 'Alex Kim', role: 'manager' },
      { id: 'u2', full_name: null, role: 'admin' },
    ];
    mocks.readMemberEmails.mockResolvedValue(new Map([['u2', 'sam@x.example']]));
    const forManager = await listMembersFor(auth('manager'));
    expect(forManager?.members[0]).toEqual({
      name: 'Alex Kim',
      role: 'manager',
      brand_access: 'all',
      is_you: true,
    });
    expect(JSON.stringify(forManager)).not.toContain('@');
    expect(mocks.readMemberEmails).not.toHaveBeenCalled();
    const forAdmin = await listMembersFor(auth('admin'));
    expect(forAdmin?.members[1]).toMatchObject({ email: 'sam@x.example' });
  });

  it("give each member's real brand access, with names for Admins and the person only", async () => {
    reads.answers.profiles = [
      { id: 'u1', full_name: 'Alex Kim', role: 'analyst' },
      { id: 'u2', full_name: 'Sam Lee', role: 'admin' },
      { id: 'u3', full_name: 'Ayse Demir', role: 'analyst' },
    ];
    reads.answers.brands = [
      { id: 'b1', name: 'Acme' },
      { id: 'b2', name: 'Globex' },
    ];
    mocks.readMemberEmails.mockResolvedValue(new Map());
    mocks.readMemberBrandAccess.mockResolvedValue(
      new Map([
        ['u1', { scope: 'selected', brandIds: ['b2'] }],
        ['u2', { scope: 'all', brandIds: [] }],
        ['u3', { scope: 'selected', brandIds: ['b1'] }],
      ]),
    );
    const forAdmin = await listMembersFor({ ...auth('admin'), userId: 'u2' });
    expect(forAdmin?.members.map((m) => [m.brand_access, m.brands])).toEqual([
      ['selected', ['Globex']],
      ['all', undefined],
      ['selected', ['Acme']],
    ]);
    const forAnalyst = await listMembersFor(auth('analyst'));
    expect(forAnalyst?.members.map((m) => [m.brand_access, m.brands])).toEqual([
      ['selected', ['Globex']],
      ['all', undefined],
      ['selected', undefined],
    ]);
    expect(JSON.stringify(forAnalyst)).not.toContain('Acme');
  });

  it("list what is connected, and never read a key's value or a credential", async () => {
    reads.answers.brands = [{ id: BRAND, name: 'Acme', gsc_property: 'sc', ga_property_id: null }];
    reads.answers.brand_cms_connections = [
      { brand_id: BRAND, provider: 'webflow', status: 'connected', site_name: 'Acme site' },
    ];
    reads.answers.integration_connections = [
      {
        provider: 'google-search-console',
        status: 'connected',
        connected_by: null,
        created_at: null,
      },
    ];
    reads.answers.api_keys = [{ name: 'MCP laptop', last_used_at: null }];
    reads.answers.organization_ai_keys = [{ provider: 'anthropic', active: true }];
    const read = await listConnectionsFor(auth());
    // The one read of connections the Connections page and the agents use (W4-24).
    expect(read).toMatchObject({
      brands: [
        {
          brand: 'Acme',
          connected: [
            { tool: 'Google Search Console', account: 'sc', access: 'read_only' },
            { tool: 'Webflow', account: 'Acme site', access: 'read_write_drafts' },
          ],
          sign_in_failed: [],
        },
      ],
      your_api_keys: [{ name: 'MCP laptop' }],
      ai_providers: [{ provider: 'anthropic', active: true }],
    });
    expect(read?.brands[0].not_connected).toContain('Google Analytics');
    expect(read?.brands[0].not_connected).not.toContain('HubSpot');
    expect(read?.coming_soon).toContain('HubSpot');
    // Google disconnected in Settings: the property is kept, but its sign-in is gone.
    reads.answers.integration_connections = [];
    expect((await listConnectionsFor(auth()))?.brands[0]).toMatchObject({
      connected: [{ tool: 'Webflow' }],
      sign_in_failed: ['Google Search Console'],
    });
    // Only the person's own keys: the read is by their id, never the workspace's members.
    expect(reads.filters).toContainEqual({ table: 'api_keys', column: 'user_id', value: 'u1' });
    expect(reads.selects.some((s) => s.table === 'profiles')).toBe(false);
    const columns = reads.selects.map((s) => s.columns).join(',');
    expect(columns).not.toMatch(/key_hash|key_encrypted|key_last4|prefix|composio|credential/);
  });

  it("list a Selected-brands person's brands only (BRAND-ACCESS)", async () => {
    reads.answers.brands = [
      { id: BRAND, name: 'Acme', gsc_property: 'sc', ga_property_id: null },
      { id: 'brand-2', name: 'Hidden', gsc_property: 'sc', ga_property_id: 'ga' },
    ];
    mocks.brandAccessFor.mockResolvedValue([BRAND]);
    const read = await listConnectionsFor(auth());
    expect(mocks.brandAccessFor).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', organizationId: ORG }),
    );
    expect(read?.brands.map((b) => b.brand)).toEqual(['Acme']);
    expect(JSON.stringify(read)).not.toContain('Hidden');
  });

  it("give Chat's rules as the precedence reads them", async () => {
    mocks.readPrecedenceContext.mockResolvedValue({
      role: 'manager',
      plan: { fullAuto: false },
      settings: {
        toolPolicies: { saveDraft: 'never' },
        fullAutoForMembers: true,
        dontAskAgain: true,
        managerExecuteOff: ['feeds'],
      },
      autoChoices: new Set(['dismissSuggestion']),
    });
    reads.answers.chat_settings = { updated_at: '2026-10-29T08:00:00Z' };
    expect(await getChatPolicyFor(auth())).toEqual({
      role: 'manager',
      full_auto_in_plan: false,
      full_auto_for_members: true,
      dont_ask_again: true,
      manager_execute_off: ['feeds'],
      tool_policies: { saveDraft: 'never' },
      your_auto_choices: ['dismissSuggestion'],
      data_as_of: '2026-10-29T08:00:00Z',
    });
  });

  it("give the plan's facts and counts, never an AI budget in dollars", async () => {
    const facts = await getPlanFactsFor(auth());
    expect(facts).toMatchObject({ plan_id: 'starter', plan_name: 'Starter', is_trial: false });
    expect(facts?.limits).toHaveProperty('maxPrompts');
    expect(JSON.stringify(facts)).not.toMatch(/Usd|Budget/);
  });
});
