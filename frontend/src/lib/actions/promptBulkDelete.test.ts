import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * deletePrompts takes a few prompts per call (PROMPT-006): each prompt's
 * answers and citations go with it, and a whole page in one statement outran
 * the 8-second timeout on big brands. The page calls it in turn.
 */

let deleted: string[][] = [];
let visible: Set<string>;
let failWith: string | null = null;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ getPromptVolumes: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({ getPromptVisibilitySummaries: vi.fn() }));
vi.mock('@/lib/guards/planGuard', () => ({ getOrgPlan: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      delete: () => ({
        in: (_column: string, ids: string[]) => ({
          select: async () => {
            if (failWith) return { data: null, error: { message: failWith } };
            deleted.push(ids);
            // RLS leaves out the prompts the caller can't see.
            return { data: ids.filter((id) => visible.has(id)).map((id) => ({ id })), error: null };
          },
        }),
      }),
    }),
  })),
}));

const { deletePrompts } = await import('./prompt');
const { PROMPT_DELETE_BATCH } = await import('@/lib/promptBulkActions');

describe('deletePrompts', () => {
  beforeEach(() => {
    deleted = [];
    visible = new Set(['p1', 'p2', 'p3', 'p4']);
    failWith = null;
  });

  it('deletes one batch and returns the ids RLS let through', async () => {
    visible.delete('p2');
    const result = await deletePrompts(['p1', 'p2', 'p3']);
    expect(result).toEqual({ deletedIds: ['p1', 'p3'] });
    expect(deleted).toEqual([['p1', 'p2', 'p3']]);
  });

  it('refuses more than a batch in one call, and deletes nothing', async () => {
    const ids = Array.from({ length: PROMPT_DELETE_BATCH + 1 }, (_, i) => `p${i + 1}`);
    const result = await deletePrompts(ids);
    expect(result).toEqual({ error: `At most ${PROMPT_DELETE_BATCH} prompts per call.` });
    expect(deleted).toEqual([]);
  });

  it('returns a database error as a value', async () => {
    failWith = 'canceling statement due to statement timeout';
    const result = await deletePrompts(['p1']);
    expect(result).toEqual({ error: 'canceling statement due to statement timeout' });
  });

  it('makes no call for an empty list', async () => {
    expect(await deletePrompts([])).toEqual({ deletedIds: [] });
    expect(deleted).toEqual([]);
  });
});
