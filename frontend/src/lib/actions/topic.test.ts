import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Topics overview over the page's date range (00156): the window's
 * figures, the change against the window just before, and a trend point per
 * whole day; the fixed 30-day overview without a window, or where the
 * database doesn't have the windowed function yet.
 */

const DAY = 24 * 60 * 60 * 1000;
let calls: { fn: string; args: Record<string, unknown> }[] = [];
let windowRows: Record<string, unknown>[] | 'missing' = [];
let fixedRows: Record<string, unknown>[] = [];

// The signed-in member's role, for deleteTopic.
let role: string | null = 'admin';
const tables: Record<string, unknown[]> = {
  topics: [{ id: 't1', name: 'Espresso', brand_id: 'b1', created_at: '2026-01-01T00:00:00Z' }],
  prompt_sets: [{ id: 's1' }],
  prompts: [
    { id: 'p1', topic_id: 't1' },
    { id: 'p2', topic_id: 't1' },
  ],
};
/** Every delete and update asked for, by table. */
let writes: { table: string; op: string }[] = [];

/**
 * A query builder whose every call chains, resolving to the table's rows
 * (single and maybeSingle to the first one).
 */
function query(table: string): unknown {
  const rows = table === 'profiles' ? [{ role }] : (tables[table] ?? []);
  const resolveTo = (data: unknown) => ({
    then: (resolve: (value: unknown) => void) => resolve({ data, error: null }),
  });
  const builder: unknown = new Proxy(
    {},
    {
      get: (_, prop) => {
        if (prop === 'then') return resolveTo(rows).then;
        if (prop === 'single' || prop === 'maybeSingle') return () => resolveTo(rows[0] ?? null);
        if (prop === 'delete' || prop === 'update') {
          return () => {
            writes.push({ table, op: prop });
            return builder;
          };
        }
        return () => builder;
      },
    },
  );
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => query(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'topics_overview_window') {
        return windowRows === 'missing'
          ? { data: null, error: { code: 'PGRST202', message: 'not found' } }
          : { data: windowRows, error: null };
      }
      return { data: fixedRows, error: null };
    },
  })),
}));

const { getTopicsOverview } = await import('./topic');

const counts = (prefix: string, answers: number, mentions: number) => ({
  [`${prefix}answers`]: answers,
  [`${prefix}mention_answers`]: mentions,
  [`${prefix}citation_answers`]: 0,
  [`${prefix}pos_sum`]: 0,
  [`${prefix}pos_n`]: 0,
});

const shared = {
  topic_id: 't1',
  total_mentions: 6,
  total_citations: 2,
  comp_mentions: 4,
  active_prompts: 2,
  visible_prompts: 1,
  last_run_at: '2026-10-16T14:28:00Z',
  competitors: { c1: { name: 'Crema Club', sov: 4 } },
};

beforeEach(() => {
  calls = [];
  writes = [];
  role = 'admin';
  const today = new Date().toISOString().slice(0, 10);
  windowRows = [
    {
      ...shared,
      ...counts('', 10, 6),
      ...counts('prev_', 10, 2),
      daily: { [today]: { visible: 3, count: 4 } },
    },
  ];
  fixedRows = [
    {
      ...shared,
      ...counts('', 30, 9),
      ...counts('cur_', 10, 6),
      ...counts('prev_', 10, 2),
      daily: {},
    },
  ];
});

describe('getTopicsOverview', () => {
  it('reads the window and compares it with the window of the same length before it', async () => {
    const from = new Date(Date.now() - 7 * DAY).toISOString();
    const summary = await getTopicsOverview('b1', { from });

    expect(calls.map((c) => c.fn)).toEqual(['topics_overview_window']);
    expect(calls[0].args).toMatchObject({ p_brand_id: 'b1', p_date_from: from });
    const [row] = summary.topics;
    expect(row.promptCount).toBe(2);
    expect(row.totalMentions).toBe(6);
    // 6 mentions of 10 against 2 of 10: up.
    expect(row.visibilityChange).toBeGreaterThan(0);
    expect(row.shareOfVoice).toBe(60);
    // Seven whole days, today last, today's share drawn.
    expect(summary.trendDays).toHaveLength(7);
    expect(row.trendSparkline).toHaveLength(7);
    expect(row.trendSparkline.at(-1)).toBe(75);
  });

  it('draws no trend for a 24-hour window, only the change', async () => {
    const summary = await getTopicsOverview('b1', {
      from: new Date(Date.now() - DAY).toISOString(),
    });
    expect(summary.trendDays).toEqual([]);
    expect(summary.topics[0].trendSparkline).toEqual([]);
    expect(summary.topics[0].visibilityChange).not.toBeNull();
  });

  it('falls back to the fixed overview where the database has no windowed function yet', async () => {
    windowRows = 'missing';
    const summary = await getTopicsOverview('b1', {
      from: new Date(Date.now() - DAY).toISOString(),
    });
    expect(calls.map((c) => c.fn)).toEqual([
      'topics_overview_window',
      'topics_overview_aggregates',
    ]);
    expect(summary.trendDays).toHaveLength(14);
    expect(summary.topics[0].totalMentions).toBe(6);
  });

  it('reads the fixed 30-day overview without a window', async () => {
    const summary = await getTopicsOverview('b1');
    expect(calls.map((c) => c.fn)).toEqual(['topics_overview_aggregates']);
    expect(summary.trendDays).toHaveLength(14);
  });
});

describe('topic names', () => {
  it('refuses a name past 100 characters before anything is written, trimmed first', async () => {
    const { createTopic, createTopics, updateTopic } = await import('./topic');
    const long = 'x'.repeat(101);
    await expect(createTopic('b1', long)).rejects.toThrow(
      'Topic names are 100 characters at most.',
    );
    await expect(updateTopic('t1', long)).rejects.toThrow('100 characters at most');
    await expect(createTopics('b1', ['Espresso', long])).rejects.toThrow('100 characters');
    // Spaces around it don't count.
    await expect(createTopic('b1', ` ${'x'.repeat(100)} `)).resolves.toBeDefined();
  });
});

describe('deleteTopic', () => {
  it('lets an admin or a manager delete a topic, and never deletes its prompts', async () => {
    const { deleteTopic } = await import('./topic');
    for (const r of ['admin', 'manager']) {
      role = r;
      writes = [];
      await expect(deleteTopic('t1')).resolves.toBeUndefined();
      expect(writes).toContainEqual({ table: 'topics', op: 'delete' });
      expect(writes).not.toContainEqual({ table: 'prompts', op: 'delete' });
    }
  });

  it('refuses an analyst or an agency partner before anything is written', async () => {
    const { deleteTopic } = await import('./topic');
    for (const r of ['analyst', 'agency_partner', null]) {
      role = r;
      await expect(deleteTopic('t1')).rejects.toThrow(
        'Only an admin or a manager can delete topics.',
      );
    }
    expect(writes).toEqual([]);
  });

  it("keeps the topic's prompts in the database: their topic is set to none", () => {
    // The delete leans on this rule to keep the prompts and their results.
    const schema = readFileSync(join(__dirname, '../../../../supabase/schema.sql'), 'utf8');
    expect(schema).toMatch(
      /"prompts_topic_id_fkey" FOREIGN KEY \("topic_id"\) REFERENCES "public"\."topics"\("id"\) ON DELETE SET NULL/,
    );
  });
});
