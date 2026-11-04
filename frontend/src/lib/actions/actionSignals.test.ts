import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AC-007 reads. The list counts the signals that support an action now (open
 * ones it holds); the drawer lists every signal the action took as evidence,
 * through action_signals, so a closed action keeps the ones that moved on.
 * The other way, a signal's drawer lists every action that took it.
 */

type Call = [string, ...unknown[]];
let queries: { table: string; calls: Call[] }[];
let rows: Record<string, unknown[]>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      const query = { table, calls: [] as Call[] };
      queries.push(query);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'not', 'order', 'limit', 'range']) {
        chain[method] = (...args: unknown[]) => {
          query.calls.push([method, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: rows[table] ?? [], error: null });
      chain.maybeSingle = async () => ({ data: rows[table]?.[0] ?? null, error: null });
      return chain;
    },
    // The actions' list counts (AC-009): nothing removed here.
    rpc: async () => ({ data: [], error: null }),
  })),
}));

// The admin client reads prompt_volumes; nothing here reaches it.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
const readAssignees = vi.fn<(...args: unknown[]) => Promise<Map<string, unknown>>>(
  async () => new Map(),
);
vi.mock('@/lib/action-center/assignees', () => ({
  readAssignees: (...args: unknown[]) => readAssignees(...args),
}));

const { getActionDetail, getActions } = await import('./actionCenter');
const { getSignalActions } = await import('./signals');

const signalsQuery = () => queries.find((q) => q.table === 'signals')!;

beforeEach(() => {
  queries = [];
  rows = {
    actions: [
      {
        id: 'a1',
        action_no: 9,
        category: 'recover',
        kind: 'recover_lost_citations',
        impact: 'high',
        status: 'new',
        payload: {},
        kpi_keys: [],
        assignee_id: null,
        due_date: null,
        created_at: '2026-10-15T00:00:00Z',
        updated_at: '2026-10-15T00:00:00Z',
        priority_score: 87,
        priority_level: 'high',
        priority_reason: null,
        priority_updated_at: null,
      },
    ],
    signals: [{ action_id: 'a1' }, { action_id: 'a1' }],
  };
});

describe('getActions', () => {
  it('counts only the open signals an action holds', async () => {
    const [action] = await getActions('b1');

    expect(action.signalCount).toBe(2);
    expect(signalsQuery().calls).toContainEqual(['in', 'status', ['new', 'acknowledged']]);
  });

  it("names an assignee who isn't the user, whose profile the user can't read", async () => {
    rows.actions = [{ ...(rows.actions[0] as Record<string, unknown>), assignee_id: 'u2' }];
    const member = { id: 'u2', fullName: null, avatarUrl: null, email: 'cg@acme.example' };
    readAssignees.mockResolvedValueOnce(new Map([['u2', member]]));

    const [action] = await getActions('b1');

    expect(readAssignees).toHaveBeenCalledWith(expect.anything(), 'b1', ['u2']);
    expect(action.assignee).toEqual(member);
    // Not through the user's client, which returns only their own profile.
    expect(queries.some((q) => q.table === 'profiles')).toBe(false);
  });
});

describe('getActionDetail', () => {
  it('lists every signal the action took, through action_signals', async () => {
    rows.signals = [];
    await getActionDetail('b1', 'a1');

    const calls = signalsQuery().calls;
    expect(calls[0][1]).toContain('action_signals!inner(action_id)');
    expect(calls).toContainEqual(['eq', 'action_signals.action_id', 'a1']);
    // Not by the signal's current action, which moves to a later cycle.
    expect(calls).not.toContainEqual(['eq', 'action_id', 'a1']);
  });
});

describe('getSignalActions', () => {
  it('lists every action that took the signal, through action_signals, the latest first', async () => {
    rows.action_signals = [
      {
        actions: {
          id: 'a2',
          action_no: 12,
          kind: 'recover_lost_citations',
          status: 'new',
          payload: null,
        },
      },
      {
        actions: {
          id: 'a1',
          action_no: 9,
          kind: 'recover_lost_citations',
          status: 'completed',
          payload: {},
        },
      },
    ];
    const actions = await getSignalActions('b1', 's1');

    expect(actions).toEqual([
      { id: 'a2', actionNo: 12, kind: 'recover_lost_citations', status: 'new', payload: {} },
      { id: 'a1', actionNo: 9, kind: 'recover_lost_citations', status: 'completed', payload: {} },
    ]);
    const calls = queries.find((q) => q.table === 'action_signals')!.calls;
    expect(calls[0][1]).toContain('actions!inner(');
    expect(calls).toContainEqual(['eq', 'signal_id', 's1']);
    expect(calls).toContainEqual(['eq', 'actions.brand_id', 'b1']);
    expect(calls).toContainEqual(['order', 'linked_at', { ascending: false }]);
    // Not the actions by the signal's action_id, which names only the current one.
    expect(queries.map((q) => q.table)).toEqual(['action_signals']);
  });
});
