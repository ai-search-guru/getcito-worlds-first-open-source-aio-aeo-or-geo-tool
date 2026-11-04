import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
// Who sees which brand (brand access, lib/access.js): everyone every brand, unless a test says.
const access = vi.hoisted(() => ({ readers: null, error: null, calls: [] }));
vi.mock('../access.js', () => ({
  brandReaders: async (orgId, brandIds) => {
    access.calls.push([orgId, brandIds]);
    if (access.error) throw access.error;
    return access.readers ?? { get: () => new Set(brandIds) };
  },
}));

const cron = (await import('node-cron')).default;
const { logger } = await import('../logger.js');
const { MAX_CANDIDATES, SCHEDULE, runDailySuggestions, startDailySuggestions } =
  await import('./job.js');
const { summaryBytes } = await import('./summary.js');

/**
 * The hourly job (CHAT-26): who gets a suggestion, when, which, and what it
 * writes, against an in-memory database that reads and writes as PostgREST
 * does for the queries the job makes.
 */

const NOW = new Date('2026-10-30T09:30:00Z');
const DAY = 86_400_000;
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const later = (days) => new Date(NOW.getTime() + days * DAY);

const ORG = '11111111-1111-1111-1111-111111111111';
const READ_ONLY_ORG = '33333333-3333-3333-3333-333333333333';

const get = (row, path) => path.split('.').reduce((value, key) => value?.[key], row);

/**
 * Tables in memory, with the filters, orders and writes the job uses. A
 * write stamps updated_at with the run's time, as the tables' trigger does.
 */
function fakeDb(tables) {
  const calls = [];
  const uniques = {
    chat_suggestion_feeds: ['user_id', 'brand_id'],
    chat_suggestions: ['user_id', 'brand_id', 'sent_on'],
  };
  const db = {
    calls,
    tables,
    now: NOW,
    fail: null,
    from(table) {
      calls.push(table);
      tables[table] ??= [];
      const filters = [];
      const orders = [];
      let write = null;
      let range = null;
      let limit = Infinity;
      let count = false;
      const keep = (row) => filters.every((test) => test(row));
      const chain = {
        select: () => chain,
        insert: (rows) => ((write = { kind: 'insert', rows: [rows].flat() }), chain),
        upsert: (rows, options) => (
          (write = { kind: 'insert', rows: [rows].flat(), options }),
          chain
        ),
        update: (values) => ((write = { kind: 'update', values }), chain),
        delete: (options) => ((write = { kind: 'delete' }), (count = !!options?.count), chain),
        eq: (column, value) => (filters.push((row) => get(row, column) === value), chain),
        in: (column, values) => (filters.push((row) => values.includes(get(row, column))), chain),
        is: (column, value) => (filters.push((row) => (get(row, column) ?? null) === value), chain),
        not: (column, op, value) => (
          filters.push((row) => (get(row, column) ?? null) !== value),
          chain
        ),
        gte: (column, value) => (filters.push((row) => get(row, column) >= value), chain),
        lt: (column, value) => (filters.push((row) => get(row, column) < value), chain),
        order: (column, { ascending = true, nullsFirst = false } = {}) => (
          orders.push({ column, ascending, nullsFirst }),
          chain
        ),
        limit: (n) => ((limit = n), chain),
        range: (from, to) => ((range = [from, to]), chain),
        then(resolve, reject) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      function run() {
        if (db.fail?.(table, keep, write)) {
          return { data: null, error: { code: '57014', message: 'canceling statement' } };
        }
        const rows = tables[table];
        const stamp = db.now.toISOString();
        if (write?.kind === 'insert') {
          const key = uniques[table];
          const inserted = [];
          for (const row of write.rows) {
            const taken = key && rows.some((other) => key.every((k) => other[k] === row[k]));
            if (taken && write.options?.ignoreDuplicates) continue;
            const stored = {
              id: `${table}-${rows.length + 1}`,
              created_at: stamp,
              updated_at: stamp,
              ...row,
            };
            rows.push(stored);
            inserted.push(stored);
          }
          return { data: inserted.map((row) => ({ ...row })), error: null };
        }
        if (write?.kind === 'update') {
          const found = rows.filter(keep);
          for (const row of found) Object.assign(row, write.values, { updated_at: stamp });
          return { data: found.map((row) => ({ ...row })), error: null };
        }
        if (write?.kind === 'delete') {
          const gone = rows.filter(keep);
          tables[table] = rows.filter((row) => !keep(row));
          return { data: null, count: count ? gone.length : null, error: null };
        }
        let found = rows.filter(keep).map((row) => ({ ...row }));
        if (table === 'chat_suggestions') {
          found = found.map((row) => ({ ...row, category: row.summary?.action?.category ?? null }));
        }
        for (const { column, ascending, nullsFirst } of [...orders].reverse()) {
          found.sort((a, b) => {
            const x = get(a, column) ?? null;
            const y = get(b, column) ?? null;
            if (x === y) return 0;
            if (x === null) return nullsFirst ? -1 : 1;
            if (y === null) return nullsFirst ? 1 : -1;
            return (x < y ? -1 : 1) * (ascending ? 1 : -1);
          });
        }
        if (range) found = found.slice(range[0], range[1] + 1);
        return { data: found.slice(0, limit), error: null };
      }
      return chain;
    },
  };
  return db;
}

/** A feed made `days` ago, on and never used. */
const feedOf = (userId, brandId, days, overrides = {}) => ({
  user_id: userId,
  brand_id: brandId,
  organization_id: ORG,
  status: 'on',
  created_at: daysAgo(days),
  updated_at: daysAgo(days),
  last_used_at: null,
  ...overrides,
});

function openAction(id, overrides = {}) {
  return {
    id,
    brand_id: 'b1',
    action_no: 1,
    kind: 'x',
    category: 'growth',
    impact: 'low',
    status: 'new',
    priority_score: 50,
    priority_level: 'medium',
    priority_reason: null,
    payload: {},
    created_at: daysAgo(1),
    assignee_id: null,
    deleted_at: null,
    ...overrides,
  };
}

/** A workspace in the morning (UTC): its people, brands, feeds, open actions and Chat answers. */
function world(overrides = {}) {
  return {
    organizations: [
      { id: ORG, subscription_status: 'trialing' },
      { id: READ_ONLY_ORG, subscription_status: 'canceled' },
    ],
    brands: [
      { id: 'b1', organization_id: ORG, is_active: true, is_demo: false },
      { id: 'demo', organization_id: ORG, is_active: true, is_demo: true },
      { id: 'paused', organization_id: ORG, is_active: false, is_demo: false },
      { id: 'b2', organization_id: READ_ONLY_ORG, is_active: true, is_demo: false },
    ],
    profiles: [
      { id: 'admin', role: 'admin', organization_id: ORG },
      { id: 'admin-new', role: 'admin', organization_id: ORG },
      { id: 'manager-ist', role: 'manager', organization_id: ORG },
      { id: 'analyst', role: 'analyst', organization_id: ORG },
      { id: 'partner', role: 'agency_partner', organization_id: ORG },
      { id: 'partner-on', role: 'agency_partner', organization_id: ORG },
      { id: 'ro-admin', role: 'admin', organization_id: READ_ONLY_ORG },
    ],
    // The admin's feed is three days old; the Inbox made the agency
    // partner's when they first opened it. The new admin has none yet.
    chat_suggestion_feeds: [feedOf('admin', 'b1', 3), feedOf('partner-on', 'b1', 3)],
    chat_suggestions: [],
    // Two answers read in UTC make it the workspace's zone; the manager reads in Istanbul (12:30).
    chat_messages: [
      {
        role: 'assistant',
        timezone: 'UTC',
        created_at: daysAgo(1),
        chat_conversations: { user_id: 'admin', organization_id: ORG },
      },
      {
        role: 'assistant',
        timezone: 'Europe/Istanbul',
        created_at: daysAgo(2),
        chat_conversations: { user_id: 'manager-ist', organization_id: ORG },
      },
      {
        role: 'assistant',
        timezone: 'UTC',
        created_at: daysAgo(3),
        chat_conversations: { user_id: 'admin', organization_id: ORG },
      },
    ],
    actions: [
      openAction('a-top', {
        action_no: 2841,
        kind: 'optimize_product_pages',
        impact: 'high',
        priority_score: 81,
        priority_level: 'high',
        priority_reason: { version: 1, change: 'gap' },
        payload: {
          targetEntity: 'pages',
          targetCount: 2,
          pages: ['https://s.example/a', 'https://s.example/b'],
        },
        created_at: daysAgo(6),
      }),
      openAction('a-second', {
        action_no: 2866,
        kind: 'add_llms_txt',
        category: 'fix',
        impact: 'medium',
        status: 'in_progress',
        priority_score: 60,
      }),
      openAction('a-held', { category: 'protect', status: 'on_hold', priority_score: 99 }),
      openAction('a-deleted', { category: 'protect', priority_score: 98, deleted_at: daysAgo(1) }),
      openAction('a-demo', { brand_id: 'demo', priority_score: 90 }),
      openAction('a-b2', { brand_id: 'b2', priority_score: 90 }),
    ],
    action_tasks: [
      { action_id: 'a-top', task_key: 'optimize_content', status: 'todo' },
      { action_id: 'a-second', task_key: 'create_content_draft', status: 'completed' },
    ],
    chat_agent_runs: [],
    chat_task_state: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('IS_CLOUD', 'true');
  logger.error.mockClear();
  access.readers = null;
  access.error = null;
  access.calls = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const run = (db, now = NOW) => {
  db.now = now;
  return runDailySuggestions({ db, now });
};
const rowsOn = (db, day) => db.tables.chat_suggestions.filter((row) => row.sent_on === day);

describe('runDailySuggestions: off', () => {
  it('reads nothing while CHAT_AGENTIC is off', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    const db = { from: vi.fn() };
    const stats = await runDailySuggestions({ db, now: NOW });
    expect(db.from).not.toHaveBeenCalled();
    expect(stats).toEqual({
      workspaces: 0,
      feedsMade: 0,
      sent: 0,
      paused: 0,
      deleted: 0,
      failed: 0,
    });
  });

  it('leaves out workspaces CHAT_AGENTIC_ORGS doesn’t list', async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', '99999999-9999-9999-9999-999999999999');
    const db = fakeDb(world());
    const stats = await run(db);
    expect(stats.sent).toBe(0);
    expect(db.calls).not.toContain('profiles');
    expect(db.tables.chat_suggestions).toEqual([]);
  });
});

describe('runDailySuggestions: who and what', () => {
  it('sends today’s suggestion to the people whose morning it is, with its summary', async () => {
    const db = fakeDb(world());
    const stats = await run(db);

    expect(stats).toMatchObject({ workspaces: 1, sent: 2, feedsMade: 1, paused: 0, failed: 0 });
    const rows = db.tables.chat_suggestions;
    expect(rows.map((row) => row.user_id).sort()).toEqual(['admin', 'partner-on']);
    for (const row of rows) {
      expect(row).toMatchObject({
        organization_id: ORG,
        brand_id: 'b1',
        action_id: 'a-top',
        sent_on: '2026-10-30',
        sent_at: NOW.toISOString(),
      });
    }
    expect(rows[0].summary).toMatchObject({
      version: 1,
      action: {
        no: 2841,
        kind: 'optimize_product_pages',
        category: 'growth',
        payload: { targetCount: 2 },
      },
      priority: { score: 81, level: 'high', reason: { version: 1, change: 'gap' } },
      waitingDays: 6,
      startNow: { method: 'optimize', pages: 2, minutes: 8 },
    });
  });

  it('makes a feed for admins and managers only; analysts and partners who didn’t turn it on get none', async () => {
    const db = fakeDb(world());
    await run(db);
    const feeds = db.tables.chat_suggestion_feeds.map((feed) => `${feed.user_id}/${feed.brand_id}`);
    expect(feeds.sort()).toEqual(['admin-new/b1', 'admin/b1', 'partner-on/b1']);
    const users = new Set(db.tables.chat_suggestions.map((row) => row.user_id));
    expect(users.has('analyst')).toBe(false);
    expect(users.has('partner')).toBe(false);
  });

  it('starts a feed made this morning the next morning', async () => {
    const db = fakeDb(world());
    await run(db);
    expect(db.tables.chat_suggestions.some((row) => row.user_id === 'admin-new')).toBe(false);
    await run(db, later(1));
    const hers = db.tables.chat_suggestions.filter((row) => row.user_id === 'admin-new');
    expect(hers.map((row) => row.sent_on)).toEqual(['2026-10-31']);
  });

  it('starts a feed turned back on this morning the next morning', async () => {
    const backOn = feedOf('admin', 'b1', 60, { updated_at: '2026-10-30T08:15:00Z' });
    const db = fakeDb(world({ chat_suggestion_feeds: [backOn] }));
    await run(db);
    expect(db.tables.chat_suggestions.some((row) => row.user_id === 'admin')).toBe(false);
    await run(db, later(1));
    expect(db.tables.chat_suggestions.filter((row) => row.user_id === 'admin')).toHaveLength(1);
  });

  it('waits for a person’s own morning: the manager in Istanbul is past it', async () => {
    const db = fakeDb(world());
    await run(db);
    expect(db.tables.chat_suggestions.some((row) => row.user_id === 'manager-ist')).toBe(false);
    // Her morning (08:30 in Istanbul, 05:30 UTC) makes her feed; the next one sends.
    await run(db, new Date('2026-10-31T05:30:00Z'));
    expect(db.tables.chat_suggestion_feeds.some((feed) => feed.user_id === 'manager-ist')).toBe(
      true,
    );
    await run(db, new Date('2026-11-01T05:30:00Z'));
    const hers = db.tables.chat_suggestions.filter((row) => row.user_id === 'manager-ist');
    expect(hers.map((row) => row.sent_on)).toEqual(['2026-11-01']);
  });

  it('never suggests on a demo brand, a paused brand or in a read-only workspace', async () => {
    const db = fakeDb(world());
    await run(db);
    const brands = new Set(db.tables.chat_suggestions.map((row) => row.brand_id));
    expect([...brands]).toEqual(['b1']);
    expect(db.tables.chat_suggestion_feeds.some((feed) => feed.user_id === 'ro-admin')).toBe(false);
  });

  it('suggests in a self-hosted workspace whatever its subscription says', async () => {
    vi.stubEnv('IS_CLOUD', 'false');
    const base = world();
    const db = fakeDb(
      world({
        chat_suggestion_feeds: [
          ...base.chat_suggestion_feeds,
          feedOf('ro-admin', 'b2', 3, { organization_id: READ_ONLY_ORG }),
        ],
      }),
    );
    await run(db);
    expect(db.tables.chat_suggestions.some((row) => row.brand_id === 'b2')).toBe(true);
    expect(db.calls).not.toContain('organizations');
  });

  it('sends nothing twice: a second run the same morning finds today’s', async () => {
    const db = fakeDb(world());
    await run(db);
    const again = await run(db, new Date(NOW.getTime() + 3_600_000));
    expect(again.sent).toBe(0);
    expect(db.tables.chat_suggestions).toHaveLength(2);
  });

  it('skips an action waiting in Needs you, and one suggested in the last 14 days', async () => {
    const db = fakeDb(
      world({
        chat_agent_runs: [{ action_id: 'a-top', status: 'needs_you' }],
        chat_suggestions: [
          {
            id: 'old',
            user_id: 'partner-on',
            organization_id: ORG,
            brand_id: 'b1',
            action_id: 'a-second',
            sent_on: '2026-10-29',
            sent_at: daysAgo(1),
            summary: { action: { category: 'fix' } },
          },
        ],
      }),
    );
    await run(db);
    // The admin gets the second; the partner had it yesterday, so nothing is left for them.
    expect(rowsOn(db, '2026-10-30').map((row) => [row.user_id, row.action_id])).toEqual([
      ['admin', 'a-second'],
    ]);
  });

  it('skips an action whose task a waiting chat works on', async () => {
    const db = fakeDb(
      world({
        chat_task_state: [
          { action_tasks: { action_id: 'a-top' }, chat_runs: { status: 'waiting' } },
          { action_tasks: { action_id: 'a-second' }, chat_runs: { status: 'done' } },
        ],
      }),
    );
    await run(db);
    expect(new Set(db.tables.chat_suggestions.map((row) => row.action_id))).toEqual(
      new Set(['a-second']),
    );
  });

  it('finds the person’s action behind more than its cap of actions assigned to others', async () => {
    const theirs = Array.from({ length: MAX_CANDIDATES + 20 }, (_, i) =>
      openAction(`theirs-${i}`, { priority_score: 95, assignee_id: 'someone-else' }),
    );
    const db = fakeDb(
      world({
        actions: [
          ...theirs,
          openAction('mine', { priority_score: 10, assignee_id: 'admin' }),
          openAction('anyone', { priority_score: 5 }),
        ],
        action_tasks: [],
      }),
    );
    await run(db);
    const today = rowsOn(db, '2026-10-30');
    expect(today.find((row) => row.user_id === 'admin').action_id).toBe('mine');
    expect(today.find((row) => row.user_id === 'partner-on').action_id).toBe('anyone');
  });

  it('keeps a large action’s summary within the database’s size', async () => {
    const huge = Array.from({ length: 3000 }, (_, i) => ({ k: i, v: 'x,y:z' }));
    const db = fakeDb(
      world({
        actions: [
          openAction('big', {
            priority_score: 90,
            priority_reason: { list: huge },
            payload: {
              title: 'Big one',
              promptIds: Array.from({ length: 100 }, (_, i) => `${i}-${'p'.repeat(250)}`),
              play: { id: 'p', dataRow: { rows: huge } },
            },
          }),
        ],
        action_tasks: [],
      }),
    );
    await run(db);
    const [row] = rowsOn(db, '2026-10-30');
    expect(row.summary.action.payload.title).toBe('Big one');
    expect(summaryBytes(row.summary)).toBeLessThanOrEqual(20_000);
    // The jsonb text's own form: a space after each comma and colon.
    const jsonbText = JSON.stringify(row.summary).replace(/([,:])/g, '$1 ');
    expect(Buffer.byteLength(jsonbText)).toBeLessThanOrEqual(32_000);
  });

  it('reads no action outside anyone’s morning', async () => {
    const db = fakeDb(world());
    const evening = new Date('2026-10-30T19:00:00Z');
    const stats = await run(db, evening);
    expect(stats.sent).toBe(0);
    expect(db.calls).not.toContain('actions');
    expect(db.calls).not.toContain('chat_suggestion_feeds');
  });
});

describe('runDailySuggestions: keeping and pausing', () => {
  it('deletes suggestions older than 14 days and keeps the rest', async () => {
    const row = (id, days) => ({
      id,
      user_id: 'someone',
      organization_id: ORG,
      brand_id: 'b1',
      action_id: 'a-gone',
      sent_on: daysAgo(days).slice(0, 10),
      sent_at: daysAgo(days),
      summary: {},
    });
    const db = fakeDb(world({ chat_suggestions: [row('kept', 13), row('gone', 15)] }));
    const stats = await run(db);
    expect(stats.deleted).toBe(1);
    const ids = db.tables.chat_suggestions.map((r) => r.id);
    expect(ids).toContain('kept');
    expect(ids).not.toContain('gone');
  });

  /** One unused suggestion a day for the admin, `count` days back. */
  const unused = (count) =>
    Array.from({ length: count }, (_, i) => ({
      id: `s${i + 1}`,
      user_id: 'admin',
      organization_id: ORG,
      brand_id: 'b1',
      action_id: `old-${i + 1}`,
      sent_on: daysAgo(i + 1).slice(0, 10),
      sent_at: daysAgo(i + 1),
      summary: { action: { category: 'growth' } },
    }));

  it('pauses a feed 30 days after the first unused suggestion, and sends it nothing', async () => {
    // Marked 31 days ago at its first suggestion since the last use (35 days ago).
    const feed = feedOf('admin', 'b1', 45, { updated_at: daysAgo(31), last_used_at: daysAgo(35) });
    const db = fakeDb(world({ chat_suggestion_feeds: [feed], chat_suggestions: unused(8) }));
    const stats = await run(db);
    expect(stats.paused).toBe(1);
    const paused = db.tables.chat_suggestion_feeds.find((f) => f.user_id === 'admin');
    expect(paused).toMatchObject({ status: 'paused', paused_at: NOW.toISOString() });
    expect(rowsOn(db, '2026-10-30').some((r) => r.user_id === 'admin')).toBe(false);

    // Paused, it stays paused: nothing turns it back on by itself.
    await run(db, later(1));
    expect(db.tables.chat_suggestion_feeds.find((f) => f.user_id === 'admin').status).toBe(
      'paused',
    );
    expect(rowsOn(db, '2026-10-31').some((r) => r.user_id === 'admin')).toBe(false);
  });

  it('marks the first suggestion since the last use, so a long quiet spell doesn’t pause the next day', async () => {
    // Forty days old, never used, nothing to suggest until today.
    const quiet = feedOf('admin', 'b1', 40);
    const db = fakeDb(world({ chat_suggestion_feeds: [quiet] }));
    await run(db);
    const feed = () => db.tables.chat_suggestion_feeds.find((f) => f.user_id === 'admin');
    expect(rowsOn(db, '2026-10-30').map((r) => r.user_id)).toEqual(['admin']);
    expect(feed().updated_at).toBe(NOW.toISOString());

    const next = await run(db, later(1));
    expect(next.paused).toBe(0);
    expect(feed().status).toBe('on');
    // Not the first since the use any more: the mark stays where it was.
    expect(feed().updated_at).toBe(NOW.toISOString());
  });

  it('sends nothing to a feed turned off', async () => {
    const db = fakeDb(
      world({ chat_suggestion_feeds: [feedOf('admin', 'b1', 3, { status: 'off' })] }),
    );
    await run(db);
    expect(db.tables.chat_suggestions.some((r) => r.user_id === 'admin')).toBe(false);
  });
});

describe('runDailySuggestions: brand access (spec §5.4)', () => {
  /** A second brand of the workspace, with an open action of its own. */
  const twoBrands = (overrides = {}) =>
    world({
      brands: [
        ...world().brands,
        { id: 'b3', organization_id: ORG, is_active: true, is_demo: false },
      ],
      actions: [...world().actions, openAction('a-b3', { brand_id: 'b3', priority_score: 70 })],
      ...overrides,
    });
  const seeOnly = (byPerson) => {
    access.readers = new Map(Object.entries(byPerson).map(([id, brands]) => [id, new Set(brands)]));
  };

  it('gives no feed and no suggestion where a person can’t see the brand', async () => {
    seeOnly({
      admin: ['b1', 'b3'],
      'admin-new': ['b1'],
      'manager-new': ['b1'],
      'partner-on': ['b1', 'b3'],
    });
    const db = fakeDb(
      twoBrands({
        profiles: [
          ...world().profiles,
          { id: 'manager-new', role: 'manager', organization_id: ORG },
        ],
        chat_suggestion_feeds: [
          feedOf('admin', 'b1', 3),
          feedOf('admin', 'b3', 3),
          // Narrowed to b1 since its b3 feed was made: b3 sends it nothing now.
          feedOf('admin-new', 'b1', 3),
          feedOf('admin-new', 'b3', 3),
          feedOf('partner-on', 'b1', 3),
        ],
      }),
    );
    await run(db);
    const sent = db.tables.chat_suggestions.map((r) => `${r.user_id}@${r.brand_id}`).sort();
    expect(sent).toEqual(['admin-new@b1', 'admin@b1', 'admin@b3', 'partner-on@b1']);
    // A manager with no feed yet, narrowed to b1, gets one on b1 only.
    expect(
      db.tables.chat_suggestion_feeds
        .filter((f) => f.user_id === 'manager-new')
        .map((f) => f.brand_id),
    ).toEqual(['b1']);
  });

  it('reads who sees what once for the workspace, not once a brand', async () => {
    await run(fakeDb(twoBrands()));
    expect(access.calls).toEqual([[ORG, ['b1', 'b3']]]);
  });

  it('reads no brand nobody of the morning can see', async () => {
    seeOnly({ admin: ['b1'], 'admin-new': ['b1'], 'partner-on': ['b1'] });
    const db = fakeDb(twoBrands());
    await run(db);
    expect(db.tables.chat_suggestions.some((r) => r.brand_id === 'b3')).toBe(false);
    expect(db.tables.chat_suggestion_feeds.some((f) => f.brand_id === 'b3')).toBe(false);
  });

  it('leaves a hidden person’s feed as it was, neither used nor paused, and works again with the brand back', async () => {
    // Thirty-one days past its first unused suggestion: due to pause, were it run.
    const feed = feedOf('admin', 'b1', 45, { updated_at: daysAgo(31), last_used_at: daysAgo(35) });
    const unused = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i + 1}`,
      user_id: 'admin',
      organization_id: ORG,
      brand_id: 'b1',
      action_id: `old-${i + 1}`,
      sent_on: daysAgo(i + 1).slice(0, 10),
      sent_at: daysAgo(i + 1),
      summary: { action: { category: 'growth' } },
    }));
    const db = fakeDb(world({ chat_suggestion_feeds: [{ ...feed }], chat_suggestions: unused }));
    seeOnly({ 'partner-on': ['b1'] });
    const stats = await run(db);
    expect(stats.paused).toBe(0);
    expect(db.tables.chat_suggestion_feeds.find((f) => f.user_id === 'admin')).toEqual(feed);
    expect(rowsOn(db, '2026-10-30').some((r) => r.user_id === 'admin')).toBe(false);

    // Given b1 back, the same feed goes on from where it was: due, it pauses now.
    access.readers = null;
    expect((await run(db, later(1))).paused).toBe(1);
    expect(db.tables.chat_suggestion_feeds.find((f) => f.user_id === 'admin').status).toBe(
      'paused',
    );
  });

  it('fails the workspace, writing nothing, when who sees what can’t be read', async () => {
    access.error = Object.assign(new Error('profiles down'), { name: 'Error', code: '57014' });
    const db = fakeDb(world());
    const stats = await run(db);
    expect(stats).toMatchObject({ workspaces: 0, failed: 1, sent: 0, feedsMade: 0 });
    expect(db.tables.chat_suggestions).toEqual([]);
    expect(db.tables.chat_suggestion_feeds).toEqual(world().chat_suggestion_feeds);
    expect(logger.error).toHaveBeenCalledWith(
      { err: { name: 'Error', code: '57014' } },
      '[chat-suggestions] workspace failed',
    );
  });
});

describe('runDailySuggestions: failures', () => {
  it('counts a workspace that fails and logs codes only', async () => {
    const db = fakeDb(world());
    db.fail = (table) => table === 'profiles';
    const stats = await run(db);
    expect(stats.failed).toBe(1);
    expect(stats.sent).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      { err: { name: 'SuggestionsDbError', code: '57014' } },
      '[chat-suggestions] workspace failed',
    );
  });

  it('goes on to the next brand when one fails, and counts its suggestions', async () => {
    const base = world();
    const db = fakeDb(
      world({
        brands: [
          ...base.brands,
          { id: 'b3', organization_id: ORG, is_active: true, is_demo: false },
        ],
        chat_suggestion_feeds: [...base.chat_suggestion_feeds, feedOf('admin', 'b3', 3)],
        actions: [...base.actions, openAction('a-b3', { brand_id: 'b3', priority_score: 70 })],
      }),
    );
    // b1's suggestions can't be read: that brand fails.
    db.fail = (table, keep, write) =>
      !write &&
      table === 'chat_suggestions' &&
      keep({ brand_id: 'b1', sent_at: NOW.toISOString() });
    const stats = await run(db);
    expect(stats.failed).toBe(1);
    expect(stats.workspaces).toBe(1);
    expect(stats.sent).toBe(1);
    expect(db.tables.chat_suggestions.map((row) => [row.brand_id, row.action_id])).toEqual([
      ['b3', 'a-b3'],
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      { err: { name: 'SuggestionsDbError', code: '57014' } },
      '[chat-suggestions] brand failed',
    );
  });

  it('keeps suggestions and counts from completed workspaces when a later workspace fails', async () => {
    const db = fakeDb(world());
    // A second workspace, whose people can't be read, comes after the first's work.
    const base = world();
    db.tables.brands = [
      ...base.brands,
      {
        id: 'b9',
        organization_id: '99999999-9999-9999-9999-999999999999',
        is_active: true,
        is_demo: false,
      },
    ];
    db.tables.organizations.push({
      id: '99999999-9999-9999-9999-999999999999',
      subscription_status: 'active',
    });
    db.fail = (table, keep) =>
      table === 'profiles' && keep({ organization_id: '99999999-9999-9999-9999-999999999999' });
    const stats = await run(db);
    expect(stats).toEqual({
      workspaces: 1,
      feedsMade: 1,
      sent: 2,
      paused: 0,
      deleted: 0,
      failed: 1,
    });
    expect(
      db.tables.chat_suggestions.map((row) => [row.organization_id, row.brand_id, row.user_id]),
    ).toEqual([
      [ORG, 'b1', 'admin'],
      [ORG, 'b1', 'partner-on'],
    ]);
  });
});

describe('startDailySuggestions', () => {
  it('runs every hour, and skips an hour while the last run is still going', async () => {
    cron.schedule.mockClear();
    let finish;
    const job = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    startDailySuggestions({ run: job });
    expect(SCHEDULE).toBe('7 * * * *');
    expect(cron.schedule).toHaveBeenCalledTimes(1);
    const [at, tick] = cron.schedule.mock.calls[0];
    expect(at).toBe(SCHEDULE);
    expect(typeof tick).toBe('function');

    const first = tick();
    await tick();
    expect(job).toHaveBeenCalledTimes(1);
    finish();
    await first;
    const next = tick();
    finish();
    await next;
    expect(job).toHaveBeenCalledTimes(2);
  });
});
