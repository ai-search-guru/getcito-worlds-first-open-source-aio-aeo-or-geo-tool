import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Library's read (CE-002): the latest 500 drafts, and each tab counted
 * in all once a brand has more.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';

let rows: Record<string, unknown>[];
// The shopping checks' read (00352): its rows, or the error it answers.
let checkRows: Record<string, unknown>[];
let checkError: { message: string } | null;
let checkReads: string[][];
let counted: Record<string, number>;
let countReads: string[];
// The row menu's writes (00233): what each update or delete returns.
let writes: { op: string; value?: unknown; id?: unknown }[];
let writeResult: { data: unknown; error: { code?: string; message: string } | null };

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
const reopenDraftTasks = vi.hoisted(() => vi.fn());
const unpublishDraftWork = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/actionDrafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/content/actionDrafts')>()),
  reopenDraftTasks,
  unpublishDraftWork,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'content_shopping_checks') {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => {
              checkReads.push(ids);
              return checkError
                ? { data: null, error: checkError }
                : {
                    data: checkRows.filter((r) => ids.includes(r.draft_id as string)),
                    error: null,
                  };
            },
          }),
        };
      }
      let head = false;
      let status = 'all';
      let archived = false;
      let write: { op: string; value?: unknown; id?: unknown } | null = null;
      const chain: Record<string, unknown> = {
        select: (_cols: string, opts?: { head?: boolean }) => ((head = !!opts?.head), chain),
        eq: (col: string, v: string) => {
          if (col === 'status') status = v;
          if (col === 'id' && write) write.id = v;
          return chain;
        },
        is: () => chain,
        not: (col: string) => (col === 'archived_at' && (archived = true), chain),
        order: () => chain,
        limit: async () => ({ data: rows, error: null }),
        update: (value: unknown) => ((write = { op: 'update', value }), writes.push(write), chain),
        delete: () => ((write = { op: 'delete' }), writes.push(write), chain),
        maybeSingle: async () => writeResult,
        then: (resolve: (r: unknown) => void) => {
          if (write) return resolve(writeResult);
          const tab = archived ? 'archived' : status;
          countReads.push(tab);
          resolve({ count: head ? counted[tab] : null, error: null });
        },
      };
      return chain;
    },
  })),
}));

const { archiveContentDraft, deleteContentDraft, getContentDrafts, setContentDraftStatus } =
  await import('./contentDrafts');
const DRAFT = '2f1d1c52-0f7a-4c1e-9b8a-5d6e7f8a9b0c';

const row = (i: number, status = 'draft') => ({
  id: `d${i}`,
  title: `Draft ${i}`,
  page_type: null,
  method: 'create',
  status,
  author: 'user',
  created_by: 'u1',
  score_before: null,
  score_after: null,
  agent_state: null,
  agent_state_at: null,
  created_at: '2026-10-19T08:00:00Z',
  updated_at: '2026-10-21T10:00:00Z',
  archived_at: null,
});

beforeEach(() => {
  checkRows = [];
  checkError = null;
  checkReads = [];
  countReads = [];
  counted = { all: 812, draft: 300, in_review: 12, ready: 0, published: 500, archived: 7 };
  writes = [];
  writeResult = { data: { id: DRAFT }, error: null };
});

describe('getContentDrafts', () => {
  it('counts the tabs from the rows under the cap', async () => {
    rows = [row(1), row(2, 'published')];
    const { drafts, counts } = await getContentDrafts(BRAND);
    expect(drafts).toHaveLength(2);
    expect(counts).toEqual({
      all: 2,
      draft: 1,
      in_review: 0,
      ready: 0,
      published: 1,
      archived: 0,
    });
    expect(countReads).toEqual([]);
  });

  it('reads when each draft was created, and sets the archived ones apart', async () => {
    rows = [row(1), { ...row(2, 'published'), archived_at: '2026-10-21T09:00:00Z' }];
    const { drafts, counts } = await getContentDrafts(BRAND);
    expect(drafts.map((d) => [d.createdAt, d.archivedAt])).toEqual([
      ['2026-10-19T08:00:00Z', null],
      ['2026-10-19T08:00:00Z', '2026-10-21T09:00:00Z'],
    ]);
    expect(counts).toMatchObject({ all: 1, published: 0, archived: 1 });
  });

  it("reads each draft's shopping path as the last catalog sync's check left it (00352)", async () => {
    const check = {
      read_from: 'page',
      checked_at: '2026-10-27T03:00:00Z',
      categories: 1,
      categories_linked: 1,
      products: 5,
      products_linked: 4,
      bad: [{ id: 'p2', title: 'Storm Shell 2', state: 'sold_out' }],
    };
    rows = [
      row(1),
      { ...row(2), shopping_built: '2026-10-26T09:00:00Z' },
      { ...row(3), shopping_built: '2026-10-26T09:00:00Z' },
      { ...row(4), shopping_built: '2026-10-26T09:00:00Z' },
    ];
    checkRows = [
      { draft_id: 'd3', ...check },
      { draft_id: 'd4', ...check, bad: [] },
    ];
    const { drafts } = await getContentDrafts(BRAND);
    expect(drafts.map((d) => d.shopping?.state)).toEqual(['none', 'unchecked', 'attention', 'ok']);
    // Only the drafts with a path are asked for.
    expect(checkReads).toEqual([['d2', 'd3', 'd4']]);
    expect(drafts[2].shopping).toEqual({
      state: 'attention',
      readFrom: 'page',
      checkedAt: '2026-10-27T03:00:00Z',
      categories: 1,
      categoriesLinked: 1,
      products: 5,
      productsLinked: 4,
      bad: [{ id: 'p2', title: 'Storm Shell 2', state: 'sold_out' }],
    });
  });

  it("still lists the drafts when the shopping checks can't be read (00352 not applied)", async () => {
    rows = [row(1), { ...row(2), shopping_built: '2026-10-26T09:00:00Z' }];
    checkRows = [{ draft_id: 'd2', read_from: 'draft' }];
    checkError = { message: 'relation "public.content_shopping_checks" does not exist' };
    const { drafts } = await getContentDrafts(BRAND);
    expect(drafts.map((d) => [d.id, d.shopping?.state])).toEqual([
      ['d1', 'none'],
      ['d2', 'unchecked'],
    ]);
  });

  it('reads the shopping checks 100 drafts a request', async () => {
    rows = Array.from({ length: 250 }, (_, i) => ({
      ...row(i),
      shopping_built: '2026-10-26T09:00:00Z',
    }));
    await getContentDrafts(BRAND);
    expect(checkReads.map((ids) => ids.length)).toEqual([100, 100, 50]);
  });

  it('counts each tab on its own at the cap', async () => {
    rows = Array.from({ length: 500 }, (_, i) => row(i));
    const { drafts, counts } = await getContentDrafts(BRAND);
    expect(drafts).toHaveLength(500);
    expect(counts).toEqual(counted);
    expect(countReads.sort()).toEqual([
      'all',
      'archived',
      'draft',
      'in_review',
      'published',
      'ready',
    ]);
  });
});

describe('the Library row menu (00233)', () => {
  it('sets a status any member may set', async () => {
    await setContentDraftStatus(DRAFT, 'in_review');
    expect(writes).toEqual([{ op: 'update', value: { status: 'in_review' }, id: DRAFT }]);
    expect(reopenDraftTasks).not.toHaveBeenCalled();
  });

  it('opens again the task Ready completed when a ready page goes back, as the editor does', async () => {
    reopenDraftTasks.mockReset().mockResolvedValue(1);
    const ready = {
      id: DRAFT,
      status: 'ready',
      brand_id: 'b1',
      method: 'optimize',
      action_id: 'a1',
    };
    writeResult = { data: ready, error: null };
    await setContentDraftStatus(DRAFT, 'draft');
    expect(reopenDraftTasks).toHaveBeenCalledWith(
      expect.anything(),
      { id: DRAFT, brandId: 'b1', actionId: 'a1', method: 'optimize' },
      'u1',
    );
    // Published from Ready, the work stays done.
    reopenDraftTasks.mockClear();
    await setContentDraftStatus(DRAFT, 'published');
    expect(reopenDraftTasks).not.toHaveBeenCalled();
    // Only a published page leaves what its action measures.
    expect(unpublishDraftWork).not.toHaveBeenCalled();
  });

  it('takes a published page back in its action too: its Publish task and its live address', async () => {
    reopenDraftTasks.mockReset().mockResolvedValue(1);
    unpublishDraftWork.mockReset().mockResolvedValue(1);
    writeResult = {
      data: { id: DRAFT, status: 'published', brand_id: 'b1', method: 'create', action_id: 'a1' },
      error: null,
    };
    await setContentDraftStatus(DRAFT, 'in_review');
    expect(reopenDraftTasks).toHaveBeenCalledWith(
      expect.anything(),
      { id: DRAFT, brandId: 'b1', actionId: 'a1', method: 'create' },
      'u1',
    );
    expect(unpublishDraftWork).toHaveBeenCalledWith(
      expect.anything(),
      { id: DRAFT, brandId: 'b1', actionId: 'a1' },
      'u1',
    );
    // The status has changed either way.
    unpublishDraftWork.mockRejectedValueOnce(new Error('boom'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(setContentDraftStatus(DRAFT, 'draft')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('refuses Ready (it goes through Mark ready) and a malformed id, writing nothing', async () => {
    await expect(setContentDraftStatus(DRAFT, 'ready' as never)).rejects.toThrow('invalid');
    await expect(setContentDraftStatus('nope', 'draft')).rejects.toThrow('invalid');
    expect(writes).toEqual([]);
  });

  it('archives and restores, and names a refusal by the trigger as forbidden', async () => {
    await archiveContentDraft(DRAFT, true);
    expect((writes[0].value as { archived_at: string }).archived_at).toEqual(expect.any(String));
    await archiveContentDraft(DRAFT, false);
    expect(writes[1].value).toEqual({ archived_at: null });

    writeResult = { data: null, error: { code: '42501', message: 'only admins and managers' } };
    await expect(archiveContentDraft(DRAFT, true)).rejects.toThrow('forbidden');
  });

  it('names a restore refused by the one-draft-per-work key', async () => {
    writeResult = { data: null, error: { code: '23505', message: 'duplicate key' } };
    await expect(archiveContentDraft(DRAFT, false)).rejects.toThrow('newer_draft');
  });

  it('deletes, and calls a delete that removed nothing forbidden', async () => {
    writeResult = { data: [{ id: DRAFT }], error: null };
    await deleteContentDraft(DRAFT);
    expect(writes).toEqual([{ op: 'delete', id: DRAFT }]);

    writeResult = { data: [], error: null };
    await expect(deleteContentDraft(DRAFT)).rejects.toThrow('forbidden');
  });
});
