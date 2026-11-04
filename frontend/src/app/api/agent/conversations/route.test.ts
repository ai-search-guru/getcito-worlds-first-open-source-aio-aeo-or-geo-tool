// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/agent/conversations on a read-only workspace (GetCito Cloud, plan not
 * active): starting a conversation answers 402 subscription_inactive, as a
 * chat turn does; the list stays open.
 */

let status: string | null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: async () => ({ data: [{ id: 'conversation-1' }], error: null }),
        maybeSingle: async () => ({
          data: table === 'organizations' ? { subscription_status: status, plan: 'starter' } : null,
          error: null,
        }),
      };
      return query;
    },
  },
}));
vi.mock('@/lib/agent/auth', () => ({
  resolveAgentAuth: async () => ({
    userId: 'user-1',
    email: 'a@example.com',
    organizationId: 'org-1',
    apiKeyId: 'agent-internal',
    brandAccess: 'all',
  }),
}));
// No key: past the gates, starting a conversation answers missing_ai_key.
vi.mock('@/lib/agent/key', () => ({ isAgentKeyConfigured: async () => false }));

const { GET, POST } = await import('./route');

const start = () =>
  POST(
    new Request('http://localhost/api/agent/conversations', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  );

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  status = 'canceled';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/agent/conversations', () => {
  it('answers 402 subscription_inactive to a new conversation while read-only', async () => {
    const res = await start();
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: 'plan_limit',
      code: 'subscription_inactive',
    });
  });

  it('keeps the list open while read-only', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ conversations: [{ id: 'conversation-1' }] });
  });

  it('goes on to the key check once the plan is active', async () => {
    status = 'trialing';
    const res = await start();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'missing_ai_key' });
  });

  it('never gates self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    const res = await start();
    expect(res.status).toBe(403);
  });
});

// With the new Chat on for the workspace (CHAT_AGENTIC), Agent Chat's API is
// gone: its chats are the new Chat's now.
describe('/api/agent/conversations with the new Chat on', () => {
  it('answers 404 to the list and to a new conversation', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    const list = await GET();
    expect(list.status).toBe(404);
    expect(await list.json()).toEqual({ error: 'Not found' });
    const res = await start();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('answers as before where CHAT_AGENTIC_ORGS leaves the workspace out', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2');
    expect((await GET()).status).toBe(200);
    expect((await start()).status).toBe(402);
  });
});
