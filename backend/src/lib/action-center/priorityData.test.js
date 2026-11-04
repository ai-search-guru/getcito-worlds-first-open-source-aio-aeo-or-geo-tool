import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the priority score reads (AC-006): each prompt's demand and intent,
 * the largest volume across its rows and the newest intent. And a brand's
 * actions scored again in one go, from their own open signals.
 */

let rows = [];
let reads = [];
let pages = [];
let fail = false;
let actionRows = [];
let signalRows = [];
let queries = [];
let saved = [];
let unsaved = new Set();
let levelRows = [];
let levelReads = [];
let levelsFail = false;
let rpcCalls = [];
let rpcResult = { data: [], error: null };

vi.mock('../../config/supabase.js', () => ({
  default: {
    rpc: async (fn, args) => {
      rpcCalls.push([fn, args]);
      return rpcResult;
    },
    from: (table) => {
      let ids = [];
      const op = { table, filters: [] };
      queries.push(op);
      const chain = {
        select: () => chain,
        eq: (column, value) => {
          op.filters.push(['eq', column, value]);
          return chain;
        },
        in: (column, values) => {
          op.filters.push(['in', column, values]);
          if (table === 'prompt_volumes') {
            ids = values;
            reads.push(values);
          }
          if (table === 'prompt_demand') {
            ids = values;
            levelReads.push(values);
          }
          return chain;
        },
        is: (column, value) => {
          op.filters.push(['is', column, value]);
          return chain;
        },
        not: (column, operator, value) => {
          op.filters.push(['not', column, value]);
          return chain;
        },
        order: () => chain,
        limit: async () => ({
          data: table === 'actions' ? actionRows : signalRows,
          error: null,
        }),
        range: async (from, to) => {
          pages.push([from, to]);
          if (fail) return { data: null, error: { message: 'timeout' } };
          const matching = rows.filter((r) => ids.includes(r.prompt_id));
          return { data: matching.slice(from, to + 1), error: null };
        },
        update: (row) => {
          op.update = row;
          return chain;
        },
        // An update, awaited after its .eq('id', …); or the demand levels' read.
        then: (resolve) => {
          if (table === 'prompt_demand') {
            if (levelsFail) return resolve({ data: null, error: { message: 'no such table' } });
            return resolve({
              data: levelRows.filter((r) => ids.includes(r.prompt_id)),
              error: null,
            });
          }
          const id = op.filters.find(([, column]) => column === 'id')?.[2];
          if (unsaved.has(id)) return resolve({ error: { message: 'write failed' } });
          saved.push({ id, row: op.update });
          return resolve({ error: null });
        },
      };
      return chain;
    },
  },
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { loadKindTrack, loadPromptDemand, priorityOnCreate, rescoreBrandActions } =
  await import('./priorityData.js');

beforeEach(() => {
  reads = [];
  pages = [];
  fail = false;
  actionRows = [];
  signalRows = [];
  queries = [];
  saved = [];
  unsaved = new Set();
  levelRows = [];
  levelReads = [];
  levelsFail = false;
  rpcCalls = [];
  rpcResult = { data: [], error: null };
  // Newest first, as the read orders them.
  rows = [
    { prompt_id: 'p1', est_ai_volume: 300, intent: 'comparison', fetched_at: '2026-10-10' },
    { prompt_id: 'p1', est_ai_volume: 900, intent: 'other', fetched_at: '2026-09-01' },
    { prompt_id: 'p2', est_ai_volume: null, intent: 'how-to', fetched_at: '2026-10-10' },
  ];
});

describe('loadPromptDemand', () => {
  it("takes each prompt's largest volume and newest intent", async () => {
    const demand = await loadPromptDemand(['p1', 'p2', 'p1']);
    expect(Object.fromEntries(demand)).toEqual({
      p1: { volume: 900, intent: 'comparison', level: null },
      p2: { volume: null, intent: 'how-to', level: null },
    });
  });

  it("adds each prompt's measured demand level, also for a prompt with no volume", async () => {
    levelRows = [
      { prompt_id: 'p1', level: 'high' },
      { prompt_id: 'p3', level: 'medium' },
    ];
    const demand = await loadPromptDemand(['p1', 'p2', 'p3']);
    expect(levelReads).toEqual([['p1', 'p2', 'p3']]);
    expect(Object.fromEntries(demand)).toEqual({
      p1: { volume: 900, intent: 'comparison', level: 'high' },
      p2: { volume: null, intent: 'how-to', level: null },
      p3: { volume: null, intent: null, level: 'medium' },
    });
  });

  it('keeps the volumes when the levels cannot be read', async () => {
    levelsFail = true;
    const demand = await loadPromptDemand(['p1']);
    expect(demand.get('p1')).toEqual({ volume: 900, intent: 'comparison', level: null });
  });

  it('reads long lists in pieces', async () => {
    await loadPromptDemand(Array.from({ length: 320 }, (_, i) => `p${i}`));
    expect(reads.map((ids) => ids.length)).toEqual([150, 150, 20]);
  });

  it('pages through a prompt with more rows than a response holds', async () => {
    rows = Array.from({ length: 1200 }, (_, i) => ({
      prompt_id: 'busy',
      est_ai_volume: i,
      intent: i === 0 ? 'comparison' : 'other',
      fetched_at: '2026-10-10',
    }));
    const demand = await loadPromptDemand(['busy']);
    expect(pages).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(demand.get('busy')).toEqual({ volume: 1199, intent: 'comparison', level: null });
  });

  it('reads nothing for no prompts', async () => {
    expect((await loadPromptDemand([])).size).toBe(0);
    expect(reads).toEqual([]);
    expect(levelReads).toEqual([]);
  });
});

describe('loadKindTrack', () => {
  it("reads the brand's own results by kind over the last half year (learning B4)", async () => {
    rpcResult = {
      data: [
        { kind: 'recover_lost_citations', improved: 2, mixed: 1, no_change: 1, declined: 1 },
        { kind: 'fix_low_scores', improved: 0, mixed: 0, no_change: 0, declined: 0 },
      ],
      error: null,
    };

    const track = await loadKindTrack('b1', new Date('2026-10-15T00:00:00Z'));

    expect(rpcCalls).toEqual([
      ['action_scorecard', { p_brand_id: 'b1', p_since: '2026-04-18T00:00:00.000Z' }],
    ]);
    expect(track.get('recover_lost_citations')).toEqual({ improved: 2, results: 5 });
    expect(track.get('fix_low_scores')).toEqual({ improved: 0, results: 0 });
  });
});

describe('priorityOnCreate', () => {
  const NOW = new Date('2026-10-15T00:00:00Z');
  const improve = {
    kind: 'prompt_improve',
    category: 'compete',
    impact: 'medium',
    payload: { promptIds: ['p1'], platforms: [{ id: 'gemini-web', state: 'not_mentioned' }] },
  };

  it('scores an action as it is written', async () => {
    expect(await priorityOnCreate(improve, NOW)).toMatchObject({
      priority_score: expect.any(Number),
      priority_reason: expect.objectContaining({ demand: 'high', commercial: true }),
      priority_updated_at: NOW.toISOString(),
    });
  });

  it('still scores it when the demand cannot be read', async () => {
    fail = true;
    const columns = await priorityOnCreate(improve, NOW);
    expect(columns.priority_reason.demand).toBeNull();
    expect(columns.priority_score).toEqual(expect.any(Number));
  });

  it("weighs how its kind did at the brand, and scores it without when that can't be read", async () => {
    rpcResult = {
      data: [{ kind: 'prompt_improve', improved: 3, mixed: 0, no_change: 0, declined: 0 }],
      error: null,
    };
    const withTrack = await priorityOnCreate({ ...improve, brand_id: 'b1' }, NOW);
    expect(rpcCalls).toHaveLength(1);
    expect(withTrack.priority_reason.pastSuccess).toEqual({
      improved: 3,
      results: 3,
      points: 3.75,
    });

    rpcResult = { data: null, error: { message: 'timeout' } };
    const without = await priorityOnCreate({ ...improve, brand_id: 'b1' }, NOW);
    expect(without.priority_reason.pastSuccess).toBeNull();
    expect(without.priority_reason.factors).not.toHaveProperty('pastSuccess');
    expect(without.priority_score).toBeLessThan(withTrack.priority_score);
  });
});

describe('rescoreBrandActions', () => {
  const NOW = new Date('2026-10-18T03:00:00Z');
  const recover = (id, payload = {}) => ({
    id,
    kind: 'recover_lost_citations',
    category: 'recover',
    impact: 'high',
    payload,
    created_at: '2026-09-27T02:00:00Z',
  });
  const filtersOf = (table) => queries.find((q) => q.table === table).filters;

  it("scores a brand's active actions, each from its own open signals", async () => {
    actionRows = [recover('a1', { promptIds: ['p1'] }), recover('a2')];
    signalRows = [
      {
        id: 's1',
        action_id: 'a1',
        kind: 'citation_lost',
        impact: 'high',
        payload: {},
        detected_at: '2026-10-16T02:00:00Z',
      },
    ];

    expect(await rescoreBrandActions('b1', { now: NOW })).toBe(2);

    expect(filtersOf('actions')).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['in', 'status', ['new', 'in_progress', 'on_hold']],
    ]);
    expect(filtersOf('signals')).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['in', 'status', ['new', 'acknowledged']],
      ['not', 'action_id', null],
    ]);
    // The signals, the demand and the track are read once for the brand, not per action.
    expect(queries.filter((q) => q.table === 'signals')).toHaveLength(1);
    expect(reads).toEqual([['p1']]);
    expect(rpcCalls.map(([fn, args]) => [fn, args.p_brand_id])).toEqual([
      ['action_scorecard', 'b1'],
    ]);

    const byId = Object.fromEntries(saved.map(({ id, row }) => [id, row]));
    expect(byId.a1).toMatchObject({
      priority_score: expect.any(Number),
      priority_updated_at: NOW.toISOString(),
    });
    expect(byId.a1.priority_reason).toMatchObject({ days: 2, kinds: 1, demand: 'high' });
    // No open signal of its own: nothing says what changed or when.
    expect(byId.a2.priority_reason).toMatchObject({ days: null, kinds: 0 });
  });

  it('backfills only the actions with no score, in any status', async () => {
    actionRows = [recover('a1')];

    expect(await rescoreBrandActions('b1', { now: NOW, statuses: null, unscored: true })).toBe(1);
    expect(filtersOf('actions')).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['is', 'priority_score', null],
    ]);
  });

  it('reads nothing more for a brand with no actions', async () => {
    expect(await rescoreBrandActions('b1', { now: NOW })).toBe(0);
    expect(queries.map((q) => q.table)).toEqual(['actions']);
  });

  it('leaves an action whose score, level and reason are what is stored', async () => {
    const signal = {
      id: 's1',
      action_id: 'a1',
      kind: 'citation_lost',
      impact: 'high',
      payload: {},
      detected_at: '2026-10-16T02:00:00Z',
    };
    actionRows = [recover('a1', { promptIds: ['p1'] }), recover('a2')];
    signalRows = [signal];
    expect(await rescoreBrandActions('b1', { now: NOW })).toBe(2);

    // Scored again the same night (the demand sweep after the signal pass):
    // a1 is as stored (read back as jsonb), a2's stored score is older.
    const stored = Object.fromEntries(saved.map(({ id, row }) => [id, row]));
    actionRows = [
      {
        ...recover('a1', { promptIds: ['p1'] }),
        priority_score: stored.a1.priority_score,
        priority_level: stored.a1.priority_level,
        priority_reason: JSON.parse(JSON.stringify(stored.a1.priority_reason)),
      },
      {
        ...recover('a2'),
        priority_score: stored.a2.priority_score - 5,
        priority_level: stored.a2.priority_level,
        priority_reason: stored.a2.priority_reason,
      },
    ];
    saved = [];

    expect(await rescoreBrandActions('b1', { now: NOW })).toBe(1);
    expect(saved.map(({ id }) => id)).toEqual(['a2']);
  });

  it('carries on past a score it cannot save, and without demand', async () => {
    actionRows = [recover('a1', { promptIds: ['p1'] }), recover('a2')];
    unsaved.add('a1');
    fail = true;

    expect(await rescoreBrandActions('b1', { now: NOW })).toBe(1);
    expect(saved.map(({ id }) => id)).toEqual(['a2']);
  });
});
