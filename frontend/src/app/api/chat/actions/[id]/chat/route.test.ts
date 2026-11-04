// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * Run with Chat on an Action Center action (W2-17): not there with Chat
 * off, the plan first, then the person's chat on the action, driven past
 * the answer; refusals as values (#1777).
 */

const state = vi.hoisted(() => ({ on: true, readOnly: false }));
const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const CTX = { actor: ACTOR, viewer: { userId: 'user-1', role: 'manager', brandAccess: 'all' } };
const ACTION = 'acacacac-0000-4000-8000-000000000001';

const fakes = vi.hoisted(() => ({
  start: vi.fn(),
  drive: vi.fn(async () => {}),
  after: vi.fn((task: () => unknown) => void task()),
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: fakes.after,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/engine', () => ({ driveRun: fakes.drive }));
vi.mock('@/lib/chat/actionChat', () => ({ startActionChat: fakes.start }));
vi.mock('@/lib/chat/agents', async (original) => ({
  ...(await original<typeof import('@/lib/chat/agents')>()),
  readAgentContext: vi.fn(async () => CTX),
}));
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

const route = await import('./route');
const { refused } = await import('@/lib/chat/agents');

const call = (id = ACTION, body: unknown = { timezone: 'Europe/Istanbul' }) =>
  route.POST(
    new Request(`https://app.example.com/api/chat/actions/${id}/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  fakes.start.mockResolvedValue({
    ok: true,
    value: { runId: 'run-1', conversationId: 'chat-1', queued: false, repeated: false },
  });
});

afterEach(() => {
  state.on = true;
  state.readOnly = false;
});

describe('/api/chat/actions/{id}/chat', () => {
  it('starts the person’s chat on the action and drives it past the answer', async () => {
    const res = await call();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      ok: true,
      chatId: 'chat-1',
      queued: false,
      repeated: false,
    });
    expect(fakes.start).toHaveBeenCalledWith(CTX, ACTION, { timezone: 'Europe/Istanbul' });
    expect(fakes.after).toHaveBeenCalledTimes(1);
    expect(fakes.drive).toHaveBeenCalledWith(ACTOR, 'run-1');
  });

  it('answers a second click with the same chat and drives nothing more', async () => {
    fakes.start.mockResolvedValueOnce({
      ok: true,
      value: { runId: null, conversationId: 'chat-1', queued: false, repeated: true },
    });
    const res = await call();
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ chatId: 'chat-1', repeated: true });
    expect(fakes.after).not.toHaveBeenCalled();
    expect(fakes.drive).not.toHaveBeenCalled();
  });

  it('is not there with Chat off, and checks the plan before anything else', async () => {
    state.on = false;
    expect((await call()).status).toBe(404);
    state.on = true;
    state.readOnly = true;
    expect((await call()).status).toBe(402);
    expect(fakes.start).not.toHaveBeenCalled();
  });

  it('refuses a bad id or body, a closed action and the engine’s limits as values', async () => {
    expect((await call('nope')).status).toBe(404);
    expect((await call(ACTION, { timezone: 5 })).status).toBe(400);
    fakes.start.mockResolvedValueOnce(refused('action_closed'));
    const closed = await call();
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ ok: false, code: 'action_closed' });
    fakes.start.mockResolvedValueOnce({
      ok: false,
      engine: { ok: false, status: 429, code: 'rate_limited', message: 'Too many' },
    });
    const busy = await call();
    expect(busy.status).toBe(429);
    expect(await busy.json()).toMatchObject({ ok: false, failure: 'busy', code: 'rate_limited' });
    expect(fakes.drive).not.toHaveBeenCalled();
  });
});
