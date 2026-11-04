// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { BRAND, ORG, OTHER_ORG, PEOPLE, seedWorkspace } from './testing/chatFixtures';

/**
 * Run agent on an Action Center action (CHAT-21 §F; W2-17), read side: the
 * action a run is scoped to (open, the person's, never the demo brand's,
 * named as the Action Center names it, with its open tasks), the agents the
 * picker lists (those the person may run whose scope covers its brand, last
 * used on this kind of action first) and the History lines a run writes.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/mcp/account', () => ({
  getAiUsageFor: vi.fn(async () => ({ active_plan: true, unlimited: false, percent_used: 5 })),
}));
const keyCap = vi.hoisted(() => ({
  reached: null as { reached: boolean; renewsAt: string | null } | null,
  read: null as { reached: boolean; renewsAt: string | null } | null,
}));
vi.mock('./ownKeyCap', () => ({
  ownKeyCapReached: vi.fn(async () => keyCap.reached),
  readOwnKeyCap: vi.fn(async () => keyCap.read),
}));
vi.mock('./key', () => ({
  resolveChatModelKey: vi.fn(async () => ({ source: 'getcito' })),
  failingOwnKey: vi.fn(async () => null),
}));
vi.mock('./agentShares', () => ({ readAgentShares: vi.fn(async () => null) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const agents = await import('./agents');
const action = await import('./agentAction');
const { createAgentInput } = await import('./agentRules');

const NOW = new Date('2026-10-31T09:00:00.000Z');
const BRAND_2 = '33333333-3333-4333-8333-333333333333';
const DEMO = '66666666-6666-4666-8666-666666666666';
const OTHER_BRAND = '77777777-7777-4777-8777-777777777777';
const ACTION = 'acacacac-0000-4000-8000-000000000001';
const OTHER_ACTION = 'acacacac-0000-4000-8000-000000000002';

const ctxOf = async (userId: string) =>
  (await agents.readAgentContext({ userId, email: null, organizationId: ORG }))!;

async function agentOf(userId: string, over: Record<string, unknown> = {}) {
  const result = await agents.createAgent(
    await ctxOf(userId),
    createAgentInput.parse({
      name: `Agent ${Math.random()}`,
      skills: ['winback'],
      scope: { brand_ids: [BRAND] },
      ...over,
    }),
    NOW,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.refusal));
  return result.value.id;
}

const setStatus = (id: string, status: string) => {
  db.tables.chat_agents.find((a) => a.id === id)!.status = status;
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seedWorkspace(db);
  db.unique = { ...db.unique, chat_agents: [['organization_id', 'name']] };
  const iso = () => NOW.toISOString();
  db.defaults = {
    ...db.defaults,
    chat_agents: () => ({
      created_at: iso(),
      updated_at: iso(),
      activated_at: null,
      archived_at: null,
      paused_reason: null,
    }),
    chat_agent_triggers: () => ({ created_at: iso(), last_fired_at: null }),
  };
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false },
    { id: BRAND_2, organization_id: ORG, name: 'Brand B', is_demo: false },
    { id: DEMO, organization_id: ORG, name: 'Demo', is_demo: true },
    { id: OTHER_BRAND, organization_id: OTHER_ORG, name: 'Theirs', is_demo: false },
  ];
  db.tables.actions = [
    {
      id: ACTION,
      action_no: 1258,
      brand_id: BRAND,
      category: 'recover',
      kind: 'prompt_improve',
      status: 'in_progress',
      payload: { title: 'Win back citations for /blog/what-is-aeo' },
      deleted_at: null,
    },
  ];
  db.tables.action_tasks = [
    {
      action_id: ACTION,
      position: 2,
      task_key: null,
      title: 'Refresh /blog/what-is-aeo',
      title_params: {},
      status: 'todo',
    },
    {
      action_id: ACTION,
      position: 1,
      task_key: null,
      title: 'Compare with the cited guides',
      title_params: {},
      status: 'completed',
    },
    {
      action_id: ACTION,
      position: 3,
      task_key: null,
      title: 'Publish the page',
      title_params: {},
      status: 'in_progress',
    },
    {
      action_id: ACTION,
      position: 4,
      task_key: null,
      title: 'Old idea',
      title_params: {},
      status: 'skipped',
    },
  ];
  db.tables.action_events = [];
  db.tables.chat_agents = [];
  db.tables.chat_agent_versions = [];
  db.tables.chat_agent_triggers = [];
  db.tables.chat_agent_runs = [];
  db.rpcs = { action_entity_counts: () => [] };
});

afterEach(() => vi.unstubAllEnvs());

describe('the action a run is scoped to', () => {
  it('keeps its number, title, category and open tasks, as the Action Center names them', async () => {
    const read = await action.readActionForRun(await ctxOf(PEOPLE.manager), ACTION, NOW);
    expect(read).toEqual({
      ok: true,
      value: {
        snapshot: {
          id: ACTION,
          no: 1258,
          title: 'Win back citations for /blog/what-is-aeo',
          category: 'recover',
          kind: 'prompt_improve',
          at: NOW.toISOString(),
          // In order; done and skipped ones left out.
          tasks: ['Refresh /blog/what-is-aeo', 'Publish the page'],
        },
        brand: { id: BRAND, name: 'Brand A' },
      },
    });
    // What it keeps reads back from a run's evidence; anything else is no action.
    const snapshot = read.ok ? read.value.snapshot : null;
    expect(action.actionScopeOf({ action: snapshot })).toEqual(snapshot);
    expect(action.actionScopeOf({ fires: [] })).toBeNull();
    expect(action.actionScopeOf({ action: { id: 'nope' } })).toBeNull();
    expect(action.actionScopeOf(null)).toBeNull();
  });

  it('refuses a closed, deleted, missing, another workspace’s or the demo brand’s action', async () => {
    const ctx = await ctxOf(PEOPLE.manager);
    const row = db.tables.actions[0];
    row.status = 'completed';
    expect(await action.readActionForRun(ctx, ACTION)).toMatchObject({
      ok: false,
      refusal: { status: 409, code: 'action_closed' },
    });
    row.status = 'new';
    row.deleted_at = NOW.toISOString();
    expect(await action.readActionForRun(ctx, ACTION)).toMatchObject({
      ok: false,
      refusal: { status: 404, code: 'action_not_found' },
    });
    expect(await action.readActionForRun(ctx, OTHER_ACTION)).toMatchObject({
      ok: false,
      refusal: { status: 404, code: 'action_not_found' },
    });
    row.deleted_at = null;
    row.brand_id = OTHER_BRAND;
    expect(await action.readActionForRun(ctx, ACTION)).toMatchObject({
      ok: false,
      refusal: { status: 404 },
    });
    row.brand_id = DEMO;
    expect(await action.readActionForRun(ctx, ACTION)).toMatchObject({
      ok: false,
      refusal: { status: 402, code: 'demo_brand' },
    });
  });

  it('isn’t found on a brand not shared with the person (Agency partners)', async () => {
    const ctx = await ctxOf(PEOPLE.manager);
    const shared = { ...ctx, viewer: { ...ctx.viewer, brandAccess: [BRAND_2] } };
    expect(await action.readActionForRun(shared, ACTION)).toMatchObject({
      ok: false,
      refusal: { status: 404, code: 'action_not_found' },
    });
    const withIt = { ...ctx, viewer: { ...ctx.viewer, brandAccess: [BRAND] } };
    expect((await action.readActionForRun(withIt, ACTION)).ok).toBe(true);
  });

  it('is closed once completed, dismissed, deleted or gone', async () => {
    expect(await action.actionClosed(ACTION)).toBe(false);
    db.tables.actions[0].status = 'on_hold';
    expect(await action.actionClosed(ACTION)).toBe(false);
    db.tables.actions[0].status = 'dismissed';
    expect(await action.actionClosed(ACTION)).toBe(true);
    db.tables.actions[0].status = 'new';
    db.tables.actions[0].deleted_at = NOW.toISOString();
    expect(await action.actionClosed(ACTION)).toBe(true);
    expect(await action.actionClosed(OTHER_ACTION)).toBe(true);
  });
});

describe('the picker’s agents', () => {
  it('lists the agents the person may run on its brand, last used on this kind of action first', async () => {
    const tasks = await agentOf(PEOPLE.manager, { name: 'Tasks', skills: ['tasks'] });
    const alpha = await agentOf(PEOPLE.manager, { name: 'Alpha', skills: ['report'] });
    const used = await agentOf(PEOPLE.manager, { name: 'Zeta', skills: ['report'] });
    const winback = await agentOf(PEOPLE.manager, {
      name: 'Win back',
      scope: { all_brands: true },
    });
    const otherBrand = await agentOf(PEOPLE.manager, {
      name: 'Brand B only',
      scope: { brand_ids: [BRAND_2] },
    });
    const draft = await agentOf(PEOPLE.manager, { name: 'Draft' });
    const archived = await agentOf(PEOPLE.manager, { name: 'Archived' });
    for (const id of [tasks, alpha, used, winback, otherBrand, archived]) setStatus(id, 'active');
    setStatus(winback, 'paused');
    setStatus(archived, 'archived');
    void draft;
    // Zeta ran on another Recover action before; Alpha on a Fix one.
    db.tables.actions.push(
      { id: 'a-recover', brand_id: BRAND, category: 'recover' },
      { id: 'a-fix', brand_id: BRAND, category: 'fix' },
    );
    db.tables.chat_agent_runs.push(
      { agent_id: used, action_id: 'a-recover', queued_at: '2026-10-20T10:00:00.000Z' },
      { agent_id: alpha, action_id: 'a-fix', queued_at: '2026-10-30T10:00:00.000Z' },
    );

    const result = await action.compatibleAgents(await ctxOf(PEOPLE.manager), ACTION, NOW);
    expect(result).toMatchObject({
      ok: true,
      value: { action: { no: 1258, category: 'recover' }, createSkill: 'winback' },
    });
    const listed = result.ok ? result.value.agents : [];
    // Used on Recover first, then the skills that fit Recover (/winback, /tasks), then by name.
    expect(listed.map((a) => a.name)).toEqual(['Zeta', 'Tasks', 'Win back', 'Alpha']);
    expect(listed[0]).toEqual({
      id: used,
      name: 'Zeta',
      status: 'active',
      skills: ['report'],
      mode: 'auto',
      usedOnCategoryAt: '2026-10-20T10:00:00.000Z',
    });
    expect(listed.find((a) => a.name === 'Win back')).toMatchObject({
      status: 'paused',
      usedOnCategoryAt: null,
    });
  });

  it('leaves out a teammate’s private agent, and refuses a closed action', async () => {
    const mine = await agentOf(PEOPLE.manager, { name: 'Mine' });
    const theirs = await agentOf(PEOPLE.otherManager, { name: 'Theirs' });
    const shared = await agentOf(PEOPLE.otherManager, { name: 'Shared', visibility: 'workspace' });
    for (const id of [mine, theirs, shared]) setStatus(id, 'active');
    const result = await action.compatibleAgents(await ctxOf(PEOPLE.manager), ACTION, NOW);
    expect(result.ok && result.value.agents.map((a) => a.name)).toEqual(['Mine', 'Shared']);
    // An Admin sees and may run every one.
    const admin = await action.compatibleAgents(await ctxOf(PEOPLE.admin), ACTION, NOW);
    expect(admin.ok && admin.value.agents).toHaveLength(3);

    db.tables.actions[0].status = 'dismissed';
    expect(await action.compatibleAgents(await ctxOf(PEOPLE.manager), ACTION, NOW)).toMatchObject({
      ok: false,
      refusal: { code: 'action_closed' },
    });
  });
});

describe('History lines', () => {
  it('writes one to the action as the person, tagged chat', async () => {
    await action.logActionRunEvent(
      ACTION,
      'agent_run_started',
      { run_id: 'r1', agent: 'Win back' },
      PEOPLE.manager,
    );
    expect(db.tables.action_events).toEqual([
      {
        action_id: ACTION,
        id: expect.any(String),
        event: 'agent_run_started',
        data: { source: 'chat', run_id: 'r1', agent: 'Win back' },
        actor_id: PEOPLE.manager,
      },
    ]);
  });

  it('never fails the run when the line can’t be written', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.failures.action_events = { message: 'down' };
    await expect(
      action.logActionRunEvent(ACTION, 'chat_started', {}, PEOPLE.manager),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
