// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PATCH /api/mcp/content-opportunities/[id]/status: a change the key's role
 * doesn't allow (updateOpportunityStatusFor's own check) answers 403 with the
 * reason; any other failure is still a 500.
 */

const { updateOpportunityStatusFor } = vi.hoisted(() => ({
  updateOpportunityStatusFor: vi.fn(),
}));
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
vi.mock('@/lib/mcp/data', () => ({
  CONTENT_OPPORTUNITY_STATUSES: ['new', 'reviewed', 'sent', 'in_progress', 'done', 'dismissed'],
  updateOpportunityStatusFor,
}));

const { PATCH } = await import('./route');
const { RoleRequiredError, MANAGER_ROLES } = await import('@/lib/mcp/roleGate');

const patch = (status: string) =>
  PATCH(
    new Request('http://localhost/api/mcp/content-opportunities/opp-1/status', {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id: 'opp-1' }) },
  );

beforeEach(() => {
  updateOpportunityStatusFor.mockReset();
});

describe('PATCH /api/mcp/content-opportunities/[id]/status', () => {
  it('answers 403 with the reason when the role may not make the change', async () => {
    updateOpportunityStatusFor.mockRejectedValue(new RoleRequiredError(MANAGER_ROLES, 'analyst'));
    const res = await patch('dismissed');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'forbidden',
      code: 'role_required',
      message:
        'Only an admin or a manager can do this. This API key acts as an analyst: ask an admin or a manager of the organization to do it.',
    });
  });

  it('keeps any other failure a 500 with its message', async () => {
    updateOpportunityStatusFor.mockRejectedValue(new Error('connection reset'));
    const res = await patch('done');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'connection reset' });
  });

  it('answers the updated row otherwise', async () => {
    updateOpportunityStatusFor.mockResolvedValue({ id: 'opp-1', status: 'done', updated_at: 'x' });
    const res = await patch('done');
    expect(res.status).toBe(200);
  });
});
