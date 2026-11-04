import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS, type Plan } from '@/config/plans';

/**
 * setPromptsActive meters a bulk resume as setPromptActive meters one (00128):
 * the paused prompts among the selection bring all their locations back, and
 * when the plan has no room for them nothing is written. Pausing is never
 * metered.
 */

let rows: { id: string; regions: string[]; is_active: boolean }[] = [];
let usedLocations = 0;
let plan: Plan;
let writes: unknown[] = [];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ getPromptVolumes: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({ getPromptVisibilitySummaries: vi.fn() }));

vi.mock('@/lib/guards/planGuard', () => ({
  getOrgPlan: vi.fn(async () => plan),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: async () => ({ data: [{ brand_id: 'b1', locations: usedLocations }], error: null }),
    from: () => ({
      select: () => ({
        in: async () => ({
          data: rows.map((r) => ({ ...r, prompt_sets: { brands: { organization_id: 'org-1' } } })),
          error: null,
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        writes.push(payload);
        return {
          in: (_column: string, ids: string[]) => ({
            select: async () => ({ data: ids.map((id) => ({ id })), error: null }),
          }),
        };
      },
    }),
  })),
}));

const { setPromptsActive } = await import('./prompt');

const capped = (maxPrompts: number): Plan => ({
  ...PLANS.starter,
  limits: { ...PLANS.starter.limits, maxPrompts },
});

describe('setPromptsActive', () => {
  beforeEach(() => {
    writes = [];
    plan = capped(50);
  });

  it('refuses a bulk resume whose paused locations no longer fit, and writes nothing', async () => {
    // Two paused prompts with 2 + 3 locations; only 4 slots are left.
    rows = [
      { id: 'p1', regions: ['US', 'DE'], is_active: false },
      { id: 'p2', regions: ['US', 'DE', 'TR'], is_active: false },
    ];
    usedLocations = 46;

    const result = await setPromptsActive(['p1', 'p2'], true);
    expect(result).toMatchObject({ code: 'plan_limit' });
    expect('error' in result && result.error).toMatch(/Remove or pause 1 location/);
    expect(writes).toEqual([]);
  });

  it('resumes them when the plan has room, counting only the paused ones', async () => {
    rows = [
      { id: 'p1', regions: ['US', 'DE'], is_active: false },
      // Already active: resuming it adds nothing.
      { id: 'p2', regions: ['US', 'DE', 'TR'], is_active: true },
    ];
    usedLocations = 48;

    await expect(setPromptsActive(['p1', 'p2'], true)).resolves.toEqual({ updated: 2 });
    expect(writes).toEqual([{ is_active: true }]);
  });

  it('always lets prompts be paused, even over the limit', async () => {
    rows = [{ id: 'p1', regions: ['US'], is_active: true }];
    usedLocations = 60;

    await expect(setPromptsActive(['p1'], false)).resolves.toEqual({ updated: 1 });
    expect(writes).toEqual([{ is_active: false }]);
  });

  it('never limits unlimited plans', async () => {
    plan = capped(-1);
    rows = [{ id: 'p1', regions: ['US', 'DE'], is_active: false }];
    usedLocations = 10_000;

    await expect(setPromptsActive(['p1'], true)).resolves.toEqual({ updated: 1 });
  });
});
