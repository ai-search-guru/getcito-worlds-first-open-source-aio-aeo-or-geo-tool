import { beforeEach, describe, expect, it, vi } from 'vitest';

/** My rules (CE-009, 00214, 00227): the workspace's rule set per kind of site and page type. */

const BRAND = '33333333-3333-3333-3333-333333333333';

let reads: Record<string, unknown>;
let upserts: { table: string; value: unknown; options: unknown }[];
let filters: [string, string, unknown][];
let user: { id: string } | null;

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      const result = () => ({ data: reads[table] ?? null, error: null });
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (filters.push([table, col, v]), chain),
        upsert: async (value: unknown, options: unknown) => {
          upserts.push({ table, value, options });
          return { error: null };
        },
        maybeSingle: async () => result(),
        then: (resolve: (r: unknown) => void) => resolve(result()),
      };
      return chain;
    },
  })),
}));

const { getMyRuleSets, saveMyRuleSet } = await import('./contentDrafts');

const set = {
  overrides: { sentence: { value: '120' } },
  textRules: [{ id: 'r1', text: 'Mention free shipping', on: true }],
};

beforeEach(() => {
  reads = {
    brands: {
      organization_id: 'org1',
      site_type: null,
      industry: 'E-commerce & Retail',
      shopping_mode_enabled: false,
    },
  };
  upserts = [];
  filters = [];
  user = { id: 'u1' };
});

describe('getMyRuleSets', () => {
  it('reads the organization’s sets for the brand’s kind of site, leaving out ones that don’t read as rules', async () => {
    reads.content_rule_sets = [
      { page_type: 'blog_post', overrides: set.overrides, text_rules: set.textRules },
      { page_type: 'nope', overrides: {}, text_rules: [] },
      { page_type: 'guide', overrides: [], text_rules: [] },
    ];
    expect(await getMyRuleSets(BRAND)).toEqual({ blog_post: set });
    expect(filters).toEqual([
      ['brands', 'id', BRAND],
      ['content_rule_sets', 'organization_id', 'org1'],
      // No site type chosen: the brand's industry guesses a shop.
      ['content_rule_sets', 'site_type', 'ecommerce'],
    ]);
  });

  it('reads the kind of site the brand chose', async () => {
    reads.brands = { organization_id: 'org1', site_type: 'b2c', industry: null };
    reads.content_rule_sets = [];
    await getMyRuleSets(BRAND);
    expect(filters).toContainEqual(['content_rule_sets', 'site_type', 'b2c']);
  });

  it('has none for a brand the member can’t read', async () => {
    reads.brands = null;
    expect(await getMyRuleSets(BRAND)).toEqual({});
    await expect(getMyRuleSets('b1')).rejects.toThrow('invalid');
  });
});

describe('saveMyRuleSet', () => {
  it('keeps the set for the organization, the brand’s kind of site and the page type, as the member', async () => {
    await saveMyRuleSet(BRAND, 'blog_post', set);
    expect(upserts).toEqual([
      {
        table: 'content_rule_sets',
        value: expect.objectContaining({
          organization_id: 'org1',
          site_type: 'ecommerce',
          page_type: 'blog_post',
          overrides: set.overrides,
          text_rules: set.textRules,
          updated_by: 'u1',
        }),
        options: { onConflict: 'organization_id,site_type,page_type' },
      },
    ]);
  });

  it('refuses a set out of shape, an unknown type, or no member', async () => {
    await expect(
      saveMyRuleSet(BRAND, 'blog_post', { ...set, textRules: [{ id: 'x', text: ' ', on: true }] }),
    ).rejects.toThrow('invalid');
    await expect(saveMyRuleSet(BRAND, 'nope' as never, set)).rejects.toThrow('invalid');
    user = null;
    await expect(saveMyRuleSet(BRAND, 'blog_post', set)).rejects.toThrow('not_found');
    expect(upserts).toEqual([]);
  });
});
