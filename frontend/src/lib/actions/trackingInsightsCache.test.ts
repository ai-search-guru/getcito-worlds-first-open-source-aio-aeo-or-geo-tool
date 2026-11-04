import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The anchored 24h view is computed in strict mode and cached until the next
 * tracking run (cachedAnchoredInsights). A section that fails there must
 * fail the cached read, so the page falls back to a live read and nothing
 * degraded is stored. The same-prompt comparison (VIS-002) used to swallow
 * its own errors: one timeout then cached the all-prompt changes, with no
 * new-prompts note, until the next run.
 */

let sameError: { message: string } | null = null;

const visibility = (answers: number, mentions: number) => ({
  answers,
  mention_answers: mentions,
  citation_answers: 50,
  position_factor: 0.5,
  by_competitor: [],
});
const sameTotals = (answers: number, mentions: number) => ({
  ...visibility(answers, mentions),
  total_mentions: mentions,
  total_citations: 50,
  positive_count: 20,
  mentioning_answers: mentions,
});
const SAME = {
  complete: true,
  same_prompts: 200,
  new_prompts: 509,
  dropped_prompts: 3,
  cur: sameTotals(800, 220),
  prev: sameTotals(780, 200),
};

function rpc(name: string) {
  let data: unknown = null;
  if (name === 'insights_same_prompt_compare') {
    if (sameError) return Promise.resolve({ data: null, error: sameError });
    data = SAME;
  } else if (name === 'ai_visibility_aggregates') data = visibility(1800, 540);
  else if (name === 'insights_aggregates') {
    data = {
      total_results: 1800,
      sum_visibility: 0,
      total_mentions: 710,
      total_citations: 180,
      positive_count: 0,
      mentioning_results: 0,
      last_checked_at: null,
      by_model: [],
    };
  } else if (name === 'competitor_aggregates') {
    data = {
      brand_row_count: 1800,
      brand_sum_visibility: 0,
      brand_total_mentions: 710,
      brand_total_citations: 180,
      brand_prompt_count: 2,
      brand_visible_prompts: 2,
      by_competitor: [],
      by_brand_provider: [],
      by_competitor_provider: [],
    };
  } else if (name === 'share_of_voice_aggregates') {
    data = { total_brand_mentions: 0, total_competitor_mentions: 0, by_platform: [] };
  } else if (name === 'visibility_rate_trend') data = [];
  else if (name === 'insights_filter_options') data = [{ regions: [], models: [] }];
  else if (name === 'tracked_prompt_count') data = 2;
  return Promise.resolve({ data, error: null });
}

// The last two completed tracking runs anchor the 24h window.
const RUNS = [
  { completed_at: '2026-10-14T06:00:00.000Z' },
  { completed_at: '2026-10-13T06:00:00.000Z' },
];

function table(name: string) {
  let activeRunQuery = false;
  const builder: Record<string, unknown> = {
    is: () => {
      activeRunQuery = true;
      return builder;
    },
    maybeSingle: async () => ({ data: { id: 'b1' }, error: null }),
    single: async () => ({ data: { organization_id: 'org-1' }, error: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: name === 'tracking_runs' && !activeRunQuery ? RUNS : [], error: null }),
  };
  for (const method of ['select', 'eq', 'neq', 'not', 'gte', 'order', 'limit']) {
    builder[method] = () => builder;
  }
  return builder;
}

const client = { from: table, rpc };

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: client }));
vi.mock('@/lib/actions/topic', () => ({ getTopicById: vi.fn() }));
vi.mock('@/lib/guards/planGuard', () => ({
  getOrgPlan: async () => ({ limits: { maxPrompts: 100 } }),
}));
vi.mock('@/lib/promptLocations', () => ({ getOrgLocationUsage: async () => ({ total: 2 }) }));
vi.mock('@/lib/actions/volumes', () => ({ getPromptVolumes: async () => ({ volumes: [] }) }));
vi.mock('@/lib/actions/promptSuggestions', () => ({
  getPromptSuggestions: async () => ({ ok: true, suggestions: [], stale: true }),
}));

// unstable_cache as Next runs it: a result is stored once its function
// resolves, and a thrown error stores nothing.
const cache = new Map<string, unknown>();
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[]) => async () => {
    const key = keyParts.join('|');
    if (!cache.has(key)) cache.set(key, await fn());
    return cache.get(key);
  },
}));

const { getInsightsData } = await import('./tracking');

describe('the cached 24h Insights view (VIS-002)', () => {
  beforeEach(() => {
    cache.clear();
    sameError = null;
  });

  it('keeps a failed same-prompt comparison out of the cache', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    sameError = { message: 'canceling statement due to statement timeout' };

    // The live fallback still shows the page, comparing all prompts.
    const degraded = await getInsightsData('b1', { anchor24h: true });
    expect(degraded.comparison).toBeNull();
    expect(cache.size).toBe(0);
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();

    // The next open reads it again instead of serving the degraded result.
    sameError = null;
    const fresh = await getInsightsData('b1', { anchor24h: true });
    expect(fresh.comparison).toMatchObject({ basis: 'same', newPrompts: 509 });
    expect(cache.size).toBe(1);
  });

  it('caches the view once the comparison reads', async () => {
    const first = await getInsightsData('b1', { anchor24h: true });
    sameError = { message: 'canceling statement due to statement timeout' };
    const second = await getInsightsData('b1', { anchor24h: true });

    expect(second.comparison).toEqual(first.comparison);
    expect(second.comparison?.samePrompts).toBe(200);
  });
});
