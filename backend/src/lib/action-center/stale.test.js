import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IN_FILTER_CHUNK } from '../chunkedIn.js';

// Stale actions: New for staleAfterDays with no one's event. Marked, never
// closed; cleared once someone touches the action or it leaves New.

let db;
let writes;
let reads;

/** `actions.brand_id` on an event reads its action's column, as `actions!inner` does. */
const col = (row, path) => path.split('.').reduce((value, key) => value?.[key] ?? null, row);

function table(name) {
  const q = { op: 'select', filters: [], payload: null, order: null, limit: Infinity, ins: [] };
  const source = () =>
    name === 'action_events'
      ? (db.action_events ?? []).map((e) => ({
          ...e,
          actions: db.actions.find((a) => a.id === e.action_id) ?? null,
        }))
      : (db[name] ?? []);
  const rows = () => {
    const matched = source().filter((row) => q.filters.every((test) => test(row)));
    if (q.order) {
      const { by, ascending } = q.order;
      matched.sort((a, b) => (a[by] < b[by] ? -1 : a[by] > b[by] ? 1 : 0) * (ascending ? 1 : -1));
    }
    return matched.slice(0, q.limit);
  };
  const run = () => {
    if (q.op === 'select') {
      reads.push({ table: name, limit: q.limit, ins: q.ins });
      return { data: rows(), error: null };
    }
    const matched = rows();
    writes.push({ table: name, ins: q.ins, ids: matched.map((r) => r.id), payload: q.payload });
    for (const row of matched) Object.assign(row, q.payload);
    return { data: null, error: null };
  };
  const chain = {
    select: () => chain,
    eq: (c, value) => (q.filters.push((row) => col(row, c) === value), chain),
    neq: (c, value) => (q.filters.push((row) => col(row, c) !== value), chain),
    in: (c, values) => (
      q.ins.push(values.length),
      q.filters.push((row) => values.includes(col(row, c))),
      chain
    ),
    is: (c, value) => (q.filters.push((row) => col(row, c) === value), chain),
    not: (c, op, value) => (q.filters.push((row) => col(row, c) !== value), chain),
    gte: (c, value) => (q.filters.push((row) => col(row, c) >= value), chain),
    lt: (c, value) => (q.filters.push((row) => col(row, c) < value), chain),
    order: (by, { ascending }) => ((q.order = { by, ascending }), chain),
    limit: (n) => ((q.limit = n), chain),
    update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));

const { STALE_CHECKS_PER_BRAND, staleChanges, sweepStaleActions } = await import('./stale.js');

const NOW = new Date('2026-10-31T03:00:00Z');
const action = (over) => ({
  brand_id: 'b1',
  status: 'new',
  created_at: '2026-09-01T00:00:00Z',
  stale_at: null,
  deleted_at: null,
  ...over,
});
/** `n` actions of brand b1, a minute apart from 2026-08-01 on. */
const many = (n, prefix, over = {}) =>
  Array.from({ length: n }, (_, i) =>
    action({
      id: `${prefix}-${String(i).padStart(4, '0')}`,
      created_at: new Date(Date.parse('2026-08-01T00:00:00Z') + i * 60_000).toISOString(),
      ...over,
    }),
  );
const byId = () => Object.fromEntries(db.actions.map((a) => [a.id, a]));

beforeEach(() => {
  writes = [];
  reads = [];
  db = {
    brands: [
      { id: 'b1', is_demo: false },
      { id: 'demo', is_demo: true },
    ],
    actions: [
      action({ id: 'quiet' }),
      action({ id: 'touched' }),
      action({ id: 'young', created_at: '2026-10-20T00:00:00Z' }),
      action({ id: 'moved-on', status: 'in_progress', stale_at: '2026-10-01T00:00:00Z' }),
      action({ id: 'still-quiet', stale_at: '2026-10-01T00:00:00Z' }),
      action({ id: 'deleted', deleted_at: '2026-10-02T00:00:00Z' }),
      action({ id: 'other-brand', brand_id: 'b2' }),
    ],
    action_events: [
      // Someone assigned it last week.
      { action_id: 'touched', actor_id: 'u1', created_at: '2026-10-24T00:00:00Z' },
      // The engine's own line counts for nothing.
      { action_id: 'quiet', actor_id: null, created_at: '2026-10-30T00:00:00Z' },
      // Someone's, but before the window.
      { action_id: 'quiet', actor_id: 'u1', created_at: '2026-09-02T00:00:00Z' },
    ],
  };
});

describe('staleChanges', () => {
  it('marks quiet New actions past the age, and clears the rest that were stale', () => {
    const since = new Date('2026-10-01T03:00:00Z');
    expect(
      staleChanges(
        [
          action({ id: 'a' }),
          action({ id: 'b', stale_at: '2026-10-01T00:00:00Z' }),
          action({ id: 'c', status: 'on_hold', stale_at: '2026-10-01T00:00:00Z' }),
          action({ id: 'd', created_at: '2026-10-15T00:00:00Z' }),
          action({ id: 'e' }),
        ],
        new Set(['e']),
        since,
      ),
    ).toEqual({ mark: ['a'], clear: ['c'] });
  });
});

describe('sweepStaleActions', () => {
  it("marks the brand's quiet New actions and clears the ones no longer stale", async () => {
    expect(await sweepStaleActions('b1', { now: NOW })).toEqual({ marked: 1, cleared: 1 });
    const rows = byId();
    expect(rows.quiet.stale_at).toBe(NOW.toISOString());
    // Never closed: it stays New.
    expect(rows.quiet.status).toBe('new');
    expect(rows['moved-on'].stale_at).toBeNull();
    expect(rows['still-quiet'].stale_at).toBe('2026-10-01T00:00:00Z');
    for (const id of ['touched', 'young', 'deleted', 'other-brand']) {
      expect(rows[id].stale_at).toBeNull();
    }
  });

  it('clears a marked action someone had an event on, as the server logs it', async () => {
    // Sent a task yesterday (taskSend.js logs it as the person).
    db.action_events.push({
      action_id: 'still-quiet',
      actor_id: 'u1',
      created_at: '2026-10-30T00:00:00Z',
    });
    expect(await sweepStaleActions('b1', { now: NOW })).toEqual({ marked: 1, cleared: 2 });
    expect(byId()['still-quiet'].stale_at).toBeNull();
  });

  it('writes nothing on a second night', async () => {
    await sweepStaleActions('b1', { now: NOW });
    writes = [];
    expect(await sweepStaleActions('b1', { now: NOW })).toEqual({ marked: 0, cleared: 0 });
    expect(writes).toEqual([]);
  });

  it('looks at a bounded number of rows per brand, for each question', async () => {
    await sweepStaleActions('b1', { now: NOW });
    const windows = reads.filter((r) => r.ins.length === 0 && r.table !== 'brands');
    expect(windows.map((r) => r.limit)).toEqual([
      STALE_CHECKS_PER_BRAND,
      STALE_CHECKS_PER_BRAND,
      STALE_CHECKS_PER_BRAND,
    ]);
  });

  // A demo brand (00380) is read-only: Still relevant is refused there, so a
  // demo action marked stale could never be cleared.
  it('leaves a demo brand alone', async () => {
    db.actions.push(action({ id: 'demo-quiet', brand_id: 'demo' }));
    expect(await sweepStaleActions('demo', { now: NOW })).toEqual({
      marked: 0,
      cleared: 0,
      skipped: 'demo_brand',
    });
    expect(byId()['demo-quiet'].stale_at).toBeNull();
    expect(reads.filter((r) => r.table !== 'brands')).toEqual([]);
    expect(writes).toEqual([]);
  });

  // The ids go in the URL: 500 of them (~20 kB) can be refused at the edge.
  it(`marks and clears ${IN_FILTER_CHUNK} ids per request`, async () => {
    db.actions = [
      ...many(250, 'quiet'),
      ...many(250, 'done', { status: 'completed', stale_at: '2026-10-01T00:00:00Z' }),
    ];
    db.action_events = [];
    expect(await sweepStaleActions('b1', { now: NOW })).toEqual({ marked: 250, cleared: 250 });
    expect(
      writes.map((w) => [w.payload.stale_at === null ? 'clear' : 'mark', w.ids.length]),
    ).toEqual([
      ['mark', 100],
      ['mark', 100],
      ['mark', 50],
      ['clear', 100],
      ['clear', 100],
      ['clear', 50],
    ]);
    for (const request of [...reads, ...writes]) {
      for (const n of request.ins) expect(n).toBeLessThanOrEqual(IN_FILTER_CHUNK);
    }
    expect(db.actions.filter((a) => a.status === 'new').every((a) => a.stale_at)).toBe(true);
    expect(db.actions.filter((a) => a.status !== 'new').every((a) => !a.stale_at)).toBe(true);
  });

  it('reaches quiet actions past a window full of ones already marked', async () => {
    db.actions = [
      // The oldest: marked on an earlier night, still New, still quiet.
      ...many(STALE_CHECKS_PER_BRAND, 'marked', { stale_at: '2026-10-01T00:00:00Z' }),
      action({ id: 'newer-quiet', created_at: '2026-09-15T00:00:00Z' }),
    ];
    db.action_events = [];
    expect(await sweepStaleActions('b1', { now: NOW })).toEqual({ marked: 1, cleared: 0 });
    expect(byId()['newer-quiet'].stale_at).toBe(NOW.toISOString());
  });

  it('works through a backlog bigger than the window over the next nights', async () => {
    db.actions = many(STALE_CHECKS_PER_BRAND + 120, 'quiet');
    db.action_events = [];
    expect(await sweepStaleActions('b1', { now: NOW })).toEqual({
      marked: STALE_CHECKS_PER_BRAND,
      cleared: 0,
    });
    expect(await sweepStaleActions('b1', { now: NOW })).toEqual({ marked: 120, cleared: 0 });
    expect(db.actions.every((a) => a.stale_at)).toBe(true);
  });
});
