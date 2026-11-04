// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/mcp/content-opportunities/[id]/brief: a brief costs AI, so a key
 * whose user isn't an admin or a manager (generateBriefFor's own check)
 * answers 403 with the reason.
 */

const { generateBriefFor } = vi.hoisted(() => ({ generateBriefFor: vi.fn() }));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    role: 'analyst',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/mcp/data', () => ({ generateBriefFor }));

const { POST } = await import('./route');
const { RoleRequiredError, MANAGER_ROLES } = await import('@/lib/mcp/roleGate');

const post = () =>
  POST(
    new Request('http://localhost/api/mcp/content-opportunities/opp-1/brief', { method: 'POST' }),
    {
      params: Promise.resolve({ id: 'opp-1' }),
    },
  );

beforeEach(() => {
  generateBriefFor.mockReset();
});

describe('POST /api/mcp/content-opportunities/[id]/brief', () => {
  it("answers 403 with the reason for an analyst's key", async () => {
    generateBriefFor.mockRejectedValue(new RoleRequiredError(MANAGER_ROLES, 'analyst'));
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden', code: 'role_required' });
  });

  it('answers the brief otherwise', async () => {
    generateBriefFor.mockResolvedValue({ brief: { title: 'x' } });
    expect((await post()).status).toBe(200);
  });
});
