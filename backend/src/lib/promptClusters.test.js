import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

const {
  MAX_QUERIES_PER_CLUSTER,
  clusterQueries,
  keepClusterIds,
  normalizeClusters,
  scopeFingerprint,
} = await import('./promptClusters.js');

const prompts = ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `prompt ${id}` }));

describe('scopeFingerprint', () => {
  it('ignores order but not text', () => {
    const same = scopeFingerprint([...prompts].reverse());
    expect(scopeFingerprint(prompts)).toBe(same);
    const edited = prompts.map((p) => (p.id === 'b' ? { ...p, text: 'reworded' } : p));
    expect(scopeFingerprint(edited)).not.toBe(same);
  });
});

describe('normalizeClusters', () => {
  it('puts every prompt in exactly one cluster', () => {
    const rows = normalizeClusters(prompts, [
      { label: 'one', primaryIntent: 'x', secondaryIntents: ['y'], promptIndexes: [0, 1, 1, 9] },
      { label: 'two', primaryIntent: 'z', promptIndexes: [1, 2] },
      { label: 'empty', primaryIntent: 'e', promptIndexes: [7] },
    ]);
    expect(rows.map((r) => [r.label, r.prompt_ids])).toEqual([
      ['one', ['a', 'b']],
      ['two', ['c']],
      // Left out by the model, so it stands alone instead of disappearing.
      ['prompt d', ['d']],
    ]);
    expect(rows[1].secondary_intents).toEqual([]);
  });
});

describe('keepClusterIds', () => {
  it('reuses the id of the old cluster a new one mostly continues', () => {
    const next = [
      { prompt_ids: ['a', 'b', 'c'] },
      { prompt_ids: ['d'] },
      { prompt_ids: ['e', 'f'] },
    ];
    const previous = [
      { id: 'old-1', prompt_ids: ['a', 'b'] },
      { id: 'old-2', prompt_ids: ['d', 'e', 'f', 'g'] },
    ];
    // a,b,c vs a,b: 2/3 keeps old-1. e,f vs d,e,f,g: 2/4 keeps old-2, and wins
    // over d (1/4, below the bar).
    expect(keepClusterIds(next, previous).map((c) => c.id)).toEqual(['old-1', null, 'old-2']);
  });

  it('gives an old id to one new cluster only', () => {
    const next = [{ prompt_ids: ['a', 'b'] }, { prompt_ids: ['a', 'b', 'c'] }];
    const previous = [{ id: 'old', prompt_ids: ['a', 'b'] }];
    expect(keepClusterIds(next, previous).map((c) => c.id)).toEqual(['old', null]);
  });
});

describe('clusterQueries', () => {
  it('sums a query across member prompts and ranks by searches', () => {
    const clusterOf = new Map([
      ['p1', 'c1'],
      ['p2', 'c1'],
      ['p3', 'c2'],
    ]);
    const out = clusterQueries(
      [
        ['p1', 'ai visibility tracking', 3],
        ['p2', 'ai visibility tracking', 2],
        ['p2', 'chatgpt pricing', 4],
        ['p3', 'ai visibility tracking', 2],
        ['p9', 'unclustered prompt', 9],
      ],
      clusterOf,
    );
    expect(out.get('c1')).toEqual([
      { query: 'ai visibility tracking', times: 5 },
      { query: 'chatgpt pricing', times: 4 },
    ]);
    expect(out.get('c2')).toEqual([{ query: 'ai visibility tracking', times: 2 }]);
    expect(out.size).toBe(2);
  });

  it('keeps only the most searched queries per cluster', () => {
    const rows = Array.from({ length: MAX_QUERIES_PER_CLUSTER + 5 }, (_, i) => [
      'p1',
      `q${i}`,
      i + 1,
    ]);
    const out = clusterQueries(rows, new Map([['p1', 'c1']])).get('c1');
    expect(out).toHaveLength(MAX_QUERIES_PER_CLUSTER);
    expect(out[0].times).toBe(MAX_QUERIES_PER_CLUSTER + 5);
  });
});
