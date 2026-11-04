// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/mcp/ai-usage and GET /api/mcp/whoami: the REST mirrors of the MCP
 * tools get_ai_usage and get_me.
 */

const { getAiUsageFor, getMeFor } = vi.hoisted(() => ({
  getAiUsageFor: vi.fn(),
  getMeFor: vi.fn(),
}));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: 'ada@acme.example',
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/mcp/account', () => ({ getAiUsageFor, getMeFor }));

const aiUsage = await import('./route');
const whoami = await import('../whoami/route');

const get = (route: { GET: (req: Request) => Promise<Response> }, path: string) =>
  route.GET(new Request(`http://localhost/api/mcp/${path}`));

beforeEach(() => {
  getAiUsageFor.mockReset();
  getMeFor.mockReset();
});

describe('GET /api/mcp/ai-usage', () => {
  it("answers the organization's usage", async () => {
    getAiUsageFor.mockResolvedValue({ active_plan: true, percent_used: 12.5, features: [] });
    const res = await get(aiUsage, 'ai-usage');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      usage: { active_plan: true, percent_used: 12.5, features: [] },
    });
  });

  it('answers 404 for a key without an organization, and 500 on a failure', async () => {
    getAiUsageFor.mockResolvedValue(null);
    expect((await get(aiUsage, 'ai-usage')).status).toBe(404);
    getAiUsageFor.mockRejectedValue(new Error('Internal ai-usage endpoint returned 503'));
    const res = await get(aiUsage, 'ai-usage');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal ai-usage endpoint returned 503' });
  });
});

describe('GET /api/mcp/whoami', () => {
  it('adds the role, the work areas and whether they change menus', async () => {
    getMeFor.mockResolvedValue({
      user_id: 'user-1',
      email: 'ada@acme.example',
      organization_id: 'org-1',
      organization_name: 'Acme',
      role: 'manager',
      work_areas: [{ id: 'content', name: 'Content' }],
      can_manage_menus: true,
    });
    const res = await get(whoami, 'whoami');
    expect(await res.json()).toEqual({
      userId: 'user-1',
      email: 'ada@acme.example',
      organizationId: 'org-1',
      organizationName: 'Acme',
      role: 'manager',
      workAreas: [{ id: 'content', name: 'Content' }],
      canManageMenus: true,
    });
  });
});
