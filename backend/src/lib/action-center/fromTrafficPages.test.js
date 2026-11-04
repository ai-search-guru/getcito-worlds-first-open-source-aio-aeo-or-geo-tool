import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * sendTrafficPagesToActionCenter (AT-006): pages from the AI Traffic page's
 * Pages section as one action. These pin that the list is read again on the
 * server over the same range (only pages still on it go), that the same
 * pages sent again return the open action, and that the action carries its
 * list's plan, its pages as full URLs for measuring, the figures as the
 * database has them and a person's "created" event.
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
          : { data: { id: 'act-1', action_no: 71 }, error: null };
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
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
}

const rpc = vi.fn();
vi.mock('../../config/supabase.js', () => ({
  default: { from: (name) => table(name), rpc: (...args) => rpc(...args) },
}));
vi.mock('./sources.js', () => ({
  resolveBrandSources: async () => new Set(['tracking', 'analytics', 'ai_traffic']),
}));
vi.mock('./priorityData.js', () => ({
  priorityOnCreate: async () => ({ priority_score: 61, priority_level: 'medium' }),
}));

const {
  CITED_NOT_CLICKED_TASKS,
  pageKeyOf,
  sendTrafficPagesToActionCenter,
  trafficPagesDedupKey,
  trafficPagesValueSignal,
  trafficPagesWeight,
} = await import('./fromTrafficPages.js');
const { default: captureAiTraffic } = await import('./definitions/g01CaptureAiTraffic.js');

const row = (page, over = {}) => ({
  page,
  ai_visits: 0,
  citations: 0,
  targeting_prompts: 0,
  sessions: 0,
  key_events: 0,
  transactions: 0,
  revenue: 0,
  in_sitemap: false,
  value_rank: null,
  ...over,
});

const FROM = '2026-09-18T12:00:00.000Z';
const TO = '2026-10-18T12:00:00.000Z';

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: {
      counts: { cited_not_clicked: 2 },
      rows: [
        row('/Guides/Espresso', { citations: 80, targeting_prompts: 1 }),
        row('/shop/beans', { citations: 22, sessions: 240, key_events: 18, value_rank: 4 }),
      ],
    },
    error: null,
  });
  db = {
    inserts: [],
    insertError: null,
    rows: {
      actions: () => null,
      brand_domains: () => [{ domain: 'https://www.Acme-Coffee.example.com/', is_primary: true }],
    },
  };
});

describe('sendTrafficPagesToActionCenter', () => {
  it('creates a Fix action from the cited pages as the list has them', async () => {
    const result = await sendTrafficPagesToActionCenter('b1', {
      // Another spelling of a listed page, and a page no longer on the list.
      pages: ['/guides/espresso/', '/shop/beans', '/menu'],
      reason: 'cited_not_clicked',
      from: FROM,
      to: TO,
      userId: 'u1',
    });
    expect(result).toEqual({ actionId: 'act-1', actionNo: 71, created: true });

    // The same list over the same range.
    expect(rpc).toHaveBeenCalledWith('ai_traffic_pages', {
      p_brand_id: 'b1',
      p_from: FROM,
      p_to: TO,
      p_tab: 'cited_not_clicked',
      p_limit: 10_000,
      p_offset: 0,
    });

    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action).toMatchObject({
      brand_id: 'b1',
      category: 'fix',
      kind: 'traffic_pages',
      impact: 'high',
      kpi_keys: ['ai_referral_traffic', 'citations'],
      baseline: { aiVisits: 0, citations: 102, sessions: 240 },
      // /menu isn't on the list, so it doesn't change which action these pages find.
      dedup_key: trafficPagesDedupKey('cited_not_clicked', ['/guides/espresso', '/shop/beans']),
      priority_score: 61,
    });
    expect(action.payload).toMatchObject({
      source: 'traffic_pages',
      reason: 'cited_not_clicked',
      window: { from: FROM, to: TO },
      pageCount: 2,
      citations: 102,
      sessions: 240,
      valueSignal: 'key_events',
      pages: [
        'https://www.acme-coffee.example.com/Guides/Espresso',
        'https://www.acme-coffee.example.com/shop/beans',
      ],
      targetEntity: 'pages',
      targetCount: 2,
      targets: [
        { id: '/Guides/Espresso', label: '/Guides/Espresso', sessions: 0, citations: 80 },
        { id: '/shop/beans', label: '/shop/beans', sessions: 240, citations: 22 },
      ],
    });
    expect(action.payload.evidence[1]).toEqual({
      page: '/shop/beans',
      aiVisits: 0,
      citations: 22,
      targetingPrompts: 0,
      sessions: 240,
      keyEvents: 18,
      transactions: 0,
      revenue: 0,
      inSitemap: false,
      valueRank: 4,
    });

    const tasks = db.inserts.find((i) => i.table === 'action_tasks').row;
    expect(tasks.map((t) => t.task_key)).toEqual(CITED_NOT_CLICKED_TASKS);
    const event = db.inserts.find((i) => i.table === 'action_events').row;
    expect(event).toMatchObject({
      event: 'created',
      actor_id: 'u1',
      data: { source: 'traffic_pages', reason: 'cited_not_clicked', pages: 2 },
    });
  });

  it("gives pages AI skips G01's plan, as Growth, over all time", async () => {
    rpc.mockResolvedValue({
      data: {
        rows: [row('/', { sessions: 90, revenue: 361.5, transactions: 3, in_sitemap: true })],
      },
      error: null,
    });
    await sendTrafficPagesToActionCenter('b1', {
      pages: ['/'],
      reason: 'no_ai_traffic',
      userId: 'u1',
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_from: null,
      p_to: null,
      p_tab: 'no_ai_traffic',
    });
    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action).toMatchObject({ category: 'growth', impact: 'high' });
    expect(action.payload).toMatchObject({
      pages: ['https://www.acme-coffee.example.com'],
      valueSignal: 'revenue',
      revenue: 361.5,
    });
    const tasks = db.inserts.find((i) => i.table === 'action_tasks').row;
    // The plan drops what the brand can't do; G01's tasks keep their order.
    const keys = tasks.map((t) => t.task_key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => captureAiTraffic.tasks.includes(k))).toBe(true);
    expect(keys).toEqual(captureAiTraffic.tasks.filter((k) => keys.includes(k)));
    // One page: each change on it carries the page's full URL, and how it's checked (AC-010).
    const onPage = tasks.filter((t) => t.details?.check === 'auto');
    expect(onPage.length).toBeGreaterThan(0);
    for (const task of onPage) {
      expect(task.details, task.task_key).toEqual({
        check: 'auto',
        url: 'https://www.acme-coffee.example.com',
        source: 'template',
      });
    }
  });

  it('still sends, unmeasured, when the brand has no domain', async () => {
    db.rows.brand_domains = () => [];
    await sendTrafficPagesToActionCenter('b1', {
      pages: ['/shop/beans'],
      reason: 'cited_not_clicked',
      userId: 'u1',
    });
    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action.payload.pages).toEqual([]);
    expect(action.payload.targetCount).toBe(1);
  });

  it('returns the open action when the same pages were sent from the list', async () => {
    db.rows.actions = () => ({ id: 'act-9', action_no: 9 });
    await expect(
      sendTrafficPagesToActionCenter('b1', {
        pages: ['/shop/beans', '/guides/espresso'],
        reason: 'cited_not_clicked',
        userId: 'u1',
      }),
    ).resolves.toEqual({ actionId: 'act-9', actionNo: 9, created: false });
    expect(db.inserts).toEqual([]);
  });

  it('refuses pages that are no longer on the list', async () => {
    await expect(
      sendTrafficPagesToActionCenter('b1', {
        pages: ['/menu'],
        reason: 'cited_not_clicked',
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.inserts).toEqual([]);
  });

  it('refuses a list it does not know', async () => {
    await expect(
      sendTrafficPagesToActionCenter('b1', { pages: ['/'], reason: 'all', userId: 'u1' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the winner when another send opened it first', async () => {
    db.insertError = { code: '23505', message: 'duplicate' };
    let reads = 0;
    db.rows.actions = () => (reads++ === 0 ? null : { id: 'act-7', action_no: 7 });
    await expect(
      sendTrafficPagesToActionCenter('b1', {
        pages: ['/shop/beans'],
        reason: 'cited_not_clicked',
        userId: 'u1',
      }),
    ).resolves.toEqual({ actionId: 'act-7', actionNo: 7, created: false });
  });
});

describe('the action’s weight and key', () => {
  const page = (over) => ({
    citations: 0,
    revenue: 0,
    transactions: 0,
    keyEvents: 0,
    sessions: 0,
    ...over,
  });

  it('makes cited pages Fix work, high from 100 citations', () => {
    expect(
      trafficPagesWeight([page({ citations: 60 }), page({ citations: 39 })], 'cited_not_clicked'),
    ).toEqual({
      category: 'fix',
      impact: 'medium',
    });
    expect(trafficPagesWeight([page({ citations: 100 })], 'cited_not_clicked').impact).toBe('high');
  });

  it('makes skipped pages Growth, weighted by what they earn', () => {
    expect(trafficPagesWeight([page({ revenue: 10 })], 'no_ai_traffic')).toEqual({
      category: 'growth',
      impact: 'high',
    });
    expect(trafficPagesWeight([page({ keyEvents: 2 })], 'no_ai_traffic').impact).toBe('medium');
    expect(trafficPagesWeight([page({ sessions: 40 })], 'no_ai_traffic').impact).toBe('low');
  });

  it('names the strongest value Analytics reports', () => {
    expect(trafficPagesValueSignal([page({ keyEvents: 1 }), page({ transactions: 1 })])).toBe(
      'transactions',
    );
    expect(trafficPagesValueSignal([page({ sessions: 3 })])).toBe('engagement');
    expect(trafficPagesValueSignal([page({ citations: 30 })])).toBeNull();
  });

  it('keys the same pages the same way, in any order or spelling', () => {
    expect(pageKeyOf('/Shop/Beans/')).toBe('/shop/beans');
    expect(pageKeyOf('/')).toBe('/');
    expect(trafficPagesDedupKey('no_ai_traffic', ['/b', '/A/', '/a'])).toBe(
      trafficPagesDedupKey('no_ai_traffic', ['/a', '/b']),
    );
    expect(trafficPagesDedupKey('no_ai_traffic', ['/a'])).not.toBe(
      trafficPagesDedupKey('cited_not_clicked', ['/a']),
    );
  });
});
