import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * update_task_status is the only Action Center write exposed over MCP. These
 * pin the rules it shares with the dashboard: nothing is written for a task
 * outside the caller's org, a skip must say why, and the change lands in the
 * action's event trail under the API key's user.
 */

type Op = { table: string; op: 'select' | 'update' | 'insert'; payload?: unknown };

let ops: Op[] = [];
let taskOwned = true;
let isFilters: [string, unknown][] = [];

function builder(table: string) {
  let current: Op = { table, op: 'select' };
  const chain = {
    select: () => {
      if (current.op === 'select') ops.push(current);
      return chain;
    },
    update: (payload: unknown) => {
      current = { table, op: 'update', payload };
      ops.push(current);
      return chain;
    },
    insert: async (payload: unknown) => {
      ops.push({ table, op: 'insert', payload });
      return { error: null };
    },
    eq: () => chain,
    is: (column: string, value: unknown) => {
      isFilters.push([column, value]);
      return chain;
    },
    maybeSingle: async () => ({
      data: taskOwned ? { id: 'task-1', action_id: 'action-1' } : null,
      error: null,
    }),
    single: async () => ({
      data: {
        id: 'task-1',
        action_id: 'action-1',
        status: (current.payload as { status: string }).status,
        skip_reason: (current.payload as { skip_reason: string | null }).skip_reason,
        updated_at: '2026-10-04T00:00:00.000Z',
      },
      error: null,
    }),
    then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

const { updateTaskStatusFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const writes = () => ops.filter((o) => o.op !== 'select');

describe('updateTaskStatusFor', () => {
  beforeEach(() => {
    ops = [];
    taskOwned = true;
    isFilters = [];
  });

  it("checks the task's action isn't deleted (00168)", async () => {
    await updateTaskStatusFor(auth, 'task-1', 'completed');
    expect(isFilters).toContainEqual(['actions.deleted_at', null]);
  });

  it('returns null and writes nothing for a task outside the caller org', async () => {
    taskOwned = false;
    expect(await updateTaskStatusFor(auth, 'task-1', 'completed')).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('refuses a skip without a reason before touching the database', async () => {
    await expect(updateTaskStatusFor(auth, 'task-1', 'skipped', '   ')).rejects.toThrow(
      /skip_reason/,
    );
    expect(ops).toEqual([]);
  });

  it('updates the task and logs the change under the key user', async () => {
    const result = await updateTaskStatusFor(auth, 'task-1', 'skipped', ' Already covered ');

    expect(result).toMatchObject({
      id: 'task-1',
      status: 'skipped',
      skip_reason: 'Already covered',
    });
    expect(writes()).toEqual([
      {
        table: 'action_tasks',
        op: 'update',
        payload: expect.objectContaining({ status: 'skipped', skip_reason: 'Already covered' }),
      },
      {
        table: 'action_events',
        op: 'insert',
        payload: {
          action_id: 'action-1',
          event: 'task_status',
          data: { taskId: 'task-1', to: 'skipped', reason: 'Already covered' },
          actor_id: 'user-1',
        },
      },
      {
        table: 'actions',
        op: 'update',
        payload: expect.objectContaining({ updated_at: expect.any(String) }),
      },
    ]);
  });

  it('clears the skip reason for any other status', async () => {
    await updateTaskStatusFor(auth, 'task-1', 'completed', 'ignored');
    expect(writes()[0].payload).toMatchObject({ status: 'completed', skip_reason: null });
  });
});
