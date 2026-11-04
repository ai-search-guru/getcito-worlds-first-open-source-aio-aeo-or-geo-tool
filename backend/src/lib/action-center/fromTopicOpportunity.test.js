import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * sendTopicOpportunityToActionCenter (VIS-011): an Opportunities topic as a
 * Growth action. These pin that the suggestions are read again on the
 * server, that the plan follows how far the brand is in the topic (G16 / G05),
 * that a topic already sent returns the open action, and that the action
 * carries a person's "created" event.
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
          : { data: { id: 'act-1', action_no: 62 }, error: null };
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

vi.mock('../../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('./sources.js', () => ({
  resolveBrandSources: async () => new Set(['tracking', 'topics', 'site', 'content']),
}));

const { sendTopicOpportunityToActionCenter, topicOpportunityImpact, topicOpportunityPlan } =
  await import('./fromTopicOpportunity.js');

const topic = { id: 't1', name: 'GEO tools for agencies', brand_id: 'b1' };

const suggestionRow = (id, volume, relevance = 0.8) => ({
  id,
  suggested_text: `prompt ${id}`,
  est_volume: volume,
  relevance,
});

beforeEach(() => {
  db = {
    inserts: [],
    insertError: null,
    rows: {
      actions: () => null,
      // The query filters on brand, topic and status (open or tracked from the
      // card, never dismissed); the mock returns what matched.
      prompt_suggestions: (f) =>
        f.brand_id === 'b1' &&
        f.topic_id === 't1' &&
        JSON.stringify(f.status) === JSON.stringify(['new', 'added'])
          ? [suggestionRow('s1', 30_000), suggestionRow('s2', 62_000)].filter((r) =>
              f.id.includes(r.id),
            )
          : [],
      prompts: () => [],
    },
  };
});

const send = (suggestionIds = ['s1', 's2']) =>
  sendTopicOpportunityToActionCenter(topic, { suggestionIds, userId: 'u1' });

describe('topicOpportunityPlan', () => {
  it('writes new content for an untracked topic and grows a tracked one', () => {
    expect(topicOpportunityPlan(0).code).toBe('G16');
    expect(topicOpportunityPlan(3).code).toBe('G05');
  });
});

describe('topicOpportunityImpact', () => {
  it('is high from 10k a month, medium from 2k', () => {
    expect([48_000, 10_000, 9_999, 2_000, 1_999, 0].map(topicOpportunityImpact)).toEqual([
      'high',
      'high',
      'medium',
      'medium',
      'low',
      'low',
    ]);
  });
});

describe('sendTopicOpportunityToActionCenter', () => {
  it('opens a Growth action with the suggestions read on the server', async () => {
    expect(await send()).toEqual({ actionId: 'act-1', actionNo: 62, created: true });

    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action).toMatchObject({
      brand_id: 'b1',
      category: 'growth',
      kind: 'topic_opportunity',
      impact: 'high',
      dedup_key: 'topic_opportunity:t1',
      kpi_keys: ['ai_visibility', 'share_of_voice'],
      baseline: { demand: 92_000, trackedPrompts: 0 },
    });
    expect(action.payload).toMatchObject({
      topicId: 't1',
      topicName: 'GEO tools for agencies',
      plan: 'G16',
      demand: 92_000,
      // Highest volume first.
      suggestions: [
        { id: 's2', text: 'prompt s2', volume: 62_000 },
        { id: 's1', text: 'prompt s1', volume: 30_000 },
      ],
      promptIds: [],
      targetEntity: 'prompts',
      targetCount: 2,
    });
  });

  it('plans G16’s tasks for an untracked topic and records who sent it', async () => {
    await send();

    const tasks = db.inserts.find((i) => i.table === 'action_tasks').row;
    expect(tasks.map((t) => t.task_key)).toContain('identify_new_content_need');
    expect(tasks.every((t) => t.action_id === 'act-1' && t.status === 'todo')).toBe(true);
    expect(db.inserts.find((i) => i.table === 'action_events').row).toMatchObject({
      action_id: 'act-1',
      event: 'created',
      actor_id: 'u1',
      data: { plan: 'G16', demand: 92_000 },
    });
  });

  it('plans G05’s tasks and keeps the tracked prompts for a topic you track', async () => {
    db.rows.prompts = (f) =>
      f.topic_id === 't1' && f.is_active === true ? [{ id: 'p1', text: 'tracked prompt' }] : [];

    await send();

    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action.payload).toMatchObject({ plan: 'G05', trackedPrompts: 1, promptIds: ['p1'] });
    const tasks = db.inserts.find((i) => i.table === 'action_tasks').row;
    expect(tasks.map((t) => t.task_key)).toContain('map_prompts_to_content');
    expect(tasks.map((t) => t.task_key)).not.toContain('identify_new_content_need');
  });

  it('returns the open action for a topic already sent', async () => {
    db.rows.actions = (f) =>
      f.dedup_key === 'topic_opportunity:t1' ? { id: 'act-0', action_no: 59 } : null;

    expect(await send()).toEqual({ actionId: 'act-0', actionNo: 59, created: false });
    expect(db.inserts).toEqual([]);
  });

  it('leaves out suggestions under the relevance threshold or not rated', async () => {
    db.rows.prompt_suggestions = () => [
      suggestionRow('s1', 30_000),
      suggestionRow('s2', 62_000, 0.5),
      suggestionRow('s3', 9_000, null),
    ];

    await send(['s1', 's2', 's3']);

    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action.payload.suggestions.map((s) => s.id)).toEqual(['s1']);
    expect(action.payload.demand).toBe(30_000);
  });

  it('counts the suggestions as the action keeps them: each text once, none empty', async () => {
    db.rows.prompt_suggestions = () => [
      suggestionRow('s1', 30_000),
      { ...suggestionRow('s2', 20_000), suggested_text: 'prompt s1' },
      { ...suggestionRow('s3', 10_000), suggested_text: '' },
    ];

    await send(['s1', 's2', 's3']);

    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action.payload).toMatchObject({ targetCount: 1, targetIds: ['prompt s1'] });
  });

  it('refuses suggestions with no words, which it couldn’t keep', async () => {
    db.rows.prompt_suggestions = () => [{ ...suggestionRow('s1', 30_000), suggested_text: '  ' }];
    await expect(send(['s1'])).rejects.toMatchObject({ status: 409 });
    expect(db.inserts.find((i) => i.table === 'actions')).toBeUndefined();
  });

  it('refuses when none of the suggestions is still open in this topic', async () => {
    db.rows.prompt_suggestions = () => [];
    await expect(send()).rejects.toMatchObject({ status: 409 });
    expect(db.inserts).toEqual([]);
  });

  it('returns the winner when another send opened it at the same moment', async () => {
    let reads = 0;
    db.rows.actions = () => (reads++ === 0 ? null : { id: 'act-9', action_no: 63 });
    db.insertError = { code: '23505', message: 'duplicate key' };

    expect(await send()).toEqual({ actionId: 'act-9', actionNo: 63, created: false });
  });
});
