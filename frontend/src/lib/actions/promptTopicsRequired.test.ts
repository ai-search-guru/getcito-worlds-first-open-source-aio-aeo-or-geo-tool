import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/config/plans';

/**
 * Prompts are grouped under topics, so a brand with no topic yet can't add
 * prompts: addPromptToSet (every single add: the Prompts page, suggestions,
 * Track buttons) and importPrompts (the Add Prompt dialog and bulk import)
 * answer `no_topics` as a value and write nothing. With a topic, adding works
 * as before.
 */

/** The brand's active topics, by name. */
let topics: { id: string; name: string }[] = [];
/** When set, reading the brand's topics fails with it. */
let topicsError: string | null = null;
/** Rows inserted, by table, and RPCs called. */
let inserts: { table: string; row: unknown }[] = [];
let rpcs: string[] = [];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ getPromptVolumes: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({
  getPromptVisibilitySummaries: vi.fn(),
  analyzeNewPrompts: vi.fn(async () => ({ started: true })),
}));
vi.mock('@/lib/guards/planGuard', () => ({
  getOrgPlan: vi.fn(async () => PLANS.growth),
  ORG_PLAN_COLUMNS: 'plan',
  planFromOrgRow: vi.fn(() => PLANS.growth),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: async (fn: string) => {
      rpcs.push(fn);
      // The org's location usage: plenty of room.
      return { data: [{ brand_id: 'b1', locations: 0 }], error: null };
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let inserted: Record<string, unknown> | null = null;
      const read = () => {
        if (table === 'topics') {
          if (topicsError) return { data: null, error: { message: topicsError } };
          const matching = topics.filter((t) => !filters.name || t.name === filters.name);
          return { data: matching, error: null };
        }
        if (table === 'prompt_sets') return { data: { id: 'ps1', brand_id: 'b1' }, error: null };
        if (table === 'brands') {
          return {
            data: { organization_id: 'org-1', region: 'US', shopping_mode_enabled: false },
            error: null,
          };
        }
        if (table === 'prompts' && inserted) {
          return { data: { id: 'p1', prompt_set_id: 'ps1', ...inserted }, error: null };
        }
        return { data: [], error: null };
      };
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          inserted = row;
          return chain;
        },
        single: async () => read(),
        maybeSingle: async () => {
          const result = read();
          const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
          return { ...result, data };
        },
        then: (resolve: (value: unknown) => unknown) => resolve(read()),
      };
      return chain;
    },
  })),
}));

const { addPromptToBrand, addPromptToSet, importPrompts } = await import('./prompt');

const NO_TOPICS = {
  error: 'Add a topic first: prompts are grouped under topics.',
  code: 'no_topics',
};

beforeEach(() => {
  topics = [];
  topicsError = null;
  inserts = [];
  rpcs = [];
});

describe('addPromptToSet without topics', () => {
  it('asks for a topic first and writes nothing', async () => {
    const result = await addPromptToSet({
      promptSetId: 'ps1',
      text: 'Best espresso beans?',
      platforms: ['chatgpt-web'],
    });
    expect(result).toEqual(NO_TOPICS);
    expect(inserts).toEqual([]);
  });

  it('adds the prompt under its topic when the brand has one', async () => {
    topics = [{ id: 't1', name: 'Espresso' }];
    const result = await addPromptToSet({
      promptSetId: 'ps1',
      text: 'Best espresso beans?',
      category: 'Espresso',
      platforms: ['chatgpt-web'],
    });
    expect('prompt' in result).toBe(true);
    expect(inserts).toEqual([
      expect.objectContaining({
        table: 'prompts',
        row: expect.objectContaining({ text: 'Best espresso beans?', topic_id: 't1' }),
      }),
    ]);
  });

  it('still adds a prompt without a topic of its own, as a Track does, once the brand has topics', async () => {
    topics = [{ id: 't1', name: 'Espresso' }];
    const result = await addPromptToSet({
      promptSetId: 'ps1',
      text: 'espresso vs ristretto',
      platforms: ['chatgpt-web'],
    });
    expect('prompt' in result).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it("doesn't send the person to add a topic when the topics can't be read", async () => {
    topicsError = 'connection reset';
    const result = await addPromptToSet({
      promptSetId: 'ps1',
      text: 'Best espresso beans?',
      platforms: ['chatgpt-web'],
    });
    expect(result).not.toMatchObject({ code: 'no_topics' });
  });
});

describe('addPromptToBrand without topics', () => {
  it('passes the refusal on with its code', async () => {
    const result = await addPromptToBrand('b1', {
      text: 'Best espresso beans?',
      platforms: ['chatgpt-web'],
    });
    expect(result).toEqual(NO_TOPICS);
    expect(inserts).toEqual([]);
  });
});

describe('importPrompts without topics', () => {
  const row = {
    idx: 0,
    text: 'Best espresso beans?',
    topic: 'Espresso',
    platforms: ['chatgpt-web'],
    models: [],
    regions: ['US'],
  };

  it('asks for a topic first, even when the rows name topics, and writes nothing', async () => {
    expect(await importPrompts('b1', [row])).toEqual(NO_TOPICS);
    expect(inserts).toEqual([]);
    expect(rpcs).toEqual([]);
  });

  it('imports as before once the brand has a topic', async () => {
    topics = [{ id: 't1', name: 'Espresso' }];
    await importPrompts('b1', [row]);
    expect(rpcs).toContain('import_prompts');
  });
});
