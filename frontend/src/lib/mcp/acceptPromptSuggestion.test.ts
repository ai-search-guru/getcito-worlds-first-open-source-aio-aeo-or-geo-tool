// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/config/plans';

/**
 * accept_prompt_suggestion on a brand with no topic yet: prompts are grouped
 * under topics, so the tool says to add one first (a topic suggestion it can
 * accept itself) and adds nothing. With a topic it adds the prompt as before.
 */

/** The brand's topic, or none. */
let topic: { id: string } | null = null;
/** Rows inserted, by table. */
let inserts: string[] = [];

vi.mock('@/lib/guards/planGuard', () => ({
  ORG_PLAN_COLUMNS: 'plan',
  planFromOrgRow: () => PLANS.growth,
  usagePlanFromOrgRow: () => PLANS.growth,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    rpc: async () => ({ data: [{ brand_id: 'b1', locations: 0 }], error: null }),
    from: (table: string) => {
      let inserting = false;
      const row = () => {
        if (inserting) return table === 'prompts' ? { id: 'p1', text: 'Best GEO tools?' } : null;
        switch (table) {
          case 'prompt_suggestions':
            return {
              id: 's1',
              brand_id: 'b1',
              suggested_text: 'Best GEO tools?',
              topic_name: null,
            };
          case 'brands':
            return { id: 'b1', organization_id: 'org-1', region: 'US', state: null };
          case 'topics':
            return topic;
          case 'prompt_sets':
            return { id: 'ps1' };
          case 'organizations':
            return { plan: 'growth' };
          default:
            return null;
        }
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        update: () => chain,
        insert: () => {
          inserting = true;
          inserts.push(table);
          return chain;
        },
        maybeSingle: async () => ({ data: row(), error: null }),
        single: async () => ({ data: row(), error: null }),
      };
      return chain;
    },
  },
}));

const { acceptPromptSuggestionFor, MCP_NO_TOPICS_MESSAGE } = await import('./data');

const auth = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'admin' as const,
  apiKeyId: 'key-1',
  brandAccess: 'all' as const,
};

beforeEach(() => {
  topic = null;
  inserts = [];
});

describe('acceptPromptSuggestionFor', () => {
  it('asks for a topic first on a brand without one, and adds nothing', async () => {
    expect(await acceptPromptSuggestionFor(auth, 's1')).toEqual({
      error: MCP_NO_TOPICS_MESSAGE,
      code: 'no_topics',
    });
    expect(MCP_NO_TOPICS_MESSAGE).toMatch(/accept_topic_suggestion/);
    expect(inserts).toEqual([]);
  });

  it('adds the prompt once the brand has a topic', async () => {
    topic = { id: 't1' };
    expect(await acceptPromptSuggestionFor(auth, 's1')).toMatchObject({
      prompt_id: 'p1',
      status: 'added',
    });
    expect(inserts).toEqual(['prompts']);
  });
});
