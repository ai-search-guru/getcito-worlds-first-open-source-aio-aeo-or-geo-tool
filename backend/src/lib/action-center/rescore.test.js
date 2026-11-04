import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AC-007: moving a signal scores its actions again at once. Only active
 * actions the signal supports are touched, from their open signals as they
 * stand now, and a score that can't be saved never fails the request.
 */

let db;
let saves;
let failSave;

/** Enough of PostgREST: eq/in filters over in-memory rows, and updates recorded. */
function from(table) {
  const filters = [];
  let patch = null;
  const rows = () => (db[table] ?? []).filter((row) => filters.every((test) => test(row)));
  const chain = {
    select: () => chain,
    eq: (column, value) => {
      filters.push((row) => row[column] === value);
      return chain;
    },
    in: (column, values) => {
      filters.push((row) => values.includes(row[column]));
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    range: async (start, end) => ({ data: rows().slice(start, end + 1), error: null }),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    update: (values) => {
      patch = values;
      return chain;
    },
    then: (resolve, reject) => {
      if (patch) {
        if (failSave) return Promise.resolve({ error: { message: 'down' } }).then(resolve, reject);
        for (const row of rows()) saves.push({ table, id: row.id, patch });
        return Promise.resolve({ error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    },
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({ default: { from: (table) => from(table) } }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const assertBrandAccess = vi.fn();
vi.mock('../access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));

const { rescoreActionsForSignal } = await import('./priorityData.js');
const { rescoreForSignal } = await import('../../routes/actionCenter.js');

const NOW = new Date('2026-10-15T06:00:00Z');

const action = (over = {}) => ({
  id: 'a1',
  brand_id: 'b1',
  kind: 'recover_lost_citations',
  category: 'recover',
  impact: 'high',
  status: 'in_progress',
  payload: {},
  created_at: '2026-10-10T00:00:00Z',
  ...over,
});

const signal = (over = {}) => ({
  id: 's1',
  brand_id: 'b1',
  kind: 'lost_citations',
  impact: 'high',
  status: 'new',
  action_id: 'a1',
  source: ['ai_results'],
  payload: {},
  detected_at: '2026-10-14T00:00:00Z',
  ...over,
});

beforeEach(() => {
  saves = [];
  failSave = false;
  assertBrandAccess.mockReset();
  db = {
    actions: [action(), action({ id: 'closed', status: 'completed' })],
    signals: [
      signal(),
      // A second source confirming it: more confidence while it is open.
      signal({ id: 's2', kind: 'lost_citations', source: ['gsc'] }),
    ],
    action_signals: [
      { action_id: 'a1', signal_id: 's1' },
      { action_id: 'a1', signal_id: 's2' },
      { action_id: 'closed', signal_id: 's1' },
    ],
    prompt_volumes: [],
  };
});

describe('rescoreActionsForSignal', () => {
  it('scores again the active actions the signal supports, and no closed one', async () => {
    await expect(rescoreActionsForSignal('s1', NOW)).resolves.toBe(1);
    expect(saves.map((s) => s.id)).toEqual(['a1']);
    expect(saves[0].patch).toMatchObject({
      priority_updated_at: NOW.toISOString(),
      priority_score: expect.any(Number),
    });
  });

  it('loses confidence when a confirming signal is resolved', async () => {
    await rescoreActionsForSignal('s1', NOW);
    const before = saves[0].patch.priority_reason.factors.confidence;

    db.signals[1].status = 'resolved';
    saves = [];
    await rescoreActionsForSignal('s2', NOW);
    const after = saves[0].patch.priority_reason.factors.confidence;

    expect(after).toBeLessThan(before);
  });

  it('touches nothing for a signal no action uses', async () => {
    await expect(rescoreActionsForSignal('lonely', NOW)).resolves.toBe(0);
    expect(saves).toEqual([]);
  });

  it('leaves a score it cannot save to the night, without failing', async () => {
    failSave = true;
    await expect(rescoreActionsForSignal('s1', NOW)).resolves.toBe(0);
  });
});

describe('rescoreForSignal', () => {
  it("checks the signal's brand belongs to the caller before scoring", async () => {
    await expect(rescoreForSignal('s1', 'user-1')).resolves.toEqual({ rescored: 1 });
    expect(assertBrandAccess).toHaveBeenCalledWith('b1', 'user-1');
  });

  it('refuses a signal it cannot find', async () => {
    await expect(rescoreForSignal('missing', 'user-1')).rejects.toMatchObject({ status: 404 });
    expect(assertBrandAccess).not.toHaveBeenCalled();
  });

  it('scores nothing when the caller is outside the organization', async () => {
    assertBrandAccess.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 403 }));
    await expect(rescoreForSignal('s1', 'stranger')).rejects.toMatchObject({ status: 403 });
    expect(saves).toEqual([]);
  });
});
