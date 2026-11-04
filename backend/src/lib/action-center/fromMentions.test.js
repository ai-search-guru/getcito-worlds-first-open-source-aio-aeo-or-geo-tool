import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * sendMentionsToActionCenter (MS-08): answers chosen on the Mentions tab as
 * one action. These pin that the answers are read again on the server (only
 * the brand's own answers naming it count), that the same answers sent again
 * return the open action, and that the action carries the review plan, its
 * evidence, a sentiment baseline and a person's "created" event.
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
vi.mock('./sources.js', () => ({ resolveBrandSources: async () => new Set(['tracking']) }));

const {
  MENTION_REVIEW_TASKS,
  mentionActionWeight,
  mentionKpiKeys,
  mentionBaseline,
  mentionDedupKey,
  sendMentionsToActionCenter,
} = await import('./fromMentions.js');

const answer = (id, over = {}) => ({
  id,
  prompt_id: 'p1',
  platform: 'gemini-web',
  region: 'US',
  sentiment: 'negative',
  mention_count: 1,
  created_at: `2026-10-1${id.slice(-1)}T10:00:00Z`,
  prompts: { text: 'Best espresso beans?' },
  ...over,
});

beforeEach(() => {
  db = {
    inserts: [],
    insertError: null,
    rows: {
      actions: () => null,
      prompt_results: () => [
        answer('r1'),
        answer('r2', { sentiment: 'positive', platform: 'claude' }),
        answer('r3', { prompt_id: 'p2', prompts: { text: 'Cheap coffee?' }, sentiment: 'neutral' }),
        // Doesn't name the brand: ignored.
        answer('r4', { mention_count: 0 }),
      ],
    },
  };
});

describe('sendMentionsToActionCenter', () => {
  it('creates a Protect action from the answers as tracking stored them', async () => {
    const result = await sendMentionsToActionCenter('b1', {
      resultIds: ['r1', 'r2', 'r3', 'r4'],
      excerpts: { r1: '…Acme Coffee is pricier than Crema Club…', r2: 'x'.repeat(500) },
      userId: 'u1',
    });
    expect(result).toEqual({ actionId: 'act-1', actionNo: 62, created: true });

    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action).toMatchObject({
      brand_id: 'b1',
      category: 'protect',
      kind: 'mention_review',
      impact: 'medium',
      // Negative answers in it: judged by its sentiment first (learning D1).
      kpi_keys: ['positive_sentiment', 'mentions', 'ai_visibility'],
      baseline: { mentions: 3, positive: 1, negative: 1, netSentiment: 0 },
      // r4 isn't a mention, so it doesn't change which action these answers find.
      dedup_key: mentionDedupKey(['r1', 'r2', 'r3']),
    });
    expect(action.payload).toMatchObject({
      source: 'mention_review',
      mentionCount: 3,
      negativeCount: 1,
      promptCount: 2,
      promptIds: ['p2', 'p1'],
      targetEntity: 'prompts',
      targetCount: 2,
      platforms: ['gemini-web', 'claude'],
      resultIds: ['r3', 'r2', 'r1'],
    });
    const evidence = action.payload.evidence;
    expect(evidence.map((e) => e.resultId)).toEqual(['r3', 'r2', 'r1']);
    expect(evidence[2].excerpt).toBe('…Acme Coffee is pricier than Crema Club…');
    expect(evidence[1].excerpt).toHaveLength(400);
    expect(evidence[0].excerpt).toBe('');

    const tasks = db.inserts.find((i) => i.table === 'action_tasks').row;
    expect(tasks.map((t) => t.task_key)).toEqual(MENTION_REVIEW_TASKS);
    const event = db.inserts.find((i) => i.table === 'action_events').row;
    expect(event).toMatchObject({ event: 'created', actor_id: 'u1' });
  });

  it('returns the open action when the same answers were sent', async () => {
    db.rows.actions = () => ({ id: 'act-9', action_no: 9 });
    await expect(
      sendMentionsToActionCenter('b1', { resultIds: ['r2', 'r1'], userId: 'u1' }),
    ).resolves.toEqual({ actionId: 'act-9', actionNo: 9, created: false });
    expect(db.inserts).toEqual([]);
  });

  it('refuses answers that are not the brand’s mentions', async () => {
    db.rows.prompt_results = () => [answer('r4', { mention_count: 0 })];
    await expect(
      sendMentionsToActionCenter('b1', { resultIds: ['r4'], userId: 'u1' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns the winner when another send opened it first', async () => {
    db.insertError = { code: '23505', message: 'duplicate' };
    let reads = 0;
    db.rows.actions = () => (reads++ === 0 ? null : { id: 'act-7', action_no: 7 });
    await expect(
      sendMentionsToActionCenter('b1', { resultIds: ['r1'], userId: 'u1' }),
    ).resolves.toEqual({ actionId: 'act-7', actionNo: 7, created: false });
  });
});

describe('the action’s weight and baseline', () => {
  it('is Growth without negatives, high impact when most are negative', () => {
    const s = (sentiment) => ({ sentiment });
    expect(mentionActionWeight([s('positive'), s('neutral')])).toEqual({
      negative: 0,
      category: 'growth',
      impact: 'low',
    });
    expect(mentionActionWeight([s('negative'), s('neutral'), s('positive')]).impact).toBe('medium');
    expect(mentionActionWeight([s('negative'), s('positive')]).impact).toBe('high');
    expect(mentionBaseline([s('positive'), s('positive'), s('negative'), s('neutral')])).toEqual({
      mentions: 4,
      positive: 2,
      negative: 1,
      netSentiment: 25,
    });
  });

  it('keys the same answers the same way, in any order', () => {
    expect(mentionDedupKey(['b', 'a', 'a'])).toBe(mentionDedupKey(['a', 'b']));
    expect(mentionDedupKey(['a'])).not.toBe(mentionDedupKey(['a', 'b']));
  });
});

/** Its aim first (learning D1): sentiment when it carries negative answers, else mentions. */
describe('mentionKpiKeys', () => {
  it('judges answers with negative ones by their sentiment, the others by mentions', () => {
    expect(mentionKpiKeys(2)[0]).toBe('positive_sentiment');
    expect(mentionKpiKeys(0)).toEqual(['mentions', 'ai_visibility', 'positive_sentiment']);
  });
});
