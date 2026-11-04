// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The staff Debug endpoint (CHAT-03 items 25–26; W1-15): not there while the
 * new Chat is off; 401 without a session; 403 for anyone who isn't GetCito
 * staff, a customer's Admin too; for staff, the answer's debug record, and
 * a step's whole output as a download, in their own workspace only. Each
 * staff view is logged, with the workspace.
 */

const auth = vi.hoisted(() => ({
  user: null as { id: string; email: string; email_confirmed_at: string | null } | null,
  org: '77777777-7777-4777-8777-777777777777' as string | null,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: auth.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: auth.org ? { organization_id: auth.org } : null,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/engine', () => ({ driveRun: vi.fn() }));
vi.mock('@/lib/chat/staffDebug', () => ({
  readChatMessageDebug: vi.fn(async (id: string, viewer: { organizationId: string }) =>
    id === MESSAGE && viewer.organizationId === ORG
      ? {
          status: 'done',
          model: 'auto',
          effort: 'normal',
          error: null,
          steps: [{ n: 1, tool: 'list_citations', input: { days: 30 } }],
          modelCalls: [{ n: null, model: 'claude-haiku-4-5', costUsd: 0.0012 }],
          totals: { inputTokens: 1800, outputTokens: 60, costUsd: 0.0012 },
        }
      : null,
  ),
  readChatStepOutput: vi.fn(async (id: string, viewer: { organizationId: string }, n: number) =>
    id === MESSAGE && viewer.organizationId === ORG && n === 1 ? '{\n  "rows": []\n}' : null,
  ),
}));

const { GET } = await import('./route');
const { readChatMessageDebug } = await import('@/lib/chat/staffDebug');

const MESSAGE = '55555555-5555-4555-8555-555555555555';
const ORG = '77777777-7777-4777-8777-777777777777';
const CONFIRMED = '2026-10-01T09:00:00.000Z';
const STAFF = { id: 'staff-1', email: 'ops@getcito.com', email_confirmed_at: CONFIRMED };
const ADMIN = { id: 'admin-1', email: 'admin@customer.com', email_confirmed_at: CONFIRMED };

const get = (id: string, query = '') =>
  GET(new Request(`https://app.example.com/api/internal/chat/messages/${id}/debug${query}`), {
    params: Promise.resolve({ id }),
  });

let info: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('STAFF_EMAILS', 'ops@getcito.com');
  auth.user = STAFF;
  auth.org = ORG;
  vi.mocked(readChatMessageDebug).mockClear();
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  info.mockRestore();
});

describe('GET /api/internal/chat/messages/{id}/debug', () => {
  it('is not there while the new Chat is off', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect((await get(MESSAGE)).status).toBe(404);
    expect(readChatMessageDebug).not.toHaveBeenCalled();
  });

  it("is not there for staff whose workspace doesn't have the new Chat (CHAT_AGENTIC_ORGS)", async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', '99999999-9999-4999-8999-999999999999');
    expect((await get(MESSAGE)).status).toBe(404);
    expect((await get(MESSAGE, '?full=1')).status).toBe(404);
    expect(readChatMessageDebug).not.toHaveBeenCalled();
    vi.stubEnv('CHAT_AGENTIC_ORGS', ORG);
    expect((await get(MESSAGE)).status).toBe(200);
  });

  it('asks for a session first', async () => {
    auth.user = null;
    expect((await get(MESSAGE)).status).toBe(401);
  });

  it('refuses a customer, their Admin too, with 403 and nothing of the record', async () => {
    auth.user = ADMIN;
    const res = await get(MESSAGE);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: 'forbidden' });
    expect(JSON.stringify(body)).not.toMatch(/list_citations|claude|cost/i);
    expect(readChatMessageDebug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();

    // A staff address not yet confirmed isn't staff.
    auth.user = { ...STAFF, email_confirmed_at: null };
    expect((await get(MESSAGE)).status).toBe(403);
  });

  it('gives staff the debug record, and logs who looked', async () => {
    const res = await get(MESSAGE);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.debug.steps[0].tool).toBe('list_citations');
    expect(body.debug.modelCalls[0].costUsd).toBe(0.0012);
    expect(readChatMessageDebug).toHaveBeenCalledWith(MESSAGE, {
      userId: 'staff-1',
      organizationId: ORG,
    });
    expect(info).toHaveBeenCalledWith('[chat/debug] staff view', {
      staffUserId: 'staff-1',
      organizationId: ORG,
      id: MESSAGE,
    });
  });

  it("finds nothing outside the staff member's own workspace (404)", async () => {
    auth.org = '88888888-8888-4888-8888-888888888888';
    const res = await get(MESSAGE);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toMatch(/list_citations|claude|cost/i);
    expect((await get(MESSAGE, '?full=1')).status).toBe(404);
    // Without a workspace, nothing is theirs.
    auth.org = null;
    expect((await get(MESSAGE)).status).toBe(404);
  });

  it("gives a step's whole output as a download, and 404 for what isn't there", async () => {
    const res = await get(MESSAGE, '?full=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="step-1-output.json"',
    );
    expect(await res.text()).toBe('{\n  "rows": []\n}');
    expect((await get(MESSAGE, '?full=2')).status).toBe(404);
    expect((await get(MESSAGE, '?full=x')).status).toBe(404);
    expect((await get('66666666-6666-4666-8666-666666666666')).status).toBe(404);
    expect((await get('not-an-id')).status).toBe(404);
  });
});
