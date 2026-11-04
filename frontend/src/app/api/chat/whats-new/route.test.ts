// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/chat/whats-new (W4-20): What's new for the person's plan, and
 * marking entries read; nothing while Chat is off.
 */

const state = vi.hoisted(() => ({ on: true }));
const readWhatsNew = vi.hoisted(() =>
  vi.fn(async (params: unknown) => ({
    params,
    items: [{ slug: 'agent-center', read: false }],
    hasUnread: true,
    more: false,
    planName: 'Starter',
  })),
);
const markWhatsNewRead = vi.hoisted(() => vi.fn(async (...args: unknown[]) => args.length > 0));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/whats-new/reads', () => ({ readWhatsNew, markWhatsNewRead }));
vi.mock('@/lib/chat/runApi', async (original) => {
  const actual = await original<typeof import('@/lib/chat/runApi')>();
  return {
    ...actual,
    chatActor: async () =>
      state.on
        ? { userId: 'u1', email: null, organizationId: 'org-1' }
        : actual.runFailure(404, 'not_found', 'not_found', 'Not found'),
  };
});

const { GET } = await import('./route');
const { POST } = await import('./read/route');
const URL_BASE = 'https://app.example.com/api/chat/whats-new';
const post = (body: unknown) =>
  POST(new Request(`${URL_BASE}/read`, { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  state.on = true;
  readWhatsNew.mockClear();
  markWhatsNewRead.mockClear();
});

describe('GET /api/chat/whats-new', () => {
  it('answers the person’s entries, with the dot’s hasUnread', async () => {
    const res = await GET(new Request(`${URL_BASE}?unread=true&limit=1&days=14`));
    expect(await res.json()).toEqual({
      ok: true,
      entries: [{ slug: 'agent-center', read: false }],
      hasUnread: true,
      more: false,
    });
    expect(readWhatsNew).toHaveBeenCalledWith({
      userId: 'u1',
      organizationId: 'org-1',
      unreadOnly: true,
      limit: 1,
      days: 14,
    });
  });

  it('leaves out a bad parameter, and reads nothing while Chat is off', async () => {
    await GET(new Request(`${URL_BASE}?limit=500&days=x`));
    expect(readWhatsNew).toHaveBeenCalledWith(
      expect.objectContaining({ unreadOnly: false, limit: undefined, days: undefined }),
    );
    state.on = false;
    expect((await GET(new Request(URL_BASE))).status).toBe(404);
    expect(readWhatsNew).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/chat/whats-new/read', () => {
  it('marks the entries read for the person', async () => {
    const res = await post({ slugs: ['agent-center'] });
    expect(await res.json()).toEqual({ ok: true });
    expect(markWhatsNewRead).toHaveBeenCalledWith('u1', ['agent-center']);
  });

  it('refuses a body that isn’t one, and answers a failure as a value', async () => {
    expect((await post({ slugs: [] })).status).toBe(400);
    expect((await post({ nope: true })).status).toBe(400);
    markWhatsNewRead.mockResolvedValueOnce(false);
    expect((await post({ slugs: ['agent-center'] })).status).toBe(500);
  });
});
