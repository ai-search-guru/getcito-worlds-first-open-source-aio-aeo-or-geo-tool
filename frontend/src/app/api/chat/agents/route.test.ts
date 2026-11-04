// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * The agents API (CHAT-21): not there while the new Chat is off for the
 * workspace; every write checks the plan first (a read-only workspace is
 * 402, before anything else); a bad body or id is refused as a value
 * (#1777), and a refusal carries the out-of-permission answer's parts
 * (CHAT-20 §4c), never a thrown error.
 */

const state = vi.hoisted(() => ({ on: true, readOnly: false, ctx: true }));
const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const CTX = { actor: ACTOR, viewer: { userId: 'user-1', role: 'manager', brandAccess: 'all' } };

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/engine', () => ({ driveRun: vi.fn(), stopChatRun: vi.fn() }));
vi.mock('@/lib/chat/runApi', async (original) => {
  const actual = await original<typeof import('@/lib/chat/runApi')>();
  return {
    ...actual,
    chatActor: async () =>
      state.on ? ACTOR : actual.runFailure(404, 'not_found', 'not_found', 'Not found'),
  };
});
vi.mock('@/lib/subscriptionGuard', () => ({
  writeRefusal: vi.fn(async () =>
    state.readOnly
      ? NextResponse.json({ error: 'plan_limit', code: 'subscription_inactive' }, { status: 402 })
      : null,
  ),
  DEMO_BRAND: { message: 'This is the demo brand.' },
}));
vi.mock('@/lib/chat/agents', async (original) => {
  const actual = await original<typeof import('@/lib/chat/agents')>();
  return {
    ...actual,
    readAgentContext: vi.fn(async () => (state.ctx ? CTX : null)),
    listAgents: vi.fn(async () => ({
      agents: [],
      counts: { mine: 0, workspace: 0, paused: 0, archived: 0 },
      active: 0,
      activeInWorkspace: 0,
      activeLimit: 25,
    })),
    readAgent: vi.fn(async () => null),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    changeAgentState: vi.fn(async () => ({ ok: true, value: { id: AGENT, status: 'paused' } })),
    duplicateAgent: vi.fn(),
    takeOverAgent: vi.fn(async () => ({ ok: true, value: { id: AGENT, status: 'active' } })),
    listAgentRuns: vi.fn(async () => []),
  };
});
vi.mock('@/lib/chat/agentRuns', () => ({
  runAgentNow: vi.fn(async () => ({
    ok: true,
    value: { runs: [{ brand: 'Brand A', status: 'queued', repeated: false, coalesced: false }] },
  })),
  runAgentOnAction: vi.fn(async () => ({
    ok: true,
    value: {
      run: {
        brand: 'Brand A',
        status: 'running',
        repeated: false,
        coalesced: false,
        chatId: 'chat-1',
        stopReason: null,
      },
    },
  })),
}));
vi.mock('@/lib/chat/agentGoLivePermission', () => ({
  setAgentGoLive: vi.fn(async () => ({ ok: true, detail: null })),
}));
vi.mock('@/lib/chat/agentAction', () => ({
  compatibleAgents: vi.fn(async () => ({
    ok: true,
    value: { action: { no: 1258, category: 'recover' }, agents: [], createSkill: 'winback' },
  })),
}));

const AGENT = 'eeeeeeee-0000-4000-8000-000000000001';
const BRAND = '22222222-2222-4222-8222-222222222222';

const list = await import('./route');
const one = await import('./[id]/route');
const activate = await import('./[id]/activate/route');
const pause = await import('./[id]/pause/route');
const resume = await import('./[id]/resume/route');
const archive = await import('./[id]/archive/route');
const restore = await import('./[id]/restore/route');
const duplicate = await import('./[id]/duplicate/route');
const takeOver = await import('./[id]/take-over/route');
const run = await import('./[id]/run/route');
const runsRoute = await import('./[id]/runs/route');
const compatible = await import('./compatible/route');
const goLive = await import('./[id]/go-live/route');
const lib = await import('@/lib/chat/agents');
const { runAgentNow, runAgentOnAction } = await import('@/lib/chat/agentRuns');
const { compatibleAgents } = await import('@/lib/chat/agentAction');
const { setAgentGoLive } = await import('@/lib/chat/agentGoLivePermission');

const url = (path = '') => `https://app.example.com/api/chat/agents${path}`;
const params = (id = AGENT) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
const valid = { name: 'Win back', skills: ['winback'], scope: { brand_ids: [BRAND] } };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  state.on = true;
  state.readOnly = false;
  state.ctx = true;
});

describe('/api/chat/agents', () => {
  it('is not there while the new Chat is off, nor for someone out of the workspace', async () => {
    state.on = false;
    expect((await list.GET(new Request(url()))).status).toBe(404);
    expect((await list.POST(new Request(url(), post(valid)))).status).toBe(404);
    state.on = true;
    state.ctx = false;
    expect((await list.GET(new Request(url()))).status).toBe(404);
    expect(lib.listAgents).not.toHaveBeenCalled();
  });

  it('lists a tab, and refuses a tab it doesn’t know as a value', async () => {
    const res = await list.GET(new Request(url('?view=paused&q=brief')));
    expect(await res.json()).toMatchObject({ ok: true, activeLimit: 25 });
    expect(lib.listAgents).toHaveBeenCalledWith(CTX, { view: 'paused', q: 'brief' });
    const bad = await list.GET(new Request(url('?view=deleted')));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, failure: 'failed', code: 'invalid' });
  });

  it('checks the plan before anything else on every write', async () => {
    state.readOnly = true;
    const writes = [
      list.POST(new Request(url(), post(valid))),
      one.PATCH(new Request(url(), { method: 'PATCH', body: '{"name":"x"}' }), params()),
      one.DELETE(new Request(url(), { method: 'DELETE' }), params()),
      activate.POST(new Request(url()), params()),
      pause.POST(new Request(url()), params()),
      resume.POST(new Request(url()), params()),
      archive.POST(new Request(url()), params()),
      restore.POST(new Request(url()), params()),
      duplicate.POST(new Request(url()), params()),
      takeOver.POST(new Request(url()), params()),
      run.POST(new Request(url(), post({})), params()),
    ];
    for (const res of await Promise.all(writes)) expect(res.status).toBe(402);
    expect(lib.createAgent).not.toHaveBeenCalled();
    expect(lib.changeAgentState).not.toHaveBeenCalled();
    expect(lib.takeOverAgent).not.toHaveBeenCalled();
    expect(runAgentNow).not.toHaveBeenCalled();
  });

  it('creates from a valid body only', async () => {
    vi.mocked(lib.createAgent).mockResolvedValueOnce({
      ok: true,
      value: { id: AGENT } as never,
    });
    const created = await list.POST(new Request(url(), post(valid)));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ ok: true, agent: { id: AGENT } });
    const bad = await list.POST(new Request(url(), post({ ...valid, skills: [] })));
    expect(bad.status).toBe(400);
    const keyed = await list.POST(new Request(url(), post({ ...valid, apiKey: 'sk-…' })));
    expect(keyed.status).toBe(400);
    expect(lib.createAgent).toHaveBeenCalledTimes(1);
  });

  it('answers a refusal with the out-of-permission answer’s parts', async () => {
    const denial = {
      asked: 'You asked: Create an agent.',
      rule: {
        kind: 'role',
        detail: "Your role is Analyst, and Analysts can't do this.",
        source: null,
      },
      whoCan: 'Admins and Managers can do this.',
      nextActions: ['ask_admin', 'see_access'],
    };
    vi.mocked(lib.createAgent).mockResolvedValueOnce({
      ok: false,
      refusal: { kind: 'denied', status: 403, code: 'forbidden_role', denial } as never,
    });
    const res = await list.POST(new Request(url(), post(valid)));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      failure: 'failed',
      code: 'forbidden_role',
      error: denial.rule.detail,
      denial,
    });

    vi.mocked(lib.createAgent).mockResolvedValueOnce({
      ok: false,
      refusal: {
        kind: 'denied',
        status: 403,
        code: 'plan_locked',
        denial: { ...denial, needsPlan: 'Growth' },
      } as never,
    });
    expect(await (await list.POST(new Request(url(), post(valid)))).json()).toMatchObject({
      failure: 'plan',
      code: 'plan_locked',
    });

    vi.mocked(lib.createAgent).mockResolvedValueOnce(lib.refused('name_taken', { name: 'X' }));
    const taken = await list.POST(new Request(url(), post(valid)));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({
      ok: false,
      code: 'name_taken',
      error: 'An agent named “X” already exists in this workspace. Pick another name.',
    });
  });

  it('never throws: a failure inside is a 500 value', async () => {
    vi.mocked(lib.createAgent).mockRejectedValueOnce(new Error('relation does not exist'));
    const res = await list.POST(new Request(url(), post(valid)));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      failure: 'failed',
      code: 'failed',
      error: 'Failed to create the agent',
    });
  });
});

describe('/api/chat/agents/{id}', () => {
  it('answers 404 for a bad id or an agent the person can’t see', async () => {
    expect((await one.GET(new Request(url()), params('nope'))).status).toBe(404);
    expect((await one.GET(new Request(url()), params())).status).toBe(404);
    expect(lib.readAgent).toHaveBeenCalledTimes(1);
  });

  it('saves a change, and refuses one with nothing to change', async () => {
    vi.mocked(lib.updateAgent).mockResolvedValueOnce({ ok: true, value: { id: AGENT } as never });
    const req = (body: unknown) =>
      new Request(url(), { method: 'PATCH', body: JSON.stringify(body) });
    expect((await one.PATCH(req({ expectedVersion: 1, mode: 'ask_first' }), params())).status).toBe(
      200,
    );
    expect(lib.updateAgent).toHaveBeenCalledWith(CTX, AGENT, {
      expectedVersion: 1,
      mode: 'ask_first',
    });
    expect((await one.PATCH(req({}), params())).status).toBe(400);
    expect((await one.PATCH(req({ maxRunShare: 0.75 }), params())).status).toBe(400);
  });

  it('deletes through the lifecycle, and each state route asks for its own change', async () => {
    expect((await one.DELETE(new Request(url()), params())).status).toBe(200);
    for (const route of [activate, pause, resume, archive, restore]) {
      const res = await route.POST(new Request(url()), params());
      expect(await res.json()).toMatchObject({ ok: true, agent: { id: AGENT } });
    }
    expect(vi.mocked(lib.changeAgentState).mock.calls.map((call) => call[2])).toEqual([
      'delete',
      'activate',
      'pause',
      'resume',
      'archive',
      'restore',
    ]);
    vi.mocked(lib.changeAgentState).mockResolvedValueOnce(
      lib.refused('wrong_status', { status: 'draft' }),
    );
    const wrong = await pause.POST(new Request(url()), params());
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toMatchObject({
      code: 'wrong_status',
      error: "This agent is a draft, so it can't do that now.",
    });
  });
});

describe('/api/chat/agents/{id}/take-over', () => {
  it('hands the agent to the Admin, and answers 404 for a bad id', async () => {
    const res = await takeOver.POST(new Request(url()), params());
    expect(await res.json()).toEqual({ ok: true, agent: { id: AGENT, status: 'active' } });
    expect(lib.takeOverAgent).toHaveBeenCalledWith(CTX, AGENT);
    expect((await takeOver.POST(new Request(url()), params('nope'))).status).toBe(404);
  });
});

describe('/api/chat/agents/{id}/run and /runs', () => {
  it('queues Run now with the brand it names, and answers each brand’s run', async () => {
    const res = await run.POST(new Request(url(), post({ brandId: BRAND })), params());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      ok: true,
      runs: [{ brand: 'Brand A', status: 'queued', repeated: false, coalesced: false }],
    });
    expect(runAgentNow).toHaveBeenCalledWith(CTX, AGENT, { brandId: BRAND });
    expect((await run.POST(new Request(url(), post({ brandId: 'x' })), params())).status).toBe(400);
  });

  it('says the AI limit is used up as a limit', async () => {
    vi.mocked(runAgentNow).mockResolvedValueOnce(lib.refused('ai_limit'));
    const res = await run.POST(new Request(url(), post({})), params());
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ failure: 'limit', code: 'ai_limit' });
  });

  it('runs it on an Action Center action, answering the run’s chat (W2-17)', async () => {
    const ACTION = 'acacacac-0000-4000-8000-000000000001';
    const res = await run.POST(new Request(url(), post({ actionId: ACTION })), params());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      ok: true,
      runs: [{ brand: 'Brand A', status: 'running', repeated: false, coalesced: false }],
      chatId: 'chat-1',
      stopReason: null,
    });
    expect(runAgentOnAction).toHaveBeenCalledWith(CTX, AGENT, ACTION);
    expect(runAgentNow).not.toHaveBeenCalled();
    // A brand and an action at once, or an action id that isn't one: refused.
    expect(
      (await run.POST(new Request(url(), post({ actionId: ACTION, brandId: BRAND })), params()))
        .status,
    ).toBe(400);
    expect((await run.POST(new Request(url(), post({ actionId: 'x' })), params())).status).toBe(
      400,
    );
    vi.mocked(runAgentOnAction).mockResolvedValueOnce(lib.refused('action_closed'));
    const closed = await run.POST(new Request(url(), post({ actionId: ACTION })), params());
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ ok: false, code: 'action_closed' });
  });

  it('lists up to 50 runs, and 404 for an agent the person can’t see', async () => {
    expect((await runsRoute.GET(new Request(url('?limit=10')), params())).status).toBe(200);
    expect(lib.listAgentRuns).toHaveBeenCalledWith(CTX, AGENT, 10);
    expect((await runsRoute.GET(new Request(url('?limit=51')), params())).status).toBe(400);
    vi.mocked(lib.listAgentRuns).mockResolvedValueOnce(null);
    expect((await runsRoute.GET(new Request(url()), params())).status).toBe(404);
  });
});

describe('/api/chat/agents/compatible (W2-17)', () => {
  const ACTION = 'acacacac-0000-4000-8000-000000000001';

  it('lists the agents for an action to an Admin or a Manager', async () => {
    const res = await compatible.GET(new Request(url(`/compatible?actionId=${ACTION}`)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      action: { no: 1258, category: 'recover' },
      agents: [],
      createSkill: 'winback',
    });
    expect(compatibleAgents).toHaveBeenCalledWith(CTX, ACTION);
    expect((await compatible.GET(new Request(url('/compatible?actionId=x')))).status).toBe(400);
  });

  it('is not there with Chat off, and answers an Analyst with the out-of-permission answer', async () => {
    state.on = false;
    expect((await compatible.GET(new Request(url(`/compatible?actionId=${ACTION}`)))).status).toBe(
      404,
    );
    state.on = true;
    vi.mocked(lib.readAgentContext).mockResolvedValueOnce({
      ...CTX,
      viewer: { ...CTX.viewer, role: 'analyst' },
      plan: { planId: 'growth' },
      settings: lib.agentSettingsOf(null),
    } as never);
    const res = await compatible.GET(new Request(url(`/compatible?actionId=${ACTION}`)));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, code: 'forbidden_role' });
    expect(compatibleAgents).not.toHaveBeenCalled();
  });
});

describe('/api/chat/agents/{id}/go-live (AUTONOMOUS-GO-LIVE §7.2)', () => {
  const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) });

  it('gives a daily limit of 1 to 20, takes it away, and refuses anything else as a value', async () => {
    const given = await goLive.PUT(
      new Request(url(`/${AGENT}/go-live`), put({ dailyLimit: 7 })),
      params(),
    );
    expect(await given.json()).toEqual({ ok: true, goLive: null });
    expect(setAgentGoLive).toHaveBeenLastCalledWith(CTX, AGENT, 7);
    const taken = await goLive.DELETE(
      new Request(url(`/${AGENT}/go-live`), { method: 'DELETE' }),
      params(),
    );
    expect(taken.status).toBe(200);
    expect(setAgentGoLive).toHaveBeenLastCalledWith(CTX, AGENT, null);
    vi.mocked(setAgentGoLive).mockClear();
    for (const body of [
      { dailyLimit: 0 },
      { dailyLimit: 21 },
      { dailyLimit: 2.5 },
      {},
      { dailyLimit: 5, version: 3 },
    ]) {
      const bad = await goLive.PUT(new Request(url(`/${AGENT}/go-live`), put(body)), params());
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    expect(
      (await goLive.PUT(new Request(url('/x/go-live'), put({ dailyLimit: 5 })), params('x')))
        .status,
    ).toBe(404);
    expect(setAgentGoLive).not.toHaveBeenCalled();
  });

  it('checks the plan first, and answers a refusal with its parts', async () => {
    state.readOnly = true;
    expect(
      (await goLive.PUT(new Request(url(`/${AGENT}/go-live`), put({ dailyLimit: 5 })), params()))
        .status,
    ).toBe(402);
    expect(setAgentGoLive).not.toHaveBeenCalled();
    state.readOnly = false;
    vi.mocked(setAgentGoLive).mockResolvedValueOnce(lib.refused('go_live_off'));
    const res = await goLive.PUT(
      new Request(url(`/${AGENT}/go-live`), put({ dailyLimit: 5 })),
      params(),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      ok: false,
      code: 'go_live_off',
      error: 'An Admin hasn’t allowed agents to publish on their own in Settings › Chat.',
    });
  });

  it('reads it for whoever may see the agent, and 404 otherwise', async () => {
    expect((await goLive.GET(new Request(url(`/${AGENT}/go-live`)), params())).status).toBe(404);
    vi.mocked(lib.readAgent).mockResolvedValueOnce({
      goLive: { switch: 'on', permission: null, recent: [] },
    } as never);
    const res = await goLive.GET(new Request(url(`/${AGENT}/go-live`)), params());
    expect(await res.json()).toEqual({
      ok: true,
      goLive: { switch: 'on', permission: null, recent: [] },
    });
  });
});
