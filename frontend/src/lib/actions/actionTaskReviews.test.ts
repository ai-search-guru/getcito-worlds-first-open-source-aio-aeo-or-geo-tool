import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tasks waiting for review (AC-010, 00293): read for the brand, approved
 * onto their action through the RPC with what the writer stored kept, and
 * dismissed.
 */

let rows: Record<string, unknown>[];
let filters: [string, string, unknown][];
let rpcCalls: [string, Record<string, unknown>][];
let rpcResult: { data: unknown; error: { code: string; message: string } | null };
let deletes: [string, unknown][];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      let deleting = false;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.order = () => chain;
      chain.eq = (column: string, value: unknown) => {
        if (deleting) deletes.push([column, value]);
        else filters.push([table, column, value]);
        return chain;
      };
      chain.is = (column: string, value: unknown) => (filters.push([table, column, value]), chain);
      chain.not = (column: string, op: string, value: unknown) => (
        filters.push([table, `${column} not ${op}`, value]),
        chain
      );
      chain.delete = () => ((deleting = true), chain);
      chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      chain.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: rows, error: null, count: rows.length });
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      return rpcResult;
    },
  })),
}));

const { approveTaskReview, dismissTaskReview, getTaskReviews } =
  await import('./actionTaskReviews');

const edit = {
  title: '  Add a pricing FAQ to /pricing ',
  url: ' /pricing ',
  where: '/pricing',
  why: '',
  before: '',
  after: 'FAQ: Do plans ship free?',
  how: ['Add the FAQ.'],
  doneWhen: 'FAQ present · page re-fetched',
  check: 'auto' as const,
  type: 'content' as const,
  effort: '',
  role: '',
};

beforeEach(() => {
  rows = [];
  filters = [];
  rpcCalls = [];
  rpcResult = { data: 'task-1', error: null };
  deletes = [];
});

describe('getTaskReviews', () => {
  it("reads the brand's tasks waiting for review, with their action and what they miss", async () => {
    rows = [
      {
        id: 'r1',
        action_id: 'a1',
        title: 'Add a pricing FAQ to /pricing',
        details: { where: '/pricing', doneWhen: 'FAQ present', source: 'ai' },
        missing: ['url', 'change', 'nonsense'],
        created_at: '2026-10-26T10:00:00Z',
        actions: { action_no: 12, brand_id: 'b1' },
      },
    ];
    expect(await getTaskReviews('b1')).toEqual([
      {
        id: 'r1',
        actionId: 'a1',
        actionNo: 12,
        title: 'Add a pricing FAQ to /pricing',
        details: expect.objectContaining({ where: '/pricing', doneWhen: 'FAQ present' }),
        missing: ['url', 'change'],
        createdAt: '2026-10-26T10:00:00Z',
      },
    ]);
    expect(filters).toContainEqual(['action_task_reviews', 'actions.brand_id', 'b1']);
    // None of an action that is deleted or closed: it can't take them.
    expect(filters).toContainEqual(['action_task_reviews', 'actions.deleted_at', null]);
    expect(filters).toContainEqual([
      'action_task_reviews',
      'actions.status not in',
      '(completed,dismissed)',
    ]);
  });
});

describe('approveTaskReview', () => {
  it('puts the task on its action as edited, keeping what the writer stored', async () => {
    rows = [{ details: { source: 'ai', refs: ['page:1'], url: null } }];
    expect(await approveTaskReview('b1', 'r1', edit)).toEqual({ taskId: 'task-1' });
    expect(rpcCalls).toEqual([
      [
        'approve_action_task_review',
        {
          p_review_id: 'r1',
          p_title: 'Add a pricing FAQ to /pricing',
          p_details: expect.objectContaining({
            source: 'ai',
            refs: ['page:1'],
            url: '/pricing',
            change: { before: null, after: 'FAQ: Do plans ship free?' },
            doneWhen: 'FAQ present · page re-fetched',
            check: 'auto',
          }),
        },
      ],
    ]);
    // Only a row of this brand's actions.
    expect(filters).toContainEqual(['action_task_reviews', 'actions.brand_id', 'b1']);
  });

  it('says why it was not approved', async () => {
    expect(await approveTaskReview('b1', 'r1', { ...edit, how: 'x' as never })).toEqual({
      error: 'invalid',
    });
    expect(await approveTaskReview('b1', 'r1', edit)).toEqual({ error: 'gone' });
    rows = [{ details: {} }];
    rpcResult = { data: null, error: { code: '22023', message: 'incomplete task' } };
    expect(await approveTaskReview('b1', 'r1', edit)).toEqual({ error: 'incomplete' });
    rpcResult = { data: null, error: { code: '42501', message: 'not allowed' } };
    expect(await approveTaskReview('b1', 'r1', edit)).toEqual({ error: 'not_allowed' });
    rpcResult = { data: null, error: { code: '55000', message: 'action closed' } };
    expect(await approveTaskReview('b1', 'r1', edit)).toEqual({ error: 'closed' });
    // Approved or dismissed meanwhile: the RPC finds no row.
    rpcResult = { data: null, error: null };
    expect(await approveTaskReview('b1', 'r1', edit)).toEqual({ error: 'gone' });
  });
});

describe('dismissTaskReview', () => {
  it("deletes a row of the brand's, and nothing when it's gone", async () => {
    rows = [{ id: 'r1' }];
    await dismissTaskReview('b1', 'r1');
    expect(deletes).toEqual([['id', 'r1']]);
    rows = [];
    deletes = [];
    await dismissTaskReview('b1', 'r1');
    expect(deletes).toEqual([]);
  });
});
