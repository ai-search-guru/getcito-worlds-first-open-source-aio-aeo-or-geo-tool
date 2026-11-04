import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Deleting an action from its row menu: hidden, not removed (00168). It
 * becomes dismissed with deleted_at, checked against the caller's
 * organization and role first, and the trail records it.
 */

let action;
let role;
let writes;

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const op = { table, filters: [] };
      const chain = {
        select: () => chain,
        eq: (col, val) => {
          op.filters.push(['eq', col, val]);
          return chain;
        },
        is: (col, val) => {
          op.filters.push(['is', col, val]);
          return chain;
        },
        update: (row) => {
          op.update = row;
          return chain;
        },
        insert: (row) => {
          op.insert = row;
          return chain;
        },
        maybeSingle: async () => ({
          data: table === 'actions' ? action : table === 'profiles' ? { role } : null,
          error: null,
        }),
        then: (resolve) => {
          writes.push(op);
          return resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  },
}));

const assertBrandAccess = vi.fn();
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
vi.mock('../lib/action-center/priorityData.js', () => ({ rescoreActionsForSignal: vi.fn() }));
vi.mock('../lib/planGuard.js', () => ({
  PlanLimitError: class extends Error {},
  requireFeature: () => (_req, _res, next) => next(),
}));
vi.mock('../lib/action-center/task-writer/index.js', () => ({
  TaskWriterError: class extends Error {},
  isTaskWriterEnabled: () => false,
  writeTasksForAction: vi.fn(),
}));
vi.mock('../lib/action-center/taskSend.js', () => ({
  TaskSendError: class extends Error {},
  loadTask: vi.fn(),
  sendTaskToContent: vi.fn(),
  sendTaskToWebhook: vi.fn(),
}));

const { default: router, deleteAction } = await import('./actionCenter.js');

/** DELETE /api/action-center/actions/:id, as Express calls it. */
async function deleteRoute(id) {
  const handle = router.stack.find(
    (layer) => layer.route?.path === '/actions/:id' && layer.route.methods.delete,
  ).route.stack[0].handle;
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  await handle({ params: { id }, user: { id: 'u1' }, log: { error: vi.fn() } }, res);
  return res;
}

const ACTION_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  action = { id: 'a1', brand_id: 'b1', status: 'in_progress', deleted_at: null };
  role = 'manager';
  writes = [];
  assertBrandAccess.mockReset();
});

describe('deleteAction', () => {
  it('dismisses the action, stamps deleted_at and records who did it', async () => {
    await expect(deleteAction('a1', 'u1')).resolves.toEqual({ deleted: true });
    expect(assertBrandAccess).toHaveBeenCalledWith('b1', 'u1');

    const [update, event] = writes;
    expect(update).toMatchObject({
      table: 'actions',
      update: {
        status: 'dismissed',
        deleted_at: expect.any(String),
        completed_at: null,
        updated_at: expect.any(String),
      },
    });
    // Only an action not deleted yet.
    expect(update.filters).toEqual([
      ['eq', 'id', 'a1'],
      ['is', 'deleted_at', null],
    ]);
    expect(event).toMatchObject({
      table: 'action_events',
      insert: { action_id: 'a1', event: 'deleted', data: { from: 'in_progress' }, actor_id: 'u1' },
    });
  });

  it("checks the caller's organization before anything", async () => {
    assertBrandAccess.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await expect(deleteAction('a1', 'u1')).rejects.toThrow('Forbidden');
    expect(writes).toEqual([]);
  });

  it('lets only admins and managers delete', async () => {
    role = 'member';
    await expect(deleteAction('a1', 'u1')).rejects.toMatchObject({
      status: 403,
      message: 'Only admins and managers can delete actions.',
    });
    role = 'admin';
    await expect(deleteAction('a1', 'u1')).resolves.toEqual({ deleted: true });
  });

  it('is not found when the action is gone or already deleted', async () => {
    action = null;
    await expect(deleteAction('a1', 'u1')).rejects.toMatchObject({ status: 404 });
    action = { id: 'a1', brand_id: 'b1', status: 'dismissed', deleted_at: '2026-10-18T00:00:00Z' };
    await expect(deleteAction('a1', 'u1')).rejects.toMatchObject({ status: 404 });
    expect(writes).toEqual([]);
  });
});

describe('DELETE /api/action-center/actions/:id', () => {
  it("answers a brand refusal with the server's code, which the web reads", async () => {
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error("You don't have access to this brand"), {
        status: 403,
        code: 'no_brand_access',
      }),
    );
    const res = await deleteRoute(ACTION_ID);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: "You don't have access to this brand",
      code: 'no_brand_access',
    });
    expect(writes).toEqual([]);
  });

  it('keeps a failure in its own words, without a code', async () => {
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error('connection reset'), { code: '08006' }),
    );
    const res = await deleteRoute(ACTION_ID);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to delete the action.' });
  });
});
