import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/settings/ai-providers: an organization's own keys for Chat, one per
 * provider, and the one Chat uses. Members read; admins save, switch and remove.
 */

let user: { id: string } | null;
let profile: { id: string; role: string; organization_id: string } | null;
/** The organization's plan, read on the cloud before a change. */
let org: { subscription_status: string; stripe_subscription_id: string };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: profile }),
          // The plan check: the profile with its organization.
          maybeSingle: async () => ({
            data: profile && { ...profile, organizations: org },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

/** Each query on the admin client: its table and the calls made on it. */
const queries: { table: string; calls: [string, ...unknown[]][] }[] = [];
/** What each query resolves to, in order. */
let results: { data?: unknown; error?: { message: string } | null }[];
const rpc = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const query = { table, calls: [] as [string, ...unknown[]][] };
      queries.push(query);
      const settle = () => Promise.resolve(results.shift() ?? { data: null, error: null });
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'neq', 'upsert', 'update', 'delete', 'order', 'limit']) {
        chain[op] = (...args: unknown[]) => {
          query.calls.push([op, ...args]);
          return chain;
        };
      }
      chain.maybeSingle = settle;
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        settle().then(resolve, reject);
      return chain;
    },
    rpc: (...args: unknown[]) => rpc(...args),
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: `${id}@acme.test` } } }),
      },
    },
  },
}));

/** What own keys do for the workspace (lib/chat/key.ts), as each test sets it. */
const ownKeyAccess = vi.fn();
vi.mock('@/lib/chat/key', () => ({
  ownKeyAccess: (...args: unknown[]) => ownKeyAccess(...args),
}));

vi.mock('@/lib/agent/keyEncryption', () => ({
  encryptApiKey: (key: string) => `enc(${key})`,
  last4: (key: string) => key.slice(-4),
}));

/** The key's test and what it keeps (lib/chat/keyTest.ts), as each test sets them. */
const keys = vi.hoisted(() => ({
  test: vi.fn(async (): Promise<unknown> => ({ outcome: 'unknown' })),
  keep: vi.fn(async () => 0),
  read: vi.fn(async (): Promise<unknown> => ({ state: 'none', active: false })),
  resume: vi.fn(async () => 0),
  resolve: vi.fn(async () => {}),
}));
vi.mock('@/lib/chat/keyTest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chat/keyTest')>()),
  testOwnKey: keys.test,
  testSavedKey: keys.test,
  keepKeyCheck: keys.keep,
}));
vi.mock('@/lib/agent/key', () => ({ readProviderKey: keys.read }));
vi.mock('@/lib/chat/keyHealth', () => ({
  resumeOwnKeyAgents: keys.resume,
  resolveOwnKeyNotices: keys.resolve,
}));

/** The key guard as the server answers it (lib/chat/ownKeyCap.ts). */
const guards = vi.hoisted(() => ({
  read: vi.fn(async (): Promise<unknown> => null),
  forget: vi.fn(),
}));
vi.mock('@/lib/chat/ownKeyCap', () => ({
  readOwnKeyGuard: guards.read,
  forgetOwnKeyCap: guards.forget,
}));

const { GET, PUT, PATCH, DELETE } = await import('./route');
const { POST: TEST } = await import('./test/route');
const { PUT: SET_GUARD } = await import('./guard/route');

const KEY = 'sk-test-0123456789abcdef';
const send = (method: string, body?: unknown) =>
  new Request('http://localhost/api/settings/ai-providers', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  user = { id: 'u1' };
  profile = { id: 'u1', role: 'admin', organization_id: 'org1' };
  org = { subscription_status: 'active', stripe_subscription_id: 'sub_1' };
  queries.length = 0;
  results = [];
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
  ownKeyAccess.mockReset().mockResolvedValue({ state: 'open' });
  guards.read.mockReset().mockResolvedValue(null);
  guards.forget.mockReset();
  // Chat off, as today: a saved key is marked to keep working once it is on.
  vi.stubEnv('CHAT_AGENTIC', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET', () => {
  it('lists the saved providers with who saved them, their health, and whether Chat has one', async () => {
    profile!.role = 'member';
    results = [
      {
        data: [
          {
            provider: 'openai',
            key_last4: 'abcd',
            settings: {},
            active: true,
            set_at: '2026-10-19T08:00:00Z',
            set_by: 'u2',
            checked_at: '2026-11-01T09:00:00Z',
            failing_since: '2026-11-01T08:00:00Z',
            failure_class: 'no_credit',
          },
          {
            provider: 'azure',
            key_last4: 'wxyz',
            settings: { endpoint: 'https://acme.openai.azure.com', deployment: 'd1' },
            active: false,
            set_at: '2026-10-18T08:00:00Z',
            set_by: null,
          },
        ],
        error: null,
      },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      access: { state: 'open' },
      configured: true,
      providers: [
        {
          provider: 'openai',
          last4: 'abcd',
          settings: {},
          active: true,
          setAt: '2026-10-19T08:00:00Z',
          setByEmail: 'u2@acme.test',
          health: {
            checkedAt: '2026-11-01T09:00:00Z',
            failingSince: '2026-11-01T08:00:00Z',
            failureClass: 'no_credit',
          },
        },
        {
          provider: 'azure',
          last4: 'wxyz',
          settings: { endpoint: 'https://acme.openai.azure.com', deployment: 'd1' },
          active: false,
          setAt: '2026-10-18T08:00:00Z',
          setByEmail: null,
          // A key never tested.
          health: { checkedAt: null, failingSince: null, failureClass: null },
        },
      ],
    });
    expect(queries[0].calls).toContainEqual(['eq', 'organization_id', 'org1']);
  });

  it('needs a signed-in user', async () => {
    user = null;
    expect((await GET()).status).toBe(401);
  });
});

describe('PUT', () => {
  it('lets admins only change the keys', async () => {
    profile!.role = 'manager';
    const res = await PUT(send('PUT', { provider: 'openai', apiKey: KEY }));
    expect(res.status).toBe(403);
    expect(queries).toHaveLength(0);
  });

  it("refuses an unknown provider, a short key, and names the setting that's wrong", async () => {
    expect((await PUT(send('PUT', { provider: 'copilot', apiKey: KEY }))).status).toBe(400);
    expect((await PUT(send('PUT', { provider: 'openai', apiKey: 'short' }))).status).toBe(400);
    const res = await PUT(
      send('PUT', {
        provider: 'azure',
        apiKey: KEY,
        settings: { endpoint: 'https://evil.example', deployment: 'd1' },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'endpoint' });
    expect(queries).toHaveLength(0);
  });

  it('saves the key encrypted, and makes the first one the one Chat uses', async () => {
    results = [{ error: null }];
    const res = await PUT(
      send('PUT', {
        provider: 'azure',
        apiKey: ` ${KEY} `,
        settings: { endpoint: 'https://acme.openai.azure.com/', deployment: 'd1' },
      }),
    );
    expect(res.status).toBe(200);
    const [upsert] = queries[0].calls;
    expect(upsert[0]).toBe('upsert');
    expect(upsert[1]).toMatchObject({
      organization_id: 'org1',
      provider: 'azure',
      key_encrypted: `enc(${KEY})`,
      key_last4: 'cdef',
      settings: { endpoint: 'https://acme.openai.azure.com', deployment: 'd1' },
      set_by: 'u1',
    });
    // A replaced key keeps whether Chat uses it.
    expect(upsert[1]).not.toHaveProperty('active');
    // Only while no key is Chat's, decided under the lock (00188).
    expect(rpc).toHaveBeenCalledWith('set_active_ai_provider', {
      p_organization_id: 'org1',
      p_provider: 'azure',
      p_only_if_none: true,
    });
    // Only an Anthropic key has an old copy to clear; the workspace is marked
    // to keep its key for Chat (below).
    expect(queries.map((q) => q.table)).toEqual(['organization_ai_keys', 'organizations']);
  });

  it('marks a workspace below Enterprise to keep its key for Chat while Chat is off', async () => {
    expect((await PUT(send('PUT', { provider: 'openai', apiKey: KEY }))).status).toBe(200);
    const mark = queries[queries.length - 1];
    expect(mark.table).toBe('organizations');
    expect(mark.calls).toEqual([
      ['update', { legacy_key_grandfathered: true }],
      ['eq', 'id', 'org1'],
      // Only where its plan wouldn't include own keys (CHAT-16 item 28).
      ['neq', 'plan', 'enterprise'],
    ]);
  });

  it('marks nothing once Chat is on: own keys are then Enterprise’s', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    expect((await PUT(send('PUT', { provider: 'openai', apiKey: KEY }))).status).toBe(200);
    expect(queries.map((q) => q.table)).toEqual(['organization_ai_keys']);
  });

  it("clears the Anthropic key's old copy on organizations when it is replaced", async () => {
    results = [{ error: null }, { error: null }];
    expect((await PUT(send('PUT', { provider: 'anthropic', apiKey: KEY }))).status).toBe(200);
    expect(queries[1].table).toBe('organizations');
    expect(queries[1].calls).toEqual([
      [
        'update',
        {
          anthropic_api_key_encrypted: null,
          anthropic_api_key_last4: null,
          anthropic_api_key_set_at: null,
          anthropic_api_key_set_by: null,
        },
      ],
      ['eq', 'id', 'org1'],
    ]);
  });
});

describe('PATCH', () => {
  it('switches Chat to a saved provider', async () => {
    const res = await PATCH(send('PATCH', { provider: 'google' }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('set_active_ai_provider', {
      p_organization_id: 'org1',
      p_provider: 'google',
      p_only_if_none: false,
    });
  });

  it('answers 404 for a provider without a key', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await PATCH(send('PATCH', { provider: 'google' }))).status).toBe(404);
  });
});

describe('DELETE', () => {
  const remove = (provider: string) =>
    DELETE(
      new Request(`http://localhost/api/settings/ai-providers?provider=${provider}`, {
        method: 'DELETE',
      }),
    );

  it('removes the key in one locked step that also hands Chat to another key', async () => {
    rpc.mockResolvedValue({ data: 'google', error: null });
    expect((await remove('openai')).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('remove_ai_provider_key', {
      p_organization_id: 'org1',
      p_provider: 'openai',
    });
    expect(queries).toHaveLength(0);
    // A removed key fails no more: the Admins' notices about it close.
    expect(keys.resolve).toHaveBeenCalledWith('org1', 'openai');
  });

  it("clears the Anthropic key's old copy too", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    results = [{ error: null }];
    expect((await remove('anthropic')).status).toBe(200);
    expect(queries[0].table).toBe('organizations');
    expect(queries[0].calls[0][0]).toBe('update');
  });

  it('answers 500 when the removal fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await remove('openai')).status).toBe(500);
  });

  it('refuses an unknown provider', async () => {
    expect((await remove('copilot')).status).toBe(400);
  });
});

describe('a read-only workspace (cloud, plan not active)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    org = { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers 402 subscription_inactive to saving or switching a key, and writes nothing', async () => {
    for (const res of [
      await PUT(send('PUT', { provider: 'openai', apiKey: KEY })),
      await PATCH(send('PATCH', { provider: 'google' })),
    ]) {
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({ code: 'subscription_inactive' });
    }
    expect(queries).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('still removes a key: that takes back access', async () => {
    const res = await DELETE(
      new Request('http://localhost/api/settings/ai-providers?provider=openai', {
        method: 'DELETE',
      }),
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('remove_ai_provider_key', {
      p_organization_id: 'org1',
      p_provider: 'openai',
    });
  });

  it('saves once the plan is active', async () => {
    org = { subscription_status: 'trialing', stripe_subscription_id: 'sub_1' };
    results = [{ error: null }];
    expect((await PUT(send('PUT', { provider: 'openai', apiKey: KEY }))).status).toBe(200);
  });
});

describe('own keys with Chat on (CHAT-16 items 19 and 28)', () => {
  it('tells the page what own keys do for the workspace', async () => {
    ownKeyAccess.mockResolvedValue({ state: 'kept', until: '2026-12-01T00:00:00Z' });
    results = [{ data: [], error: null }];
    expect(await (await GET()).json()).toMatchObject({
      access: { state: 'kept', until: '2026-12-01T00:00:00Z' },
    });
    expect(ownKeyAccess).toHaveBeenCalledWith('org1');
  });

  it('refuses saving or switching a key below Enterprise, and writes nothing', async () => {
    ownKeyAccess.mockResolvedValue({ state: 'locked' });
    for (const res of [
      await PUT(send('PUT', { provider: 'openai', apiKey: KEY })),
      await PATCH(send('PATCH', { provider: 'openai' })),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'own_keys_enterprise' });
    }
    expect(queries).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('saves on Enterprise', async () => {
    ownKeyAccess.mockResolvedValue({ state: 'plan' });
    results = [{ error: null }];
    expect((await PUT(send('PUT', { provider: 'openai', apiKey: KEY }))).status).toBe(200);
  });

  it('lets a kept key be replaced during its 30 days, but adds no other provider', async () => {
    ownKeyAccess.mockResolvedValue({ state: 'kept', until: '2026-12-01T00:00:00Z' });
    // The saved provider is found: replaced.
    results = [{ data: { provider: 'openai' }, error: null }, { error: null }];
    expect((await PUT(send('PUT', { provider: 'openai', apiKey: KEY }))).status).toBe(200);
    expect(queries[0].calls).toContainEqual(['eq', 'provider', 'openai']);

    // None saved for Google: refused.
    queries.length = 0;
    results = [{ data: null, error: null }];
    const res = await PUT(send('PUT', { provider: 'google', apiKey: KEY }));
    expect(res.status).toBe(403);
    expect(queries.map((q) => q.table)).toEqual(['organization_ai_keys']);
  });

  it('still removes a key below Enterprise', async () => {
    ownKeyAccess.mockResolvedValue({ state: 'locked' });
    const res = await DELETE(
      new Request('http://localhost/api/settings/ai-providers?provider=openai', {
        method: 'DELETE',
      }),
    );
    expect(res.status).toBe(200);
    expect(ownKeyAccess).not.toHaveBeenCalled();
  });
});

describe('testing a key (AGENT-OWN-KEY §5.2 item 7, §11 Q8)', () => {
  const READY = {
    state: 'ready',
    config: { provider: 'openai', apiKey: KEY, settings: {} },
    active: true,
  };
  const failing = (cls: string, status: number) => ({ outcome: 'failing', class: cls, status });

  beforeEach(() => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    ownKeyAccess.mockResolvedValue({ state: 'plan' });
    keys.test.mockReset().mockResolvedValue({ outcome: 'working' });
    keys.keep.mockReset().mockResolvedValue(0);
    keys.read.mockReset().mockResolvedValue(READY);
    keys.resume.mockReset().mockResolvedValue(0);
    keys.resolve.mockClear();
  });

  it('saves nothing for a key its test turns down, and names why under the key', async () => {
    keys.test.mockResolvedValue(failing('invalid', 401));
    const res = await PUT(send('PUT', { provider: 'openai', apiKey: KEY }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'key_invalid', field: 'apiKey' });
    expect(keys.test).toHaveBeenCalledWith({ provider: 'openai', apiKey: KEY, settings: {} });
    expect(queries).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('saves a key out of credit with the warning, and an unanswered test unchecked', async () => {
    keys.test.mockResolvedValue(failing('no_credit', 429));
    results = [{ error: null }];
    const res = await PUT(send('PUT', { provider: 'openai', apiKey: KEY }));
    expect(await res.json()).toEqual({ ok: true, check: 'no_credit', resumed: 0 });
    expect(keys.keep).toHaveBeenCalledWith('org1', 'openai', failing('no_credit', 429), {
      active: true,
    });
    // The old key's notices close first; this key's failure tells the Admins anew.
    expect(keys.resolve).toHaveBeenCalledWith('org1', 'openai');
    expect(keys.resolve.mock.invocationCallOrder[0]).toBeLessThan(
      keys.keep.mock.invocationCallOrder[0],
    );

    keys.test.mockResolvedValue({ outcome: 'unknown' });
    results = [{ error: null }];
    const unchecked = await PUT(send('PUT', { provider: 'openai', apiKey: KEY }));
    expect(await unchecked.json()).toMatchObject({ ok: true, check: 'unchecked' });
  });

  it('says how many paused agents a working key Chat uses started again', async () => {
    keys.keep.mockResolvedValue(3);
    results = [{ error: null }];
    const res = await PUT(send('PUT', { provider: 'openai', apiKey: KEY }));
    expect(await res.json()).toEqual({ ok: true, check: 'working', resumed: 3 });
  });

  it('tests a key before Chat uses it, refusing one that fails and keeping why', async () => {
    keys.read.mockResolvedValue({ ...READY, active: false });
    keys.test.mockResolvedValue(failing('model', 404));
    const res = await PATCH(send('PATCH', { provider: 'openai' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'key_model' });
    expect(rpc).not.toHaveBeenCalled();
    expect(keys.keep).toHaveBeenCalledWith('org1', 'openai', failing('model', 404), {
      active: false,
    });

    keys.test.mockResolvedValue({ outcome: 'working' });
    keys.keep.mockResolvedValue(2);
    const switched = await PATCH(send('PATCH', { provider: 'openai' }));
    expect(await switched.json()).toEqual({ ok: true, check: 'working', resumed: 2 });
    expect(keys.keep).toHaveBeenLastCalledWith(
      'org1',
      'openai',
      { outcome: 'working' },
      {
        active: true,
      },
    );
  });

  it('starts the agents its failure paused again when Chat’s key is removed', async () => {
    const remove = () =>
      DELETE(
        new Request('http://localhost/api/settings/ai-providers?provider=openai', {
          method: 'DELETE',
        }),
      );
    expect((await remove()).status).toBe(200);
    expect(keys.resume).toHaveBeenCalledWith('org1');

    keys.resume.mockClear();
    keys.read.mockResolvedValue({ ...READY, active: false });
    await remove();
    expect(keys.resume).not.toHaveBeenCalled();
  });

  it('tests a saved key for admins only, and says what it found', async () => {
    const test = (provider: unknown) =>
      TEST(
        new Request('http://localhost/api/settings/ai-providers/test', {
          method: 'POST',
          body: JSON.stringify({ provider }),
        }),
      );
    keys.keep.mockResolvedValue(4);
    expect(await (await test('openai')).json()).toEqual({
      ok: true,
      outcome: 'working',
      resumed: 4,
    });
    keys.test.mockResolvedValue(failing('no_credit', 429));
    keys.keep.mockResolvedValue(0);
    expect(await (await test('openai')).json()).toEqual({
      ok: true,
      outcome: 'failing',
      class: 'no_credit',
      resumed: 0,
    });
    keys.read.mockResolvedValue({ state: 'none', active: false });
    expect((await test('openai')).status).toBe(404);
    expect((await test('copilot')).status).toBe(400);

    profile!.role = 'manager';
    expect((await test('openai')).status).toBe(403);
  });
});

describe('the key guard (AGENT-OWN-KEY §4.3, PR 9)', () => {
  const GUARD = { capUsd: 250, usedUsd: 182.4, renewsAt: '2026-11-20T09:00:00.000Z' };
  const setGuard = (body: unknown) =>
    SET_GUARD(
      new Request('http://localhost/api/settings/ai-providers/guard', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    );

  beforeEach(() => {
    guards.read.mockResolvedValue(GUARD);
  });

  it('shows Admins the guard where Chat runs on own keys, with this month’s spend', async () => {
    for (const access of [{ state: 'plan' }, { state: 'kept', until: '2026-12-01T00:00:00Z' }]) {
      ownKeyAccess.mockResolvedValue(access);
      results = [{ data: [], error: null }];
      expect(await (await GET()).json()).toMatchObject({ guard: GUARD });
    }
    expect(guards.read).toHaveBeenCalledWith('org1');

    // The server didn't answer: the card says so.
    guards.read.mockResolvedValue(null);
    results = [{ data: [], error: null }];
    expect(await (await GET()).json()).toMatchObject({ guard: null });
  });

  it('sends it to nobody else, and nowhere own keys are off', async () => {
    ownKeyAccess.mockResolvedValue({ state: 'plan' });
    for (const role of ['manager', 'member', 'analyst']) {
      profile!.role = role;
      results = [{ data: [], error: null }];
      expect(await (await GET()).json()).not.toHaveProperty('guard');
    }
    profile!.role = 'admin';
    for (const state of ['open', 'locked']) {
      ownKeyAccess.mockResolvedValue({ state });
      results = [{ data: [], error: null }];
      expect(await (await GET()).json()).not.toHaveProperty('guard');
    }
    expect(guards.read).not.toHaveBeenCalled();
  });

  it('lets Admins only change it', async () => {
    profile!.role = 'manager';
    expect((await setGuard({ capUsd: 300 })).status).toBe(403);
    expect(queries).toHaveLength(0);
  });

  it('keeps it from $10 to $10,000', async () => {
    ownKeyAccess.mockResolvedValue({ state: 'plan' });
    for (const capUsd of [9.99, 10_000.01, 0, -5, '300', null, Number.NaN]) {
      expect((await setGuard({ capUsd })).status).toBe(400);
    }
    expect(queries).toHaveLength(0);
  });

  it('saves it to the cent, and the agent checks read it fresh', async () => {
    ownKeyAccess.mockResolvedValue({ state: 'plan' });
    results = [{ error: null }];
    guards.read.mockResolvedValue({ ...GUARD, capUsd: 400.25 });
    const res = await setGuard({ capUsd: 400.254 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, guard: { ...GUARD, capUsd: 400.25 } });
    expect(queries[0].table).toBe('chat_settings');
    expect(queries[0].calls[0]).toEqual([
      'upsert',
      { organization_id: 'org1', own_key_agent_month_usd: 400.25, updated_by: 'u1' },
      { onConflict: 'organization_id' },
    ]);
    expect(guards.forget).toHaveBeenCalledWith('org1');
  });

  it('answers 404 where own keys are off, and writes nothing', async () => {
    for (const state of ['open', 'locked']) {
      ownKeyAccess.mockResolvedValue({ state });
      expect((await setGuard({ capUsd: 300 })).status).toBe(404);
    }
    expect(queries).toHaveLength(0);
  });

  it('says unavailable before 00442, and 500 on any other failure', async () => {
    ownKeyAccess.mockResolvedValue({ state: 'plan' });
    results = [
      {
        error: {
          code: 'PGRST204',
          message: "Could not find the 'own_key_agent_month_usd' column of 'chat_settings'",
        } as { message: string },
      },
    ];
    const res = await setGuard({ capUsd: 300 });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'unavailable' });

    results = [{ error: { message: 'boom' } }];
    expect((await setGuard({ capUsd: 300 })).status).toBe(500);
    expect(guards.forget).not.toHaveBeenCalled();
  });

  it('answers 402 on a read-only workspace', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    org = { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
    ownKeyAccess.mockResolvedValue({ state: 'plan' });
    const res = await setGuard({ capUsd: 300 });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'subscription_inactive' });
    expect(queries).toHaveLength(0);
  });
});
