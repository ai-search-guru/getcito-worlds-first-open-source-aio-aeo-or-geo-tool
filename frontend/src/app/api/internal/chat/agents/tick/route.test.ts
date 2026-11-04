// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The agents' internal endpoints (W2-16): POST /api/internal/chat/agents/tick
 * and /signals, called by the API server with CHAT_INTERNAL_SECRET. Not
 * there with the new Chat off, before the secret is read; a wrong or
 * missing secret is 401, compared in constant time; a good call fires and
 * sweeps with the agent run driver, then deletes the memory lines past
 * their Undo (CHAT-14 item 23).
 */

const fakes = vi.hoisted(() => ({
  schedules: vi.fn(),
  signals: vi.fn(),
  sweep: vi.fn(),
  driver: vi.fn(),
  purge: vi.fn(),
}));
vi.mock('@/lib/chat/memory/store', () => ({ purgeDeletedMemory: fakes.purge }));
vi.mock('@/lib/chat/agentDriver', () => ({ agentRunDriver: fakes.driver }));
vi.mock('@/lib/chat/agentSweep', () => ({ sweepAgents: fakes.sweep }));
vi.mock('@/lib/chat/agentTriggers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chat/agentTriggers')>()),
  fireDueSchedules: fakes.schedules,
  fireSignals: fakes.signals,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));

const tick = await import('./route');
const signals = await import('../signals/route');

const SECRET = 'a-long-shared-secret';
const BRAND = '22222222-2222-4222-8222-222222222222';
const SIGNAL = 'cdcdcdcd-0000-4000-8000-000000000001';

const post = (
  handler: (req: Request) => Promise<Response>,
  body: unknown,
  auth: string | null = `Bearer ${SECRET}`,
) =>
  handler(
    new Request('http://localhost/api/internal/chat/agents/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body),
    }),
  );

const counts = { fired: 1, queued: 1, coalesced: 0, skipped: 0, failed: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_INTERNAL_SECRET', SECRET);
  fakes.schedules.mockResolvedValue(counts);
  fakes.signals.mockResolvedValue(counts);
  fakes.sweep.mockResolvedValue({ settled: 2 });
  fakes.purge.mockResolvedValue(3);
});

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/internal/chat/agents/tick', () => {
  it('is not there with the new Chat off, whatever the secret', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    const res = await post(tick.POST, {});
    expect(res.status).toBe(404);
    expect(fakes.schedules).not.toHaveBeenCalled();
    expect(fakes.sweep).not.toHaveBeenCalled();
  });

  it('refuses a wrong, missing or bare secret, and any secret when none is set', async () => {
    for (const auth of ['Bearer nope', `Bearer ${SECRET}x`, SECRET, null]) {
      expect((await post(tick.POST, {}, auth)).status).toBe(401);
    }
    vi.stubEnv('CHAT_INTERNAL_SECRET', '');
    expect((await post(tick.POST, {}, 'Bearer ')).status).toBe(401);
    expect(fakes.schedules).not.toHaveBeenCalled();
  });

  it('compares the secret in constant time', async () => {
    const crypto = await import('node:crypto');
    const spy = vi.spyOn(crypto.default, 'timingSafeEqual');
    const { internalSecretMatches } = await import('@/lib/chat/internalCall');
    expect(internalSecretMatches(SECRET, `${SECRET.slice(0, -1)}y`)).toBe(false);
    expect(internalSecretMatches(SECRET, SECRET)).toBe(true);
    expect(internalSecretMatches(SECRET, 'short')).toBe(false);
    expect(internalSecretMatches(undefined, SECRET)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('fires the due schedules, then sweeps, with the agent run driver, then purges memory', async () => {
    const res = await post(tick.POST, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      schedules: counts,
      sweep: { settled: 2 },
      memory: { purged: 3 },
    });
    expect(fakes.schedules).toHaveBeenCalledWith(expect.any(Date), fakes.driver);
    expect(fakes.sweep).toHaveBeenCalledWith(expect.any(Date), fakes.driver);
    expect(fakes.purge).toHaveBeenCalledWith(expect.any(Date));
  });

  it('runs one job when asked, and refuses an unknown one', async () => {
    const res = await post(tick.POST, { jobs: ['sweep'] });
    expect(await res.json()).toEqual({
      ok: true,
      schedules: null,
      sweep: { settled: 2 },
      memory: null,
    });
    expect(fakes.schedules).not.toHaveBeenCalled();
    expect(fakes.purge).not.toHaveBeenCalled();
    expect((await post(tick.POST, { jobs: ['kpi'] })).status).toBe(400);
  });

  it('runs the sweep when the schedules fail, and answers 500 naming the job that failed', async () => {
    fakes.schedules.mockRejectedValue(new Error('db down'));
    const res = await post(tick.POST, {});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'failed',
      failed: ['schedules'],
      schedules: null,
      sweep: { settled: 2 },
      memory: { purged: 3 },
    });
    expect(fakes.sweep).toHaveBeenCalled();

    fakes.schedules.mockResolvedValue(counts);
    fakes.sweep.mockRejectedValue(new Error('db down'));
    expect(await (await post(tick.POST, {})).json()).toMatchObject({
      failed: ['sweep'],
      schedules: counts,
    });
  });
});

describe('POST /api/internal/chat/agents/signals', () => {
  const batch = {
    brandId: BRAND,
    signals: [
      {
        id: SIGNAL,
        kind: 'lost_citation',
        definitions: [{ id: 'recover_lost_citations', category: 'recover' }],
        urls: ['/pricing'],
        engines: ['chatgpt'],
      },
    ],
  };

  it('is not there with the new Chat off, and refuses a wrong secret', async () => {
    vi.stubEnv('CHAT_AGENTIC', '');
    expect((await post(signals.POST, batch)).status).toBe(404);
    vi.stubEnv('CHAT_AGENTIC', 'true');
    expect((await post(signals.POST, batch, 'Bearer nope')).status).toBe(401);
    expect(fakes.signals).not.toHaveBeenCalled();
  });

  it('fires the triggers the new signals match', async () => {
    const res = await post(signals.POST, batch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fired: counts });
    expect(fakes.signals).toHaveBeenCalledWith(batch, expect.any(Date), fakes.driver);
  });

  it('refuses a batch that doesn’t read', async () => {
    for (const body of [
      {},
      { brandId: 'x', signals: [] },
      { ...batch, signals: [{ id: SIGNAL }] },
    ]) {
      expect((await post(signals.POST, body)).status).toBe(400);
    }
    expect(fakes.signals).not.toHaveBeenCalled();
  });
});
