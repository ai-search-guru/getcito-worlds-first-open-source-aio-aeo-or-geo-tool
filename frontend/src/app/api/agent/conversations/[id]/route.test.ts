// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * One Agent Chat conversation: read and deleted as before while the new Chat
 * is off, and gone (404) where it is on for the workspace (CHAT_AGENTIC).
 */

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const query = {
        select: () => query,
        delete: () => query,
        eq: () => query,
        order: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: { id: 'conversation-1' }, error: null }),
        // A delete awaits the query itself: one row went.
        then: (resolve: (value: { error: null; count: number }) => void) =>
          resolve({ error: null, count: 1 }),
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
  }),
}));

const { GET, DELETE } = await import('./route');

const params = { params: Promise.resolve({ id: 'conversation-1' }) };
const request = (method: string) =>
  new Request('http://localhost/api/agent/conversations/conversation-1', { method });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/agent/conversations/[id]', () => {
  it('reads and deletes a conversation while the new Chat is off', async () => {
    const read = await GET(request('GET'), params);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ conversation: { id: 'conversation-1' }, messages: [] });
    const deleted = await DELETE(request('DELETE'), params);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
  });

  it('answers 404 to both where the new Chat is on for the workspace', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    const read = await GET(request('GET'), params);
    expect(read.status).toBe(404);
    expect(await read.json()).toEqual({ error: 'Not found' });
    const deleted = await DELETE(request('DELETE'), params);
    expect(deleted.status).toBe(404);
    expect(await deleted.json()).toEqual({ error: 'Not found' });
  });

  it('answers as before where CHAT_AGENTIC_ORGS leaves the workspace out', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2');
    expect((await GET(request('GET'), params)).status).toBe(200);
    expect((await DELETE(request('DELETE'), params)).status).toBe(200);
  });
});
