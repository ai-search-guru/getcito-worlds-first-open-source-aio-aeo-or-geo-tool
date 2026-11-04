import { beforeEach, describe, expect, it, vi } from 'vitest';

// The one-off merge of open opportunities on the same question: dry unless
// asked to apply, the one kept written first, the others archived.

let db;
let writes;

function table(name) {
  const q = { op: 'select', filters: [], payload: null };
  const rows = () => (db[name] ?? []).filter((row) => q.filters.every((test) => test(row)));
  const run = () => {
    if (q.op === 'select') return { data: rows(), error: null };
    db.beforeWrite?.();
    const matched = rows();
    writes.push({ table: name, id: matched[0]?.id ?? null, payload: q.payload });
    for (const row of matched) Object.assign(row, q.payload);
    return { data: matched.map((r) => ({ id: r.id })), error: null };
  };
  const chain = {
    select: () => chain,
    eq: (col, value) => (q.filters.push((row) => row[col] === value), chain),
    in: (col, values) => (q.filters.push((row) => values.includes(row[col])), chain),
    order: () => chain,
    range: () => chain,
    update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));

const { mergeBrandSameQuestion } = await import('./opportunitySameQuestionMerge.js');

const QUESTION = 'What are the best coffee subscription services in 2026?';
const opp = (over) => ({
  brand_id: 'b1',
  title: 'An opportunity',
  status: 'new',
  source: 'system',
  created_at: '2026-10-11T00:00:00Z',
  updated_at: '2026-10-13T00:00:00Z',
  prompt_id: 'p1',
  cluster_id: null,
  related_cluster_ids: [],
  opportunity_score: 50,
  impact: 'medium',
  source_data: { promptText: QUESTION },
  ...over,
});

beforeEach(() => {
  writes = [];
  db = {
    content_opportunities: [
      opp({ id: 'o1', cluster_id: 'c1', opportunity_score: 60 }),
      opp({ id: 'o2', cluster_id: 'c2', opportunity_score: 72 }),
      opp({ id: 'o3', prompt_id: 'p3', source_data: { promptText: 'Best espresso machines' } }),
      opp({ id: 'o4', status: 'archived' }),
    ],
    prompt_cluster_members: [{ prompt_id: 'p1', cluster_id: 'c1' }],
    prompts: [{ id: 'p1', text: QUESTION }],
    content_drafts: [{ opportunity_id: 'o1' }],
  };
});

describe('mergeBrandSameQuestion', () => {
  it('only says what it would do by default', async () => {
    const result = await mergeBrandSameQuestion('b1');
    expect(result.groups).toEqual([
      {
        keep: expect.objectContaining({ id: 'o1', hasDraft: true }),
        merge: [expect.objectContaining({ id: 'o2', score: 72 })],
      },
    ]);
    expect(result.merged).toBe(0);
    expect(writes).toEqual([]);
  });

  it('writes the one kept, then archives the others pointing at it', async () => {
    const result = await mergeBrandSameQuestion('b1', { apply: true });
    expect(result.merged).toBe(1);
    expect(writes.map((w) => w.id)).toEqual(['o1', 'o2']);
    const [o1, o2] = db.content_opportunities;
    expect(o1).toMatchObject({ status: 'new', opportunity_score: 72, related_cluster_ids: ['c2'] });
    expect(o1.source_data.merged).toEqual([expect.objectContaining({ opportunityId: 'o2' })]);
    expect(o2).toMatchObject({ status: 'archived', source_data: { mergedInto: 'o1' } });

    // A second run finds one open opportunity on the question.
    writes = [];
    expect(await mergeBrandSameQuestion('b1', { apply: true })).toEqual({ groups: [], merged: 0 });
    expect(writes).toEqual([]);
  });

  it('skips a group whose kept opportunity changed meanwhile', async () => {
    db.beforeWrite = () => {
      db.content_opportunities[0].updated_at = '2026-10-30T00:00:00Z';
    };
    const result = await mergeBrandSameQuestion('b1', { apply: true });
    expect(result).toMatchObject({ merged: 0, groups: [{ skipped: 'changed' }] });
    expect(db.content_opportunities[1].status).toBe('new');
  });
});
