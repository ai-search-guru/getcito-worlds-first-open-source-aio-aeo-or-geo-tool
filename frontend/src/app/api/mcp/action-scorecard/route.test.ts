// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/action-scorecard: the REST mirror of the MCP tool get_action_scorecard. */

const { getActionScorecardFor } = vi.hoisted(() => ({ getActionScorecardFor: vi.fn() }));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/mcp/learning', () => ({ getActionScorecardFor }));

const { GET } = await import('./route');

const get = (query: string) =>
  GET(new Request(`http://localhost/api/mcp/action-scorecard${query}`));

beforeEach(() => {
  getActionScorecardFor.mockReset();
});

describe('GET /api/mcp/action-scorecard', () => {
  it("answers the brand's scorecard since a day", async () => {
    getActionScorecardFor.mockResolvedValue([{ kind: 'citation_gap', completed: 2 }]);
    const res = await get('?brand_id=brand-1&date_from=2026-09-01');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scorecard: [{ kind: 'citation_gap', completed: 2 }] });
    expect(getActionScorecardFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      since: '2026-09-01',
    });
  });

  it('asks for a brand, and a date it can read', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?brand_id=brand-1&date_from=soon')).status).toBe(400);
    expect(getActionScorecardFor).not.toHaveBeenCalled();
  });

  it("answers 404 for another organization's brand, and 500 on a failure", async () => {
    getActionScorecardFor.mockResolvedValue(null);
    expect((await get('?brand_id=brand-2')).status).toBe(404);
    getActionScorecardFor.mockRejectedValue(new Error('statement timeout'));
    const res = await get('?brand_id=brand-1');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'statement timeout' });
  });
});
