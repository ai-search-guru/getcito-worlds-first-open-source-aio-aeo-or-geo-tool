import { beforeEach, describe, expect, it, vi } from 'vitest';

// The nightly run's same-question merge (opportunityGenerator.js) into an
// opportunity with no cluster of its own, as Send to Content makes: its
// clusters aren't read as covered, so the cluster comes back every night.

let db;
let writes;

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => ({
      update: (payload) => ({
        eq: async (col, value) => {
          writes.push({ table, id: value, payload });
          for (const row of db[table].filter((r) => r[col] === value)) Object.assign(row, payload);
          return { error: null };
        },
      }),
    }),
  },
}));

const { mergeSameQuestion, openCandidates } = await import('./opportunityGenerator.js');
const { coveredClusterIds } = await import('./opportunityLimits.js');

const QUESTION = 'What are the best coffee subscription services in 2026?';

const cluster = {
  id: 'c1',
  label: 'Coffee subscriptions',
  topic_id: null,
  prompt_ids: ['p1'],
  promptTexts: [QUESTION],
};
const basketRows = [
  { cluster_id: 'c1', query: 'coffee subscription reviews', times_searched: 40, included: true },
  { cluster_id: 'c1', query: 'best coffee subscription', times_searched: 5, included: true },
];

/** One night: read the rows, take the open clusters, merge by question. */
async function night() {
  const rows = JSON.parse(JSON.stringify(db.content_opportunities));
  // loadClusterOpportunities reads only the rows with a cluster.
  const covered = coveredClusterIds(rows.filter((r) => r.cluster_id));
  const candidates = [
    {
      id: 'c1',
      score: 70,
      metrics: { tested: 3, representative: { id: 'p1', text: QUESTION }, demand: 900 },
      components: { demand: 60, visibilityGap: 70, competitorGap: 30, intent: 80 },
    },
  ];
  const open = openCandidates(candidates, { covered, inFocus: () => true });
  const into = await mergeSameQuestion(open, rows, {
    clusterById: new Map([['c1', cluster]]),
    basketRows,
    covered,
    topicName: () => null,
    source: 'system',
  });
  return { open, covered, into };
}

const timesSearched = () =>
  Object.fromEntries(
    db.content_opportunities[0].source_data.queries.top.map((q) => [q.query, q.timesSearched]),
  );

beforeEach(() => {
  writes = [];
  db = {
    content_opportunities: [
      {
        id: 'o1',
        title: 'Compare coffee subscriptions',
        status: 'new',
        source: 'prompt',
        created_at: '2026-10-30T00:00:00Z',
        prompt_id: 'p1',
        cluster_id: null,
        related_cluster_ids: [],
        opportunity_score: 50,
        impact: 'medium',
        source_data: {
          promptText: QUESTION,
          queries: {
            included: 1,
            excluded: 0,
            top: [{ query: 'best coffee subscription', timesSearched: 10 }],
          },
        },
      },
    ],
  };
});

describe('mergeSameQuestion on two nights in a row', () => {
  it('merges a cluster into an opportunity with no cluster once, not again the next night', async () => {
    const first = await night();
    expect(first.into.get('c1')).toBe('o1');
    expect(writes).toHaveLength(1);
    expect(db.content_opportunities[0].related_cluster_ids).toEqual(['c1']);
    expect(timesSearched()).toEqual({
      'coffee subscription reviews': 40,
      'best coffee subscription': 15,
    });

    // The opportunity still has no cluster, so the cluster is open again.
    const second = await night();
    expect(writes).toHaveLength(1);
    expect(timesSearched()).toEqual({
      'coffee subscription reviews': 40,
      'best coffee subscription': 15,
    });
    expect(db.content_opportunities[0].source_data.merged).toHaveLength(1);
    // It stays with the opportunity it joined: covered, and not written as a new one.
    expect(second.into.get('c1')).toBe('o1');
    expect(second.covered.has('c1')).toBe(true);
    expect(second.open).toEqual([]);
  });
});
