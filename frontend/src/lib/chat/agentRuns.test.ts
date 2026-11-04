// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from './testing/chatFixtures';

/**
 * Run now (CHAT-21 §E Manual, §H, §M): one queued run per brand of the
 * agent's scope, acting as the person who clicked; a second click within a
 * minute is the first, past 3 waiting a click joins the last. A slot is
 * tried with the plan's runs at once only when a driver can run what
 * starts; without one, the runs wait queued.
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
const ownKey = vi.hoisted(() => ({ failing: null as { class: string; provider: string } | null }));
vi.mock('./key', () => ({
  resolveChatModelKey: vi.fn(async () => ({ source: 'getcito' })),
  failingOwnKey: vi.fn(async () => ownKey.failing),
}));
vi.mock('./agentShares', () => ({ readAgentShares: vi.fn(async () => null) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const agents = await import('./agents');
const runs = await import('./agentRuns');
const { createAgentInput } = await import('./agentRules');

const NOW = new Date('2026-10-29T12:00:00.000Z');
const BRAND_2 = '33333333-3333-4333-8333-333333333333';
const DEMO = '66666666-6666-4666-8666-666666666666';

const ctxOf = async (userId: string) =>
  (await agents.readAgentContext({ userId, email: null, organizationId: ORG }))!;

async function agentOf(userId: string, over: Record<string, unknown> = {}) {
  const result = await agents.createAgent(
    await ctxOf(userId),
    createAgentInput.parse({
      name: `Agent ${Math.random()}`,
      skills: ['winback'],
      scope: { all_brands: true },
      ...over,
    }),
    NOW,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.refusal));
  return result.value.id;
}

const runRows = () => db.tables.chat_agent_runs ?? [];

/** chat_start_next_agent_run on the fake: the oldest queued, manual first, under the limit. */
function startNext(args: Record<string, unknown>) {
  const running = runRows().filter((r) => r.status === 'running').length;
  if (running >= (args.p_workspace_limit as number)) return null;
  const queued = runRows()
    .filter((r) => r.status === 'queued')
    .sort((a, b) => Number(b.trigger_kind === 'manual') - Number(a.trigger_kind === 'manual'));
  if (!queued[0]) return null;
  queued[0].status = 'running';
  return queued[0].id;
}

beforeEach(() => {
  keyCap.reached = null;
  keyCap.read = null;
  ownKey.failing = null;
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
  ];
  db.tables.chat_agents = [];
  db.tables.chat_agent_versions = [];
  db.tables.chat_agent_triggers = [];
  db.tables.chat_agent_runs = [];
  db.tables.chat_conversations = [];
  db.rpcs = { chat_start_next_agent_run: startNext };
});

afterEach(() => vi.unstubAllEnvs());

describe('Run now', () => {
  it('queues a run per brand of its scope, as the person, never on the demo brand', async () => {
    const id = await agentOf(PEOPLE.manager, { maxRunShare: 0.2 });
    const result = await runs.runAgentNow(await ctxOf(PEOPLE.manager), id, {}, NOW, null);
    expect(result).toEqual({
      ok: true,
      value: {
        runs: [
          { brand: 'Brand A', status: 'queued', repeated: false, coalesced: false },
          { brand: 'Brand B', status: 'queued', repeated: false, coalesced: false },
        ],
      },
    });
    expect(runRows()).toEqual([
      expect.objectContaining({
        agent_id: id,
        agent_version: 1,
        brand_id: BRAND,
        trigger_kind: 'manual',
        acting_user_id: PEOPLE.manager,
        status: 'queued',
        max_share: 0.2,
      }),
      expect.objectContaining({ brand_id: BRAND_2 }),
    ]);
    // No driver yet: nothing is started, so no run holds a slot it can't use.
    expect(db.log.filter(([name]) => name === 'chat_start_next_agent_run')).toEqual([]);
    const logged = db.tables.chat_activity_log.filter((r) => r.summary_key === 'agentRunQueued');
    expect(logged.map((r) => [r.agent_id, r.agent_run_id, r.brand_id])).toEqual([
      [id, runRows()[0].id, BRAND],
      [id, runRows()[1].id, BRAND_2],
    ]);
  });

  it('runs a draft or paused agent by hand, one brand when named, never one outside its scope', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const ctx = await ctxOf(PEOPLE.manager);
    expect(await runs.runAgentNow(ctx, id, { brandId: BRAND_2 }, NOW, null)).toMatchObject({
      ok: false,
      refusal: { code: 'brand_not_found' },
    });
    const one = await runs.runAgentNow(ctx, id, { brandId: BRAND }, NOW, null);
    expect(one).toMatchObject({ ok: true, value: { runs: [{ brand: 'Brand A' }] } });
  });

  it("runs a Selected-brands person's agent on their brands only: All brands is all of theirs", async () => {
    const id = await agentOf(PEOPLE.manager);
    // An Admin narrows them to Brand A (BRAND-ACCESS): the run checks their access now.
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.brand_scope = 'selected';
    db.tables.member_brands = [{ user_id: PEOPLE.manager, organization_id: ORG, brand_id: BRAND }];
    const ctx = await ctxOf(PEOPLE.manager);
    expect(await runs.runAgentNow(ctx, id, {}, NOW, null)).toMatchObject({
      ok: true,
      value: { runs: [{ brand: 'Brand A', status: 'queued' }] },
    });
    expect(runRows().map((r) => r.brand_id)).toEqual([BRAND]);
    // A brand of the scope they don't have is as one that isn't there.
    expect(await runs.runAgentNow(ctx, id, { brandId: BRAND_2 }, NOW, null)).toMatchObject({
      ok: false,
      refusal: { code: 'brand_not_found' },
    });
    // With none of its brands left to them, nothing runs.
    db.tables.member_brands = [];
    expect(await runs.runAgentNow(await ctxOf(PEOPLE.manager), id, {}, NOW, null)).toMatchObject({
      ok: false,
      refusal: { code: 'no_brand' },
    });
    expect(runRows()).toHaveLength(1);
  });

  it('refuses before queuing anything when a brand lacks a Required connection, naming both', async () => {
    const id = await agentOf(PEOPLE.manager, { skills: ['publish'] });
    // Brand A sends pages to WordPress; Brand B has no CMS.
    db.tables.brand_cms_connections = [
      { brand_id: BRAND, provider: 'wordpress', status: 'connected' },
    ];
    const ctx = await ctxOf(PEOPLE.manager);
    const result = await runs.runAgentNow(ctx, id, {}, NOW, null);
    expect(result).toMatchObject({
      ok: false,
      refusal: {
        status: 409,
        code: 'connection_missing',
        message:
          'This agent needs Any CMS, and Brand B doesn’t have it connected. Connect it for that brand, then run the agent again.',
      },
    });
    // Nothing half-run: not even Brand A's run is queued.
    expect(runRows()).toEqual([]);
    // The brand that has one runs.
    expect(await runs.runAgentNow(ctx, id, { brandId: BRAND }, NOW, null)).toMatchObject({
      ok: true,
      value: { runs: [{ brand: 'Brand A', status: 'queued' }] },
    });
  });

  it('refuses while the workspace’s own key fails, queuing nothing on any brand (409)', async () => {
    const id = await agentOf(PEOPLE.manager, { skills: ['winback'] });
    ownKey.failing = { class: 'no_credit', provider: 'openai' };
    const result = await runs.runAgentNow(await ctxOf(PEOPLE.manager), id, {}, NOW, null);
    expect(result).toMatchObject({
      ok: false,
      refusal: {
        status: 409,
        code: 'own_key_failed',
        message:
          'Your OpenAI account is out of credit. An Admin can fix it in Settings › AI Providers, then run the agent again.',
      },
    });
    expect(runRows()).toEqual([]);
  });

  it('refuses while all agents used the month’s limit on the own key, queuing nothing (429)', async () => {
    const id = await agentOf(PEOPLE.manager, { skills: ['winback'] });
    keyCap.reached = { reached: true, renewsAt: '2026-11-20T09:00:00.000Z' };
    const result = await runs.runAgentNow(await ctxOf(PEOPLE.manager), id, {}, NOW, null);
    expect(result).toMatchObject({
      ok: false,
      refusal: {
        status: 429,
        code: 'own_key_cap',
        message:
          "Agents have used this month's limit on your own AI key. An Admin can raise it in Settings › AI Providers, or it renews on November 20, 2026.",
      },
    });
    expect(runRows()).toEqual([]);
  });

  it('starts it in a free slot when a driver can take it, with the plan’s runs at once', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const driver = vi.fn(async () => {});
    const result = await runs.runAgentNow(await ctxOf(PEOPLE.manager), id, {}, NOW, driver);
    expect(result).toMatchObject({ ok: true, value: { runs: [{ status: 'running' }] } });
    const started = runRows()[0];
    // Started in the person's own request: their session goes with it.
    expect(driver).toHaveBeenCalledWith({
      id: started.id,
      organizationId: ORG,
      sessionUserId: PEOPLE.manager,
    });
    // Growth: 5 agent runs at once.
    expect(db.log.filter(([name]) => name === 'chat_start_next_agent_run').length).toBeGreaterThan(
      0,
    );
  });

  it('keeps the plan’s runs at once: the trial’s one slot, the rest wait', async () => {
    db.tables.organizations[0].subscription_status = 'trialing';
    const id = await agentOf(PEOPLE.manager);
    const calls: unknown[] = [];
    db.rpcs.chat_start_next_agent_run = (args) => {
      calls.push(args.p_workspace_limit);
      return startNext(args);
    };
    const result = await runs.runAgentNow(
      await ctxOf(PEOPLE.manager),
      id,
      {},
      NOW,
      vi.fn(async () => {}),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { runs: [{ status: 'running' }, { status: 'queued' }] },
    });
    expect(calls).toEqual([1]);
  });

  it('fails a run the driver can’t take, which frees its place', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const result = await runs.runAgentNow(
      await ctxOf(PEOPLE.manager),
      id,
      {},
      NOW,
      vi.fn(async () => {
        throw new Error('engine down');
      }),
    );
    expect(result).toMatchObject({ ok: true, value: { runs: [{ status: 'failed' }] } });
  });

  it('answers a second click within a minute with the first run, and joins a fourth to the last', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const ctx = await ctxOf(PEOPLE.manager);
    await runs.runAgentNow(ctx, id, {}, NOW, null);
    const again = await runs.runAgentNow(ctx, id, {}, new Date(NOW.getTime() + 30_000), null);
    expect(again).toMatchObject({ ok: true, value: { runs: [{ repeated: true }] } });
    expect(runRows()).toHaveLength(1);

    // An Admin's clicks, a minute apart: three wait, the fourth joins the last.
    const admin = await ctxOf(PEOPLE.admin);
    for (let i = 1; i <= 3; i++) {
      await runs.runAgentNow(admin, id, {}, new Date(NOW.getTime() + i * 61_000), null);
    }
    expect(runRows()).toHaveLength(3);
    const joined = await runs.runAgentNow(admin, id, {}, new Date(NOW.getTime() + 300_000), null);
    expect(joined).toMatchObject({ ok: true, value: { runs: [{ coalesced: true }] } });
    expect(runRows()).toHaveLength(3);
  });

  it('queues one run for two clicks at once by the same person', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const ctx = await ctxOf(PEOPLE.manager);
    const [a, b] = await Promise.all([
      runs.runAgentNow(ctx, id, {}, NOW, null),
      runs.runAgentNow(ctx, id, {}, NOW, null),
    ]);
    expect(runRows()).toHaveLength(1);
    expect([a, b].map((r) => (r.ok ? r.value.runs[0].repeated : null)).sort()).toEqual([
      false,
      true,
    ]);
    expect(
      db.tables.chat_activity_log.filter((r) => r.summary_key === 'agentRunQueued'),
    ).toHaveLength(1);
  });

  it('keeps 3 waiting when two people click at once on a queue of 2', async () => {
    const id = await agentOf(PEOPLE.admin, {
      visibility: 'workspace',
      scope: { brand_ids: [BRAND] },
    });
    for (const [n, person] of [PEOPLE.admin, PEOPLE.otherManager].entries()) {
      db.tables.chat_agent_runs.push({
        id: `00000000-0000-4000-8000-00000000000${n}`,
        agent_id: id,
        brand_id: BRAND,
        trigger_kind: 'schedule',
        acting_user_id: person,
        status: 'queued',
        queued_at: '2026-10-29T11:00:00.000Z',
      });
    }
    const [a, b] = await Promise.all([
      runs.runAgentNow(await ctxOf(PEOPLE.manager), id, {}, NOW, null),
      runs.runAgentNow(await ctxOf(PEOPLE.admin), id, {}, NOW, null),
    ]);
    expect(runRows().filter((r) => r.status === 'queued')).toHaveLength(3);
    const results = [a, b].map((r) => (r.ok ? r.value.runs[0] : null));
    expect(results.filter((r) => r?.coalesced)).toHaveLength(1);
    // Only the run that stayed is in the log.
    expect(
      db.tables.chat_activity_log.filter((r) => r.summary_key === 'agentRunQueued'),
    ).toHaveLength(1);
  });

  it('refuses Analysts, a teammate’s private agent, and an archived agent', async () => {
    const id = await agentOf(PEOPLE.manager, { visibility: 'workspace' });
    expect(await runs.runAgentNow(await ctxOf(PEOPLE.analyst), id, {}, NOW, null)).toMatchObject({
      ok: false,
      refusal: {
        kind: 'denied',
        status: 403,
        code: 'forbidden_role',
        denial: { asked: 'You asked: Run an agent now.' },
      },
    });
    // A workspace agent: any Manager may run it.
    expect((await runs.runAgentNow(await ctxOf(PEOPLE.otherManager), id, {}, NOW, null)).ok).toBe(
      true,
    );
    const priv = await agentOf(PEOPLE.manager);
    expect(
      await runs.runAgentNow(await ctxOf(PEOPLE.otherManager), priv, {}, NOW, null),
    ).toMatchObject({ ok: false, refusal: { status: 404 } });
    const ctx = await ctxOf(PEOPLE.manager);
    await agents.changeAgentState(ctx, priv, 'archive');
    expect(await runs.runAgentNow(ctx, priv, {}, NOW, null)).toMatchObject({
      ok: false,
      refusal: { status: 409, code: 'archived' },
    });
  });

  it('stops the run of a click whose agent was archived after its checks, as Archive does', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const ctx = await ctxOf(PEOPLE.manager);
    // Archive lands between the click's checks and its insert: its stop of the queue has
    // already run, with this run not in it yet.
    const from = db.from.bind(db);
    const spy = vi.spyOn(db, 'from').mockImplementation((table: string) => {
      const builder = from(table);
      if (table === 'chat_agent_runs') {
        const insert = builder.insert.bind(builder);
        builder.insert = (rows) => {
          db.tables.chat_agents.find((a) => a.id === id)!.status = 'archived';
          return insert(rows);
        };
      }
      return builder;
    });
    const result = await runs.runAgentNow(ctx, id, {}, NOW, null);
    spy.mockRestore();
    expect(result).toMatchObject({ ok: true, value: { runs: [{ status: 'stopped' }] } });
    expect(runRows()).toEqual([
      expect.objectContaining({ agent_id: id, status: 'stopped', stop_reason: 'user' }),
    ]);
    expect(
      db.tables.chat_activity_log.filter((r) => r.summary_key === 'agentRunQueued'),
    ).toHaveLength(0);
  });

  it('refuses a Full auto agent on a plan without it, before anything is queued', async () => {
    const id = await agentOf(PEOPLE.admin, { mode: 'full_auto' });
    db.tables.organizations[0].plan = 'starter';
    expect(await runs.runAgentNow(await ctxOf(PEOPLE.admin), id, {}, NOW, null)).toMatchObject({
      ok: false,
      refusal: { kind: 'denied', code: 'plan_locked' },
    });
    expect(runRows()).toEqual([]);
  });
});

describe('Run agent on an action', () => {
  const ACTION = 'acacacac-0000-4000-8000-000000000001';

  beforeEach(() => {
    db.tables.actions = [
      {
        id: ACTION,
        action_no: 1258,
        brand_id: BRAND_2,
        category: 'recover',
        kind: 'prompt_improve',
        status: 'new',
        payload: { title: 'Win back citations for /pricing' },
        deleted_at: null,
      },
    ];
    db.tables.action_tasks = [
      {
        action_id: ACTION,
        position: 1,
        title: 'Refresh /pricing',
        title_params: {},
        status: 'todo',
      },
    ];
    db.rpcs.action_entity_counts = () => [];
  });

  it('refuses Run agent when the action’s brand lacks a Required connection, queuing nothing', async () => {
    const id = await agentOf(PEOPLE.manager, { skills: ['shopping'] });
    const result = await runs.runAgentOnAction(await ctxOf(PEOPLE.manager), id, ACTION, NOW, null);
    expect(result).toMatchObject({
      ok: false,
      refusal: {
        code: 'connection_missing',
        detail: { name: 'Any catalog source', brand: 'Brand B' },
      },
    });
    expect(runRows()).toEqual([]);
  });

  it('refuses Run agent while the workspace’s own key fails, queuing nothing', async () => {
    const id = await agentOf(PEOPLE.manager, { skills: ['winback'] });
    ownKey.failing = { class: 'invalid', provider: 'anthropic' };
    const result = await runs.runAgentOnAction(await ctxOf(PEOPLE.manager), id, ACTION, NOW, null);
    expect(result).toMatchObject({ ok: false, refusal: { status: 409, code: 'own_key_failed' } });
    expect(runRows()).toEqual([]);
  });

  it('refuses Run agent while all agents used the month’s limit on the own key, queuing nothing', async () => {
    const id = await agentOf(PEOPLE.manager, { skills: ['winback'] });
    keyCap.reached = { reached: true, renewsAt: '2026-11-20T09:00:00.000Z' };
    const result = await runs.runAgentOnAction(await ctxOf(PEOPLE.manager), id, ACTION, NOW, null);
    expect(result).toMatchObject({ ok: false, refusal: { status: 429, code: 'own_key_cap' } });
    expect(runRows()).toEqual([]);
  });

  it('queues one run on the action’s brand, scoped to it, as the person who clicked', async () => {
    const id = await agentOf(PEOPLE.manager, { name: 'Citation win-back' });
    const result = await runs.runAgentOnAction(await ctxOf(PEOPLE.manager), id, ACTION, NOW, null);
    expect(result).toEqual({
      ok: true,
      value: {
        run: {
          brand: 'Brand B',
          status: 'queued',
          repeated: false,
          coalesced: false,
          chatId: null,
          stopReason: null,
        },
      },
    });
    expect(runRows()).toEqual([
      expect.objectContaining({
        agent_id: id,
        brand_id: BRAND_2,
        trigger_kind: 'action',
        trigger_ref: ACTION,
        action_id: ACTION,
        acting_user_id: PEOPLE.manager,
        status: 'queued',
        evidence_json: {
          action: {
            id: ACTION,
            no: 1258,
            title: 'Win back citations for /pricing',
            category: 'recover',
            kind: 'prompt_improve',
            at: NOW.toISOString(),
            tasks: ['Refresh /pricing'],
          },
        },
      }),
    ]);
    const logged = db.tables.chat_activity_log.filter((r) => r.summary_key === 'agentRunOnAction');
    expect(logged.map((r) => [r.agent_run_id, r.summary_params])).toEqual([
      [runRows()[0].id, { name: 'Citation win-back', action: '1258' }],
    ]);
  });

  it('answers a second click on the same action within a minute with the first run', async () => {
    const id = await agentOf(PEOPLE.manager);
    const ctx = await ctxOf(PEOPLE.manager);
    await runs.runAgentOnAction(ctx, id, ACTION, NOW, null);
    const again = await runs.runAgentOnAction(
      ctx,
      id,
      ACTION,
      new Date(NOW.getTime() + 20_000),
      null,
    );
    expect(again).toMatchObject({ ok: true, value: { run: { repeated: true } } });
    // Run now on the same brand is another click: its own run.
    await runs.runAgentNow(ctx, id, { brandId: BRAND_2 }, new Date(NOW.getTime() + 30_000), null);
    expect(runRows().map((r) => r.trigger_kind)).toEqual(['action', 'manual']);
  });

  it('answers a second click past the minute’s turn with the first run, under way or waiting', async () => {
    const id = await agentOf(PEOPLE.manager);
    const ctx = await ctxOf(PEOPLE.manager);
    // 59 seconds into a minute, then 2 seconds later: two minutes, one click's worth.
    const first = new Date('2026-10-29T12:00:59.000Z');
    await runs.runAgentOnAction(ctx, id, ACTION, first, null);
    runRows()[0].status = 'running';
    const again = await runs.runAgentOnAction(
      ctx,
      id,
      ACTION,
      new Date(first.getTime() + 2_000),
      null,
    );
    expect(again).toMatchObject({ ok: true, value: { run: { repeated: true } } });
    expect(runRows()).toHaveLength(1);
    // Waiting on a person too; a minute later a click is a new run.
    runRows()[0].status = 'needs_you';
    expect(
      await runs.runAgentOnAction(ctx, id, ACTION, new Date(first.getTime() + 30_000), null),
    ).toMatchObject({ ok: true, value: { run: { repeated: true } } });
    await runs.runAgentOnAction(ctx, id, ACTION, new Date(first.getTime() + 61_000), null);
    expect(runRows()).toHaveLength(2);
  });

  it('joins only a waiting run on the same action, else refuses with the queue full', async () => {
    const id = await agentOf(PEOPLE.admin, { visibility: 'workspace' });
    const OTHER = 'acacacac-0000-4000-8000-000000000009';
    // Three runs wait on this brand, on other work.
    for (const [n, kind] of ['schedule', 'manual', 'action'].entries()) {
      db.tables.chat_agent_runs.push({
        id: `00000000-0000-4000-8000-00000000010${n}`,
        agent_id: id,
        brand_id: BRAND_2,
        trigger_kind: kind,
        action_id: kind === 'action' ? OTHER : null,
        acting_user_id: PEOPLE.admin,
        status: 'queued',
        queued_at: '2026-10-29T11:00:00.000Z',
      });
    }
    const full = await runs.runAgentOnAction(await ctxOf(PEOPLE.manager), id, ACTION, NOW, null);
    expect(full).toMatchObject({
      ok: false,
      refusal: {
        status: 409,
        code: 'queue_full',
        message:
          '3 runs already wait for this agent on this brand. Try again once one has started.',
      },
    });
    expect(runRows()).toHaveLength(3);

    // One of the three on this action, by someone else: the click joins it.
    runRows()[1].trigger_kind = 'action';
    runRows()[1].action_id = ACTION;
    const joined = await runs.runAgentOnAction(
      await ctxOf(PEOPLE.otherManager),
      id,
      ACTION,
      NOW,
      null,
    );
    expect(joined).toMatchObject({ ok: true, value: { run: { coalesced: true } } });
    expect(runRows()).toHaveLength(3);
  });

  it('says why a run that ended before it started stopped', async () => {
    const id = await agentOf(PEOPLE.manager);
    // The action closed between the click's checks and its start: the driver stops it.
    const driver = vi.fn(async ({ id: runId }: { id: string }) => {
      const row = runRows().find((r) => r.id === runId)!;
      row.status = 'stopped';
      row.stop_reason = 'action_closed';
    });
    const result = await runs.runAgentOnAction(
      await ctxOf(PEOPLE.manager),
      id,
      ACTION,
      NOW,
      driver,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { run: { status: 'stopped', stopReason: 'action_closed', chatId: null } },
    });
  });

  it('refuses Agency partners, as Analysts', async () => {
    const PARTNER = 'aaaaaaaa-0000-4000-8000-000000000005';
    db.tables.profiles.push({
      id: PARTNER,
      role: 'agency_partner',
      organization_id: ORG,
      brand_scope: 'all',
    });
    const id = await agentOf(PEOPLE.manager, { visibility: 'workspace' });
    expect(await runs.runAgentOnAction(await ctxOf(PARTNER), id, ACTION, NOW, null)).toMatchObject({
      ok: false,
      refusal: { kind: 'denied', code: 'forbidden_role' },
    });
    expect(runRows()).toEqual([]);
  });

  it('answers the run’s chat once a driver started it', async () => {
    const id = await agentOf(PEOPLE.manager);
    const driver = vi.fn(async ({ id: runId }: { id: string }) => {
      db.tables.chat_conversations.push({
        id: 'chat-1',
        user_id: PEOPLE.manager,
        agent_run_id: runId,
      });
    });
    const result = await runs.runAgentOnAction(
      await ctxOf(PEOPLE.manager),
      id,
      ACTION,
      NOW,
      driver,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { run: { status: 'running', chatId: 'chat-1' } },
    });
    expect(driver).toHaveBeenCalledWith(expect.objectContaining({ sessionUserId: PEOPLE.manager }));
  });

  it('refuses a closed action, an agent that doesn’t cover its brand, and Analysts', async () => {
    const ctx = await ctxOf(PEOPLE.manager);
    const narrow = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    expect(await runs.runAgentOnAction(ctx, narrow, ACTION, NOW, null)).toMatchObject({
      ok: false,
      refusal: { code: 'brand_not_found' },
    });
    const wide = await agentOf(PEOPLE.manager, { visibility: 'workspace' });
    expect(
      await runs.runAgentOnAction(await ctxOf(PEOPLE.analyst), wide, ACTION, NOW, null),
    ).toMatchObject({ ok: false, refusal: { kind: 'denied', code: 'forbidden_role' } });
    db.tables.actions[0].status = 'completed';
    expect(await runs.runAgentOnAction(ctx, wide, ACTION, NOW, null)).toMatchObject({
      ok: false,
      refusal: { code: 'action_closed' },
    });
    expect(runRows()).toEqual([]);
  });
});

describe('starting queued runs', () => {
  it('starts nothing without a driver, and stops at the first empty answer', async () => {
    expect(await runs.startQueuedAgentRuns(ORG, 5, null)).toEqual([]);
    expect(db.log).toEqual([]);
    db.tables.chat_agent_runs = [
      { id: 'r1', status: 'queued', trigger_kind: 'schedule' },
      { id: 'r2', status: 'queued', trigger_kind: 'manual' },
    ];
    const driver = vi.fn(async () => {});
    expect(await runs.startQueuedAgentRuns(ORG, 5, driver)).toEqual(['r2', 'r1']);
    expect(driver).toHaveBeenCalledTimes(2);
  });
});
