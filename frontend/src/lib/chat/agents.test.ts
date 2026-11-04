// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { BRAND, ORG, OTHER_ORG, PEOPLE, seedWorkspace } from './testing/chatFixtures';

/**
 * Chat's agents (CHAT-21; CHAT-27 §E): created as drafts by Admins and
 * Managers only, each change of what one does a new immutable version, the
 * states as §G has them with the activation checks, the plan's gates and
 * caps, names unique in the workspace whatever their case, every change in
 * the Activity log with the agent, and nothing but shares of the AI limit
 * for the browser.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
const usage = vi.hoisted(() => ({
  percent: 10,
  own: false,
  shares: null as unknown,
  keyFailing: null as { class: string; provider: string } | null,
}));
vi.mock('@/lib/mcp/account', () => ({
  getAiUsageFor: vi.fn(async () => ({
    active_plan: true,
    unlimited: false,
    percent_used: usage.percent,
  })),
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
  resolveChatModelKey: vi.fn(async () => ({ source: usage.own ? 'own' : 'getcito' })),
  failingOwnKey: vi.fn(async () => usage.keyFailing ?? null),
}));
vi.mock('./agentShares', () => ({ readAgentShares: vi.fn(async () => usage.shares) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const agents = await import('./agents');
const runs = await import('./agentRuns');
const { createAgentInput, updateAgentInput } = await import('./agentRules');

const NOW = new Date('2026-10-29T12:00:00.000Z');
const BRAND_2 = '33333333-3333-4333-8333-333333333333';
const DEMO = '66666666-6666-4666-8666-666666666666';
const FOREIGN = '77777777-7777-4777-8777-777777777777';

const actor = (userId: string) => ({ userId, email: null, organizationId: ORG });

async function ctxOf(userId: string) {
  const ctx = await agents.readAgentContext(actor(userId));
  if (!ctx) throw new Error('no context');
  return ctx;
}

const input = (over: Record<string, unknown> = {}) =>
  createAgentInput.parse({
    name: 'Win back citations',
    skills: ['winback', 'faq'],
    scope: { brand_ids: [BRAND] },
    ...over,
  });

async function create(userId: string, over: Record<string, unknown> = {}) {
  const result = await agents.createAgent(await ctxOf(userId), input(over), NOW);
  if (!result.ok) throw new Error(JSON.stringify(result.refusal));
  return result.value;
}

const rows = (table: string) => db.tables[table] ?? [];
const agentRow = (id: string) => rows('chat_agents').find((r) => r.id === id)!;
const logRows = (key?: string) =>
  rows('chat_activity_log').filter((r) => !key || r.summary_key === key);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seedWorkspace(db);
  usage.percent = 10;
  usage.own = false;
  usage.shares = null;
  usage.keyFailing = null;
  db.unique = {
    ...db.unique,
    chat_agents: [['organization_id', 'name']],
    chat_agent_versions: [['agent_id', 'version']],
  };
  const iso = () => NOW.toISOString();
  db.defaults = {
    ...db.defaults,
    chat_agents: () => ({
      created_at: iso(),
      updated_at: iso(),
      activated_at: null,
      archived_at: null,
      paused_reason: null,
      max_month_share: null,
    }),
    chat_agent_versions: () => ({ created_at: iso() }),
    chat_agent_triggers: () => ({ created_at: iso(), last_fired_at: null }),
    chat_agent_runs: () => ({
      queued_at: iso(),
      started_at: null,
      finished_at: null,
      skipped_reason: null,
      stop_reason: null,
      usage_share: 0,
      outcome: null,
      outcome_confidence: null,
    }),
  };
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false },
    { id: BRAND_2, organization_id: ORG, name: 'Brand B', is_demo: false },
    { id: DEMO, organization_id: ORG, name: 'Demo', is_demo: true },
    { id: FOREIGN, organization_id: OTHER_ORG, name: 'Theirs', is_demo: false },
  ];
  db.tables.profiles = db.tables.profiles.map((p) => ({ ...p, full_name: 'Sam Lee' }));
  db.tables.topics = [];
  db.tables.chat_agents = [];
  db.tables.chat_agent_versions = [];
  db.tables.chat_agent_triggers = [];
  db.tables.chat_agent_runs = [];
  db.tables.chat_conversations = [];
});

afterEach(() => vi.unstubAllEnvs());

describe('creating an agent', () => {
  it('saves a draft with its first version, its triggers and a log row with the agent', async () => {
    db.tables.chat_settings = [
      {
        organization_id: ORG,
        agent_run_share_default: 0.15,
        agents_full_auto: true,
        workspace_agents_admins_only: false,
        full_auto_for_members: true,
      },
    ];
    const detail = await create(PEOPLE.manager, {
      triggers: [
        {
          kind: 'schedule',
          config: { type: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9', timezone: 'UTC' },
        },
      ],
    });
    expect(detail).toMatchObject({
      name: 'Win back citations',
      status: 'draft',
      mine: true,
      ownerInitials: 'SL',
      skills: ['winback', 'faq'],
      mode: 'auto',
      version: 1,
      maxRunShare: 0.15,
      maxMonthShare: null,
      scope: { allBrands: false, brands: ['Brand A'] },
    });
    expect(detail.triggers).toEqual([
      expect.objectContaining({ kind: 'schedule', nextFireAt: '2026-11-02T09:00:00.000Z' }),
    ]);
    expect(agentRow(detail.id)).toMatchObject({ owner_id: PEOPLE.manager, status: 'draft' });
    expect(rows('chat_agent_versions')).toEqual([
      expect.objectContaining({ agent_id: detail.id, version: 1, skill_ids: ['winback', 'faq'] }),
    ]);
    expect(logRows('agentCreated')).toEqual([
      expect.objectContaining({
        agent_id: detail.id,
        user_id: PEOPLE.manager,
        kind: 'change',
        class: 'write',
        approval_kind: 'run',
        tool_key: 'agents',
        target_type: 'chat_agent',
        summary_params: { name: 'Win back citations' },
      }),
    ]);
  });

  it('refuses an Analyst with the out-of-permission answer, and logs the denial', async () => {
    const result = await agents.createAgent(await ctxOf(PEOPLE.analyst), input(), NOW);
    expect(result.ok).toBe(false);
    if (result.ok || result.refusal.kind !== 'denied') throw new Error('expected a denial');
    expect(result.refusal).toMatchObject({ status: 403, code: 'forbidden_role' });
    expect(result.refusal.denial).toMatchObject({
      asked: 'You asked: Create an agent.',
      rule: { kind: 'role' },
      whoCan: 'Admins and Managers can do this.',
      nextActions: ['ask_admin', 'see_access'],
    });
    expect(rows('chat_agents')).toEqual([]);
    expect(rows('chat_activity_log')).toEqual([
      expect.objectContaining({ kind: 'access.denied', denial_code: 'forbidden_role' }),
    ]);
  });

  it('keeps names unique in the workspace whatever their case', async () => {
    await create(PEOPLE.manager);
    const again = await agents.createAgent(
      await ctxOf(PEOPLE.admin),
      input({ name: 'WIN BACK citations' }),
      NOW,
    );
    expect(again).toMatchObject({
      ok: false,
      refusal: { kind: 'refused', status: 409, code: 'name_taken' },
    });
  });

  it('never says a private agent’s name to someone who can’t see it (W2-15)', async () => {
    await create(PEOPLE.otherManager, { name: 'Secret plan' });
    const taken = await agents.createAgent(
      await ctxOf(PEOPLE.manager),
      input({ name: 'secret PLAN' }),
      NOW,
    );
    expect(taken).toMatchObject({
      ok: false,
      refusal: { kind: 'refused', status: 409, code: 'name_taken_hidden' },
    });
    expect(JSON.stringify(taken)).not.toMatch(/secret plan/i);
    // Renaming into it: the same.
    const { id } = await create(PEOPLE.manager, { name: 'Mine' });
    const renamed = await agents.updateAgent(
      await ctxOf(PEOPLE.manager),
      id,
      updateAgentInput.parse({ name: 'Secret plan' }),
    );
    expect(renamed).toMatchObject({ ok: false, refusal: { code: 'name_taken_hidden' } });
    expect(JSON.stringify(renamed)).not.toMatch(/secret plan/i);
    // An Admin sees every agent: the name is said.
    const admin = await agents.createAgent(
      await ctxOf(PEOPLE.admin),
      input({ name: 'Secret plan' }),
      NOW,
    );
    expect(admin).toMatchObject({ ok: false, refusal: { code: 'name_taken' } });
  });

  it('names an agent the person didn’t name by §O against every agent, hidden ones included (W2-15)', async () => {
    await create(PEOPLE.otherManager, { name: 'Win back lost citations' });
    const first = await create(PEOPLE.manager, { name: 'Win back lost citations', autoName: true });
    expect(first.name).toBe('Win back lost citations · Brand A');
    const second = await create(PEOPLE.manager, {
      name: 'Win back lost citations',
      autoName: true,
    });
    expect(second.name).toBe('Win back lost citations 2');
  });

  it('locks Full auto below Growth and the monthly cap to Admins', async () => {
    db.tables.organizations[0].plan = 'starter';
    const fullAuto = await agents.createAgent(
      await ctxOf(PEOPLE.admin),
      input({ mode: 'full_auto' }),
      NOW,
    );
    expect(fullAuto).toMatchObject({
      ok: false,
      refusal: { kind: 'denied', code: 'plan_locked', denial: { needsPlan: 'Growth' } },
    });
    const cap = await agents.createAgent(
      await ctxOf(PEOPLE.manager),
      input({ maxMonthShare: 0.3 }),
      NOW,
    );
    expect(cap).toMatchObject({ ok: false, refusal: { code: 'forbidden_role' } });
    expect((await create(PEOPLE.admin, { maxMonthShare: 0.3 })).maxMonthShare).toBe(0.3);
  });

  it('takes only the workspace’s brands and topics, never the demo brand', async () => {
    const ctx = await ctxOf(PEOPLE.manager);
    expect(
      await agents.createAgent(ctx, input({ scope: { brand_ids: [FOREIGN] } }), NOW),
    ).toMatchObject({ ok: false, refusal: { code: 'brand_not_found' } });
    expect(
      await agents.createAgent(ctx, input({ scope: { brand_ids: [DEMO] } }), NOW),
    ).toMatchObject({ ok: false, refusal: { status: 402, code: 'demo_brand' } });
    db.tables.topics = [{ id: FOREIGN, brand_id: BRAND_2 }];
    expect(
      await agents.createAgent(
        ctx,
        input({ scope: { brand_ids: [BRAND], topic_ids: [FOREIGN] } }),
        NOW,
      ),
    ).toMatchObject({ ok: false, refusal: { code: 'topic_not_found' } });
    expect(await agents.createAgent(ctx, input({ notifyUserIds: [FOREIGN] }), NOW)).toMatchObject({
      ok: false,
      refusal: { code: 'member_not_found' },
    });
    expect(rows('chat_agents')).toEqual([]);
  });

  it('refuses a one-off schedule in the past', async () => {
    const result = await agents.createAgent(
      await ctxOf(PEOPLE.manager),
      input({
        triggers: [{ kind: 'schedule', config: { type: 'once', at: '2026-10-01T09:00:00Z' } }],
      }),
      NOW,
    );
    expect(result).toMatchObject({ ok: false, refusal: { status: 400, code: 'schedule_past' } });
  });

  it('keeps workspace agents to Admins when Settings › Chat says so', async () => {
    db.tables.chat_settings = [
      {
        organization_id: ORG,
        agent_run_share_default: 0.1,
        agents_full_auto: true,
        workspace_agents_admins_only: true,
        full_auto_for_members: true,
      },
    ];
    const result = await agents.createAgent(
      await ctxOf(PEOPLE.manager),
      input({ visibility: 'workspace' }),
      NOW,
    );
    expect(result).toMatchObject({
      ok: false,
      refusal: { kind: 'denied', code: 'policy_never' },
    });
    expect((await create(PEOPLE.admin, { visibility: 'workspace' })).visibility).toBe('workspace');
  });
});

describe('changing an agent', () => {
  it('holds an Admin’s change to a Manager’s agent that is on to the mode its owner may use', async () => {
    db.tables.chat_settings = [
      {
        organization_id: ORG,
        agent_run_share_default: 0.1,
        agents_full_auto: true,
        workspace_agents_admins_only: false,
        full_auto_for_members: false,
      },
    ];
    const { id } = await create(PEOPLE.manager);
    const on = await agents.changeAgentState(await ctxOf(PEOPLE.manager), id, 'activate', NOW);
    expect(on).toMatchObject({ ok: true, value: { status: 'active' } });
    const fullAuto = updateAgentInput.parse({ mode: 'full_auto' });

    // Its triggered runs act as the Manager, who may not use Full auto here.
    expect(await agents.updateAgent(await ctxOf(PEOPLE.admin), id, fullAuto, NOW)).toMatchObject({
      ok: false,
      refusal: { kind: 'denied', code: 'policy_never' },
    });
    expect(agentRow(id).version).toBe(1);
    expect(rows('chat_agent_versions')).toHaveLength(1);

    // Once the Admin owns it, it is theirs to choose.
    expect(await agents.takeOverAgent(await ctxOf(PEOPLE.admin), id, NOW)).toMatchObject({
      ok: true,
    });
    expect(await agents.updateAgent(await ctxOf(PEOPLE.admin), id, fullAuto, NOW)).toMatchObject({
      ok: true,
      value: { mode: 'full_auto', version: 2 },
    });
  });

  it('writes a new immutable version for a change to what it does, and keeps the old one', async () => {
    const { id } = await create(PEOPLE.manager);
    const ctx = await ctxOf(PEOPLE.manager);
    const result = await agents.updateAgent(
      ctx,
      id,
      updateAgentInput.parse({ expectedVersion: 1, mode: 'ask_first', instructions: 'Be brief' }),
      NOW,
    );
    expect(result).toMatchObject({ ok: true, value: { version: 2, mode: 'ask_first' } });
    expect(rows('chat_agent_versions').map((v) => [v.version, v.mode, v.instructions])).toEqual([
      [1, 'auto', null],
      [2, 'ask_first', 'Be brief'],
    ]);
    expect(agentRow(id).version).toBe(2);
    expect(logRows('agentUpdated')).toHaveLength(1);
  });

  it('renames in place without a new version, and refuses a name taken', async () => {
    const { id } = await create(PEOPLE.manager);
    await create(PEOPLE.manager, { name: 'Weekly brief' });
    const ctx = await ctxOf(PEOPLE.manager);
    const renamed = await agents.updateAgent(ctx, id, updateAgentInput.parse({ name: 'Recover' }));
    expect(renamed).toMatchObject({ ok: true, value: { name: 'Recover', version: 1 } });
    expect(rows('chat_agent_versions')).toHaveLength(2);
    const taken = await agents.updateAgent(
      ctx,
      id,
      updateAgentInput.parse({ name: 'weekly BRIEF' }),
    );
    expect(taken).toMatchObject({ ok: false, refusal: { code: 'name_taken' } });
  });

  it('refuses a save over another one, numbers past a stray version, and refuses an archived agent', async () => {
    const { id } = await create(PEOPLE.manager);
    const ctx = await ctxOf(PEOPLE.manager);
    await agents.updateAgent(ctx, id, updateAgentInput.parse({ effort: 'high' }));
    const stale = await agents.updateAgent(
      ctx,
      id,
      updateAgentInput.parse({ expectedVersion: 1, effort: 'max' }),
    );
    expect(stale).toMatchObject({ ok: false, refusal: { status: 409, code: 'version_conflict' } });
    // A version a save left without finishing: the next save numbers past it.
    db.tables.chat_agent_versions.push({ ...rows('chat_agent_versions')[1], version: 3 });
    const past = await agents.updateAgent(ctx, id, updateAgentInput.parse({ effort: 'max' }));
    expect(past).toMatchObject({ ok: true, value: { version: 4 } });
    agentRow(id).status = 'archived';
    expect(
      await agents.updateAgent(ctx, id, updateAgentInput.parse({ name: 'Other' })),
    ).toMatchObject({ ok: false, refusal: { code: 'archived' } });
  });

  it('lets one of two saves at once win: the other is refused and leaves no version', async () => {
    const { id } = await create(PEOPLE.manager);
    const ctx = await ctxOf(PEOPLE.manager);
    const [a, b] = await Promise.all([
      agents.updateAgent(ctx, id, updateAgentInput.parse({ effort: 'high' })),
      agents.updateAgent(ctx, id, updateAgentInput.parse({ effort: 'max' })),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ refusal: { code: 'version_conflict' } });
    expect(rows('chat_agent_versions').map((v) => v.version)).toEqual([1, 2]);
    expect(agentRow(id).version).toBe(2);
  });

  it('refuses a save over one that made no new version: a name, sharing or triggers (W2-15)', async () => {
    const { id, updatedAt } = await create(PEOPLE.manager);
    const ctx = await ctxOf(PEOPLE.manager);
    // Two editors open the agent; the first renames it (no new version).
    const first = await agents.updateAgent(
      ctx,
      id,
      updateAgentInput.parse({ expectedVersion: 1, expectedUpdatedAt: updatedAt, name: 'Renamed' }),
    );
    expect(first).toMatchObject({ ok: true, value: { name: 'Renamed', version: 1 } });
    // The second changes its triggers from what it opened: refused, the first save kept.
    const second = await agents.updateAgent(
      ctx,
      id,
      updateAgentInput.parse({
        expectedVersion: 1,
        expectedUpdatedAt: updatedAt,
        triggers: [{ kind: 'signal', config: { category: 'recover' } }],
      }),
    );
    expect(second).toMatchObject({ ok: false, refusal: { status: 409, code: 'version_conflict' } });
    expect(rows('chat_agent_triggers').filter((t) => t.agent_id === id)).toHaveLength(0);
    // With what it reads now, it saves; a triggers-only save moves updatedAt too.
    const fresh = first.ok ? first.value.updatedAt : '';
    const third = await agents.updateAgent(
      ctx,
      id,
      updateAgentInput.parse({
        expectedUpdatedAt: fresh,
        triggers: [{ kind: 'signal', config: { category: 'recover' } }],
      }),
    );
    expect(third.ok).toBe(true);
    expect(third.ok && third.value.updatedAt).not.toBe(fresh);
    expect(
      await agents.updateAgent(
        ctx,
        id,
        updateAgentInput.parse({ expectedUpdatedAt: fresh, visibility: 'workspace' }),
      ),
    ).toMatchObject({ ok: false, refusal: { code: 'version_conflict' } });
  });

  it('lets only its owner or an Admin change it; a teammate gets the out-of-permission answer', async () => {
    const { id } = await create(PEOPLE.manager, { visibility: 'workspace' });
    const teammate = await agents.updateAgent(
      await ctxOf(PEOPLE.otherManager),
      id,
      updateAgentInput.parse({ name: 'Mine now' }),
    );
    expect(teammate).toMatchObject({
      ok: false,
      refusal: {
        kind: 'denied',
        code: 'forbidden_role',
        denial: { whoCan: 'Admins can do this.' },
      },
    });
    const admin = await agents.updateAgent(
      await ctxOf(PEOPLE.admin),
      id,
      updateAgentInput.parse({ name: 'Admin’s edit' }),
    );
    expect(admin.ok).toBe(true);
  });

  it('keeps KPI and Signal triggers whose settings came back in another key order', async () => {
    const kpi = {
      kind: 'kpi',
      config: {
        kpi: 'citations',
        direction: 'down',
        threshold: 10,
        unit: 'percent',
        period: 'week',
      },
    };
    const signal = {
      kind: 'signal',
      config: {
        category: 'recover',
        definition_ids: ['win_back_citations'],
        entity_filter: { engines: ['chatgpt-web'], prompt_tags: ['pricing'] },
      },
    };
    const { id } = await create(PEOPLE.manager, { triggers: [kpi, signal] });
    // jsonb keeps its own key order: shorter keys first, then by bytes.
    const reorder = (value: unknown): unknown =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .reverse()
              .map(([k, v]) => [k, reorder(v)]),
          )
        : value;
    for (const trigger of rows('chat_agent_triggers')) {
      trigger.config_json = reorder(trigger.config_json);
      trigger.last_fired_at = '2026-10-28T08:00:00.000Z';
      trigger.cooldown_until = '2026-10-28T14:00:00.000Z';
    }
    const before = rows('chat_agent_triggers').map((t) => t.id);
    const result = await agents.updateAgent(
      await ctxOf(PEOPLE.manager),
      id,
      updateAgentInput.parse({ triggers: [kpi, signal] }),
    );
    expect(result.ok).toBe(true);
    expect(rows('chat_agent_triggers').map((t) => t.id)).toEqual(before);
    expect(rows('chat_agent_triggers').map((t) => [t.last_fired_at, t.cooldown_until])).toEqual([
      ['2026-10-28T08:00:00.000Z', '2026-10-28T14:00:00.000Z'],
      ['2026-10-28T08:00:00.000Z', '2026-10-28T14:00:00.000Z'],
    ]);
    // Nothing changed: no log row for it.
    expect(logRows('agentUpdated')).toEqual([]);
  });

  it('lets a one-off that already fired come back with a save, but not a new one in the past', async () => {
    const once = { kind: 'schedule', config: { type: 'once', at: '2026-11-02T09:00:00.000Z' } };
    const { id } = await create(PEOPLE.manager, { triggers: [once] });
    const later = new Date('2026-11-10T12:00:00.000Z');
    const ctx = await ctxOf(PEOPLE.manager);
    const kept = await agents.updateAgent(
      ctx,
      id,
      updateAgentInput.parse({ name: 'Renamed', triggers: [once] }),
      later,
    );
    expect(kept).toMatchObject({ ok: true, value: { name: 'Renamed' } });
    if (kept.ok) expect(kept.value.triggers[0].nextFireAt).toBeNull();
    const past = await agents.updateAgent(
      ctx,
      id,
      updateAgentInput.parse({
        triggers: [
          once,
          { kind: 'schedule', config: { type: 'once', at: '2026-11-05T09:00:00Z' } },
        ],
      }),
      later,
    );
    expect(past).toMatchObject({ ok: false, refusal: { code: 'schedule_past' } });
  });

  it('keeps a trigger kept as it was, with its last fire, and replaces the rest', async () => {
    const weekly = {
      kind: 'schedule',
      config: { type: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9', timezone: 'UTC' },
    };
    const { id } = await create(PEOPLE.manager, {
      triggers: [weekly, { kind: 'signal', config: { category: 'recover' } }],
    });
    const kept = rows('chat_agent_triggers')[0];
    kept.last_fired_at = '2026-10-26T09:00:00.000Z';
    const result = await agents.updateAgent(
      await ctxOf(PEOPLE.manager),
      id,
      updateAgentInput.parse({
        triggers: [weekly, { kind: 'signal', config: { category: 'fix' } }],
      }),
    );
    expect(result.ok).toBe(true);
    expect(rows('chat_agent_triggers').map((t) => [t.kind, t.id === kept.id])).toEqual([
      ['schedule', true],
      ['signal', false],
    ]);
    expect(rows('chat_agent_triggers')[0].last_fired_at).toBe('2026-10-26T09:00:00.000Z');
    // No change to what it does: still version 1.
    expect(agentRow(id).version).toBe(1);
  });
});

describe('states', () => {
  it('refuses Activate and Resume while the workspace’s own key fails, and lets them once it works', async () => {
    const { id } = await create(PEOPLE.manager, { visibility: 'workspace' });
    const admin = await ctxOf(PEOPLE.admin);
    usage.own = true;
    usage.keyFailing = { class: 'invalid', provider: 'anthropic' };
    expect(await agents.changeAgentState(admin, id, 'activate', NOW)).toMatchObject({
      ok: false,
      refusal: {
        status: 409,
        code: 'own_key_failed',
        message:
          'Anthropic turned down your workspace’s key. An Admin can fix it in Settings › AI Providers, then run the agent again.',
      },
    });
    expect(agentRow(id).status).toBe('draft');

    usage.keyFailing = null;
    expect((await agents.changeAgentState(admin, id, 'activate', NOW)).ok).toBe(true);
    // Paused for the key, it stays paused while the key fails.
    db.tables.chat_agents.find((a) => a.id === id)!.status = 'paused';
    db.tables.chat_agents.find((a) => a.id === id)!.paused_reason = 'own_key';
    usage.keyFailing = { class: 'no_credit', provider: 'openai' };
    expect(await agents.changeAgentState(admin, id, 'resume')).toMatchObject({
      ok: false,
      refusal: { code: 'own_key_failed' },
    });
    expect(agentRow(id)).toMatchObject({ status: 'paused', paused_reason: 'own_key' });
  });

  it('activates a draft (the person becomes its owner), pauses, resumes, archives, restores and deletes', async () => {
    const { id } = await create(PEOPLE.manager, { visibility: 'workspace' });
    const admin = await ctxOf(PEOPLE.admin);
    expect(await agents.changeAgentState(admin, id, 'activate', NOW)).toMatchObject({
      ok: true,
      value: { status: 'active' },
    });
    expect(agentRow(id)).toMatchObject({
      owner_id: PEOPLE.admin,
      activated_at: NOW.toISOString(),
      paused_reason: null,
    });
    expect(await agents.changeAgentState(admin, id, 'pause')).toMatchObject({
      ok: true,
      value: { status: 'paused', pausedReason: 'manual' },
    });
    expect(await agents.changeAgentState(admin, id, 'resume')).toMatchObject({
      ok: true,
      value: { status: 'active', pausedReason: null },
    });
    db.tables.chat_agent_runs.push(
      { id: 'run-q', agent_id: id, status: 'queued', queued_at: NOW.toISOString() },
      { id: 'run-r', agent_id: id, status: 'running', queued_at: NOW.toISOString() },
    );
    expect(await agents.changeAgentState(admin, id, 'archive', NOW)).toMatchObject({
      ok: true,
      value: { status: 'archived' },
    });
    // Its waiting run stops; the running one finishes.
    expect(rows('chat_agent_runs').map((r) => [r.id, r.status, r.stop_reason])).toEqual([
      ['run-q', 'stopped', 'user'],
      ['run-r', 'running', undefined],
    ]);
    expect(await agents.changeAgentState(admin, id, 'restore')).toMatchObject({
      ok: true,
      value: { status: 'paused', pausedReason: 'manual' },
    });
    await agents.changeAgentState(admin, id, 'archive');
    expect(await agents.changeAgentState(admin, id, 'delete')).toEqual({
      ok: true,
      value: { deleted: true },
    });
    expect(rows('chat_agents')).toEqual([]);
    expect(logRows().map((r) => r.summary_key)).toEqual([
      'agentCreated',
      'agentActivated',
      'agentPaused',
      'agentResumed',
      'agentArchived',
      'agentRestored',
      'agentArchived',
      'agentDeleted',
    ]);
    // The delete's row keeps the agent as its target only: the agent is gone.
    expect(logRows('agentDeleted')[0]).toMatchObject({ agent_id: null, target_id: id });
  });

  it('refuses what doesn’t follow §G', async () => {
    const { id } = await create(PEOPLE.manager);
    const ctx = await ctxOf(PEOPLE.manager);
    expect(await agents.changeAgentState(ctx, id, 'pause')).toMatchObject({
      ok: false,
      refusal: { status: 409, code: 'wrong_status', detail: { status: 'draft' } },
    });
    expect(await agents.changeAgentState(ctx, id, 'delete')).toMatchObject({
      ok: false,
      refusal: { code: 'wrong_status' },
    });
    expect(await agents.changeAgentState(ctx, id, 'resume')).toMatchObject({
      ok: false,
      refusal: { code: 'wrong_status' },
    });
  });

  it('keeps the plan’s active agents: one in the trial, five on Starter', async () => {
    db.tables.organizations[0] = { ...db.tables.organizations[0], plan: 'starter' };
    const ctx = await ctxOf(PEOPLE.manager);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await create(PEOPLE.manager, { name: `Agent ${i}` })).id);
    for (const id of ids.slice(0, 5)) {
      expect((await agents.changeAgentState(ctx, id, 'activate')).ok).toBe(true);
    }
    expect(await agents.changeAgentState(ctx, ids[5], 'activate')).toMatchObject({
      ok: false,
      refusal: { status: 403, code: 'agent_limit', detail: { limit: 5 } },
    });
    db.tables.organizations[0].subscription_status = 'trialing';
    await agents.changeAgentState(ctx, ids[0], 'pause');
    expect(
      await agents.changeAgentState(await ctxOf(PEOPLE.manager), ids[0], 'resume'),
    ).toMatchObject({ ok: false, refusal: { code: 'agent_limit', detail: { limit: 1 } } });
  });

  it('checks the AI limit, unless the workspace’s own key pays', async () => {
    const { id } = await create(PEOPLE.manager);
    const ctx = await ctxOf(PEOPLE.manager);
    usage.percent = 100;
    expect(await agents.changeAgentState(ctx, id, 'activate')).toMatchObject({
      ok: false,
      refusal: { status: 429, code: 'ai_limit' },
    });
    usage.own = true;
    expect((await agents.changeAgentState(ctx, id, 'activate')).ok).toBe(true);
  });

  it('won’t activate without a brand left, or resume for an owner who can’t own it now', async () => {
    const { id } = await create(PEOPLE.manager);
    const ctx = await ctxOf(PEOPLE.manager);
    db.tables.brands = db.tables.brands.filter((b) => b.id !== BRAND);
    expect(await agents.changeAgentState(ctx, id, 'activate')).toMatchObject({
      ok: false,
      refusal: { code: 'no_brand' },
    });
    db.tables.brands.push({ id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false });
    await agents.changeAgentState(ctx, id, 'activate');
    await agents.changeAgentState(ctx, id, 'pause');
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.role = 'analyst';
    expect(await agents.changeAgentState(await ctxOf(PEOPLE.admin), id, 'resume')).toMatchObject({
      ok: false,
      refusal: { code: 'owner_role' },
    });
  });

  it('won’t activate on a skill that is off, and resumes on its owner’s own skill (CHAT-13, W3-06)', async () => {
    const { skillChecksum } = await import('./skills/store');
    const parts = {
      name: 'my-brief',
      title: 'My brief',
      description: 'Writes my brief.',
      body: 'Read the page first.',
    };
    db.tables.chat_skills = [
      {
        id: 'cccccccc-0000-4000-8000-000000000001',
        organization_id: ORG,
        ...parts,
        status: 'approved',
        visibility: 'private',
        enabled: false,
        created_by: PEOPLE.manager,
        checksum_sha256: skillChecksum(parts),
      },
    ];
    const { id } = await create(PEOPLE.manager, { skills: ['my-brief'] });
    const manager = await ctxOf(PEOPLE.manager);
    expect(await agents.changeAgentState(manager, id, 'activate')).toMatchObject({
      ok: false,
      refusal: {
        status: 409,
        code: 'skill_off',
        message:
          'The skill /my-brief is off or no longer available. Turn it on again, or pick another skill for this agent.',
      },
    });
    db.tables.chat_skills[0].enabled = true;
    expect((await agents.changeAgentState(manager, id, 'activate')).ok).toBe(true);
    await agents.changeAgentState(manager, id, 'pause');
    // An Admin resumes it for its owner, whose private skill it runs.
    expect((await agents.changeAgentState(await ctxOf(PEOPLE.admin), id, 'resume')).ok).toBe(true);
  });

  it('won’t resume while a brand of its scope lacks a Required connection, naming both', async () => {
    const { id } = await create(PEOPLE.manager, {
      skills: ['publish'],
      scope: { brand_ids: [BRAND, BRAND_2] },
    });
    const ctx = await ctxOf(PEOPLE.manager);
    await agents.changeAgentState(ctx, id, 'activate');
    // Its last run found Brand B without a CMS: the runner paused it (agentDriver.ts).
    await agents.pauseAgentForSystem(ORG, id, 'connection');
    db.tables.brand_cms_connections = [
      { brand_id: BRAND, provider: 'wordpress', status: 'connected' },
    ];
    expect(await agents.changeAgentState(ctx, id, 'resume')).toMatchObject({
      ok: false,
      refusal: {
        status: 409,
        code: 'connection_missing',
        detail: { name: 'Any CMS', brand: 'Brand B' },
        message:
          'This agent needs Any CMS, and Brand B doesn’t have it connected. Connect it for that brand, then run the agent again.',
      },
    });
    expect(agentRow(id)).toMatchObject({ status: 'paused', paused_reason: 'connection' });
    expect(logRows('agentResumed')).toEqual([]);

    // Once Brand B sends pages through a workflow webhook, it resumes.
    db.tables.webhook_configs = [
      { brand_id: BRAND_2, events: ['content_draft.sent'], is_active: true },
    ];
    expect(await agents.changeAgentState(ctx, id, 'resume')).toMatchObject({
      ok: true,
      value: { status: 'active', pausedReason: null },
    });
  });

  it('resumes with no connection at all when its connections are Optional', async () => {
    const { id } = await create(PEOPLE.manager, { skills: ['winback'] });
    const ctx = await ctxOf(PEOPLE.manager);
    await agents.changeAgentState(ctx, id, 'activate');
    await agents.pauseAgentForSystem(ORG, id, 'connection');
    expect(await agents.changeAgentState(ctx, id, 'resume')).toMatchObject({
      ok: true,
      value: { status: 'active', pausedReason: null },
    });
  });

  it('pauses an active agent for a reason of the system’s', async () => {
    const { id } = await create(PEOPLE.manager);
    expect(await agents.pauseAgentForSystem(ORG, id, 'failures')).toBe(false);
    await agents.changeAgentState(await ctxOf(PEOPLE.manager), id, 'activate');
    expect(await agents.pauseAgentForSystem(ORG, id, 'failures')).toBe(true);
    expect(agentRow(id)).toMatchObject({ status: 'paused', paused_reason: 'failures' });
    expect(await agents.pauseAgentForSystem(OTHER_ORG, id, 'cap')).toBe(false);
  });
});

describe('taking over', () => {
  it('lets an Admin take over an agent whose owner lost the role, and turns it on again', async () => {
    const { id } = await create(PEOPLE.manager, { visibility: 'workspace' });
    await agents.changeAgentState(await ctxOf(PEOPLE.manager), id, 'activate');
    await agents.pauseAgentForSystem(ORG, id, 'owner_role');
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.role = 'analyst';
    const admin = await ctxOf(PEOPLE.admin);
    expect(await agents.changeAgentState(admin, id, 'resume')).toMatchObject({
      ok: false,
      refusal: { code: 'owner_role' },
    });
    const before = await agents.readAgent(admin, id, NOW);
    expect(before?.can.takeOver).toBe(true);

    const taken = await agents.takeOverAgent(admin, id, NOW);
    expect(taken).toMatchObject({ ok: true, value: { status: 'active', pausedReason: null } });
    expect(agentRow(id)).toMatchObject({
      owner_id: PEOPLE.admin,
      status: 'active',
      activated_at: NOW.toISOString(),
    });
    expect(logRows('agentTakenOver')).toEqual([
      expect.objectContaining({ agent_id: id, user_id: PEOPLE.admin }),
    ]);
  });

  it('runs the activation checks under the new owner first, and changes nothing when they fail', async () => {
    const { id } = await create(PEOPLE.manager);
    await agents.changeAgentState(await ctxOf(PEOPLE.manager), id, 'activate');
    usage.percent = 100;
    expect(await agents.takeOverAgent(await ctxOf(PEOPLE.admin), id, NOW)).toMatchObject({
      ok: false,
      refusal: { code: 'ai_limit' },
    });
    expect(agentRow(id).owner_id).toBe(PEOPLE.manager);
    // A draft or a person's pause only changes hands.
    usage.percent = 10;
    const draft = await create(PEOPLE.manager, { name: 'Draft' });
    usage.percent = 100;
    expect(await agents.takeOverAgent(await ctxOf(PEOPLE.admin), draft.id, NOW)).toMatchObject({
      ok: true,
      value: { status: 'draft' },
    });
    expect(agentRow(draft.id).owner_id).toBe(PEOPLE.admin);
  });

  it('is an Admin’s only, never on an archived agent', async () => {
    const { id } = await create(PEOPLE.manager, { visibility: 'workspace' });
    expect(await agents.takeOverAgent(await ctxOf(PEOPLE.otherManager), id, NOW)).toMatchObject({
      ok: false,
      refusal: {
        kind: 'denied',
        code: 'forbidden_role',
        denial: { asked: 'You asked: Take over an agent.', whoCan: 'Admins can do this.' },
      },
    });
    expect(await agents.takeOverAgent(await ctxOf(PEOPLE.manager), id, NOW)).toMatchObject({
      ok: false,
      refusal: { code: 'forbidden_role' },
    });
    await agents.changeAgentState(await ctxOf(PEOPLE.manager), id, 'archive');
    expect(await agents.takeOverAgent(await ctxOf(PEOPLE.admin), id, NOW)).toMatchObject({
      ok: false,
      refusal: { code: 'archived' },
    });
  });
});

describe('duplicating', () => {
  it('copies the current version as a draft “{name} copy”, its triggers switched off', async () => {
    const { id } = await create(PEOPLE.admin, {
      visibility: 'workspace',
      maxMonthShare: 0.2,
      triggers: [{ kind: 'signal', config: { category: 'recover' } }],
    });
    await agents.changeAgentState(await ctxOf(PEOPLE.admin), id, 'activate');
    const copy = await agents.duplicateAgent(await ctxOf(PEOPLE.manager), id, NOW);
    expect(copy).toMatchObject({
      ok: true,
      value: {
        name: 'Win back citations copy',
        status: 'draft',
        mine: true,
        visibility: 'workspace',
        // The monthly cap is an Admin's: a Manager's copy has none.
        maxMonthShare: null,
        triggers: [expect.objectContaining({ kind: 'signal', enabled: false })],
      },
    });
    if (!copy.ok) return;
    expect(agentRow(copy.value.id).owner_id).toBe(PEOPLE.manager);
    expect(logRows('agentDuplicated')[0].summary_params).toEqual({
      name: 'Win back citations copy',
      from: 'Win back citations',
    });
  });
});

describe('duplicating what the plan or the workspace no longer allows', () => {
  it('refuses a copy in Full auto below Growth, and one whose brand is gone', async () => {
    const fullAuto = await create(PEOPLE.admin, { mode: 'full_auto' });
    db.tables.organizations[0].plan = 'starter';
    expect(await agents.duplicateAgent(await ctxOf(PEOPLE.admin), fullAuto.id, NOW)).toMatchObject({
      ok: false,
      refusal: { kind: 'denied', code: 'plan_locked' },
    });
    db.tables.organizations[0].plan = 'growth';
    const { id } = await create(PEOPLE.manager, {
      name: 'Brand B only',
      scope: { brand_ids: [BRAND_2] },
    });
    db.tables.brands = db.tables.brands.filter((b) => b.id !== BRAND_2);
    expect(await agents.duplicateAgent(await ctxOf(PEOPLE.manager), id, NOW)).toMatchObject({
      ok: false,
      refusal: { code: 'brand_not_found' },
    });
    expect(rows('chat_agents')).toHaveLength(2);
  });
});

describe('reading', () => {
  it('lists what the person may see, by tab, with counts, and searches by name or skill', async () => {
    const mine = await create(PEOPLE.manager, { name: 'Mine private' });
    await create(PEOPLE.otherManager, { name: 'Their private' });
    const shared = await create(PEOPLE.otherManager, { name: 'Shared', visibility: 'workspace' });
    await agents.changeAgentState(await ctxOf(PEOPLE.otherManager), shared.id, 'activate');
    await agents.changeAgentState(await ctxOf(PEOPLE.otherManager), shared.id, 'pause');

    const manager = await ctxOf(PEOPLE.manager);
    const list = await agents.listAgents(manager, { view: 'mine' }, NOW);
    expect(list.agents.map((a) => a.name)).toEqual(['Mine private']);
    expect(list.counts).toEqual({ mine: 1, workspace: 1, paused: 1, archived: 0 });
    expect(list).toMatchObject({
      active: 0,
      activeInWorkspace: 0,
      activeLimit: 25,
      keyFailure: null,
    });
    // The own key failing: the banner's class and provider, no dates.
    usage.keyFailing = { class: 'model', provider: 'azure' };
    expect((await agents.listAgents(manager, { view: 'mine' }, NOW)).keyFailure).toEqual({
      class: 'model',
      provider: 'azure',
    });
    usage.keyFailing = null;
    const workspace = await agents.listAgents(manager, { view: 'workspace' }, NOW);
    expect(workspace.agents.map((a) => [a.name, a.mine])).toEqual([['Shared', false]]);

    const admin = await agents.listAgents(await ctxOf(PEOPLE.admin), { view: 'mine' }, NOW);
    expect(admin.counts.mine).toBe(0);
    const all = await agents.listAgents(await ctxOf(PEOPLE.admin), { view: 'paused' }, NOW);
    expect(all.agents.map((a) => a.name)).toEqual(['Shared']);

    expect(
      (await agents.listAgents(manager, { view: 'mine', q: 'weekly' }, NOW)).agents,
    ).toHaveLength(0);
    // By skill or by name, whatever the case.
    for (const q of ['WINBACK', 'mine priv']) {
      expect(
        (await agents.listAgents(manager, { view: 'mine', q }, NOW)).agents.map((a) => a.id),
      ).toEqual([mine.id]);
    }
  });

  it('shows an Admin every agent in use on Workspace, others’ private ones included', async () => {
    const theirs = await create(PEOPLE.manager, { name: 'Manager private' });
    const shared = await create(PEOPLE.otherManager, { name: 'Shared', visibility: 'workspace' });
    const own = await create(PEOPLE.admin, { name: 'Admin private' });
    const archived = await create(PEOPLE.manager, { name: 'Old' });
    await agents.changeAgentState(await ctxOf(PEOPLE.manager), archived.id, 'archive');
    const admin = await ctxOf(PEOPLE.admin);
    const list = await agents.listAgents(admin, { view: 'workspace' }, NOW);
    expect(list.agents.map((a) => a.id).sort()).toEqual([theirs.id, shared.id].sort());
    expect(list.counts).toEqual({ mine: 1, workspace: 2, paused: 0, archived: 1 });
    expect((await agents.listAgents(admin, { view: 'mine' }, NOW)).agents.map((a) => a.id)).toEqual(
      [own.id],
    );
    // A Manager's Workspace stays the shared ones.
    const manager = await agents.listAgents(
      await ctxOf(PEOPLE.manager),
      { view: 'workspace' },
      NOW,
    );
    expect(manager.agents.map((a) => a.id)).toEqual([shared.id]);
  });

  it("gives each row the buttons the detail's `can` gives, as Settings › Chat keeps them", async () => {
    const shared = await create(PEOPLE.manager, { name: 'Shared', visibility: 'workspace' });
    const manager = await ctxOf(PEOPLE.manager);
    await agents.changeAgentState(manager, shared.id, 'activate', NOW);
    await agents.changeAgentState(manager, shared.id, 'pause', NOW);
    const rowOf = async (userId: string) =>
      (await agents.listAgents(await ctxOf(userId), { view: 'paused' }, NOW)).agents[0];
    expect((await rowOf(PEOPLE.manager)).can).toEqual({ run: true, pause: false, resume: true });
    expect((await rowOf(PEOPLE.analyst)).can).toEqual({ run: false, pause: false, resume: false });

    // Only Admins keep workspace agents now: its Manager may run it, but not turn it back on.
    db.tables.chat_settings = [
      {
        organization_id: ORG,
        agent_run_share_default: 0.1,
        agents_full_auto: true,
        workspace_agents_admins_only: true,
        full_auto_for_members: true,
      },
    ];
    const row = await rowOf(PEOPLE.manager);
    expect(row.can).toEqual({ run: true, pause: false, resume: false });
    const detail = await agents.readAgent(await ctxOf(PEOPLE.manager), shared.id, NOW);
    expect(detail?.can).toMatchObject(row.can);
    expect((await rowOf(PEOPLE.admin)).can).toEqual({ run: true, pause: false, resume: true });
  });

  it('answers not found for another workspace’s agent and for a teammate’s private one', async () => {
    const theirs = await create(PEOPLE.otherManager);
    const foreign = await create(PEOPLE.manager, { name: 'Moved away' });
    // The agent moves to another workspace: its id means nothing here.
    agentRow(foreign.id).organization_id = OTHER_ORG;
    const ctx = await ctxOf(PEOPLE.manager);
    for (const id of [theirs.id, foreign.id]) {
      expect(await runs.runAgentNow(ctx, id, {}, NOW, null)).toMatchObject({
        ok: false,
        refusal: { status: 404 },
      });
      expect(await agents.listAgentRuns(ctx, id, 50)).toBeNull();
      expect(await agents.duplicateAgent(ctx, id, NOW)).toMatchObject({
        ok: false,
        refusal: { status: 404 },
      });
    }
    expect(
      await agents.updateAgent(ctx, foreign.id, updateAgentInput.parse({ name: 'x' })),
    ).toMatchObject({ ok: false, refusal: { status: 404 } });
    expect(rows('chat_agent_runs')).toEqual([]);
  });

  it('hides a private agent of someone else as not there', async () => {
    const theirs = await create(PEOPLE.otherManager);
    expect(await agents.readAgent(await ctxOf(PEOPLE.manager), theirs.id)).toBeNull();
    expect(await agents.readAgent(await ctxOf(PEOPLE.analyst), theirs.id)).toBeNull();
    expect(
      await agents.updateAgent(
        await ctxOf(PEOPLE.manager),
        theirs.id,
        updateAgentInput.parse({ name: 'x' }),
      ),
    ).toMatchObject({ ok: false, refusal: { status: 404, code: 'not_found' } });
    expect(await agents.readAgent(await ctxOf(PEOPLE.admin), theirs.id)).not.toBeNull();
  });

  it('gives an Analyst a workspace agent read-only, with nothing to click', async () => {
    const { id } = await create(PEOPLE.manager, { visibility: 'workspace' });
    const detail = await agents.readAgent(await ctxOf(PEOPLE.analyst), id, NOW);
    expect(detail?.can).toEqual({
      create: false,
      edit: false,
      activate: false,
      pause: false,
      resume: false,
      archive: false,
      restore: false,
      delete: false,
      duplicate: false,
      run: false,
      takeOver: false,
    });
    const owner = await agents.readAgent(await ctxOf(PEOPLE.manager), id, NOW);
    expect(owner?.can).toMatchObject({ edit: true, activate: true, run: true, pause: false });
  });

  it('shows runs and AI use as shares only: never a dollar, a run’s or a trigger’s id', async () => {
    const { id } = await create(PEOPLE.manager, {
      triggers: [{ kind: 'signal', config: { category: 'recover' } }],
    });
    usage.shares = {
      unlimited: false,
      byAgent: new Map([[id, { share: 0.032, ownKeyShare: 0, runs: 4 }]]),
    };
    db.tables.chat_agent_runs.push({
      id: 'dddddddd-0000-4000-8000-000000000001',
      organization_id: ORG,
      agent_id: id,
      agent_version: 1,
      brand_id: BRAND,
      trigger_kind: 'manual',
      acting_user_id: PEOPLE.manager,
      status: 'done',
      skipped_reason: null,
      stop_reason: null,
      max_share: 0.1,
      usage_share: 0.032,
      outcome: 'improved',
      outcome_confidence: 'medium',
      queued_at: '2026-10-28T09:00:00.000Z',
      started_at: '2026-10-28T09:00:01.000Z',
      finished_at: '2026-10-28T09:05:00.000Z',
    });
    db.tables.chat_conversations.push({
      id: 'cccccccc-0000-4000-8000-000000000009',
      organization_id: ORG,
      user_id: PEOPLE.manager,
      shared_at: null,
      agent_run_id: 'dddddddd-0000-4000-8000-000000000001',
    });
    const detail = await agents.readAgent(await ctxOf(PEOPLE.manager), id, NOW);
    expect(detail).toMatchObject({
      usage30d: { share: 0.032, runs: 4 },
      usagePeriod: { share: 0.032 },
      lastRun: { status: 'done', at: '2026-10-28T09:05:00.000Z' },
      outcomes30d: { improved: 1, pending: 0 },
      recentRuns: [
        {
          status: 'done',
          triggerKind: 'manual',
          brand: 'Brand A',
          by: 'Sam Lee',
          usageShare: 0.032,
          maxShare: 0.1,
          chatId: 'cccccccc-0000-4000-8000-000000000009',
        },
      ],
    });
    const body = JSON.stringify(detail);
    expect(body).not.toMatch(/usd|cost|\$|dddddddd-0000/i);
    for (const trigger of rows('chat_agent_triggers')) expect(body).not.toContain(trigger.id);
  });

  it('gives a run whose chat was deleted no chat to open', async () => {
    const { id } = await create(PEOPLE.manager);
    db.tables.chat_agent_runs.push({
      id: 'dddddddd-0000-4000-8000-000000000002',
      organization_id: ORG,
      agent_id: id,
      agent_version: 1,
      brand_id: BRAND,
      trigger_kind: 'manual',
      acting_user_id: PEOPLE.manager,
      status: 'done',
      max_share: 0.1,
      usage_share: 0.01,
      queued_at: '2026-10-28T09:00:00.000Z',
    });
    db.tables.chat_conversations.push({
      id: 'cccccccc-0000-4000-8000-000000000010',
      organization_id: ORG,
      user_id: PEOPLE.manager,
      shared_at: null,
      agent_run_id: 'dddddddd-0000-4000-8000-000000000002',
      deleted_at: '2026-10-28T10:00:00.000Z',
    });
    const runsOf = await agents.listAgentRuns(await ctxOf(PEOPLE.manager), id, 50);
    expect(runsOf?.map((run) => run.chatId)).toEqual([null]);
  });

  it("links a run's chat only for those who can open it: its author, or anyone once shared", async () => {
    const { id } = await create(PEOPLE.manager, { visibility: 'workspace' });
    const run = (n: number) => ({
      id: `dddddddd-0000-4000-8000-00000000002${n}`,
      organization_id: ORG,
      agent_id: id,
      agent_version: 1,
      brand_id: BRAND,
      trigger_kind: 'manual',
      acting_user_id: PEOPLE.manager,
      status: 'done',
      max_share: 0.1,
      usage_share: 0.01,
      queued_at: `2026-10-28T0${n}:00:00.000Z`,
    });
    db.tables.chat_agent_runs.push(run(1), run(2));
    db.tables.chat_conversations.push(
      {
        id: 'cccccccc-0000-4000-8000-000000000021',
        organization_id: ORG,
        user_id: PEOPLE.manager,
        shared_at: null,
        agent_run_id: run(1).id,
      },
      {
        id: 'cccccccc-0000-4000-8000-000000000022',
        organization_id: ORG,
        user_id: PEOPLE.manager,
        shared_at: '2026-10-28T03:00:00.000Z',
        agent_run_id: run(2).id,
      },
    );
    const chatsFor = async (person: string) =>
      (await agents.listAgentRuns(await ctxOf(person), id, 50))?.map((r) => r.chatId);
    // Newest first: the shared chat, then the private one.
    expect(await chatsFor(PEOPLE.manager)).toEqual([
      'cccccccc-0000-4000-8000-000000000022',
      'cccccccc-0000-4000-8000-000000000021',
    ]);
    // The chat page opens only its author's own chats and shared ones: no link to a private one.
    for (const person of [PEOPLE.admin, PEOPLE.analyst]) {
      expect(await chatsFor(person)).toEqual(['cccccccc-0000-4000-8000-000000000022', null]);
    }
    const detail = await agents.readAgent(await ctxOf(PEOPLE.analyst), id, NOW);
    expect(detail?.recentRuns.map((r) => r.chatId)).toEqual([
      'cccccccc-0000-4000-8000-000000000022',
      null,
    ]);
  });
});

describe('brand access (Selected brands)', () => {
  /** An Admin narrows the person to these brands (BRAND-ACCESS, 00388). */
  const narrow = (userId: string, ...brandIds: string[]) => {
    db.tables.profiles.find((p) => p.id === userId)!.brand_scope = 'selected';
    db.tables.member_brands = brandIds.map((brand_id) => ({
      user_id: userId,
      organization_id: ORG,
      brand_id,
    }));
  };

  it('changes nothing while everyone has All brands', async () => {
    const ctx = await ctxOf(PEOPLE.manager);
    expect(ctx.viewer.brandAccess).toBe('all');
    expect(
      (await agents.runnableBrands(ORG, { all_brands: true }, ctx.viewer.brandAccess)).map(
        (b) => b.name,
      ),
    ).toEqual(['Brand A', 'Brand B']);
  });

  it('reads All brands as all of theirs, and refuses a brand not shared as one not found', async () => {
    narrow(PEOPLE.manager, BRAND);
    const ctx = await ctxOf(PEOPLE.manager);
    // The demo brand is everyone's to read; nothing runs on it.
    expect(ctx.viewer.brandAccess).toEqual([BRAND, DEMO]);
    expect(
      (await agents.runnableBrands(ORG, { all_brands: true }, ctx.viewer.brandAccess)).map(
        (b) => b.name,
      ),
    ).toEqual(['Brand A']);
    expect(
      await agents.createAgent(ctx, input({ scope: { brand_ids: [BRAND_2] } }), NOW),
    ).toMatchObject({ ok: false, refusal: { code: 'brand_not_found' } });
    // Their own agent on All brands is theirs to see, naming their brands only (Brand B never).
    const own = await create(PEOPLE.manager, { scope: { all_brands: true } });
    const detail = await agents.readAgent(await ctxOf(PEOPLE.manager), own.id, NOW);
    expect(detail?.brands.map((b) => b.name)).toEqual(['Brand A', 'Demo']);
    expect(detail?.scope).toEqual({ allBrands: true, brands: ['Brand A', 'Demo'] });
  });

  it("holds an Admin's Resume to the brands its owner may use, connections included", async () => {
    const agent = await create(PEOPLE.manager, {
      scope: { all_brands: true },
      skills: ['publish'],
    });
    // Brand A sends pages to WordPress; Brand B has no CMS.
    db.tables.brand_cms_connections = [
      { brand_id: BRAND, provider: 'wordpress', status: 'connected' },
    ];
    const manager = await ctxOf(PEOPLE.manager);
    expect(await agents.changeAgentState(manager, agent.id, 'activate', NOW)).toMatchObject({
      ok: true,
    });
    expect(await agents.changeAgentState(manager, agent.id, 'pause', NOW)).toMatchObject({
      ok: true,
    });
    const admin = await ctxOf(PEOPLE.admin);
    // Its runs act as the Manager, who has All brands: Brand B would lack the CMS.
    expect(await agents.changeAgentState(admin, agent.id, 'resume', NOW)).toMatchObject({
      ok: false,
      refusal: { code: 'connection_missing' },
    });
    // Narrowed to Brand A, the owner's brands all have it: the Admin's own don't count.
    narrow(PEOPLE.manager, BRAND);
    expect(await agents.changeAgentState(admin, agent.id, 'resume', NOW)).toMatchObject({
      ok: true,
    });
    expect(await agents.changeAgentState(admin, agent.id, 'pause', NOW)).toMatchObject({
      ok: true,
    });
    // None of its brands left to the owner: nothing to run on.
    narrow(PEOPLE.manager);
    expect(await agents.changeAgentState(admin, agent.id, 'resume', NOW)).toMatchObject({
      ok: false,
      refusal: { code: 'no_brand' },
    });
  });

  it('hides the agents, runs and brand names they may not see', async () => {
    const shared = await create(PEOPLE.otherManager, {
      name: 'On both',
      visibility: 'workspace',
      scope: { brand_ids: [BRAND, BRAND_2] },
    });
    const mine = await create(PEOPLE.manager, { visibility: 'workspace' });
    const run = (n: number, brandId: string | null) => ({
      id: `dddddddd-0000-4000-8000-00000000003${n}`,
      organization_id: ORG,
      agent_id: mine.id,
      agent_version: 1,
      brand_id: brandId,
      trigger_kind: 'manual',
      acting_user_id: PEOPLE.manager,
      status: 'done',
      max_share: 0.1,
      usage_share: 0.01,
      queued_at: `2026-10-28T0${n}:00:00.000Z`,
    });
    // Runs from before they were narrowed: on Brand B, and on a brand since deleted.
    db.tables.chat_agent_runs.push(run(1, BRAND), run(2, BRAND_2), run(3, null));
    expect(await agents.listAgentRuns(await ctxOf(PEOPLE.manager), mine.id, 50)).toHaveLength(3);

    narrow(PEOPLE.manager, BRAND);
    const ctx = await ctxOf(PEOPLE.manager);
    const list = await agents.listAgents(ctx, { view: 'workspace' }, NOW);
    expect(list.agents.map((a) => a.id)).not.toContain(shared.id);
    expect(await agents.readAgent(ctx, shared.id, NOW)).toBeNull();
    const runsSeen = await agents.listAgentRuns(ctx, mine.id, 50);
    expect(runsSeen?.map((r) => r.brand)).toEqual(['Brand A']);
    // An Admin still sees all of it.
    const admin = await ctxOf(PEOPLE.admin);
    expect(await agents.readAgent(admin, shared.id, NOW)).not.toBeNull();
    expect(await agents.listAgentRuns(admin, mine.id, 50)).toHaveLength(3);
  });
});
