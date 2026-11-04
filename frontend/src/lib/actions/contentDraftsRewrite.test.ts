import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The draft's last page rewrite, as the API keeps it (00285): numbers only,
 * none for a rewrite made before them.
 */

const DRAFT = '2f1d1c52-0f7a-4c1e-9b8a-5d6e7f8a9b0c';
let row: Record<string, unknown> | null;
let filters: [string, unknown][];
let selected: string;

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: (cols: string) => ((selected = cols), chain),
        eq: (col: string, value: unknown) => (filters.push([col, value]), chain),
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return chain;
    },
  })),
}));

const { getLastPageRewrite } = await import('./contentDrafts');

beforeEach(() => {
  row = null;
  filters = [];
  selected = '';
});

describe('getLastPageRewrite', () => {
  it('reads the latest page rewrite: its numbers and its page, for the editor to count', async () => {
    row = {
      after_text: '<h1>Plan</h1><p>Teams forecast.</p>',
      after_chars: 5_468,
      length_target: 4_000,
      kept_chars: 3_125,
    };
    await expect(getLastPageRewrite(DRAFT)).resolves.toEqual({
      chars: 5_468,
      target: 4_000,
      kept: 3_125,
      html: '<h1>Plan</h1><p>Teams forecast.</p>',
    });
    expect(selected).toBe('after_text, after_chars, length_target, kept_chars');
    expect(filters).toEqual([
      ['draft_id', DRAFT],
      ['kind', 'page'],
    ]);
  });

  it('says nothing for none, or for one made before 00285; Length off keeps its null', async () => {
    await expect(getLastPageRewrite(DRAFT)).resolves.toBeNull();
    row = { after_text: '<p>Old.</p>', after_chars: null, length_target: null, kept_chars: null };
    await expect(getLastPageRewrite(DRAFT)).resolves.toBeNull();
    row = { after_text: '<p>New.</p>', after_chars: 6_000, length_target: null, kept_chars: 900 };
    await expect(getLastPageRewrite(DRAFT)).resolves.toEqual({
      chars: 6_000,
      target: null,
      kept: 900,
      html: '<p>New.</p>',
    });
    await expect(getLastPageRewrite('nope')).rejects.toThrow('invalid');
  });
});
