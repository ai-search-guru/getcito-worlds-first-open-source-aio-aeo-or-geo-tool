import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * sendTopicGapToActionCenter (VIS-010): the heat map's biggest gap as a
 * Compete action. These pin that the gap is measured again on the server,
 * that a topic and competitor already sent return the open action, and that
 * the action carries C04's tasks and a person's "created" event.
 */

let db;

function table(name) {
  const state = { name, filters: {}, op: 'select', row: null };
  const result = () => {
    if (state.op === 'insert') {
      db.inserts.push({ table: name, row: state.row });
      if (name === 'actions') {
        return db.insertError
          ? { data: null, error: db.insertError }
          : { data: { id: 'act-1', action_no: 61 }, error: null };
      }
      return { data: null, error: null };
    }
    return { data: db.rows[name]?.(state.filters) ?? null, error: null };
  };
  const chain = {
    select: () => chain,
    insert: (row) => {
      state.op = 'insert';
      state.row = row;
      return chain;
    },
    eq: (col, val) => {
      state.filters[col] = val;
      return chain;
    },
    in: (col, val) => {
      state.filters[col] = val;
      return chain;
    },
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (name) => table(name),
    rpc: async (fn, args) => {
      db.rpcCalls.push({ fn, args });
      return { data: db.map, error: null };
    },
  },
}));
vi.mock('./sources.js', () => ({
  resolveBrandSources: async () => new Set(['tracking', 'competitors', 'topics']),
}));

const { sendTopicGapToActionCenter, topicGapImpact, topicGapScores } =
  await import('./fromTopicGap.js');

const topic = { id: 't1', name: 'AI Rank Tracker', brand_id: 'b1' };

const topicRow = (you, them) => ({
  topic_id: 't1',
  answers: 100,
  mention_answers: you,
  citation_answers: 0,
  sum_inv_position: 0,
  position_count: 0,
  competitors: [
    {
      competitor_id: 'c1',
      mention_answers: them,
      citation_answers: 0,
      sum_inv_position: 0,
      position_count: 0,
    },
  ],
});

beforeEach(() => {
  db = {
    inserts: [],
    rpcCalls: [],
    insertError: null,
    map: { complete: true, topics: [topicRow(20, 60)] },
    rows: {
      competitors: (f) =>
        f.id === 'c1' && f.brand_id === 'b1' ? { id: 'c1', name: 'Peec AI' } : null,
      actions: () => null,
      prompts: () => [
        { id: 'p1', text: 'best ai rank tracker' },
        { id: 'p2', text: 'ai rank tracker pricing' },
      ],
    },
  };
});

describe('topicGapScores', () => {
  it('scores both over your answers and gives the gap', () => {
    // 0.6 × 20% = 12.0 and 0.6 × 60% = 36.0 (no citations or positions).
    expect(topicGapScores(topicRow(20, 60), 'c1')).toEqual({
      answers: 100,
      you: 12,
      them: 36,
      gap: 24,
    });
  });

  it('scores a competitor never named in the topic 0', () => {
    expect(topicGapScores(topicRow(20, 60), 'c9').them).toBe(0);
  });
});

describe('topicGapImpact', () => {
  it('is high from 20 points, medium from 10', () => {
    expect([25, 20, 12, 10, 3].map(topicGapImpact)).toEqual([
      'high',
      'high',
      'medium',
      'medium',
      'low',
    ]);
  });
});

describe('sendTopicGapToActionCenter', () => {
  const send = (extra = {}) =>
    sendTopicGapToActionCenter(topic, {
      competitorId: 'c1',
      dayFrom: '2026-09-15',
      dayTo: '2026-10-14',
      userId: 'u1',
      ...extra,
    });

  it('opens a Compete action with the gap measured on the server', async () => {
    const result = await send({ models: ['gpt-4o'], region: 'US' });

    expect(result).toEqual({ actionId: 'act-1', actionNo: 61, created: true });
    expect(db.rpcCalls[0]).toEqual({
      fn: 'insights_topic_competitors_daily',
      args: {
        p_brand_id: 'b1',
        p_day_from: '2026-09-15',
        p_day_to: '2026-10-14',
        p_models: ['gpt-4o'],
        p_region: 'US',
      },
    });

    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action).toMatchObject({
      brand_id: 'b1',
      category: 'compete',
      kind: 'topic_competitor_gap',
      impact: 'high',
      dedup_key: 'topic_gap:t1',
      kpi_keys: ['ai_visibility', 'share_of_voice'],
      baseline: { yourScore: 12, competitorScore: 36, gap: 24 },
    });
    expect(action.payload).toMatchObject({
      topicName: 'AI Rank Tracker',
      competitorName: 'Peec AI',
      competitorNames: ['Peec AI'],
      gap: 24,
      promptIds: ['p1', 'p2'],
      targetEntity: 'prompts',
      targetCount: 2,
    });
  });

  it('plans C04’s tasks and records who sent it', async () => {
    await send();

    const tasks = db.inserts.find((i) => i.table === 'action_tasks').row;
    expect(tasks.map((t) => t.task_key)).toEqual([
      'analyze_topic_gap',
      'analyze_competitor_visibility',
      'analyze_competitor_content',
      'cluster_prompts',
      'map_prompts_to_content',
      'identify_content_gaps',
      'optimize_content',
      'validate_topic_sov',
      'measure_action_outcome',
    ]);
    expect(tasks.every((t) => t.action_id === 'act-1' && t.status === 'todo')).toBe(true);
    expect(db.inserts.find((i) => i.table === 'action_events').row).toMatchObject({
      action_id: 'act-1',
      event: 'created',
      actor_id: 'u1',
    });
  });

  it('returns the open action for a topic already sent, whoever leads it now', async () => {
    db.rows.actions = (f) =>
      f.dedup_key === 'topic_gap:t1' ? { id: 'act-0', action_no: 58 } : null;

    expect(await send()).toEqual({ actionId: 'act-0', actionNo: 58, created: false });
    expect(db.inserts).toEqual([]);
  });

  it('refuses a competitor that is not the brand’s', async () => {
    await expect(send({ competitorId: 'c9' })).rejects.toMatchObject({ status: 404 });
    expect(db.inserts).toEqual([]);
  });

  it('refuses a topic the competitor does not lead', async () => {
    db.map = { complete: true, topics: [topicRow(60, 20)] };
    await expect(send()).rejects.toMatchObject({ status: 409 });
    expect(db.inserts).toEqual([]);
  });

  it('refuses a topic with too few answers to measure', async () => {
    db.map = { complete: true, topics: [{ ...topicRow(2, 12), answers: 15 }] };
    await expect(send()).rejects.toMatchObject({ status: 409, message: /Too few answers/ });
    expect(db.inserts).toEqual([]);
  });

  it('refuses before the rollups are backfilled', async () => {
    db.map = { complete: false, topics: [topicRow(20, 60)] };
    await expect(send()).rejects.toMatchObject({ status: 409 });
  });
});
