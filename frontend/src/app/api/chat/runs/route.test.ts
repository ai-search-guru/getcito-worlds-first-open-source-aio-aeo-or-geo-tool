// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/chat/runs and the run routes (C3): not there while the new Chat
 * is off for the workspace (404), the server's own 402 body while it is
 * read-only or the chat is the demo brand's, and a run's events as Server-Sent Events with the chat and run
 * in headers, never in an event.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';

const state = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'me@example.com' } as { id: string; email: string } | null,
  org: '11111111-1111-4111-8111-111111111111' as string | null,
  reads: 0,
  /** The chat's row, as the demo check reads its brand. */
  chat: null as { brand_id: string } | null,
  /** The brand's row, as readBrandIsDemo reads it. */
  brand: { is_demo: false },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        state.reads += 1;
        return { data: { user: state.user } };
      },
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data:
            table === 'chat_conversations'
              ? state.chat
              : table === 'brands'
                ? state.brand
                : { organization_id: state.org },
          error: null,
        }),
      };
      return chain;
    },
  },
}));
const engine = vi.hoisted(() => ({
  startChatRun: vi.fn(),
  driveRun: vi.fn(async () => {}),
  prepareResume: vi.fn(),
  stopChatRun: vi.fn(),
}));
vi.mock('@/lib/chat/engine', () => engine);
vi.mock('@/lib/chat/engineStore', () => ({
  STORED_EVENTS: {
    readEvents: async () => [
      { type: 'text.delta', seq: 1, data: { text: 'Hi' } },
      {
        type: 'run.finished',
        seq: 2,
        data: {
          workingMs: 1,
          stepCount: 0,
          sources: [],
          generatedAt: '2026-10-29T09:00:00.000Z',
          dataAsOf: null,
        },
      },
    ],
    isWorking: async () => false,
  },
}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}));

const { POST } = await import('./route');
const { POST: ANSWER } = await import('./[id]/answer/route');
const { POST: APPROVE } = await import('./[id]/approve/route');
const { POST: STOP } = await import('./[id]/stop/route');

const post = (body: unknown) =>
  new Request('http://localhost/api/chat/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'user-1', email: 'me@example.com' };
  state.org = ORG;
  state.chat = null;
  state.brand = { is_demo: false };
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('the run routes', () => {
  it('are not there while Chat is off for the workspace', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    state.reads = 0;
    const res = await POST(post({ message: 'Hi' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, failure: 'not_found' });
    expect((await STOP(new Request('http://localhost'), params(RUN))).status).toBe(404);
    expect(engine.startChatRun).not.toHaveBeenCalled();
    // Off for the deployment: not even the session is read.
    expect(state.reads).toBe(0);
    // Off for this workspace only: found out from its profile, still 404.
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '99999999-9999-4999-8999-999999999999');
    expect((await POST(post({ message: 'Hi' }))).status).toBe(404);
    expect(engine.startChatRun).not.toHaveBeenCalled();
  });

  it('ask for a session', async () => {
    state.user = null;
    expect((await POST(post({ message: 'Hi' }))).status).toBe(401);
  });

  it("answer a read-only workspace with the server's 402 body", async () => {
    engine.startChatRun.mockResolvedValue({
      ok: false,
      status: 402,
      code: 'subscription_inactive',
      message: 'read-only',
    });
    const res = await POST(post({ message: 'Hi' }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      ok: false,
      code: 'subscription_inactive',
      error: 'plan_limit',
    });

    engine.prepareResume.mockResolvedValue({
      ok: false,
      status: 402,
      code: 'subscription_inactive',
      message: 'read-only',
    });
    const approve = await APPROVE(post({ n: 1, digest: 'a'.repeat(32) }), params(RUN));
    expect(approve.status).toBe(402);
  });

  it("answer a message on the demo brand with the server's 402 body, before anything runs", async () => {
    // In a sample chat of the demo brand (the server's lib/demo/chat.js).
    state.chat = { brand_id: 'demo-brand' };
    state.brand = { is_demo: true };
    const res = await POST(
      post({ message: 'And on Gemini?', conversationId: '44444444-4444-4444-8444-444444444444' }),
    );
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ ok: false, code: 'demo_brand', error: 'demo_brand' });
    // A new chat on it.
    state.chat = null;
    expect((await POST(post({ message: 'Hi', brandId: 'demo-brand' }))).status).toBe(402);
    expect(engine.startChatRun).not.toHaveBeenCalled();

    // Another brand's chat goes on to the engine.
    state.brand = { is_demo: false };
    engine.startChatRun.mockResolvedValue({
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'x',
    });
    expect((await POST(post({ message: 'Hi', brandId: 'own-brand' }))).status).toBe(404);
    expect(engine.startChatRun).toHaveBeenCalledTimes(1);
  });

  it('stream the run as Server-Sent Events, its ids in headers only', async () => {
    engine.startChatRun.mockResolvedValue({
      ok: true,
      runId: RUN,
      conversationId: ORG,
      queued: false,
    });
    const res = await POST(post({ message: 'Hi' }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-chat-run')).toBe(RUN);
    expect(res.headers.get('x-chat-conversation')).toBe(ORG);
    const body = await res.text();
    expect(body).toContain('id: 1\nevent: text.delta\ndata: {"type":"text.delta","seq":1');
    expect(body).toContain('event: run.finished');
    expect(body).not.toContain(RUN);
    expect(engine.driveRun).toHaveBeenCalledWith(
      { userId: 'user-1', email: 'me@example.com', organizationId: ORG },
      RUN,
      undefined,
    );
  });

  it('refuse a message or a typed answer that holds an API key, unread and unlogged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const key = `sk-ant-api03-${'a1B2'.repeat(10)}`;
    const res = await POST(post({ message: `Use this key ${key}` }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: 'api_key' });
    expect(engine.startChatRun).not.toHaveBeenCalled();

    const answer = await ANSWER(post({ n: 1, selected: [], other: key }), params(RUN));
    expect(answer.status).toBe(400);
    expect(engine.prepareResume).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(key);
    log.mockRestore();

    // A message without one starts as before.
    engine.startChatRun.mockResolvedValue({ ok: false, status: 429, code: 'busy', message: 'x' });
    expect((await POST(post({ message: 'Why did sk-learn pages drop?' }))).status).toBe(429);
    expect(engine.startChatRun).toHaveBeenCalledTimes(1);
  });

  it('refuse a run id that isn’t one', async () => {
    expect((await STOP(new Request('http://localhost'), params('nope'))).status).toBe(404);
    expect(engine.stopChatRun).not.toHaveBeenCalled();
  });
});
