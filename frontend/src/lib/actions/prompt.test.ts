import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS, type Plan } from '@/config/plans';
import { getPromptVolumes, type VolumeQuota } from '@/lib/actions/volumes';
import { getPromptVisibilitySummaries, type PromptVisibilitySummary } from '@/lib/actions/tracking';
import { planFromOrgRow } from '@/lib/guards/planGuard';

/**
 * setPromptActive meters resuming like adding (00128): only active prompts
 * count toward the plan, so a paused prompt's locations come back when it is
 * resumed. A refusal comes back as a value and nothing is written; pausing is
 * always allowed. Location edits on a paused prompt aren't metered until then.
 */

let promptRow: { regions: string[]; is_active: boolean } | null;
let usedLocations = 0;
let usageFails = false;
let plan: Plan;
let writes: unknown[] = [];
let promptSetRows: Record<string, unknown>[] = [];
let positionData: Record<string, unknown>[] = [];
let positionsError: string | null = null;
/** The window before, for the trend; the current window's rows when null. */
let previousPositionData: Record<string, unknown>[] | null = null;
/** Null as the RPC returns it for a caller outside the brand's organization. */
let positionsNull = false;
/** The web deployed before 00153: PostgREST can't find the jsonb RPC. */
let jsonRpcMissing = false;
/** The brand read is the organization's demo brand (00380). */
let brandIsDemo = false;
/** The position RPC calls, and whether any asked for a slice. */
let positionCalls: { fn: string; ranged: boolean }[] = [];
/** The brand's organization, as its row embeds it for the Positions column's plan. */
const ORG_ROW = { plan: 'growth', subscription_status: 'active', plan_overrides: null };
/** When set, reading the brand's row fails with it. */
let brandReadError: string | null = null;
/** When set, each heavy read takes a moment, counted while it runs. */
let slowReads: { running: number; most: number } | null = null;
/** The prompts a bulk location change reads, and what it writes back. */
let bulkRows: { id: string; regions: string[]; is_active: boolean }[] = [];
let appliedLocations: unknown[] = [];
const slowRead = async <T>(read: () => T | Promise<T>): Promise<T> => {
  if (!slowReads) return read();
  const reads = slowReads;
  reads.most = Math.max(reads.most, ++reads.running);
  await new Promise((resolve) => setTimeout(resolve, 2));
  reads.running--;
  return read();
};

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ getPromptVolumes: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({ getPromptVisibilitySummaries: vi.fn() }));

vi.mock('@/lib/guards/planGuard', () => ({
  getOrgPlan: vi.fn(async () => plan),
  // The Positions column reads the organization's plan from its brand's row.
  ORG_PLAN_COLUMNS: 'plan, subscription_status, plan_overrides',
  planFromOrgRow: vi.fn(() => plan),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    // The position sums come as one jsonb value (00153), which PostgREST's
    // 1000-row cap doesn't cut; the old row-returning RPC would have been cut.
    rpc: (fn: string, args?: { p_date_to?: string; p_updates?: unknown[] }) => {
      const call = { fn, ranged: false };
      if (fn.startsWith('prompt_position_summaries')) positionCalls.push(call);
      const result = () => {
        if (fn === 'prompt_position_summaries_json' && jsonRpcMissing) {
          return {
            data: null,
            error: { code: 'PGRST202', message: 'Could not find the function' },
          };
        }
        if (fn === 'prompt_position_summaries_json') {
          // Only the window before the current one has an end.
          const rows = (args?.p_date_to && previousPositionData) || positionData;
          if (positionsError) return { data: null, error: { message: positionsError } };
          return { data: positionsNull ? null : rows, error: null };
        }
        if (fn === 'prompt_position_summaries') {
          return { data: positionData.slice(0, 1000), error: null };
        }
        if (fn === 'apply_prompt_locations') {
          appliedLocations.push(args?.p_updates);
          return { data: args?.p_updates?.length ?? 0, error: null };
        }
        return usageFails
          ? { data: null, error: { message: 'rpc failed' } }
          : { data: [{ brand_id: 'b1', locations: usedLocations }], error: null };
      };
      const chain = {
        order: () => chain,
        range: () => {
          call.ranged = true;
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) =>
          fn === 'prompt_position_summaries_json'
            ? slowRead(result).then(resolve)
            : resolve(result()),
      };
      return chain;
    },
    from: (table: string) => ({
      select: () => ({
        in: async () => ({
          data: bulkRows.map((row) => ({
            ...row,
            prompt_sets: { brands: { organization_id: 'org-1' } },
          })),
          error: null,
        }),
        eq: () => ({
          order: async () =>
            table === 'prompt_sets'
              ? { data: promptSetRows, error: null }
              : { data: null, error: { message: `unexpected ${table}` } },
          maybeSingle: async () =>
            brandReadError
              ? { data: null, error: { message: brandReadError } }
              : {
                  data: { organization_id: 'org-1', is_demo: brandIsDemo, organizations: ORG_ROW },
                  error: null,
                },
          single: async () =>
            promptRow
              ? {
                  data: { ...promptRow, prompt_sets: { brands: { organization_id: 'org-1' } } },
                  error: null,
                }
              : { data: null, error: { message: 'no rows' } },
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        writes.push(payload);
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: { id: 'p1', ...promptRow, ...payload },
                error: null,
              }),
            }),
          }),
        };
      },
    }),
  })),
}));

const {
  bulkUpdatePromptLocations,
  getPromptLocationMatrix,
  getPromptsPageData,
  setPromptActive,
  updatePromptLocations,
} = await import('./prompt');

const capped = (maxPrompts: number): Plan => ({
  ...PLANS.starter,
  limits: { ...PLANS.starter.limits, maxPrompts },
});

describe('setPromptActive', () => {
  beforeEach(() => {
    writes = [];
    usageFails = false;
    plan = capped(50);
  });

  it('refuses to resume a prompt whose locations no longer fit, and writes nothing', async () => {
    // Paused 3-location prompt, and its room was filled while it was paused.
    promptRow = { regions: ['US', 'DE', 'TR'], is_active: false };
    usedLocations = 49;

    const result = await setPromptActive('p1', true);

    expect(result).toMatchObject({ code: 'plan_limit' });
    expect('error' in result && result.error).toContain('49 in place + 3 added');
    expect(writes).toEqual([]);
  });

  it('resumes when the plan has room for every location', async () => {
    promptRow = { regions: ['US', 'DE', 'TR'], is_active: false };
    usedLocations = 47;

    const result = await setPromptActive('p1', true);

    expect(result).toMatchObject({ prompt: { id: 'p1', isActive: true } });
    expect(writes).toEqual([{ is_active: true }]);
  });

  it('always lets a prompt be paused, even over the limit', async () => {
    promptRow = { regions: ['US'], is_active: true };
    usedLocations = 60;

    const result = await setPromptActive('p1', false);

    expect(result).toMatchObject({ prompt: { isActive: false } });
    expect(writes).toEqual([{ is_active: false }]);
  });

  it('lets a prompt that is already active be "resumed" at the limit', async () => {
    promptRow = { regions: ['US'], is_active: true };
    usedLocations = 50;

    const result = await setPromptActive('p1', true);

    expect(result).toMatchObject({ prompt: { isActive: true } });
  });

  it('never limits unlimited plans', async () => {
    plan = capped(-1);
    promptRow = { regions: ['US', 'DE'], is_active: false };
    usedLocations = 5000;

    const result = await setPromptActive('p1', true);

    expect(result).toMatchObject({ prompt: { isActive: true } });
  });

  it('returns an error and writes nothing for a prompt it cannot see', async () => {
    promptRow = null;

    const result = await setPromptActive('p1', true);

    expect(result).toEqual({ error: 'Prompt not found' });
    expect(writes).toEqual([]);
  });

  it('returns a failed limit check as a value instead of throwing', async () => {
    promptRow = { regions: ['US'], is_active: false };
    usageFails = true;

    const result = await setPromptActive('p1', true);

    expect(result).toEqual({ error: "Couldn't check your plan's prompt limit. Please try again." });
    expect(writes).toEqual([]);
  });
});

describe('updatePromptLocations on paused prompts', () => {
  beforeEach(() => {
    writes = [];
    usageFails = false;
    plan = capped(50);
    usedLocations = 50;
  });

  it('lets a paused prompt gain locations at the limit; they count when it is resumed', async () => {
    promptRow = { regions: ['US'], is_active: false };

    const result = await updatePromptLocations('p1', ['US', 'DE', 'TR']);

    expect(result).toMatchObject({ prompt: { regions: ['US', 'DE', 'TR'] } });
    expect(writes).toEqual([{ regions: ['US', 'DE', 'TR'] }]);
  });

  it('still meters an active prompt gaining locations', async () => {
    promptRow = { regions: ['US'], is_active: true };

    const result = await updatePromptLocations('p1', ['US', 'DE']);

    expect(result).toMatchObject({ code: 'plan_limit' });
    expect(writes).toEqual([]);
  });
});

describe('bulkUpdatePromptLocations (PROMPT-015)', () => {
  beforeEach(() => {
    appliedLocations = [];
    usageFails = false;
    plan = capped(50);
    usedLocations = 10;
    // A city no list names any more: never run, and still on the prompts.
    bulkRows = [
      { id: 'p1', regions: ['US', 'TR~ATLANTIS'], is_active: true },
      { id: 'p2', regions: ['TR~ATLANTIS'], is_active: true },
    ];
  });

  it("stops a location no list names any more, but never a prompt's last one", async () => {
    const result = await bulkUpdatePromptLocations(['p1', 'p2'], 'remove', ['tr~atlantis']);

    expect(result).toEqual({ updated: 1, unchanged: 0, blocked: 1, delta: -1 });
    expect(appliedLocations).toEqual([[{ id: 'p1', regions: ['US'] }]]);
  });

  it('still refuses to add one, and writes nothing', async () => {
    const result = await bulkUpdatePromptLocations(['p1'], 'add', ['TR~ATLANTIS', 'DE']);

    expect(result).toEqual({ error: 'Unknown location code: TR~ATLANTIS' });
    expect(appliedLocations).toEqual([]);
  });
});

describe('getPromptsPageData', () => {
  beforeEach(() => {
    plan = capped(50);
    brandIsDemo = false;
    promptRow = null;
    brandReadError = null;
    promptSetRows = [
      {
        id: 'ps1',
        brand_id: 'b1',
        name: 'Prompts',
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
        prompts: [
          {
            id: 'p1',
            prompt_set_id: 'ps1',
            text: 'best crm for startups',
            platforms: ['chatgpt-web'],
            regions: ['US'],
            models: [],
            is_active: true,
            prompt_target_urls: [],
            created_at: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
    ];
    positionData = [
      {
        prompt_id: 'p1',
        platform: 'chatgpt-web',
        runs: 4,
        mention_answers: 4,
        position_sum: 8,
        position_count: 4,
        entity_sum: 20,
        entity_count: 4,
      },
    ];
    positionsError = null;
    previousPositionData = null;
    positionsNull = false;
    jsonRpcMissing = false;
    positionCalls = [];
    vi.mocked(getPromptVolumes).mockResolvedValue({ volumes: [], quota: {} as VolumeQuota });
    vi.mocked(getPromptVisibilitySummaries).mockResolvedValue({});
    // The location quota fails here (no brand row), which the page also absorbs.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('fills the Positions column from the position summaries', async () => {
    const page = await getPromptsPageData('b1');

    expect(page.positions.p1.avg).toBe(2);
    expect(page.positions.p1.dots.map((d) => d.id)).toEqual(['chatgpt-web']);
    // The engines the plan includes, from the organization the brand's row embeds.
    expect(planFromOrgRow).toHaveBeenCalledWith(ORG_ROW);
  });

  it('says when the brand’s plan could not be read, the column then reading —', async () => {
    brandReadError = 'could not embed organizations';
    const page = await getPromptsPageData('b1');

    expect(page.positions.p1.avg).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('brand plan read failed'),
      'could not embed organizations',
    );
  });

  it("gives the demo brand Growth's engines in the Positions column, on any plan", async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    const [p1] = promptSetRows[0].prompts as Record<string, unknown>[];
    p1.platforms = ['chatgpt-web', 'perplexity-web'];

    // Starter's engines alone on the organization's own brand…
    const own = await getPromptsPageData('b1');
    expect(own.positions.p1.dots.map((d) => d.id)).toEqual(['chatgpt-web']);

    // …and Growth's on its demo brand.
    brandIsDemo = true;
    const demo = await getPromptsPageData('b1');
    expect(demo.positions.p1.dots.map((d) => d.id)).toEqual(['chatgpt-web', 'perplexity-web']);
  });

  /** 1000 rows of other prompts, which come before p1's in the RPC's order. */
  const others = () =>
    Array.from({ length: 1000 }, (_, i) => ({
      prompt_id: `other-${String(i).padStart(4, '0')}`,
      platform: 'chatgpt-web',
      runs: 1,
      mention_answers: 0,
      position_sum: 0,
      position_count: 0,
      entity_sum: 0,
      entity_count: 0,
    }));

  it("reads every prompt's positions in one call, past PostgREST's 1000-row cap", async () => {
    // A busy brand's 30 days: p1's row comes after 1000 others. Read as rows,
    // the cap dropped it and p1 read —.
    positionData = [...others(), positionData[0]];

    const page = await getPromptsPageData('b1');

    expect(page.positions.p1.avg).toBe(2);
    // One call per window, the current one and the one before it for the
    // trend, neither paged: paging re-ran the whole aggregate for every page.
    expect(positionCalls).toEqual([
      { fn: 'prompt_position_summaries_json', ranged: false },
      { fn: 'prompt_position_summaries_json', ranged: false },
    ]);
  });

  it("reads the trend's previous window past the cap too", async () => {
    // Before: #3 on average (12 / 4); now #2, so the cell shows ↑1.
    previousPositionData = [...others(), { ...positionData[0], position_sum: 12 }];

    const page = await getPromptsPageData('b1');

    expect(page.positions.p1).toMatchObject({ avg: 2, delta: 1 });
  });

  it('falls back to the row RPC when the web deploys before 00153', async () => {
    jsonRpcMissing = true;

    const page = await getPromptsPageData('b1');

    expect(page.positions.p1.avg).toBe(2);
    expect(positionCalls.map((c) => c.fn)).toEqual([
      'prompt_position_summaries_json',
      'prompt_position_summaries_json',
      'prompt_position_summaries',
      'prompt_position_summaries',
    ]);
  });

  it("shows — when the caller is outside the brand's organization (null sums)", async () => {
    positionsNull = true;

    const page = await getPromptsPageData('b1');

    expect(page.positions.p1).toMatchObject({ avg: null, delta: null });
  });

  it('shows — in the Positions column when the position query fails, instead of failing the page', async () => {
    positionsError = 'canceling statement due to statement timeout';

    const page = await getPromptsPageData('b1');

    expect(page.promptSets[0].prompts.map((p) => p.id)).toEqual(['p1']);
    expect(page.positions.p1).toEqual({ avg: null, delta: null, dots: [], performance: null });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('position summaries'),
      expect.any(Error),
    );
  });

  it('shows the prompts without their visibility when that read times out, and says so', async () => {
    vi.mocked(getPromptVisibilitySummaries).mockRejectedValue(
      new Error('canceling statement due to statement timeout'),
    );

    const page = await getPromptsPageData('b1');

    expect(page.promptSets[0].prompts.map((p) => p.id)).toEqual(['p1']);
    expect(page.visibility).toEqual({});
    expect(page.visibilityDegraded).toBe(true);
    expect(page.volumesDegraded).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('visibility summaries'),
      expect.any(Error),
    );
  });
});

describe('getPromptLocationMatrix (PROMPT-015b)', () => {
  const BRAND = '11111111-1111-1111-1111-111111111111';
  beforeEach(() => {
    plan = capped(50);
    positionData = [
      {
        prompt_id: 'p1',
        platform: 'chatgpt-web',
        runs: 4,
        mention_answers: 4,
        position_sum: 10,
        position_count: 4,
        entity_sum: 20,
        entity_count: 4,
      },
    ];
    positionsError = null;
    previousPositionData = null;
    positionsNull = false;
    jsonRpcMissing = false;
    vi.mocked(getPromptVisibilitySummaries).mockImplementation(
      async (_brand, opts): Promise<Record<string, PromptVisibilitySummary>> =>
        opts?.region === 'TR'
          ? {
              p1: {
                score: 35,
                totalMentions: 9,
                totalCitations: 2,
                runs: 6,
              } as PromptVisibilitySummary,
            }
          : {},
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads each location as the table reads one, and keys the prompt's figures by it", async () => {
    const matrix = await getPromptLocationMatrix(BRAND, {
      from: '2026-10-21T00:00:00Z',
      regions: ['TR', 'US', 'TR', 'not a code'],
    });
    expect(vi.mocked(getPromptVisibilitySummaries).mock.calls.map(([, o]) => o?.region)).toEqual([
      'TR',
      'US',
    ]);
    expect(matrix).toEqual({
      p1: { TR: { score: 35, mentions: 9, citations: 2, position: 2.5, runs: 6 } },
    });
    await expect(getPromptLocationMatrix('nope', { regions: ['TR'] })).rejects.toThrow('invalid');
  });

  it('runs at most three of its heavy reads at once, however many locations', async () => {
    slowReads = { running: 0, most: 0 };
    positionCalls = [];
    vi.mocked(getPromptVisibilitySummaries).mockClear();
    const summaries = vi.mocked(getPromptVisibilitySummaries).getMockImplementation()!;
    vi.mocked(getPromptVisibilitySummaries).mockImplementation((brand, opts) =>
      slowRead(() => summaries(brand, opts)),
    );
    const regions = ['TR', 'US', 'DE', 'FR', 'GB', 'ES', 'IT', 'NL', 'JP', 'BR', 'CA', 'AU'];
    try {
      const matrix = await getPromptLocationMatrix(BRAND, {
        from: '2026-10-21T00:00:00Z',
        regions,
      });
      expect(vi.mocked(getPromptVisibilitySummaries)).toHaveBeenCalledTimes(12);
      expect(positionCalls.filter((c) => c.fn === 'prompt_position_summaries_json')).toHaveLength(
        12,
      );
      expect(slowReads.most).toBe(3);
      expect(matrix.p1.TR).toEqual({
        score: 35,
        mentions: 9,
        citations: 2,
        position: 2.5,
        runs: 6,
      });
    } finally {
      slowReads = null;
    }
  });
});
