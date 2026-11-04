// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from './testing/chatFixtures';

/**
 * Run with Chat on an Action Center action (CHAT-21 §F item 27; W2-17): the
 * person's own Chat run on the action, in their default mode, scoped to it
 * like Ask about this, and one "Chat started on this action" line in its
 * History. Admins and Managers only. The Chat engine is a stand-in here.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
const fakes = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('./engine', () => ({ startChatRun: fakes.start }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const agents = await import('./agents');
const { startActionChat, ACTION_CENTER_PAGE } = await import('./actionChat');

const ACTION = 'acacacac-0000-4000-8000-000000000001';
const ctxOf = async (userId: string) =>
  (await agents.readAgentContext({ userId, email: null, organizationId: ORG }))!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seedWorkspace(db);
  db.tables.brands = [{ id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false }];
  db.tables.actions = [
    {
      id: ACTION,
      action_no: 1261,
      brand_id: BRAND,
      category: 'growth',
      kind: 'prompt_improve',
      status: 'new',
      payload: { title: 'Add FAQ to /pricing' },
      deleted_at: null,
    },
  ];
  db.tables.action_tasks = [];
  db.tables.action_events = [];
  db.tables.chat_user_prefs = [];
  db.rpcs = { action_entity_counts: () => [] };
  // History lines are stamped as the database stamps them.
  db.defaults = { ...db.defaults, action_events: () => ({ created_at: new Date().toISOString() }) };
  fakes.start.mockResolvedValue({
    ok: true,
    runId: 'run-1',
    conversationId: 'chat-1',
    queued: false,
  });
});

afterEach(() => vi.unstubAllEnvs());

describe('Run with Chat', () => {
  it('starts the person’s chat on the action, its title as data only, tainted, and writes it to its History', async () => {
    db.tables.chat_user_prefs.push({ user_id: PEOPLE.manager, default_mode: 'ask_first' });
    const result = await startActionChat(await ctxOf(PEOPLE.manager), ACTION, {
      timezone: 'Europe/Istanbul',
    });
    expect(result).toEqual({
      ok: true,
      value: { runId: 'run-1', conversationId: 'chat-1', queued: false, repeated: false },
    });
    expect(fakes.start).toHaveBeenCalledWith(
      { userId: PEOPLE.manager, email: null, organizationId: ORG },
      {
        // The instruction channel names the action by number and category only.
        message: expect.stringContaining('AC-1261 (Growth)'),
        brandId: BRAND,
        mode: 'ask_first',
        timezone: 'Europe/Istanbul',
        origin: 'panel',
        originPage: ACTION_CENTER_PAGE,
        context: {
          route: ACTION_CENTER_PAGE,
          chips: [
            { key: 'brand', label: 'Brand A', value: BRAND },
            { key: 'action', label: 'Action · Add FAQ to /pricing', value: ACTION },
          ],
        },
        references: [{ type: 'task', id: ACTION, label: 'Add FAQ to /pricing' }],
      },
      { tainted: true, scopeUntrusted: true },
    );
    expect(fakes.start.mock.calls[0][1].message).not.toContain('Add FAQ to /pricing');
    expect(db.tables.action_events).toEqual([
      {
        action_id: ACTION,
        id: expect.any(String),
        event: 'chat_started',
        actor_id: PEOPLE.manager,
        created_at: expect.any(String),
        data: { source: 'chat', conversation_id: 'chat-1' },
      },
    ]);
  });

  it('opens the same chat for a second click within 60 seconds, and one chat for two at once', async () => {
    const ctx = await ctxOf(PEOPLE.manager);
    const [a, b] = await Promise.all([startActionChat(ctx, ACTION), startActionChat(ctx, ACTION)]);
    expect(fakes.start).toHaveBeenCalledTimes(1);
    const values = [a, b].map((r) => (r.ok ? r.value : null));
    expect(values.map((v) => v?.conversationId)).toEqual(['chat-1', 'chat-1']);
    // Only the first click drives its run.
    expect(values.map((v) => v?.runId).sort()).toEqual([null, 'run-1']);
    expect(db.tables.action_events).toHaveLength(1);

    // Later, in another minute but within 60 seconds of the first: the same chat.
    const later = await startActionChat(ctx, ACTION, {}, new Date(Date.now() + 45_000));
    expect(later).toMatchObject({
      ok: true,
      value: { conversationId: 'chat-1', runId: null, repeated: true },
    });
    expect(fakes.start).toHaveBeenCalledTimes(1);
  });

  it('starts in Auto, ask before changes without a saved mode, and never in a Full auto the plan lacks', async () => {
    await startActionChat(await ctxOf(PEOPLE.admin), ACTION);
    expect(fakes.start.mock.calls[0][1]).toMatchObject({ mode: 'auto' });
    db.tables.action_events = [];
    db.tables.chat_idempotency_keys = [];
    db.tables.chat_user_prefs.push({ user_id: PEOPLE.admin, default_mode: 'full_auto' });
    db.tables.organizations[0].plan = 'starter';
    await startActionChat(await ctxOf(PEOPLE.admin), ACTION);
    expect(fakes.start.mock.calls[1][1]).toMatchObject({ mode: 'auto' });
  });

  it('refuses Analysts and Agency partners with the out-of-permission answer, and a closed action', async () => {
    expect(await startActionChat(await ctxOf(PEOPLE.analyst), ACTION)).toMatchObject({
      ok: false,
      refusal: {
        kind: 'denied',
        code: 'forbidden_role',
        denial: { asked: 'You asked: Run Chat on an Action Center action.' },
      },
    });
    const PARTNER = 'aaaaaaaa-0000-4000-8000-000000000005';
    db.tables.profiles.push({
      id: PARTNER,
      role: 'agency_partner',
      organization_id: ORG,
      brand_scope: 'all',
    });
    expect(await startActionChat(await ctxOf(PARTNER), ACTION)).toMatchObject({
      ok: false,
      refusal: { kind: 'denied', code: 'forbidden_role' },
    });
    db.tables.actions[0].status = 'completed';
    expect(await startActionChat(await ctxOf(PEOPLE.manager), ACTION)).toMatchObject({
      ok: false,
      refusal: { code: 'action_closed' },
    });
    expect(fakes.start).not.toHaveBeenCalled();
    expect(db.tables.action_events).toEqual([]);
  });

  it('answers the engine’s refusal, writes nothing, and lets the next click try again', async () => {
    fakes.start.mockResolvedValueOnce({
      ok: false,
      status: 429,
      code: 'rate_limited',
      message: 'Too many',
    });
    const ctx = await ctxOf(PEOPLE.manager);
    expect(await startActionChat(ctx, ACTION)).toEqual({
      ok: false,
      engine: { ok: false, status: 429, code: 'rate_limited', message: 'Too many' },
    });
    expect(db.tables.action_events).toEqual([]);
    expect(await startActionChat(ctx, ACTION)).toMatchObject({ ok: true });
    expect(fakes.start).toHaveBeenCalledTimes(2);
  });
});
