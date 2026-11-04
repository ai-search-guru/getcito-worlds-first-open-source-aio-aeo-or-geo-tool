// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/prompt-locations: the REST mirror of get_prompt_locations. */

const { getPromptLocationsFor } = vi.hoisted(() => ({ getPromptLocationsFor: vi.fn() }));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/mcp/promptLocations', () => ({ getPromptLocationsFor }));

const { GET } = await import('./route');

const get = (query: string) =>
  GET(new Request(`http://localhost/api/mcp/prompt-locations${query}`));

beforeEach(() => {
  getPromptLocationsFor.mockReset();
});

describe('GET /api/mcp/prompt-locations', () => {
  it('compares the locations listed, over the window asked', async () => {
    getPromptLocationsFor.mockResolvedValue({ locations: [], prompts: [] });
    const res = await get('?brand_id=brand-1&locations=US-CA,TR&days=7&limit=20');
    expect(res.status).toBe(200);
    expect(getPromptLocationsFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      locations: ['US-CA', 'TR'],
      days: 7,
      from: undefined,
      to: undefined,
      limit: 20,
      offset: undefined,
    });
  });

  it('passes every code listed on, for the tool to read and say which it left out', async () => {
    getPromptLocationsFor.mockResolvedValue({ locations: [], prompts: [] });
    const codes = Array.from({ length: 13 }, (_, i) => `C${i}`);
    await get(`?brand_id=brand-1&locations=us,%20de,${codes.join(',')}`);
    expect(getPromptLocationsFor.mock.calls[0][1].locations).toEqual(['us', ' de', ...codes]);
  });

  it('refuses a window it does not offer, and answers 404 for another brand', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?brand_id=brand-1&days=14')).status).toBe(400);
    expect((await get('?brand_id=brand-1&date_from=soon')).status).toBe(400);
    getPromptLocationsFor.mockResolvedValue(null);
    expect((await get('?brand_id=brand-2')).status).toBe(404);
  });
});
