import { beforeEach, describe, expect, it, vi } from 'vitest';

/** An action's status, and why it was dismissed (learning A5). */

const writes: { table: string; op: string; payload: unknown }[] = [];
/** A database without 00366: PostgREST turns down a write naming dismiss_reason. */
let without00366 = false;
/** Any other failure of the write. */
let writeError: { code: string; message: string } | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let written: unknown;
      const record = (op: string) => (payload: unknown) => {
        writes.push({ table, op, payload });
        written = payload;
        return chain;
      };
      Object.assign(chain, {
        update: record('update'),
        insert: record('insert'),
        eq: () => chain,
        // logEvent clears a stale mark (00432): `.not('stale_at', 'is', null)`.
        not: () => chain,
        then: (resolve: (v: unknown) => void) =>
          resolve(
            table === 'actions' && writeError
              ? { data: null, error: writeError }
              : without00366 && Object.hasOwn(written as object, 'dismiss_reason')
                ? {
                    data: null,
                    error: {
                      code: 'PGRST204',
                      message: "Could not find the 'dismiss_reason' column of 'actions'",
                    },
                  }
                : { data: null, error: null },
          ),
      });
      return chain;
    },
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { updateActionStatus } = await import('./actionCenter');

// The status writes; logEvent's clearing of a stale mark (00432) is counted apart.
const isStaleClear = (w: { payload: unknown }) =>
  Object.keys(w.payload as object).join() === 'stale_at';
const updates = () =>
  writes.filter((w) => w.table === 'actions' && w.op === 'update' && !isStaleClear(w));
const update = () => updates()[0].payload;
const event = () => writes.find((w) => w.table === 'action_events')!.payload;

beforeEach(() => {
  writes.length = 0;
  without00366 = false;
  writeError = null;
});

describe('updateActionStatus', () => {
  it('keeps why an action was dismissed, and says it on its History line', async () => {
    await updateActionStatus('b1', 'a1', 'dismissed', 'not_now');
    expect(update()).toMatchObject({ status: 'dismissed', dismiss_reason: 'not_now' });
    expect(event()).toMatchObject({
      event: 'status_changed',
      data: { to: 'dismissed', reason: 'not_now' },
    });
  });

  it('clears the reason on any other status, and keeps none it doesn’t know', async () => {
    await updateActionStatus('b1', 'a1', 'in_progress', 'not_now');
    expect(update()).toMatchObject({ status: 'in_progress', dismiss_reason: null });
    expect(event()).toMatchObject({ data: { to: 'in_progress' } });

    writes.length = 0;
    await updateActionStatus('b1', 'a1', 'completed');
    expect(update()).toMatchObject({ status: 'completed', dismiss_reason: null });

    writes.length = 0;
    await updateActionStatus('b1', 'a1', 'dismissed', 'bored' as never);
    expect(update()).toMatchObject({ dismiss_reason: null });
  });

  it('clears a stale mark with the History line, as any change does (00432)', async () => {
    await updateActionStatus('b1', 'a1', 'in_progress');
    expect(
      writes.filter((w) => w.table === 'actions' && w.op === 'update' && isStaleClear(w)),
    ).toEqual([{ table: 'actions', op: 'update', payload: { stale_at: null } }]);
  });

  it('starts and completes an action on a database without 00366', async () => {
    without00366 = true;
    await expect(updateActionStatus('b1', 'a1', 'in_progress')).resolves.toBeUndefined();
    await expect(updateActionStatus('b1', 'a1', 'completed')).resolves.toBeUndefined();
    // Each tried with dismiss_reason first, then without it.
    expect(updates()).toHaveLength(4);
    expect(updates()[1].payload).not.toHaveProperty('dismiss_reason');
    expect(updates()[3].payload).not.toHaveProperty('dismiss_reason');
  });

  it('still dismisses on a database without 00366, the reason kept in its event', async () => {
    without00366 = true;
    await updateActionStatus('b1', 'a1', 'dismissed', 'wrong_data');
    expect(updates()).toHaveLength(2);
    expect(updates()[0].payload).toMatchObject({
      status: 'dismissed',
      dismiss_reason: 'wrong_data',
    });
    expect(updates()[1].payload).toMatchObject({ status: 'dismissed' });
    expect(updates()[1].payload).not.toHaveProperty('dismiss_reason');
    expect(event()).toMatchObject({ data: { to: 'dismissed', reason: 'wrong_data' } });
  });

  it('fails on any other error, without trying again', async () => {
    writeError = { code: '42501', message: 'permission denied' };
    await expect(updateActionStatus('b1', 'a1', 'dismissed', 'not_now')).rejects.toThrow(
      'permission denied',
    );
    expect(updates()).toHaveLength(1);
  });

  it('fails on a missing column of another name, without trying again', async () => {
    writeError = {
      code: 'PGRST204',
      message: "Could not find the 'completed_at' column of 'actions'",
    };
    await expect(updateActionStatus('b1', 'a1', 'completed')).rejects.toThrow('completed_at');
    expect(updates()).toHaveLength(1);
  });
});
