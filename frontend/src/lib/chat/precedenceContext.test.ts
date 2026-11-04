// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';
import type { BrandLookupTable } from './registry/defineTool';

/**
 * The precedence's facts, read fresh for every call with the service role:
 * the live role above all (CHAT-20 §4, §21), the plan, the workspace's Chat
 * settings and the person's ticks.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '33333333-3333-4333-8333-333333333333';
const USER = 'user-1';

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Filters = [string, unknown][];
const db = vi.hoisted(() => ({
  /** A table's rows, or a function of the read's filters for one that answers per id. */
  tables: {} as Record<string, unknown>,
  errors: {} as Record<string, string | { message: string; code: string }>,
  reads: [] as { table: string; filters: [string, unknown][] }[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from(table: string) {
      const read = { table, filters: [] as [string, unknown][] };
      db.reads.push(read);
      const rows = () => {
        const value = db.tables[table];
        return typeof value === 'function'
          ? (value as (f: Filters) => unknown)(read.filters)
          : value;
      };
      const result = (): Result => ({
        data: rows() ?? null,
        error: db.errors[table]
          ? typeof db.errors[table] === 'string'
            ? { message: db.errors[table] }
            : db.errors[table]
          : null,
      });
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          read.filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => result(),
        then: (resolve: (r: Result) => unknown) =>
          resolve({ ...result(), data: (rows() as unknown[]) ?? [] }),
      };
      return builder;
    },
  },
}));

const {
  readPrecedenceContext,
  readToolCall,
  resolveCallBrand,
  parseChatSettings,
  readBrandIsDemo,
} = await import('./precedenceContext');
const { decideToolCall, DEFAULT_CHAT_SETTINGS } = await import('./precedence');
const { defineTool } = await import('./registry/defineTool');
const { z } = await import('zod');

const addPrompts = defineTool({
  name: 'add_prompts',
  class: 'write',
  area: 'prompts',
  description: 'fixture',
  minRole: 'manager',
  planGate: null,
  brandOf: null,
  costClass: 'C1',
  labelKey: 'addPrompts',
  route: null,
  mcpTool: null,
  specRow: '20',
  inputSchema: z.object({}),
  run: async () => null,
  fixture: { input: {} },
  defaultPolicy: 'ask_full_auto',
  maxPolicy: 'always',
});

const request = {
  userId: USER,
  organizationId: ORG,
  mode: 'auto' as const,
  surface: 'chat' as const,
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  db.tables = {
    profiles: { role: 'manager', organization_id: ORG, brand_scope: 'all' },
    organizations: { plan: 'growth', subscription_status: 'active', plan_overrides: null },
    chat_settings: null,
    chat_auto_choices: [],
  };
  db.errors = {};
  db.reads = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('readPrecedenceContext', () => {
  it("reads the person's role again for every call: a role changed mid-run counts at once", async () => {
    const first = await readPrecedenceContext(request);
    expect(first?.role).toBe('manager');
    expect(
      decideToolCall(addPrompts, first!, { brandId: null, brandIsDemo: false, tainted: false }),
    ).toMatchObject({ kind: 'ask' });

    // An Admin makes them an Analyst while the run goes on.
    db.tables.profiles = { role: 'analyst', organization_id: ORG, brand_scope: 'all' };
    const next = await readPrecedenceContext(request);
    expect(next?.role).toBe('analyst');
    expect(
      decideToolCall(addPrompts, next!, { brandId: null, brandIsDemo: false, tainted: false }),
    ).toEqual({
      kind: 'deny',
      denial: { code: 'forbidden_role', role: 'analyst', roles: ['admin', 'manager'] },
    });
    // From the profile, by the person's id, each time.
    const profileReads = db.reads.filter((read) => read.table === 'profiles');
    expect(profileReads).toHaveLength(2);
    expect(profileReads[1].filters).toEqual([['id', USER]]);
  });

  it('acts with live roles only, and only in the workspace the person belongs to now', async () => {
    for (const role of ['owner', 'editor', 'viewer', null]) {
      db.tables.profiles = { role, organization_id: ORG, brand_scope: 'all' };
      expect(await readPrecedenceContext(request)).toBeNull();
    }
    db.tables.profiles = { role: 'admin', organization_id: OTHER_ORG };
    expect(await readPrecedenceContext(request)).toBeNull();
    db.tables.profiles = null;
    expect(await readPrecedenceContext(request)).toBeNull();
  });

  it('reads the plan, the settings and the ticks of this person in this workspace', async () => {
    db.tables.organizations = { plan: 'starter', subscription_status: 'active' };
    db.tables.chat_settings = {
      tool_policies: { saveDraft: 'always', addPrompts: 'never', brands: 'click' },
      full_auto_for_members: false,
      dont_ask_again: false,
      manager_execute_off: ['publishing', 'merging'],
    };
    db.tables.chat_auto_choices = [{ tool_key: 'saveDraft' }];
    const context = await readPrecedenceContext({ ...request, injectionDetected: true });
    expect(context).toMatchObject({
      role: 'manager',
      plan: { planId: 'starter', fullAuto: false },
      settings: {
        toolPolicies: { saveDraft: 'always', addPrompts: 'never' },
        fullAutoForMembers: false,
        dontAskAgain: false,
        managerExecuteOff: ['publishing'],
      },
      mode: 'auto',
      surface: 'chat',
      brandAccess: 'all',
      injectionDetected: true,
    });
    expect([...context!.autoChoices]).toEqual(['saveDraft']);
    const choices = db.reads.find((read) => read.table === 'chat_auto_choices');
    expect(choices?.filters).toEqual([
      ['user_id', USER],
      ['organization_id', ORG],
    ]);
  });

  it('reads a mode or a surface it does not know as the closed side', async () => {
    const context = await readPrecedenceContext({
      ...request,
      mode: 'yolo' as never,
      surface: 'email' as never,
    });
    expect(context).toMatchObject({ organizationId: ORG, mode: 'ask_first', surface: 'mcp' });
    expect(
      await readPrecedenceContext({ ...request, mode: 'full_auto', surface: 'mcp' }),
    ).toMatchObject({ mode: 'full_auto', surface: 'mcp' });
  });

  it('decides on the defaults when the workspace has no settings row', async () => {
    const context = await readPrecedenceContext(request);
    expect(context?.settings).toEqual(DEFAULT_CHAT_SETTINGS);
    expect(parseChatSettings(null)).toBe(DEFAULT_CHAT_SETTINGS);
  });

  it('decides nothing on a read that failed', async () => {
    db.errors.chat_settings = 'timeout';
    await expect(readPrecedenceContext(request)).rejects.toThrow(/timeout/);
  });
});

describe("step 4b's facts (AUTONOMOUS-GO-LIVE §5.2)", () => {
  const AGENT_RUN = 'agent-run-1';
  const agentRun = { runId: AGENT_RUN, mode: 'full_auto' as const };
  const settingsRow = {
    tool_policies: {},
    full_auto_for_members: true,
    dont_ask_again: true,
    manager_execute_off: [],
    agents_full_auto: true,
    auto_go_live_groups: ['publishing', 'merging'],
  };
  beforeEach(() => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'true');
    db.tables.profiles = { role: 'admin', organization_id: ORG };
    db.tables.chat_settings = settingsRow;
    db.tables.chat_agent_runs = { agent_id: 'agent-1', agent_version: 3 };
    db.tables.chat_agents = { name: 'Publisher' };
    db.tables.chat_agent_go_live = { version: 3, daily_limit: 7, skill_checksums: {} };
  });

  it('reads the switch, Full auto for agents, and the run’s agent with its permission', async () => {
    const context = await readPrecedenceContext({ ...request, agent: agentRun });
    expect(context).toMatchObject({
      autoGoLiveOn: true,
      settings: { autoGoLiveGroups: ['publishing'], agentsFullAuto: true },
      agent: { id: 'agent-1', name: 'Publisher', fullAuto: true, goLive: { dailyLimit: 7 } },
    });
    const run = db.reads.find((read) => read.table === 'chat_agent_runs');
    expect(run?.filters).toEqual([
      ['id', AGENT_RUN],
      ['organization_id', ORG],
    ]);
    const permission = db.reads.find((read) => read.table === 'chat_agent_go_live');
    expect(permission?.filters).toEqual([
      ['agent_id', 'agent-1'],
      ['organization_id', ORG],
    ]);
    // The run's own mode, before an injection asks first: not Full auto, no lift.
    const auto = await readPrecedenceContext({ ...request, agent: { ...agentRun, mode: 'auto' } });
    expect(auto?.agent?.fullAuto).toBe(false);
  });

  it('gives no permission for another version, or for skills changed since it was given', async () => {
    db.tables.chat_agent_go_live = { version: 2, daily_limit: 7, skill_checksums: {} };
    expect(
      (await readPrecedenceContext({ ...request, agent: agentRun }))?.agent?.goLive,
    ).toBeNull();
    db.tables.chat_agent_go_live = {
      version: 3,
      daily_limit: 7,
      skill_checksums: { 'seo-brief': 'abc' },
    };
    expect(
      (await readPrecedenceContext({ ...request, agent: agentRun }))?.agent?.goLive,
    ).toBeNull();
    db.tables.chat_agent_go_live = null;
    expect(
      (await readPrecedenceContext({ ...request, agent: agentRun }))?.agent?.goLive,
    ).toBeNull();
  });

  it('reads nothing of it while the flag is off, the switch is off or it’s a person’s own chat', async () => {
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'false');
    const off = await readPrecedenceContext({ ...request, agent: agentRun });
    expect(off).not.toHaveProperty('autoGoLiveOn');
    expect(off).not.toHaveProperty('agent');
    // Only the one settings read: the switch's own is made while the flag is on.
    expect(db.reads.filter((read) => read.table === 'chat_settings')).toHaveLength(1);
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'true');
    const own = await readPrecedenceContext(request);
    expect(own).toMatchObject({ autoGoLiveOn: true, agent: null });
    db.tables.chat_settings = { ...settingsRow, auto_go_live_groups: [] };
    expect(await readPrecedenceContext({ ...request, agent: agentRun })).toMatchObject({
      agent: null,
      settings: { autoGoLiveGroups: [] },
    });
    expect(db.reads.filter((read) => read.table.startsWith('chat_agent'))).toEqual([]);
  });

  it('decides on none of it before 00443, and on nothing at all when a read fails', async () => {
    db.errors.chat_agent_go_live = {
      code: '42P01',
      message: 'relation "chat_agent_go_live" does not exist',
    };
    expect(await readPrecedenceContext({ ...request, agent: agentRun })).toMatchObject({
      agent: { id: 'agent-1', goLive: null },
    });
    db.errors.chat_agent_go_live = 'timeout';
    await expect(readPrecedenceContext({ ...request, agent: agentRun })).rejects.toThrow(
      /go-live permission: timeout/,
    );
    db.errors = {};
    db.tables.chat_agent_runs = null;
    expect(await readPrecedenceContext({ ...request, agent: agentRun })).toMatchObject({
      agent: null,
    });
  });

  it('parses the go-live columns, dropping groups it does not know', () => {
    expect(parseChatSettings(settingsRow)).toMatchObject({
      autoGoLiveGroups: ['publishing'],
      agentsFullAuto: true,
    });
    const parsed = parseChatSettings({
      tool_policies: {},
      full_auto_for_members: true,
      dont_ask_again: true,
      manager_execute_off: [],
    });
    expect(parsed).not.toHaveProperty('autoGoLiveGroups');
    expect(parsed).not.toHaveProperty('agentsFullAuto');
  });
});

// Every table a row looks its brand up in has brand_id; a new one that lacks it doesn't compile.
type Tables = Database['public']['Tables'];
const lookupTablesNameTheirBrand: {
  [T in BrandLookupTable]: 'brand_id' extends keyof Tables[T]['Row'] ? true : never;
} = {
  actions: true,
  competitors: true,
  content_drafts: true,
  content_opportunities: true,
  prompt_results: true,
  prompt_suggestions: true,
  site_audits: true,
  topics: true,
};

const BRAND_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRAND_ELSEWHERE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OPPORTUNITY = '44444444-4444-4444-8444-444444444444';

/**
 * brands: found only for brand A, in ORG (or by its id alone), the demo brand
 * when `demo`. content_opportunities: the opportunity's brand.
 */
function seedBrands(opportunityBrand: string | null = BRAND_A, demo = false) {
  const filter = (filters: Filters, column: string) => filters.find(([c]) => c === column)?.[1];
  db.tables.brands = (filters: Filters) => {
    const org = filter(filters, 'organization_id');
    return filter(filters, 'id') === BRAND_A && (org === undefined || org === ORG)
      ? { id: BRAND_A, is_demo: demo }
      : null;
  };
  db.tables.content_opportunities = (filters: Filters) =>
    filter(filters, 'id') === OPPORTUNITY && opportunityBrand
      ? { brand_id: opportunityBrand }
      : null;
}

const byInput = { brandOf: { input: 'brand_id' } as const };
const byLookup = {
  brandOf: { lookup: 'content_opportunities', idField: 'opportunity_id' } as const,
};

describe("a call's brand", () => {
  beforeEach(() => seedBrands());

  it("is the input's brand_id, found in the person's workspace", async () => {
    expect(await resolveCallBrand(byInput, { brand_id: BRAND_A }, ORG)).toBe(BRAND_A);
    // Another workspace's brand id doesn't pass for 'all'.
    expect(await resolveCallBrand(byInput, { brand_id: BRAND_ELSEWHERE }, ORG)).toBeNull();
    expect(await resolveCallBrand(byInput, { brand_id: BRAND_A }, OTHER_ORG)).toBeNull();
    expect(await resolveCallBrand(byInput, {}, ORG)).toBeNull();
    expect(await resolveCallBrand({ brandOf: null }, { brand_id: BRAND_A }, ORG)).toBeNull();
  });

  it("is the brand of the row an id names, for a row that takes an object's id", async () => {
    expect(await resolveCallBrand(byLookup, { opportunity_id: OPPORTUNITY }, ORG)).toBe(BRAND_A);
    const lookup = db.reads.find((read) => read.table === 'content_opportunities');
    expect(lookup?.filters).toEqual([['id', OPPORTUNITY]]);
    expect(await resolveCallBrand(byLookup, { opportunity_id: BRAND_ELSEWHERE }, ORG)).toBeNull();
    seedBrands(BRAND_ELSEWHERE);
    expect(await resolveCallBrand(byLookup, { opportunity_id: OPPORTUNITY }, ORG)).toBeNull();
  });

  it("is refused when it isn't found: an object of another workspace stays out of reach", async () => {
    const context = (await readPrecedenceContext({ ...request }))!;
    seedBrands(BRAND_ELSEWHERE);
    const toolCall = await readToolCall(context, byLookup, { opportunity_id: OPPORTUNITY }, false);
    expect(toolCall).toEqual({ brandId: null, brandIsDemo: false, tainted: false });
    const updateOpportunity = { ...addPrompts, ...byLookup };
    expect(decideToolCall(updateOpportunity, context, toolCall)).toEqual({
      kind: 'deny',
      denial: { code: 'brand_scope' },
    });
  });

  it("reads the brand's demo flag (00380): the demo brand is kept to reading", async () => {
    expect(Object.values(lookupTablesNameTheirBrand).every(Boolean)).toBe(true);
    expect(await readBrandIsDemo(BRAND_A)).toBe(false);
    expect(await readBrandIsDemo(BRAND_ELSEWHERE)).toBe(false);
    const context = (await readPrecedenceContext(request))!;
    expect(await readToolCall(context, byInput, { brand_id: BRAND_A }, true)).toEqual({
      brandId: BRAND_A,
      brandIsDemo: false,
      tainted: true,
    });

    seedBrands(BRAND_A, true);
    expect(await readBrandIsDemo(BRAND_A)).toBe(true);
    const toolCall = await readToolCall(context, byInput, { brand_id: BRAND_A }, false);
    expect(toolCall).toEqual({ brandId: BRAND_A, brandIsDemo: true, tainted: false });
    expect(decideToolCall({ ...addPrompts, ...byInput }, context, toolCall)).toEqual({
      kind: 'deny',
      denial: { code: 'demo_brand' },
    });
  });

  it('decides nothing on a demo flag read that failed', async () => {
    db.errors.brands = 'timeout';
    await expect(readBrandIsDemo(BRAND_A)).rejects.toThrow(/timeout/);
  });
});

describe("a Selected-brands person's brands (BRAND-ACCESS)", () => {
  const HIDDEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const DEMO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const filter = (filters: Filters, column: string) => filters.find(([c]) => c === column)?.[1];

  beforeEach(() => {
    db.tables.profiles = { role: 'manager', organization_id: ORG, brand_scope: 'selected' };
    db.tables.member_brands = [{ brand_id: BRAND_A }];
    db.tables.brands = (filters: Filters) => {
      if (filter(filters, 'is_demo') === true) return [{ id: DEMO }];
      const id = filter(filters, 'id');
      const org = filter(filters, 'organization_id');
      return [BRAND_A, HIDDEN, DEMO].includes(id as string) && (org === undefined || org === ORG)
        ? { id, is_demo: id === DEMO }
        : null;
    };
  });

  it('are read for each call: the brands shared with them in this workspace, and the demo brand', async () => {
    expect((await readPrecedenceContext(request))?.brandAccess).toEqual([BRAND_A, DEMO]);
    expect(db.reads.find((read) => read.table === 'member_brands')?.filters).toEqual([
      ['user_id', USER],
      ['organization_id', ORG],
    ]);
    // An Admin, or All brands, has every brand: no grant is read.
    db.reads = [];
    db.tables.profiles = { role: 'admin', organization_id: ORG, brand_scope: 'selected' };
    expect((await readPrecedenceContext(request))?.brandAccess).toBe('all');
    db.tables.profiles = { role: 'manager', organization_id: ORG, brand_scope: 'all' };
    expect((await readPrecedenceContext(request))?.brandAccess).toBe('all');
    expect(db.reads.some((read) => read.table === 'member_brands')).toBe(false);
  });

  it("refuse a brand of the workspace that wasn't shared with them, as one that isn't there", async () => {
    const context = (await readPrecedenceContext(request))!;
    const addForBrand = { ...addPrompts, ...byInput };
    const hidden = await readToolCall(context, byInput, { brand_id: HIDDEN }, false);
    // Its demo flag isn't read: a brand outside the scope is refused before its state matters.
    expect(hidden).toEqual({ brandId: HIDDEN, brandIsDemo: false, tainted: false });
    expect(decideToolCall(addForBrand, context, hidden)).toEqual({
      kind: 'deny',
      denial: { code: 'brand_scope' },
    });
    const shared = await readToolCall(context, byInput, { brand_id: BRAND_A }, false);
    expect(decideToolCall(addForBrand, context, shared)).toMatchObject({ kind: 'ask' });
    // The demo brand is everyone's to read, never to change.
    const demo = await readToolCall(context, byInput, { brand_id: DEMO }, false);
    expect(decideToolCall(addForBrand, context, demo)).toEqual({
      kind: 'deny',
      denial: { code: 'demo_brand' },
    });
  });

  it('count a brand taken away from the next call on', async () => {
    const first = (await readPrecedenceContext(request))!;
    db.tables.member_brands = [];
    const next = (await readPrecedenceContext(request))!;
    const call = { brandId: BRAND_A, brandIsDemo: false, tainted: false };
    expect(decideToolCall({ ...addPrompts, ...byInput }, first, call)).toMatchObject({
      kind: 'ask',
    });
    expect(decideToolCall({ ...addPrompts, ...byInput }, next, call)).toEqual({
      kind: 'deny',
      denial: { code: 'brand_scope' },
    });
  });
});
