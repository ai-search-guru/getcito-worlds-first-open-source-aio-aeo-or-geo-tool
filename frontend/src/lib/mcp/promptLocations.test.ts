// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * get_prompt_locations (B7): the Locations view's matrix, read as the view
 * reads it (getPromptLocationMatrix) under the service role once the brand
 * is the key's, with its averages and cards, paged by prompt.
 */

const brandAllowed = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mcp/data', () => ({ brandAllowed }));

const getPromptLocationMatrix = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/prompt', () => ({ getPromptLocationMatrix }));

const scoped = vi.hoisted(() => ({ clients: [] as unknown[] }));
vi.mock('@/lib/supabase/scoped', () => ({
  withDbClient: (client: unknown, fn: () => unknown) => (scoped.clients.push(client), fn()),
}));

let promptRows: Record<string, unknown>[] = [];
const adminClient = vi.hoisted(() => ({ marker: 'service role' }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: Object.assign(adminClient, {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: async (start: number, end: number) => ({
          data: promptRows.slice(start, end + 1),
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

const { getPromptLocationsFor } = await import('./promptLocations');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const cell = (score: number | null, over: Record<string, unknown> = {}) => ({
  score,
  mentions: 3,
  citations: 1,
  position: 2,
  runs: 6,
  ...over,
});

beforeEach(() => {
  brandAllowed.mockReset().mockResolvedValue(true);
  scoped.clients.length = 0;
  promptRows = [
    { id: 'p1', text: 'Best cold brew', regions: ['US', 'DE'], is_active: true },
    { id: 'p2', text: 'Cold brew ratio', regions: ['US'], is_active: false },
  ];
  getPromptLocationMatrix.mockReset().mockResolvedValue({
    p1: { US: cell(60), DE: cell(20) },
    p2: { US: cell(40) },
  });
});

describe('getPromptLocationsFor', () => {
  it('reads the view’s matrix under the service role, the most tracked location first', async () => {
    const view = (await getPromptLocationsFor(auth, { brandId: 'brand-1' }))!;
    expect(scoped.clients).toEqual([adminClient]);
    expect(getPromptLocationMatrix).toHaveBeenCalledWith('brand-1', {
      days: 30,
      from: undefined,
      to: undefined,
      regions: ['US', 'DE'],
    });
    expect(view.locations).toEqual([
      { code: 'US', name: 'United States' },
      { code: 'DE', name: 'Germany' },
    ]);
    expect(view.ignored_locations).toEqual([]);
    expect(view.averages.visibility).toEqual([50, 20]);
    // The cards in the MCP's own snake_case names.
    expect(view.insights).toEqual({
      weakest: { region: 'DE', average: 20, untracked: 1 },
      strongest: { region: 'US', average: 50, tracked: 2 },
      widest: {
        prompt_id: 'p1',
        text: 'Best cold brew',
        low: 20,
        low_at: 'DE',
        high: 60,
        high_at: 'US',
      },
      overall: 40,
    });
    expect(view.prompts).toEqual([
      {
        id: 'p1',
        text: 'Best cold brew',
        is_active: true,
        tracked_in: ['US', 'DE'],
        cells: {
          US: { visibility: 60, mentions: 3, citations: 1, position: 2, runs: 6 },
          DE: { visibility: 20, mentions: 3, citations: 1, position: 2, runs: 6 },
        },
        visibility_gap: 40,
      },
      {
        id: 'p2',
        text: 'Cold brew ratio',
        is_active: false,
        tracked_in: ['US'],
        cells: { US: { visibility: 40, mentions: 3, citations: 1, position: 2, runs: 6 } },
        visibility_gap: null,
      },
    ]);
    expect(view.total).toBe(2);
    expect(view.next_offset).toBeNull();
  });

  it('compares the locations asked, valid ones only, at most twelve, and says which it left out', async () => {
    const view = (await getPromptLocationsFor(auth, {
      brandId: 'brand-1',
      locations: ['US-CA', 'nowhere', 'US-CA', 'TR', ...Array.from({ length: 11 }, () => 'DE')],
      days: 7,
    }))!;
    expect(getPromptLocationMatrix.mock.calls[0][1]).toMatchObject({
      days: 7,
      regions: ['US-CA', 'TR', 'DE'],
    });
    expect(view.ignored_locations).toEqual(['nowhere']);

    const many = ['US', 'DE', 'FR', 'GB', 'IT', 'ES', 'NL', 'SE', 'PL', 'TR', 'JP', 'BR', 'CA'];
    const capped = (await getPromptLocationsFor(auth, { brandId: 'brand-1', locations: many }))!;
    expect(capped.locations.map((l) => l.code)).toEqual(many.slice(0, 12));
    expect(capped.ignored_locations).toEqual(['CA']);
  });

  it('reads a location code in any case, as the prompts keep it', async () => {
    const view = (await getPromptLocationsFor(auth, {
      brandId: 'brand-1',
      locations: [' us ', 'de', 'US'],
    }))!;
    expect(getPromptLocationMatrix.mock.calls[0][1]).toMatchObject({ regions: ['US', 'DE'] });
    expect(view.ignored_locations).toEqual([]);
    expect(view.prompts[0]).toMatchObject({
      tracked_in: ['US', 'DE'],
      cells: { US: { visibility: 60 }, DE: { visibility: 20 } },
    });
  });

  it('falls back to the most tracked when no code given names a location, and says so', async () => {
    const view = (await getPromptLocationsFor(auth, { brandId: 'brand-1', locations: ['xx'] }))!;
    expect(view.locations.map((l) => l.code)).toEqual(['US', 'DE']);
    expect(view.ignored_locations).toEqual(['xx']);
  });

  it('pages the prompts, every location’s averages still over all of them', async () => {
    const view = (await getPromptLocationsFor(auth, { brandId: 'brand-1', limit: 1 }))!;
    expect(view.prompts.map((p) => p.id)).toEqual(['p1']);
    expect(view.next_offset).toBe(1);
    expect(view.averages.visibility).toEqual([50, 20]);
  });

  it('gives at most 100 prompts a page', async () => {
    promptRows = Array.from({ length: 150 }, (_, i) => ({
      id: `p${i}`,
      text: `Prompt ${i}`,
      regions: ['US'],
      is_active: true,
    }));
    const view = (await getPromptLocationsFor(auth, { brandId: 'brand-1', limit: 500 }))!;
    expect(view.prompts).toHaveLength(100);
    expect(view.next_offset).toBe(100);
    expect(view.total).toBe(150);
  });

  it("answers null for another organization's brand, without reading it", async () => {
    brandAllowed.mockResolvedValue(false);
    expect(await getPromptLocationsFor(auth, { brandId: 'brand-2' })).toBeNull();
    expect(getPromptLocationMatrix).not.toHaveBeenCalled();
  });
});
