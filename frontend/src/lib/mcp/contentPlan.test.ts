import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';
import type { ContentPlanRead } from '@/lib/content/planRead';

/**
 * get_content_plan (B5): the Content plan as the page ranks it, from the
 * page's own reads (readContentPlan) through the service role, once the
 * brand is the key's; snake_case, a card's rows when asked.
 */

let brand: Record<string, unknown> | null;
/** Each filter the brand read made: [table, column, value]. */
const filters: [string, string, unknown][] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push([table, column, value]);
          return chain;
        },
        maybeSingle: async () => ({ data: brand, error: null }),
      };
      return chain;
    },
  },
}));

const readContentPlan = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/planRead', () => ({ readContentPlan }));

const { getContentPlanFor } = await import('./contentPlan');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const READ: ContentPlanRead = {
  pages: [
    {
      page: 'https://acme.example/pricing',
      title: 'Pricing',
      citations: { cur: 4, prev: 12 },
      platformsDown: ['chatgpt-web'],
      aiVisits: 40,
      conversions: null,
    },
  ],
  answers: { cur: 100, prev: 100 },
  tracking: { prevFrom: '2026-08-29', trackedSince: '2026-06-01' },
  opportunities: [
    {
      id: '11111111-2222-3333-4444-555555555555',
      title: 'Cold brew at home',
      pageTitle: 'How to make cold brew at home',
      decision: 'create',
      score: 80,
      targetPage: null,
      targetTitle: null,
      competitorsCited: ['Rival'],
      visibility: 12,
      prompts: 6,
      assetType: null,
    },
  ],
  drafts: [
    {
      id: 'draft-1',
      author: 'agent',
      isMine: false,
      method: 'create',
      opportunityId: '11111111-2222-3333-4444-555555555555',
      sourceUrl: null,
      actionId: null,
      assignee: { id: 'person-1', name: 'Ada' },
    },
  ],
  marks: [],
};

beforeEach(() => {
  filters.length = 0;
  brand = { id: 'brand-1', site_type: 'b2b', industry: null, shopping_mode_enabled: false };
  readContentPlan.mockReset().mockResolvedValue(READ);
});

describe('getContentPlanFor', () => {
  it("ranks the brand's plan as the page does, in the MCP's names", async () => {
    const plan = await getContentPlanFor(auth, { brandId: 'brand-1', days: 30 });
    expect(readContentPlan).toHaveBeenCalledWith(
      expect.anything(),
      'brand-1',
      30,
      expect.any(Promise),
    );
    expect(plan).toMatchObject({
      days: 30,
      hidden: 0,
      tracked_since: '2026-06-01',
      previous_from: '2026-08-29',
      counts: { create: 1, optimize: 1, protect: expect.any(Number), priority: 0 },
    });
    const create = plan!.rows.find((r) => r.action === 'create')!;
    expect(create).toMatchObject({
      key: 'opportunity:11111111-2222-3333-4444-555555555555',
      title: 'How to make cold brew at home',
      page: null,
      opportunity_id: '11111111-2222-3333-4444-555555555555',
      why: { kind: 'competitors', names: ['Rival'], visibility: 12 },
      draft: {
        id: 'draft-1',
        author: 'agent',
        method: 'create',
        assignee: { id: 'person-1', name: 'Ada' },
        editor_path: expect.stringContaining('draft-1'),
      },
      priority: false,
    });
    expect(create.score_parts.map((p) => p.kind)).toEqual([
      'severity',
      'opportunity',
      'pageValue',
      'citations',
    ]);
    const optimize = plan!.rows.find((r) => r.action === 'optimize')!;
    expect(optimize.why).toMatchObject({ kind: 'citationsDown', platforms: ['chatgpt-web'] });
  });

  it("keeps to a card's rows when asked", async () => {
    const plan = await getContentPlanFor(auth, { brandId: 'brand-1', days: 7, card: 'create' });
    expect(plan!.rows.map((r) => r.action)).toEqual(['create']);
  });

  it("answers null for another organization's brand, without reading its plan", async () => {
    brand = null;
    expect(await getContentPlanFor(auth, { brandId: 'brand-2', days: 30 })).toBeNull();
    // The brand is read only as the key's organization's.
    expect(filters).toEqual([
      ['brands', 'id', 'brand-2'],
      ['brands', 'organization_id', 'org-1'],
    ]);
    expect(readContentPlan).not.toHaveBeenCalled();
  });

  it('reads nothing for a key without an organization', async () => {
    expect(
      await getContentPlanFor({ ...auth, organizationId: null }, { brandId: 'brand-1', days: 30 }),
    ).toBeNull();
    expect(filters).toEqual([]);
    expect(readContentPlan).not.toHaveBeenCalled();
  });

  it('marks the drafts of the key’s user as theirs', async () => {
    await getContentPlanFor(auth, { brandId: 'brand-1', days: 30 });
    await expect(readContentPlan.mock.calls[0][3]).resolves.toBe('user-1');
  });
});
