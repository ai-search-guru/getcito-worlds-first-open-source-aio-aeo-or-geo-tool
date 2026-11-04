import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Daily suggestions in the Inbox (CHAT-26 §2.2, §2.4, §5, §6; 00422): the
 * person reads their own through their session (the last 7 days, not
 * removed or put off, their action not deleted), dated by the job's time
 * zone; every write is the server's, on their own rows only, after the
 * plan check, and answers as a value (#1777).
 */

const ME = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const BRAND = '33333333-3333-4333-8333-333333333333';
const BRAND_2 = '44444444-4444-4444-8444-444444444444';
const SUGGESTION = '55555555-5555-4555-8555-555555555555';
const SUGGESTION_2 = '66666666-6666-4666-8666-666666666666';
const ACTION = '77777777-7777-4777-8777-777777777777';

interface Call {
  via: 'session' | 'admin';
  table: string;
  op: string;
  row?: unknown;
  options?: unknown;
  columns?: string;
  selectOptions?: unknown;
  filters: unknown[][];
}
let calls: Call[] = [];
let role = 'admin';
/** What each client, table and operation answers: `admin.chat_suggestions.update`. */
let answers: Record<string, unknown> = {};

function client(via: Call['via']) {
  return (table: string) => {
    const call: Call = { via, table, op: 'select', filters: [] };
    calls.push(call);
    // A maybeSingle() read answers `….select.single` when the test names one.
    const answer = (single = false) => {
      const key = `${via}.${table}.${call.op}`;
      const found = (single && answers[`${key}.single`]) || answers[key];
      return typeof found === 'function' ? found(call) : (found ?? { data: null, error: null });
    };
    const chain: Record<string, unknown> = {
      select: (columns: string, options?: unknown) =>
        Object.assign(call, { columns, selectOptions: options }) && chain,
      update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
      upsert: (row: unknown, options: unknown) =>
        Object.assign(call, { op: 'upsert', row, options }) && chain,
      ...Object.fromEntries(
        ['eq', 'neq', 'in', 'is', 'gt', 'gte', 'not', 'or', 'order', 'limit'].map((name) => [
          name,
          (...args: unknown[]) => {
            call.filters.push([name, ...args]);
            return chain;
          },
        ]),
      ),
      maybeSingle: async () => answer(true),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
    };
    return chain;
  };
}

const sessionFrom = client('session');
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    from: (table: string) => sessionFrom(table),
  }),
}));
const adminFrom = client('admin');
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => adminFrom(table) },
}));
const guard = vi.hoisted(() => ({ refuse: null as Error | null }));

vi.mock('@/lib/subscriptionGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/subscriptionGuard')>()),
  assertWritable: vi.fn(async () => {
    if (guard.refuse) throw guard.refuse;
  }),
}));

// The Action Center's own reads of an action's assignee and list counts.
vi.mock('@/lib/action-center/assignees', () => ({
  readAssignees: vi.fn(
    async (_client: unknown, _brand: string, ids: string[]) =>
      new Map(ids.map((id) => [id, { id, fullName: 'Ana Lima', avatarUrl: null }])),
  ),
}));
vi.mock('@/lib/action-center/entityCounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/action-center/entityCounts')>()),
  readEntityCounts: vi.fn(async () => new Map()),
}));

const { SubscriptionInactiveError } = await import('@/lib/subscriptionGuard');
const {
  markDailySuggestionsSeen,
  openDailySuggestion,
  readDailySuggestion,
  readDailySuggestions,
  removeDailySuggestion,
  setDailySuggestions,
  snoozeDailySuggestion,
  startDailySuggestions,
  startedDailySuggestion,
} = await import('./chatSuggestions');

const summary = {
  version: 1,
  action: { no: 2841, kind: 'improve_page_content', payload: { targetCount: 5 } },
  priority: { score: 81, level: 'high', reason: null },
  startNow: { method: 'optimize', pages: 5, minutes: 20 },
};

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T09:00:00.000Z'));
  calls = [];
  role = 'admin';
  guard.refuse = null;
  answers = {
    'session.profiles.select': () => ({ data: { organization_id: ORG, role }, error: null }),
    'session.chat_suggestion_feeds.select': { data: [{ status: 'on' }], error: null },
    'session.chat_suggestions.select': {
      data: [
        {
          id: SUGGESTION,
          brand_id: BRAND,
          action_id: ACTION,
          sent_on: '2026-10-29',
          sent_at: '2026-10-29T07:05:00Z',
          seen_at: null,
          opened_at: null,
          started_at: null,
          started_via: null,
          summary,
          actions: { status: 'new' },
        },
      ],
      count: 1,
      error: null,
    },
    'admin.chat_messages.select': {
      data: [
        { timezone: 'America/New_York', chat_conversations: { user_id: 'someone' } },
        { timezone: 'Pacific/Auckland', chat_conversations: { user_id: ME } },
      ],
      error: null,
    },
    'session.chat_suggestions.select.single': {
      data: { id: SUGGESTION, brand_id: BRAND, seen_at: null, opened_at: null },
      error: null,
    },
    'session.brands.select': { data: [{ id: BRAND }, { id: BRAND_2 }], error: null },
    'admin.chat_suggestion_feeds.select': { data: [], error: null },
    'admin.chat_suggestion_feeds.upsert': (call: Call) => ({
      data: (call.row as { brand_id: string }[]).map((row) => ({ brand_id: row.brand_id })),
      error: null,
    }),
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const writes = () => calls.filter((c) => c.via === 'admin' && c.op !== 'select');
const has = (call: Call | undefined, ...filter: unknown[]) =>
  call?.filters.some((f) => JSON.stringify(f) === JSON.stringify(filter)) ?? false;

describe('readDailySuggestions', () => {
  it("reads the person's own suggestions of the last 7 days, not removed, through their session", async () => {
    const result = await readDailySuggestions();
    expect(result).toEqual({
      ok: true,
      read: {
        roleFeed: 'default_on',
        state: 'on',
        total: 1,
        // 09:00 UTC is 22:00 in Auckland, their latest answer's zone.
        today: '2026-10-29',
        suggestions: [
          {
            id: SUGGESTION,
            brandId: BRAND,
            actionId: ACTION,
            sentOn: '2026-10-29',
            sentAt: '2026-10-29T07:05:00Z',
            seenAt: null,
            openedAt: null,
            startedAt: null,
            startedVia: null,
            closed: null,
            summary: {
              actionNo: 2841,
              kind: 'improve_page_content',
              payload: { targetCount: 5 },
              priorityLevel: 'high',
              startNow: { method: 'optimize', pages: 5, minutes: 20 },
            },
          },
        ],
      },
    });
    const list = calls.find((c) => c.table === 'chat_suggestions')!;
    expect(list.via).toBe('session');
    expect(has(list, 'eq', 'user_id', ME)).toBe(true);
    expect(has(list, 'gt', 'sent_at', '2026-10-22T09:00:00.000Z')).toBe(true);
    expect(has(list, 'is', 'removed_at', null)).toBe(true);
    expect(list.selectOptions).toEqual({ count: 'exact' });
    expect(calls.some((c) => c.via === 'admin' && c.table !== 'chat_messages')).toBe(false);
  });

  it("drops a suggestion whose action was deleted: the action's status comes through the session, joined", async () => {
    await readDailySuggestions();
    const list = calls.find((c) => c.table === 'chat_suggestions')!;
    // The session reads actions without deleted_at only (actions: member select), so the inner join drops them.
    expect(list.columns).toContain('actions!chat_suggestions_action_id_fkey!inner(status)');
  });

  it('keeps one whose action was done or dismissed, with that status', async () => {
    answers['session.chat_suggestions.select'] = {
      data: ['completed', 'dismissed', 'on_hold'].map((status, i) => ({
        id: `${SUGGESTION.slice(0, -1)}${i}`,
        brand_id: BRAND,
        action_id: ACTION,
        sent_on: '2026-10-29',
        sent_at: '2026-10-29T07:05:00Z',
        seen_at: null,
        opened_at: null,
        started_at: null,
        started_via: null,
        summary,
        actions: { status },
      })),
      count: 3,
      error: null,
    };
    const result = await readDailySuggestions();
    expect(result.ok && result.read.suggestions.map((s) => s.closed)).toEqual([
      'completed',
      'dismissed',
      null,
    ]);
  });

  it('leaves out one put off (Not now) until its day', async () => {
    await readDailySuggestions();
    const list = calls.find((c) => c.table === 'chat_suggestions')!;
    expect(
      has(list, 'or', 'snoozed_until.is.null,snoozed_until.lte."2026-10-29T09:00:00.000Z"'),
    ).toBe(true);
  });

  it('counts them all when there are more than it lists', async () => {
    answers['session.chat_suggestions.select'] = {
      ...(answers['session.chat_suggestions.select'] as object),
      count: 140,
    };
    const result = await readDailySuggestions();
    expect(result.ok && result.read.total).toBe(140);
    const list = calls.find((c) => c.table === 'chat_suggestions')!;
    expect(has(list, 'limit', 100)).toBe(true);
  });

  it("dates today in the job's zone: their latest answer's, else the workspace's, and none when it can't be read", async () => {
    vi.setSystemTime(new Date('2026-10-29T13:00:00.000Z'));
    const zone = async () => {
      const result = await readDailySuggestions();
      return result.ok ? result.read.today : 'failed';
    };
    // 13:00 UTC: Oct 30 in Auckland, theirs.
    expect(await zone()).toBe('2026-10-30');
    const read = calls.find((c) => c.table === 'chat_messages')!;
    expect(read.via).toBe('admin');
    expect(has(read, 'eq', 'chat_conversations.organization_id', ORG)).toBe(true);
    expect(has(read, 'eq', 'role', 'assistant')).toBe(true);
    expect(has(read, 'gte', 'created_at', '2026-09-29T13:00:00.000Z')).toBe(true);
    answers['admin.chat_messages.select'] = {
      data: [{ timezone: 'Pacific/Auckland', chat_conversations: { user_id: 'someone' } }],
      error: null,
    };
    expect(await zone()).toBe('2026-10-30');
    answers['admin.chat_messages.select'] = { data: [], error: null };
    expect(await zone()).toBe('2026-10-29');
    answers['admin.chat_messages.select'] = { data: null, error: { message: 'boom' } };
    expect(await zone()).toBeNull();
  });

  it('gives an Analyst none, and reads nothing for them', async () => {
    role = 'analyst';
    expect(await readDailySuggestions()).toEqual({
      ok: true,
      read: { roleFeed: 'never', state: 'none', suggestions: [], total: 0, today: null },
    });
    expect(calls.some((c) => c.table.startsWith('chat_suggestion'))).toBe(false);
  });

  it('says paused while any brand is, and fails as a value', async () => {
    answers['session.chat_suggestion_feeds.select'] = {
      data: [{ status: 'on' }, { status: 'paused' }],
      error: null,
    };
    const paused = await readDailySuggestions();
    expect(paused.ok && paused.read.state).toBe('paused');
    answers['session.chat_suggestions.select'] = { data: null, error: { message: 'boom' } };
    expect(await readDailySuggestions()).toEqual({ ok: false, failure: 'failed' });
  });
});

describe('markDailySuggestionsSeen', () => {
  it("marks the person's own unseen suggestions seen, and leaves the feed alone", async () => {
    expect(await markDailySuggestionsSeen([SUGGESTION, SUGGESTION_2])).toEqual({ ok: true });
    expect(writes()).toHaveLength(1);
    const [update] = writes();
    expect(update.table).toBe('chat_suggestions');
    expect(update.row).toEqual({ seen_at: '2026-10-29T09:00:00.000Z' });
    expect(has(update, 'in', 'id', [SUGGESTION, SUGGESTION_2])).toBe(true);
    expect(has(update, 'eq', 'user_id', ME)).toBe(true);
    expect(has(update, 'eq', 'organization_id', ORG)).toBe(true);
    expect(has(update, 'is', 'seen_at', null)).toBe(true);
  });

  it('refuses ids that are not ones', async () => {
    expect(await markDailySuggestionsSeen(['nope'])).toEqual({ ok: false, failure: 'not_found' });
    expect(await markDailySuggestionsSeen([])).toEqual({ ok: false, failure: 'not_found' });
    expect(writes()).toEqual([]);
  });
});

describe('openDailySuggestion', () => {
  it('marks it opened and seen, and its feed used', async () => {
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: true });
    const read = calls.find((c) => c.table === 'chat_suggestions' && c.op === 'select')!;
    expect(has(read, 'eq', 'user_id', ME)).toBe(true);
    const [opened, used] = writes();
    expect(opened.table).toBe('chat_suggestions');
    expect(opened.row).toEqual({
      opened_at: '2026-10-29T09:00:00.000Z',
      seen_at: '2026-10-29T09:00:00.000Z',
    });
    expect(has(opened, 'is', 'opened_at', null)).toBe(true);
    expect(used.table).toBe('chat_suggestion_feeds');
    expect(used.row).toEqual({ last_used_at: '2026-10-29T09:00:00.000Z' });
    expect(has(used, 'eq', 'user_id', ME)).toBe(true);
    expect(has(used, 'eq', 'brand_id', BRAND)).toBe(true);
  });

  it('keeps the first open, and still counts the feed used', async () => {
    answers['session.chat_suggestions.select.single'] = {
      data: { id: SUGGESTION, brand_id: BRAND, seen_at: 'x', opened_at: '2026-10-28T08:00:00Z' },
      error: null,
    };
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: true });
    expect(writes().map((w) => w.table)).toEqual(['chat_suggestion_feeds']);
  });

  it("writes nothing on someone else's suggestion", async () => {
    answers['session.chat_suggestions.select.single'] = { data: null, error: null };
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'not_found' });
    expect(writes()).toEqual([]);
  });

  it('writes nothing on one removed: no use of it, nor of the feed', async () => {
    // The person's session finds it only while it isn't removed.
    answers['session.chat_suggestions.select.single'] = (call: Call) =>
      has(call, 'is', 'removed_at', null)
        ? { data: null, error: null }
        : {
            data: { id: SUGGESTION, brand_id: BRAND, seen_at: null, opened_at: null },
            error: null,
          };
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'not_found' });
    expect(await startedDailySuggestion(SUGGESTION, 'chat')).toEqual({
      ok: false,
      failure: 'not_found',
    });
    expect(writes()).toEqual([]);
  });

  it('reads it only while its action is not deleted, so a deleted one writes nothing', async () => {
    await openDailySuggestion(SUGGESTION);
    const read = calls.find((c) => c.table === 'chat_suggestions' && c.op === 'select')!;
    expect(read.columns).toContain('actions!chat_suggestions_action_id_fkey!inner(deleted_at)');
    expect(has(read, 'is', 'actions.deleted_at', null)).toBe(true);
    expect(has(read, 'eq', 'organization_id', ORG)).toBe(true);
  });
});

describe('brand access', () => {
  it("reads a suggestion to open through the person's session, so one of a brand they can't see writes nothing", async () => {
    await openDailySuggestion(SUGGESTION);
    const read = calls.find((c) => c.table === 'chat_suggestions' && c.op === 'select')!;
    expect(read.via).toBe('session');
    answers['session.chat_suggestions.select.single'] = { data: null, error: null };
    calls = [];
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'not_found' });
    expect(writes()).toEqual([]);
  });

  it("makes feeds only for the brands the person's session reads", async () => {
    // The session reads one of the workspace's two brands: the other isn't theirs.
    answers['session.brands.select'] = { data: [{ id: BRAND }], error: null };
    answers['admin.brands.select'] = { data: [{ id: BRAND }, { id: BRAND_2 }], error: null };
    role = 'agency_partner';
    expect(await startDailySuggestions()).toEqual({ ok: true, made: 1 });
    expect(await setDailySuggestions(true)).toEqual({ ok: true });
    const upserts = writes().filter((w) => w.op === 'upsert');
    expect(upserts).toHaveLength(2);
    for (const upsert of upserts) {
      expect((upsert.row as { brand_id: string }[]).map((row) => row.brand_id)).toEqual([BRAND]);
    }
    expect(calls.filter((c) => c.table === 'brands').every((c) => c.via === 'session')).toBe(true);
  });
});

describe('setDailySuggestions', () => {
  it('turns every feed of theirs back on, paused ones included, and makes a missing one', async () => {
    expect(await setDailySuggestions(true)).toEqual({ ok: true });
    const [update, upsert] = writes();
    expect(update.table).toBe('chat_suggestion_feeds');
    expect(update.row).toEqual({ status: 'on', paused_at: null });
    expect(has(update, 'eq', 'user_id', ME)).toBe(true);
    expect(has(update, 'neq', 'status', 'on')).toBe(true);
    expect(upsert.row).toEqual([
      { user_id: ME, brand_id: BRAND, organization_id: ORG, status: 'on' },
      { user_id: ME, brand_id: BRAND_2, organization_id: ORG, status: 'on' },
    ]);
    expect(upsert.options).toEqual({ onConflict: 'user_id,brand_id', ignoreDuplicates: true });
    const brands = calls.find((c) => c.table === 'brands')!;
    expect(has(brands, 'eq', 'is_demo', false)).toBe(true);
    expect(has(brands, 'eq', 'is_active', true)).toBe(true);
  });

  it('pauses them (off) on the Pause link', async () => {
    expect(await setDailySuggestions(false)).toEqual({ ok: true });
    const [update, upsert] = writes();
    expect(update.row).toEqual({ status: 'off', paused_at: null });
    expect(has(update, 'neq', 'status', 'off')).toBe(true);
    expect((upsert.row as { status: string }[]).every((row) => row.status === 'off')).toBe(true);
  });

  it("isn't an Analyst's to change", async () => {
    role = 'analyst';
    expect(await setDailySuggestions(true)).toEqual({ ok: false, failure: 'not_allowed' });
    expect(writes()).toEqual([]);
  });
});

describe('startDailySuggestions', () => {
  it("makes an Agency partner's feeds on their first Inbox, on, for the brands that get them", async () => {
    role = 'agency_partner';
    expect(await startDailySuggestions()).toEqual({ ok: true, made: 2 });
    const [upsert] = writes();
    expect(upsert.table).toBe('chat_suggestion_feeds');
    expect(upsert.row).toEqual([
      { user_id: ME, brand_id: BRAND, organization_id: ORG, status: 'on' },
      { user_id: ME, brand_id: BRAND_2, organization_id: ORG, status: 'on' },
    ]);
  });

  it('makes none once they have one in this workspace: paused or off stays so', async () => {
    role = 'agency_partner';
    answers['admin.chat_suggestion_feeds.select'] = { data: [{ brand_id: BRAND }], error: null };
    expect(await startDailySuggestions()).toEqual({ ok: true, made: 0 });
    expect(writes()).toEqual([]);
    const read = calls.find((c) => c.via === 'admin' && c.table === 'chat_suggestion_feeds')!;
    expect(has(read, 'eq', 'user_id', ME)).toBe(true);
    expect(has(read, 'eq', 'organization_id', ORG)).toBe(true);
  });

  it("makes none for an Analyst, nor for an Admin or Manager (the job's to make)", async () => {
    for (const who of ['analyst', 'admin', 'manager']) {
      role = who;
      expect(await startDailySuggestions()).toEqual({ ok: false, failure: 'not_allowed' });
    }
    expect(writes()).toEqual([]);
  });
});

describe('a read-only workspace', () => {
  it('keeps its list and writes nothing', async () => {
    guard.refuse = new SubscriptionInactiveError();
    role = 'agency_partner';
    expect((await readDailySuggestions()).ok).toBe(true);
    expect(await markDailySuggestionsSeen([SUGGESTION])).toEqual({
      ok: false,
      failure: 'read_only',
    });
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'read_only' });
    expect(await snoozeDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'read_only' });
    expect(await removeDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'read_only' });
    expect(await startedDailySuggestion(SUGGESTION, 'chat')).toEqual({
      ok: false,
      failure: 'read_only',
    });
    expect(await setDailySuggestions(true)).toEqual({ ok: false, failure: 'read_only' });
    expect(await startDailySuggestions()).toEqual({ ok: false, failure: 'read_only' });
    expect(writes()).toEqual([]);
  });

  it('answers failed when the plan check fails otherwise', async () => {
    guard.refuse = new Error('Could not read the plan');
    expect(await setDailySuggestions(false)).toEqual({ ok: false, failure: 'failed' });
  });
});

describe('with the new Chat off', () => {
  it('reads and writes nothing', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await readDailySuggestions()).toEqual({ ok: false, failure: 'chat_off' });
    expect(await markDailySuggestionsSeen([SUGGESTION])).toEqual({
      ok: false,
      failure: 'chat_off',
    });
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'chat_off' });
    expect(await readDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'chat_off' });
    expect(await snoozeDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'chat_off' });
    expect(await setDailySuggestions(true)).toEqual({ ok: false, failure: 'chat_off' });
    expect(await startDailySuggestions()).toEqual({ ok: false, failure: 'chat_off' });
    expect(calls.some((c) => c.table.startsWith('chat_suggestion'))).toBe(false);
  });

  it("is off for a workspace CHAT_AGENTIC_ORGS doesn't list", async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', '99999999-9999-4999-8999-999999999999');
    expect(await readDailySuggestions()).toEqual({ ok: false, failure: 'chat_off' });
  });
});

describe('readDailySuggestion', () => {
  const action = {
    brand_id: BRAND,
    id: ACTION,
    action_no: 2841,
    category: 'growth',
    kind: 'improve_page_content',
    impact: 'high',
    status: 'new',
    payload: {
      targetCount: 5,
      pages: ['https://acme.example/ridge-45l', 'https://acme.example/crest-30l'],
      promptIds: ['p1', 'p2', 'p3'],
    },
    kpi_keys: [],
    assignee_id: 'person-1',
    due_date: null,
    created_at: '2026-10-23T08:00:00Z',
    updated_at: '2026-10-28T08:00:00Z',
    priority_score: 81,
    priority_level: 'high',
    priority_reason: null,
    priority_updated_at: null,
  };
  let audits: { url: string; final_url: string | null; completed_at: string }[] = [];
  const row = {
    id: SUGGESTION,
    brand_id: BRAND,
    action_id: ACTION,
    sent_on: '2026-10-29',
    sent_at: '2026-10-29T07:05:00Z',
    seen_at: null,
    opened_at: null,
    started_at: null,
    started_via: null,
    summary: { ...summary, waitingDays: 6 },
    actions: action,
  };

  beforeEach(() => {
    // The page reads its row whole (maybeSingle), not the open's default row.
    delete answers['session.chat_suggestions.select.single'];
    answers['session.chat_suggestions.select'] = { data: row, error: null };
    answers['session.action_tasks.select'] = {
      data: [
        { id: 'task-1', task_key: 'review_findings', status: 'completed' },
        { id: 'task-2', task_key: 'optimize_content', status: 'new' },
        { id: 'task-3', task_key: 'track_results', status: 'new' },
      ],
      error: null,
    };
    audits = [
      { url: 'https://acme.example/other', final_url: null, completed_at: '2026-10-29T08:00:00Z' },
      // The action's page, written another way: www, http and a trailing slash.
      {
        url: 'http://www.acme.example/ridge-45l/',
        final_url: null,
        completed_at: '2026-10-28T10:00:00Z',
      },
      {
        url: 'https://acme.example/ridge-45l',
        final_url: null,
        completed_at: '2026-10-01T10:00:00Z',
      },
    ];
    // The brand's audits, newest first; the database keeps to an `in` on url, when asked.
    answers['session.site_audits.select'] = (call: Call) => {
      const urls = call.filters.find((f) => f[0] === 'in' && f[1] === 'url')?.[2] as
        string[] | undefined;
      return { data: audits.filter((a) => !urls || urls.includes(a.url)), error: null };
    };
  });

  it('reads it with its action as the Action Center lists it, through the person’s session', async () => {
    const result = await readDailySuggestion(SUGGESTION);
    if (!result.ok) throw new Error('not read');
    const { detail } = result;
    expect(detail.suggestion).toMatchObject({ id: SUGGESTION, actionId: ACTION, closed: null });
    expect(detail.action).toMatchObject({
      actionNo: 2841,
      status: 'new',
      priorityScore: 81,
      priorityLevel: 'high',
      taskTotal: 3,
      taskCompleted: 1,
      assignee: { id: 'person-1', fullName: 'Ana Lima' },
    });
    expect(detail.pick).toEqual({ score: 81, waitingDays: 6 });
    // The open writing task, on the action's first page.
    expect(detail.start).toEqual({
      taskId: 'task-2',
      method: 'optimize',
      page: 'https://acme.example/ridge-45l',
    });
    // Its page's latest audit, whatever way the audit wrote its address.
    expect(detail.auditedAt).toBe('2026-10-28T10:00:00Z');
    // 09:00 UTC is the 29th's evening in Auckland, the person's latest answer's zone.
    expect(detail.today).toBe('2026-10-29');

    const read = calls.find((c) => c.via === 'session' && c.table === 'chat_suggestions')!;
    expect(read.columns).toContain('actions!chat_suggestions_action_id_fkey!inner(brand_id, id,');
    expect(has(read, 'eq', 'id', SUGGESTION)).toBe(true);
    expect(has(read, 'eq', 'user_id', ME)).toBe(true);
    expect(has(read, 'is', 'removed_at', null)).toBe(true);
    const audit = calls.find((c) => c.table === 'site_audits')!;
    expect(audit.via).toBe('session');
    expect(has(audit, 'eq', 'brand_id', BRAND)).toBe(true);
    expect(has(audit, 'eq', 'status', 'completed')).toBe(true);
    expect(has(audit, 'order', 'completed_at', { ascending: false })).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('finds a page’s audit by the address it ended at, and none for other pages', async () => {
    audits = [
      audits[0],
      {
        url: 'https://acme.example/r/ridge',
        final_url: 'https://acme.example/ridge-45l',
        completed_at: '2026-10-27T10:00:00Z',
      },
    ];
    expect(await readDailySuggestion(SUGGESTION)).toMatchObject({
      ok: true,
      detail: { auditedAt: '2026-10-27T10:00:00Z' },
    });
    audits = [audits[0]];
    expect(await readDailySuggestion(SUGGESTION)).toMatchObject({
      ok: true,
      detail: { auditedAt: null },
    });
  });

  it('reads no audit for an action with no pages, and starts no editor without writing to do', async () => {
    answers['session.chat_suggestions.select'] = {
      data: { ...row, actions: { ...action, payload: { targetCount: 5 } } },
      error: null,
    };
    answers['session.action_tasks.select'] = {
      data: [{ id: 'task-2', task_key: 'optimize_content', status: 'completed' }],
      error: null,
    };
    const result = await readDailySuggestion(SUGGESTION);
    expect(result).toMatchObject({ ok: true, detail: { start: null, auditedAt: null } });
    expect(calls.some((c) => c.table === 'site_audits')).toBe(false);
  });

  it('says closed for an action done since', async () => {
    answers['session.chat_suggestions.select'] = {
      data: { ...row, actions: { ...action, status: 'completed' } },
      error: null,
    };
    expect(await readDailySuggestion(SUGGESTION)).toMatchObject({
      ok: true,
      detail: { suggestion: { closed: 'completed' } },
    });
  });

  it('finds none removed, deleted, someone else’s, for an Analyst or for a bad id', async () => {
    answers['session.chat_suggestions.select'] = { data: null, error: null };
    expect(await readDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'not_found' });
    expect(await readDailySuggestion('nope')).toEqual({ ok: false, failure: 'not_found' });
    calls = [];
    role = 'analyst';
    expect(await readDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'not_found' });
    expect(calls.some((c) => c.table === 'chat_suggestions')).toBe(false);
  });

  it('fails as a value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answers['session.site_audits.select'] = { data: null, error: { message: 'down' } };
    expect(await readDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'failed' });
    answers['session.chat_suggestions.select'] = { data: null, error: { message: 'down' } };
    expect(await readDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'failed' });
    logged.mockRestore();
  });
});

describe('a suggestion’s uses', () => {
  it('puts it off a week (Not now), and keeps the feed used', async () => {
    expect(await snoozeDailySuggestion(SUGGESTION)).toEqual({ ok: true });
    const [snoozed, used] = writes();
    expect(snoozed.table).toBe('chat_suggestions');
    expect(snoozed.row).toEqual({ snoozed_until: '2026-11-05T09:00:00.000Z' });
    expect(has(snoozed, 'eq', 'user_id', ME)).toBe(true);
    expect(used.row).toEqual({ last_used_at: '2026-10-29T09:00:00.000Z' });
  });

  it('removes it, the action left as it is', async () => {
    expect(await removeDailySuggestion(SUGGESTION)).toEqual({ ok: true });
    expect(writes().map((w) => [w.table, w.row])).toEqual([
      ['chat_suggestions', { removed_at: '2026-10-29T09:00:00.000Z' }],
      ['chat_suggestion_feeds', { last_used_at: '2026-10-29T09:00:00.000Z' }],
    ]);
    expect(calls.some((c) => c.table === 'actions')).toBe(false);
  });

  it('marks it started, with where, keeping the first start', async () => {
    expect(await startedDailySuggestion(SUGGESTION, 'editor')).toEqual({ ok: true });
    const [started] = writes();
    expect(started.row).toEqual({
      started_at: '2026-10-29T09:00:00.000Z',
      started_via: 'editor',
    });
    expect(has(started, 'is', 'started_at', null)).toBe(true);

    calls = [];
    answers['session.chat_suggestions.select.single'] = {
      data: { id: SUGGESTION, brand_id: BRAND, started_at: '2026-10-28T08:00:00Z' },
      error: null,
    };
    expect(await startedDailySuggestion(SUGGESTION, 'chat')).toEqual({ ok: true });
    expect(writes().map((w) => w.table)).toEqual(['chat_suggestion_feeds']);
  });

  it("reads the suggestion through the person's session", async () => {
    await snoozeDailySuggestion(SUGGESTION);
    const read = calls.find((c) => c.table === 'chat_suggestions' && c.op === 'select')!;
    expect(read.via).toBe('session');
  });

  it('takes only Chat or the Content Editor as where, and nothing on someone else’s', async () => {
    expect(await startedDailySuggestion(SUGGESTION, 'email' as 'chat')).toEqual({
      ok: false,
      failure: 'not_allowed',
    });
    answers['session.chat_suggestions.select.single'] = { data: null, error: null };
    expect(await removeDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'not_found' });
    expect(writes()).toEqual([]);
  });

  it('fails as a value when the write fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answers['admin.chat_suggestions.update'] = { data: null, error: { message: 'down' } };
    expect(await snoozeDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'failed' });
    expect(writes().map((w) => w.table)).toEqual(['chat_suggestions']);
    logged.mockRestore();
  });
});
