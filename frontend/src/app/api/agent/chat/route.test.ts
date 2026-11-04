// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/agent/chat on a read-only workspace (GetCito Cloud, plan not
 * active): a chat turn is an action, so it answers 402 subscription_inactive
 * before anything else; an active plan, or self-hosted, goes on to the
 * conversation check.
 */

let status: string | null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        // No conversation: past the gate, the route answers 404.
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
vi.mock('@/lib/agent/tools', () => ({ buildAgentTools: vi.fn() }));
vi.mock('@/lib/agent/model', () => ({ AGENT_PROVIDER_OPTIONS: {}, buildAgentModel: vi.fn() }));
vi.mock('@/lib/agent/key', () => ({ resolveAgentModelConfig: vi.fn() }));
vi.mock('@/lib/agent/tokenQuota', () => ({ recordAgentTokenUsage: vi.fn() }));
vi.mock('@/lib/agent/systemPrompt', () => ({ buildAgentSystemPrompt: vi.fn() }));

const { POST } = await import('./route');

const chat = () =>
  POST(
    new Request('http://localhost/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conversation-1',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      }),
    }),
  );

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  status = 'canceled';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/agent/chat', () => {
  it('answers 402 subscription_inactive while the workspace is read-only', async () => {
    const res = await chat();
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: 'plan_limit',
      code: 'subscription_inactive',
      message: expect.any(String),
    });
  });

  it('goes on to the conversation once the plan is active', async () => {
    status = 'active';
    const res = await chat();
    expect(res.status).toBe(404);
  });

  it('never gates self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    const res = await chat();
    expect(res.status).toBe(404);
  });
});

// With the new Chat on for the workspace (CHAT_AGENTIC), Agent Chat's API is
// gone: an old tab can't run a turn on the workspace's own key past its rules.
describe('POST /api/agent/chat with the new Chat on', () => {
  it('answers 404 before anything else', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    const res = await chat();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('answers as before where CHAT_AGENTIC_ORGS leaves the workspace out', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2');
    const res = await chat();
    expect(res.status).toBe(402);
  });
});
