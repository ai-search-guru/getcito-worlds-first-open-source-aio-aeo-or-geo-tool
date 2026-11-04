import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The actions list's Export CSV (AC-005): each action's affected count and
 * names, read for many actions at once, page by page, as the drawer's
 * Affected tab reads one.
 */

type Call = [string, ...unknown[]];
type Row = Record<string, unknown>;
let queries: { table: string; calls: Call[] }[];
let rows: Record<string, Row[]>;

/** What PostgREST would answer: the `in` filters, embedded ones included, then the range. */
function answer(table: string, calls: Call[]): Row[] {
  let out = rows[table] ?? [];
  for (const [method, column, values] of calls) {
    if (method !== 'in') continue;
    const wanted = values as string[];
    if (column === 'action_signals.action_id') {
      out = out
        .map((row) => ({
          ...row,
          action_signals: (row.action_signals as { action_id: string }[]).filter((link) =>
            wanted.includes(link.action_id),
          ),
        }))
        .filter((row) => row.action_signals.length > 0);
    } else {
      out = out.filter((row) => wanted.includes(row[column as string] as string));
    }
  }
  const range = calls.find(([method]) => method === 'range');
  return range ? out.slice(range[1] as number, (range[2] as number) + 1) : out;
}

let entityCounts: unknown[] = [];
/** Tables whose reads fail, and how. */
let errors: Record<string, { code: string; message: string }>;
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      const query = { table, calls: [] as Call[] };
      queries.push(query);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'order', 'range']) {
        chain[method] = (...args: unknown[]) => {
          query.calls.push([method, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) =>
        resolve(
          errors[table]
            ? { data: null, error: errors[table] }
            : { data: answer(table, query.calls), error: null },
        );
      return chain;
    },
    // The actions' list counts (AC-009): nothing removed here.
    rpc: async () => ({ data: entityCounts, error: null }),
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { getActionsAffected } = await import('./actionCenter');

const lost = (id: string, promptId: string, promptText: string, actions: string[]): Row => ({
  id,
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detected_at: '2026-10-09T00:00:00Z',
  last_detected_at: '2026-10-09T00:00:00Z',
  resolved_at: null,
  previous_value: null,
  current_value: null,
  change_value: null,
  payload: { promptId, promptText },
  kpi_keys: [],
  action_id: actions[0],
  action_signals: actions.map((action_id) => ({ action_id })),
});

/** A prompt an action kept when it was created (action_entities, 00244). */
const kept = (actionId: string, key: string, label: string, removed = false): Row => ({
  action_id: actionId,
  entity_type: 'prompts',
  entity_key: key,
  label,
  removed_at: removed ? '2026-10-12T00:00:00Z' : null,
});

beforeEach(() => {
  queries = [];
  entityCounts = [];
  errors = {};
  rows = {
    actions: [
      { id: 'a1', payload: {} },
      { id: 'a2', payload: {} },
      // Sent from the Improve tab: no signals, so what it was sent about.
      { id: 'a3', payload: { promptId: 'p9', promptText: 'Is Acme any good?' } },
    ],
    signals: [
      lost('s1', 'p1', 'Best coffee subscription?', ['a1']),
      lost('s2', 'p2', 'Coffee delivery near me', ['a1', 'a2']),
      // A second finding on the same prompt: one item.
      lost('s3', 'p1', 'Best coffee subscription?', ['a1']),
    ],
  };
});

describe('getActionsAffected', () => {
  it("gives each action the Affected tab's count and names", async () => {
    expect(await getActionsAffected('b1', ['a1', 'a2', 'a3'])).toEqual({
      a1: { count: 2, items: ['Best coffee subscription?', 'Coffee delivery near me'] },
      // A signal two actions took counts for both.
      a2: { count: 1, items: ['Coffee delivery near me'] },
      a3: { count: 1, items: ['Is Acme any good?'] },
    });
  });

  it('counts an action as its title does, with what was removed since (AC-009)', async () => {
    rows.actions[0].payload = { targetEntity: 'prompts', targetCount: 13 };
    entityCounts = [
      { action_id: 'a1', entity_type: 'prompts', total: 13, removed: 1, removed_labels: ['x'] },
    ];
    const result = await getActionsAffected('b1', ['a1']);
    // 13 prompts when it was created, one deleted since: 12, not the 2 the signals name now.
    expect(result.a1.count).toBe(12);
  });

  it('lists what an action kept, so its count and names agree (00244)', async () => {
    rows.actions[0].payload = { targetEntity: 'prompts', targetCount: 4 };
    entityCounts = [
      {
        action_id: 'a1',
        entity_type: 'prompts',
        total: 4,
        removed: 1,
        removed_labels: ['Old coffee prompt'],
        removed_keys: ['p4'],
      },
    ];
    // A signal the nightly pass added later, about a prompt a1 never kept.
    rows.signals.push(lost('s4', 'p3', 'Cheapest coffee beans?', ['a1']));
    rows.action_entities = [
      kept('a1', 'p1', 'Best coffee subscription?'),
      kept('a1', 'p2', 'Coffee delivery near me'),
      // Kept, but no signal names it now: listed by its label.
      kept('a1', 'p5', 'Coffee grinder reviews'),
      // Paused since: counted out, not listed.
      kept('a1', 'p4', 'Old coffee prompt', true),
    ];

    const result = await getActionsAffected('b1', ['a1', 'a2']);
    expect(result.a1).toEqual({
      count: 3,
      items: ['Best coffee subscription?', 'Coffee delivery near me', 'Coffee grinder reviews'],
    });
    expect(result.a1.items).toHaveLength(result.a1.count);
    // An action with no list reads its signals, as before.
    expect(result.a2).toEqual({ count: 1, items: ['Coffee delivery near me'] });
    // One read of the lists for the chunk, not one per action.
    const reads = queries.filter((q) => q.table === 'action_entities');
    expect(reads).toHaveLength(1);
    expect(reads[0].calls).toContainEqual(['in', 'action_id', ['a1', 'a2']]);
  });

  it("reads the kept lists past one response's rows, a page at a time", async () => {
    rows.actions[0].payload = { targetEntity: 'prompts', targetCount: 1001 };
    rows.signals = [];
    rows.action_entities = Array.from({ length: 1001 }, (_, i) =>
      kept('a1', `p${i}`, `Prompt ${i}`),
    );
    const result = await getActionsAffected('b1', ['a1']);

    expect(result.a1.count).toBe(1001);
    expect(result.a1.items).toHaveLength(1001);
    const ranges = queries
      .filter((q) => q.table === 'action_entities')
      .map((q) => q.calls.find(([method]) => method === 'range'));
    expect(ranges).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
    ]);
  });

  it('reads the signals, quietly, on a database without the kept lists (before 00244)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      rows.actions[0].payload = { targetEntity: 'prompts', targetCount: 2 };
      // What a read would have listed: one of the two.
      rows.action_entities = [kept('a1', 'p1', 'Best coffee subscription?')];
      for (const code of ['PGRST205', '42P01']) {
        errors.action_entities = { code, message: 'relation "action_entities" does not exist' };
        expect((await getActionsAffected('b1', ['a1'])).a1).toEqual({
          count: 2,
          items: ['Best coffee subscription?', 'Coffee delivery near me'],
        });
      }
      expect(logged).not.toHaveBeenCalled();

      // Any other failure is logged, and the export still reads the signals.
      errors.action_entities = { code: '57014', message: 'canceling statement' };
      expect((await getActionsAffected('b1', ['a1'])).a1.count).toBe(2);
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });

  it("reads past one response's rows, a page at a time", async () => {
    rows.signals = Array.from({ length: 1001 }, (_, i) =>
      lost(`s${i}`, `p${i}`, `Prompt ${i}`, ['a1']),
    );
    const result = await getActionsAffected('b1', ['a1']);

    expect(result.a1.count).toBe(1001);
    const ranges = queries
      .filter((q) => q.table === 'signals')
      .map((q) => q.calls.find(([method]) => method === 'range'));
    expect(ranges).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
    ]);
  });

  it('asks for at most 100 actions a request, so the URL stays short', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `x${i}`);
    await getActionsAffected('b1', ids);

    const sizes = queries
      .filter((q) => q.table === 'signals')
      .map((q) => (q.calls.find(([method]) => method === 'in')![2] as string[]).length);
    expect(sizes).toEqual([100, 50]);
  });

  it('reads nothing for no actions', async () => {
    expect(await getActionsAffected('b1', [])).toEqual({});
    expect(queries).toEqual([]);
  });
});
