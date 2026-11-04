// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from './testing/chatFixtures';

/**
 * An agent's permission to publish and send on its own (AUTONOMOUS-GO-LIVE
 * §7.2): only an Admin gives it, for the version the agent is on, while the
 * workspace's switch is on and the agent runs in Full auto; an edit leaves
 * it behind; the agent's page and card read it, with its last day's
 * go-lives.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/mcp/account', () => ({
  getAiUsageFor: vi.fn(async () => ({ active_plan: true, unlimited: false, percent_used: 10 })),
}));
vi.mock('./key', () => ({
  resolveChatModelKey: vi.fn(async () => ({ source: 'getcito' })),
  failingOwnKey: vi.fn(async () => null),
}));
vi.mock('./agentShares', () => ({ readAgentShares: vi.fn(async () => null) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const agents = await import('./agents');
const { readAgentGoLive, readGoLiveLimits, readGoLiveSwitch } = await import('./agentGoLive');
const { setAgentGoLive } = await import('./agentGoLivePermission');
const { createAgentInput, updateAgentInput } = await import('./agentRules');

const NOW = new Date('2026-11-02T12:00:00.000Z');
const actor = (userId: string) => ({ userId, email: null, organizationId: ORG });

async function ctxOf(userId: string) {
  const ctx = await agents.readAgentContext(actor(userId));
  if (!ctx) throw new Error('no context');
  return ctx;
}

async function create(over: Record<string, unknown> = {}) {
  const result = await agents.createAgent(
    await ctxOf(PEOPLE.admin),
    createAgentInput.parse({
      name: 'Ready to publish',
      skills: ['publish'],
      mode: 'full_auto',
      scope: { brand_ids: [BRAND] },
      ...over,
    }),
    NOW,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.refusal));
  return result.value;
}

const rows = (table: string) => db.tables[table] ?? [];
const settings = (over: Record<string, unknown> = {}) => {
  db.tables.chat_settings = [
    {
      organization_id: ORG,
      agent_run_share_default: 0.1,
      agents_full_auto: true,
      workspace_agents_admins_only: false,
      full_auto_for_members: true,
      auto_go_live_groups: ['publishing'],
      ...over,
    },
  ];
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AUTO_GO_LIVE', 'true');
  seedWorkspace(db);
  db.unique = {
    ...db.unique,
    chat_agents: [['organization_id', 'name']],
    chat_agent_versions: [['agent_id', 'version']],
    chat_agent_go_live: [['agent_id']],
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
  };
  db.tables.brands = [{ id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false }];
  db.tables.profiles = db.tables.profiles.map((p) =>
    p.id === PEOPLE.admin ? { ...p, full_name: 'Alex Kim' } : p,
  );
  db.tables.topics = [];
  db.tables.chat_agents = [];
  db.tables.chat_agent_versions = [];
  db.tables.chat_agent_triggers = [];
  db.tables.chat_agent_runs = [];
  db.tables.chat_conversations = [];
  db.tables.chat_agent_go_live = [];
  db.tables.chat_agent_go_live_events = [];
  settings();
});

afterEach(() => vi.unstubAllEnvs());

describe('the workspace’s switch', () => {
  it('is hidden while the flag is off, else on or off as Settings › Chat has it', async () => {
    expect(await readGoLiveSwitch(ORG)).toBe('on');
    settings({ auto_go_live_groups: [] });
    expect(await readGoLiveSwitch(ORG)).toBe('off');
    db.tables.chat_settings = [];
    expect(await readGoLiveSwitch(ORG)).toBe('off');
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'false');
    expect(await readGoLiveSwitch(ORG)).toBe('hidden');
  });

  it('is hidden before 00443, and a read that fails throws', async () => {
    db.failures.chat_settings = {
      code: '42703',
      message: 'column auto_go_live_groups does not exist',
    };
    expect(await readGoLiveSwitch(ORG)).toBe('hidden');
    db.failures.chat_settings = { message: 'timeout' };
    await expect(readGoLiveSwitch(ORG)).rejects.toThrow(/timeout/);
  });
});

describe('giving and taking an agent’s permission', () => {
  it('gives it for the version the agent is on, with its limit, logged; the page and the card read it', async () => {
    const agent = await create();
    const given = await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, 7);
    expect(given).toMatchObject({
      ok: true,
      detail: {
        switch: 'on',
        permission: { on: true, changed: false, version: 1, dailyLimit: 7, by: 'Alex Kim' },
        recent: [],
      },
    });
    expect(rows('chat_agent_go_live')).toEqual([
      expect.objectContaining({
        agent_id: agent.id,
        organization_id: ORG,
        version: 1,
        daily_limit: 7,
        skill_checksums: {},
        granted_by: PEOPLE.admin,
      }),
    ]);
    expect(rows('chat_activity_log').filter((r) => r.summary_key === 'agentGoLiveOn')).toEqual([
      expect.objectContaining({
        agent_id: agent.id,
        summary_params: { name: 'Ready to publish', limit: '7' },
      }),
    ]);
    const detail = await agents.readAgent(await ctxOf(PEOPLE.admin), agent.id, NOW);
    expect(detail?.goLive?.permission).toMatchObject({ on: true, dailyLimit: 7 });
    expect(await readGoLiveLimits(ORG, [{ id: agent.id, version: 1 }])).toEqual(
      new Map([[agent.id, 7]]),
    );
    const list = await agents.listAgents(await ctxOf(PEOPLE.admin), { view: 'mine' }, NOW);
    expect(list.agents[0]).toMatchObject({ id: agent.id, goLiveLimit: 7 });

    // A change to the limit replaces it; one row per agent.
    await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, 3);
    expect(rows('chat_agent_go_live')).toEqual([expect.objectContaining({ daily_limit: 3 })]);
  });

  it('leaves it behind when an edit makes a new version: no badge, "off since the agent changed"', async () => {
    const agent = await create();
    await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, 5);
    const edited = await agents.updateAgent(
      await ctxOf(PEOPLE.admin),
      agent.id,
      updateAgentInput.parse({ instructions: 'Keep the tone plain.' }),
      NOW,
    );
    if (!edited.ok) throw new Error('not edited');
    expect(edited.value.version).toBe(2);
    expect(edited.value.goLive?.permission).toMatchObject({ on: false, changed: true, version: 1 });
    expect(await readGoLiveLimits(ORG, [{ id: agent.id, version: 2 }])).toEqual(new Map());
    const list = await agents.listAgents(await ctxOf(PEOPLE.admin), { view: 'mine' }, NOW);
    expect(list.agents[0]).not.toHaveProperty('goLiveLimit');
  });

  it('takes it away, logged; the card loses its badge', async () => {
    const agent = await create();
    await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, 5);
    const taken = await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, null);
    expect(taken).toMatchObject({ ok: true, detail: { permission: null } });
    expect(rows('chat_agent_go_live')).toEqual([]);
    expect(rows('chat_activity_log').some((r) => r.summary_key === 'agentGoLiveOff')).toBe(true);
  });

  it('is an Admin’s: a Manager, owner or not, gets the out-of-permission answer', async () => {
    const agent = await create();
    const asked = await setAgentGoLive(await ctxOf(PEOPLE.manager), agent.id, 5);
    expect(asked).toMatchObject({
      ok: false,
      refusal: {
        kind: 'denied',
        status: 403,
        code: 'forbidden_role',
        asked: 'goLive',
        denial: { whoCan: 'Admins can do this.' },
      },
    });
    expect(await setAgentGoLive(await ctxOf(PEOPLE.manager), agent.id, null)).toMatchObject({
      ok: false,
      refusal: { code: 'forbidden_role' },
    });
    expect(rows('chat_agent_go_live')).toEqual([]);
  });

  it('needs the switch on, Full auto open to agents and the agent in Full auto; taking it away always works', async () => {
    const agent = await create();
    settings({ auto_go_live_groups: [] });
    expect(await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, 5)).toMatchObject({
      ok: false,
      refusal: { kind: 'refused', status: 409, code: 'go_live_off' },
    });
    settings({ agents_full_auto: false });
    expect(await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, 5)).toMatchObject({
      ok: false,
      refusal: { kind: 'denied', code: 'policy_never', asked: 'goLive' },
    });
    settings();
    const asked = await create({ name: 'Asks first', mode: 'auto' });
    expect(await setAgentGoLive(await ctxOf(PEOPLE.admin), asked.id, 5)).toMatchObject({
      ok: false,
      refusal: { code: 'go_live_mode' },
    });
    expect(rows('chat_agent_go_live')).toEqual([]);

    // With the switch off, an Admin can still take one away.
    await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, 5);
    settings({ auto_go_live_groups: [] });
    expect(await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, null)).toMatchObject({
      ok: true,
    });
    expect(rows('chat_agent_go_live')).toEqual([]);
  });

  it('refuses an agent the person can’t see, as not found', async () => {
    expect(
      await setAgentGoLive(await ctxOf(PEOPLE.admin), '99999999-9999-4999-8999-999999999990', 5),
    ).toMatchObject({ ok: false, refusal: { code: 'not_found' } });
  });
});

describe('telling who allowed it when an edit stops it (AUTONOMOUS-GO-LIVE §7.2, 00446)', () => {
  const sent = vi.fn();
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'shh');
    sent.mockReset().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', sent);
  });
  afterEach(() => vi.unstubAllGlobals());
  const edit = async (patch: Record<string, unknown>, id: string) => {
    const edited = await agents.updateAgent(
      await ctxOf(PEOPLE.admin),
      id,
      updateAgentInput.parse(patch),
      NOW,
    );
    if (!edited.ok) throw new Error(JSON.stringify(edited.refusal));
    return edited.value;
  };

  it('asks the server to tell them once, for the version it was allowed on, and not the editor', async () => {
    const agent = await create();
    await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, 5);
    // A name makes no new version: it stays allowed, and nobody is told.
    await edit({ name: 'Publisher' }, agent.id);
    expect(sent).not.toHaveBeenCalled();
    await edit({ instructions: 'Keep the tone plain.' }, agent.id);
    expect(sent).toHaveBeenCalledTimes(1);
    const [url, init] = sent.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/internal\/chat\/notices\/go-live-off$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer shh');
    expect(JSON.parse(init.body as string)).toEqual({
      orgId: ORG,
      agentId: agent.id,
      version: 1,
      editor: PEOPLE.admin,
    });
    // Its next edit: it wasn't allowed on version 2, so nobody is told again.
    await edit({ instructions: 'Keep the tone warm.' }, agent.id);
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('closes those notices when an Admin allows it again', async () => {
    const agent = await create();
    db.tables.chat_notices = [
      {
        id: 'n1',
        organization_id: ORG,
        user_id: PEOPLE.manager,
        kind: 'agent_go_live_off',
        payload: { agent: 'Ready to publish', agentId: agent.id },
        resolved_at: null,
      },
      {
        id: 'n2',
        organization_id: ORG,
        user_id: PEOPLE.manager,
        kind: 'agent_go_live_off',
        payload: { agent: 'Other', agentId: 'agent-x' },
        resolved_at: null,
      },
    ];
    await setAgentGoLive(await ctxOf(PEOPLE.admin), agent.id, 5);
    const [mine, other] = rows('chat_notices');
    expect(mine.resolved_at).toEqual(expect.any(String));
    expect(other.resolved_at).toBeNull();
  });
});

describe('the agent’s page', () => {
  it('lists the pages it took live in the last 24 hours, newest first, and names a former member', async () => {
    const agent = await create();
    db.tables.chat_agent_go_live = [
      {
        agent_id: agent.id,
        organization_id: ORG,
        version: 1,
        daily_limit: 5,
        granted_by: null,
        granted_at: '2026-11-01T10:00:00.000Z',
      },
    ];
    const event = (hoursAgo: number, status: string, title: string) => ({
      organization_id: ORG,
      agent_id: agent.id,
      target: 'webflow',
      status,
      created_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
      content_drafts: { title },
    });
    db.tables.chat_agent_go_live_events = [
      event(30, 'done', 'Too old'),
      event(5, 'done', 'Pricing FAQ'),
      event(2, 'taken_down', 'Plans compared'),
      event(1, 'failed', 'Not sent'),
      event(1, 'reserved', 'On its way'),
    ];
    const read = await readAgentGoLive(ORG, agent.id, 1, NOW);
    expect(read?.permission).toMatchObject({ on: true, by: null });
    expect(read?.recent).toEqual([
      { title: 'Plans compared', target: 'Webflow', at: expect.any(String), takenDown: true },
      { title: 'Pricing FAQ', target: 'Webflow', at: expect.any(String), takenDown: false },
    ]);
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'false');
    expect(await readAgentGoLive(ORG, agent.id, 1, NOW)).toBeNull();
    const detail = await agents.readAgent(await ctxOf(PEOPLE.admin), agent.id, NOW);
    expect(detail).not.toHaveProperty('goLive');
  });
});
