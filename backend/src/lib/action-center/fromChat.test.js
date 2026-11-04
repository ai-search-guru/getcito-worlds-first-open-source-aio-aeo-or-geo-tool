import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Send to Action Center from Chat (CHAT-09 §E, CHAT-20 §12). These pin the
 * V1 Final rules: an active action that covers the finding is found first
 * (all of it: no Create anyway; some of it: only when the person chose it),
 * the action is frozen as it was sent (targets, baseline, tasks), its tasks
 * keep AC-004's rules, the same approval never makes two, and History says
 * it came from Chat.
 */

let db;

/** A row's value for a column, with PostgREST's `payload->>key`. */
function valueOf(row, col) {
  const arrow = /^(\w+)->>(\w+)$/.exec(col);
  if (arrow) {
    const v = row[arrow[1]]?.[arrow[2]];
    return v === undefined || v === null ? null : String(v);
  }
  return row[col];
}

function table(name) {
  const state = { filters: [], op: 'select', row: null, count: false, where: {} };
  const rows = () =>
    (db.tables[name] ?? []).filter((row) => state.filters.every((match) => match(row)));
  const result = (one) => {
    if (state.op === 'delete') {
      db.deletes.push({ table: name, where: state.where });
      return { data: null, error: null };
    }
    if (state.op === 'insert') {
      if (name === 'action_tasks' && db.tasksError) return { data: null, error: db.tasksError };
      db.inserts.push({ table: name, row: state.row });
      if (name === 'actions') {
        if (db.insertError) {
          db.onRefusedInsert?.();
          return { data: null, error: db.insertError };
        }
        return { data: { id: 'act-new', action_no: 1300 }, error: null };
      }
      return { data: null, error: null };
    }
    if (state.count && db.countError) return { data: null, count: null, error: db.countError };
    const found = rows();
    if (state.count) return { data: null, count: found.length, error: null };
    return { data: one ? (found[0] ?? null) : found, error: null };
  };
  const chain = {
    select: (_cols, opts) => {
      if (opts?.head) state.count = true;
      return chain;
    },
    gte: (col, val) => {
      state.filters.push((row) => typeof row[col] === 'string' && row[col] >= val);
      return chain;
    },
    insert: (row) => {
      state.op = 'insert';
      state.row = row;
      return chain;
    },
    delete: () => {
      state.op = 'delete';
      return chain;
    },
    eq: (col, val) => {
      state.where[col] = val;
      state.filters.push((row) => valueOf(row, col) === val);
      return chain;
    },
    in: (col, vals) => {
      state.filters.push((row) => vals.includes(valueOf(row, col)));
      return chain;
    },
    is: (col, val) => {
      state.filters.push((row) => (valueOf(row, col) ?? null) === val);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result(true),
    single: async () => result(true),
    then: (resolve, reject) => Promise.resolve(result(false)).then(resolve, reject),
  };
  return chain;
}

const rpc = vi.fn();
vi.mock('../../config/supabase.js', () => ({
  default: { from: (name) => table(name), rpc: (...args) => rpc(...args) },
}));
const priorityOnCreate = vi.fn(async () => ({ priority_score: 64, priority_level: 'medium' }));
vi.mock('./priorityData.js', () => ({ priorityOnCreate }));
const readPlatformStates = vi.fn(async ({ platforms }) =>
  platforms.map((platform) => ({ platform, state: 'not_mentioned', runs: 4 })),
);
vi.mock('./improveOutcome.js', () => ({ readPlatformStates }));

const {
  CHAT_ACTION_KIND,
  baselineWindow,
  chatDedupKey,
  chatProposalSchema,
  chatTaskRows,
  coverage,
  findCoveringActions,
  pageKey,
  pageUrl,
  proposalKeys,
  proposalProblems,
  sendChatAction,
} = await import('./fromChat.js');

const BRAND = '33333333-3333-3333-3333-333333333333';
const PROMPT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const PROMPT_B = 'aaaaaaaa-0000-0000-0000-000000000002';
const COMPETITOR = 'cccccccc-0000-0000-0000-000000000001';

const task = (over = {}) => ({
  title: 'Add a pricing FAQ block to /pricing',
  type: 'on_page',
  url: '/pricing',
  done_when: 'The FAQ block is live on /pricing',
  ...over,
});

const proposal = (over = {}) =>
  chatProposalSchema.parse({
    title: 'Win back pricing citations',
    category: 'recover',
    why: 'Google AI Overviews stopped citing /pricing for two pricing prompts this week.',
    entities: { prompts: [PROMPT_A], pages: ['/pricing'], platforms: ['google-aio'] },
    tasks: [task()],
    ...over,
  });

beforeEach(() => {
  db = {
    inserts: [],
    deletes: [],
    tasksError: null,
    insertError: null,
    countError: null,
    tables: {
      brand_domains: [{ brand_id: BRAND, domain: 'https://www.getcito.com', is_primary: true }],
      competitors: [{ id: COMPETITOR, brand_id: BRAND, name: 'Peec AI' }],
      prompt_sets: [{ id: 'set-1', brand_id: BRAND }],
      prompts: [
        { id: PROMPT_A, prompt_set_id: 'set-1', text: 'getcito pricing' },
        { id: PROMPT_B, prompt_set_id: 'set-1', text: 'getcito plans' },
      ],
      actions: [],
      action_entities: [],
      chat_conversations: [{ id: 'conv-1', user_id: 'user-1', deleted_at: null }],
      chat_runs: [{ id: 'run-1', conversation_id: 'conv-1' }],
      chat_run_steps: [{ id: 'step-1', run_id: 'run-1', tool: 'create_action', debug_json: null }],
    },
  };
  rpc.mockReset().mockResolvedValue({
    data: { cells: 20, visible: 6, mention_answers: 6, page_citations: 3 },
    error: null,
  });
  priorityOnCreate.mockClear();
  readPlatformStates.mockClear();
});

/** An active action of the brand, with its kept list. */
function activeAction(id, no, { status = 'new', entities = [], payload = {}, dedup = null } = {}) {
  db.tables.actions.push({
    id,
    action_no: no,
    brand_id: BRAND,
    kind: 'recover_lost_citations',
    category: 'recover',
    status,
    payload,
    dedup_key: dedup ?? `def:${id}`,
    deleted_at: null,
    priority_score: 70,
  });
  for (const [type, key, label] of entities) {
    db.tables.action_entities.push({
      action_id: id,
      entity_type: type,
      entity_key: key,
      label: label ?? null,
      removed_at: null,
    });
  }
}

describe('pages as two actions compare them', () => {
  it("reads the brand's own pages by path, and another site's by host and path", () => {
    const hosts = ['getcito.com'];
    expect(pageKey('https://www.getcito.com/Pricing/', hosts)).toBe('/pricing');
    expect(pageKey('/pricing?ref=x#faq', hosts)).toBe('/pricing');
    expect(pageKey('getcito.com/pricing', hosts)).toBe('/pricing');
    expect(pageKey('https://g2.com/products/getcito', hosts)).toBe('g2.com/products/getcito');
    expect(pageKey('', hosts)).toBeNull();
  });

  it('reads a bare word as a path, never as a host', () => {
    expect(pageKey('pricing', ['getcito.com'])).toBe('/pricing');
    expect(pageKey('blog/What-Is-AEO/', ['getcito.com'])).toBe('/blog/what-is-aeo');
    expect(pageUrl('pricing', 'getcito.com')).toBe('https://getcito.com/pricing');
    expect(pageUrl('g2.com/products/getcito', 'getcito.com')).toBe(
      'https://g2.com/products/getcito',
    );
  });

  it('keeps a path as a full address on the primary host, for measuring', () => {
    expect(pageUrl('/pricing', 'getcito.com')).toBe('https://getcito.com/pricing');
    expect(pageUrl('https://g2.com/x', 'getcito.com')).toBe('https://g2.com/x');
    expect(pageUrl('/pricing', null)).toBeNull();
  });
});

describe('AC-004 on a proposal', () => {
  it('passes a task that names its page and when it is done', () => {
    expect(proposalProblems(proposal())).toEqual([]);
  });

  it('refuses look-only tasks, "for N prompts" titles, tasks with no place, and no entity', () => {
    const problems = proposalProblems(
      proposal({
        title: 'Fix citations for 12 prompts',
        entities: { prompts: [], pages: [], competitors: [], platforms: [] },
        tasks: [
          task({ title: 'Analyze competitor pages for pricing' }),
          task({ title: 'Rewrite intro for 3 pages' }),
          task({ title: 'Rewrite the pricing intro', url: undefined, where: undefined }),
        ],
      }),
    );
    expect(problems).toEqual([
      'Name at least one prompt, page or competitor the action is about.',
      'The title counts instead of naming: "Fix citations for 12 prompts".',
      'Task 1 only looks ("Analyze competitor pages for pricing"): say the change to make.',
      'Task 2 counts instead of naming one thing: "Rewrite intro for 3 pages".',
      'Task 3 needs its exact page (url) or where it is done.',
    ]);
  });
});

describe('the duplicate check', () => {
  const keys = proposalKeys(
    { prompts: [PROMPT_A], pages: ['/pricing'], competitors: [], platforms: [] },
    ['getcito.com'],
  );
  const action = (prompts, pages) => ({
    dedupKey: 'x',
    keys: { prompts: new Set(prompts), pages: new Set(pages), competitors: new Set() },
  });

  it('says how much of the finding an action covers', () => {
    expect(coverage(keys, action([PROMPT_A], ['/pricing']), 'k')).toEqual({
      covers: 'all',
      shared: 2,
    });
    expect(coverage(keys, action([PROMPT_A], []), 'k')).toEqual({ covers: 'some', shared: 1 });
    expect(coverage(keys, action([PROMPT_B], ['/plans']), 'k')).toBeNull();
    // The same proposal again, by its key, whatever its entities read as now.
    expect(coverage(keys, { ...action([], []), dedupKey: 'k' }, 'k')).toEqual({
      covers: 'all',
      shared: 2,
    });
  });

  it('keys a proposal by its category and entities, not their order or case', () => {
    const a = chatDedupKey(
      'recover',
      proposalKeys({
        prompts: [PROMPT_A, PROMPT_B],
        pages: ['/A'],
        competitors: [],
        platforms: [],
      }),
    );
    const b = chatDedupKey(
      'recover',
      proposalKeys({
        prompts: [PROMPT_B, PROMPT_A.toUpperCase()],
        pages: ['/a/'],
        competitors: [],
        platforms: [],
      }),
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^chat_finding:recover:[0-9a-f]{20}$/);
    expect(
      chatDedupKey(
        'fix',
        proposalKeys({
          prompts: [PROMPT_A, PROMPT_B],
          pages: ['/a'],
          competitors: [],
          platforms: [],
        }),
      ),
    ).not.toBe(a);
  });

  it("finds the brand's active actions over their kept list and their payload, closest first", async () => {
    // Covers the prompt by its kept list and the page by its payload: all of it.
    activeAction('act-all', 1258, {
      entities: [['prompts', PROMPT_A]],
      payload: { pages: ['https://getcito.com/pricing'], title: 'Win back /pricing' },
    });
    // Shares the prompt only.
    activeAction('act-some', 1201, { entities: [['prompts', PROMPT_A]] });
    // Closed, or deleted, or about something else: not a duplicate.
    activeAction('act-done', 1100, { status: 'completed', entities: [['prompts', PROMPT_A]] });
    activeAction('act-other', 1102, { entities: [['prompts', PROMPT_B]] });
    db.tables.actions.push({
      id: 'act-deleted',
      action_no: 1099,
      brand_id: BRAND,
      status: 'new',
      payload: { promptIds: [PROMPT_A] },
      dedup_key: 'd',
      deleted_at: '2026-10-30T00:00:00Z',
    });

    const { covering } = await findCoveringActions(BRAND, proposal().entities, {
      category: 'recover',
    });
    expect(covering.map((c) => [c.actionNo, c.covers, c.shared])).toEqual([
      [1258, 'all', 2],
      [1201, 'some', 1],
    ]);
    expect(covering[0]).toMatchObject({ actionId: 'act-all', title: 'Win back /pricing' });
  });

  it('matches a competitor its payload names, beside its kept list', async () => {
    activeAction('act-gap', 1310, {
      entities: [['prompts', PROMPT_B]],
      payload: { competitorIds: [COMPETITOR.toUpperCase()] },
    });
    const { covering } = await findCoveringActions(BRAND, {
      prompts: [],
      pages: [],
      competitors: [COMPETITOR],
      platforms: [],
    });
    expect(covering.map((c) => [c.actionNo, c.covers])).toEqual([[1310, 'all']]);
  });

  it('matches a competitor kept by its name', async () => {
    activeAction('act-rival', 1300, { entities: [['competitors', 'Peec AI', 'Peec AI']] });
    const { covering } = await findCoveringActions(BRAND, {
      prompts: [],
      pages: [],
      competitors: [COMPETITOR],
      platforms: [],
    });
    expect(covering.map((c) => [c.actionNo, c.covers])).toEqual([[1300, 'all']]);
  });
});

describe('sendChatAction', () => {
  const send = (over = {}) =>
    sendChatAction(BRAND, {
      proposal: proposal(),
      userId: 'user-1',
      conversationId: 'conv-1',
      runId: 'run-1',
      executionMode: 'assisted',
      idempotencyKey: 'chat:step-1',
      now: new Date('2026-10-31T12:00:00Z'),
      ...over,
    });
  const inserted = (name) => db.inserts.filter((i) => i.table === name).map((i) => i.row);

  it('creates the action frozen as it was sent, with its tasks and a created event from Chat', async () => {
    await expect(send()).resolves.toEqual({
      actionId: 'act-new',
      actionNo: 1300,
      created: true,
      dailyLimit: { used: 0, limit: 5, reached: false },
    });

    const [action] = inserted('actions');
    expect(action).toMatchObject({
      brand_id: BRAND,
      category: 'recover',
      kind: CHAT_ACTION_KIND,
      impact: 'medium',
      kpi_keys: ['ai_visibility', 'citations', 'mentions'],
      priority_score: 64,
      tasks_generated_at: '2026-10-31T12:00:00.000Z',
    });
    expect(action.dedup_key).toMatch(/^chat_finding:recover:/);
    expect(action.payload).toMatchObject({
      source: 'chat',
      title: 'Win back pricing citations',
      promptIds: [PROMPT_A],
      pages: ['https://getcito.com/pricing'],
      platforms: ['google-aio'],
      targetEntity: 'prompts',
      targetCount: 1,
      targets: [{ id: PROMPT_A, label: 'getcito pricing' }],
      entities: {
        prompts: [{ id: PROMPT_A, label: 'getcito pricing' }],
        pages: ['https://getcito.com/pricing'],
        competitors: [],
        platforms: ['google-aio'],
      },
      conversationId: 'conv-1',
      runId: 'run-1',
      execution: { mode: 'assisted' },
      idempotencyKey: 'chat:step-1',
    });
    // The baseline: the 14 days before, on its prompts and pages, and the prompt per platform.
    expect(action.baseline.window).toEqual({ from: '2026-10-17', to: '2026-10-30' });
    expect(action.baseline.metrics).toMatchObject({ ai_visibility: 30, mentions: 6, citations: 3 });
    expect(rpc).toHaveBeenCalledWith(
      'opportunity_basket_metrics',
      expect.objectContaining({
        p_prompt_ids: [PROMPT_A],
        p_from: '2026-10-17',
        p_to: '2026-10-30',
      }),
    );
    expect(action.baseline.platforms).toEqual([
      {
        promptId: PROMPT_A,
        platforms: [{ platform: 'google-aio', state: 'not_mentioned', runs: 4 }],
      },
    ]);
    // Scored by the engine, as every person-sent action.
    expect(priorityOnCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: CHAT_ACTION_KIND, category: 'recover' }),
    );

    // One insert of every task.
    expect(inserted('action_tasks')).toEqual([chatTaskRows('act-new', proposal().tasks)]);
    expect(inserted('action_tasks')[0][0]).toMatchObject({
      position: 1,
      task_key: null,
      title: 'Add a pricing FAQ block to /pricing',
      details: {
        type: 'on_page',
        url: '/pricing',
        doneWhen: 'The FAQ block is live on /pricing',
        check: 'manual',
        source: 'chat',
      },
    });
    expect(inserted('action_events')).toEqual([
      {
        action_id: 'act-new',
        event: 'created',
        actor_id: 'user-1',
        data: {
          source: 'chat',
          conversationId: 'conv-1',
          runId: 'run-1',
          execution: { mode: 'assisted' },
          taskCount: 1,
          prompts: 1,
          pages: 1,
          competitors: 0,
        },
      },
    ]);
  });

  /** Never refused for the day's five, as no person's send is: counted, and said once reached. */
  it("counts toward the day's new actions, and says when they are reached", async () => {
    const today = (id, createdAt, over = {}) =>
      db.tables.actions.push({
        id,
        action_no: 1,
        brand_id: BRAND,
        kind: 'prompt_improve',
        status: 'completed',
        payload: {},
        dedup_key: id,
        deleted_at: null,
        created_at: createdAt,
        ...over,
      });
    // Yesterday's don't count; today's do, whoever sent them and wherever they are now.
    today('old', '2026-10-30T23:59:00.000Z');
    for (let i = 0; i < 3; i += 1) today(`sent-${i}`, '2026-10-31T08:00:00.000Z');
    today('chat-0', '2026-10-31T09:00:00.000Z', { kind: CHAT_ACTION_KIND });
    await expect(send()).resolves.toMatchObject({
      created: true,
      dailyLimit: { used: 4, limit: 5, reached: false },
    });
    // This one is the fifth (the fake doesn't keep the row it inserts: one more stands in).
    today('chat-1', '2026-10-31T11:59:00.000Z', { kind: CHAT_ACTION_KIND });
    await expect(send({ idempotencyKey: 'chat:step-2' })).resolves.toMatchObject({
      created: true,
      dailyLimit: { used: 5, limit: 5, reached: true },
    });
    // A count it can't read says nothing: the action stands.
    db.countError = { message: 'timeout' };
    const made = await send({ idempotencyKey: 'chat:step-3' });
    expect(made).toEqual({ actionId: 'act-new', actionNo: 1300, created: true });
  });

  it('records where it came from and how it was approved only as the database has them', async () => {
    const payload = () => inserted('actions').at(-1).payload;
    // Ran without a card: the engine marked its step.
    db.tables.chat_run_steps[0].debug_json = { auto: true };
    await send({ executionMode: 'assisted' });
    expect(payload()).toMatchObject({
      conversationId: 'conv-1',
      runId: 'run-1',
      execution: { mode: 'automated' },
    });
    // Someone else's chat, or a step that isn't this run's: nothing of it is kept.
    db.tables.chat_conversations[0].user_id = 'someone-else';
    await send({ idempotencyKey: 'chat:step-2' });
    expect(payload()).toMatchObject({ conversationId: null, runId: null, execution: null });
    db.tables.chat_conversations[0].user_id = 'user-1';
    await send({ idempotencyKey: 'chat:not-a-step' });
    expect(payload()).toMatchObject({ conversationId: 'conv-1', runId: 'run-1', execution: null });
  });

  it('answers what it made for the same approval again, and makes nothing', async () => {
    db.tables.actions.push({
      id: 'act-made',
      action_no: 1290,
      brand_id: BRAND,
      kind: CHAT_ACTION_KIND,
      status: 'new',
      payload: { idempotencyKey: 'chat:step-1' },
      deleted_at: null,
    });
    await expect(send()).resolves.toEqual({ actionId: 'act-made', actionNo: 1290, created: false });
    expect(db.inserts).toEqual([]);
  });

  it('takes the action back when its tasks could not be kept, so the approval can go again', async () => {
    db.tasksError = { message: 'statement timeout' };
    await expect(send()).rejects.toThrow("The action's tasks couldn't be kept: statement timeout");
    // Deleted again: no action without its tasks is left, and no created event was written.
    expect(db.deletes).toEqual([{ table: 'actions', where: { id: 'act-new' } }]);
    expect(inserted('action_events')).toEqual([]);
    db.tasksError = null;
    await expect(send()).resolves.toMatchObject({ created: true });
  });

  it("refuses an approval whose action was cancelled since, rather than say it's made", async () => {
    db.tables.actions.push({
      id: 'act-undone',
      action_no: 1291,
      brand_id: BRAND,
      kind: CHAT_ACTION_KIND,
      status: 'dismissed',
      payload: { idempotencyKey: 'chat:step-1' },
      deleted_at: null,
    });
    await expect(send()).rejects.toMatchObject({ status: 409, code: 'conflict' });
    expect(db.inserts).toEqual([]);
  });

  it('refuses a finding an active action covers, even when asked to create anyway', async () => {
    activeAction('act-all', 1258, {
      entities: [
        ['prompts', PROMPT_A],
        ['pages', '/pricing'],
      ],
    });
    const refused = await send({ createAnyway: true }).catch((e) => e);
    expect(refused).toMatchObject({
      status: 409,
      code: 'duplicate',
      message: 'AC-1258 already covers this.',
      extra: {
        action: { id: 'act-all', no: 1258, covers: 'all' },
        canCreateAnyway: false,
      },
    });
    expect(db.inserts).toEqual([]);
  });

  it('creates beside an action that shares only some entities, once the person chose to', async () => {
    activeAction('act-some', 1201, { entities: [['prompts', PROMPT_A]] });
    const refused = await send().catch((e) => e);
    expect(refused).toMatchObject({ code: 'duplicate', extra: { canCreateAnyway: true } });
    expect(db.inserts).toEqual([]);

    await expect(send({ createAnyway: true })).resolves.toMatchObject({ created: true });
    // The other action's targets never grow: nothing is written to it.
    expect(db.inserts.map((i) => i.table)).toEqual(['actions', 'action_tasks', 'action_events']);
    expect(inserted('actions')[0].payload.createdAnywayBeside).toBe(1201);
  });

  it("refuses AC-004's problems, and prompts or competitors that aren't the brand's", async () => {
    await expect(
      send({ proposal: proposal({ tasks: [task({ title: 'Measure citations' })] }) }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid' });
    await expect(
      send({
        proposal: proposal({
          entities: { prompts: ['bbbbbbbb-0000-0000-0000-000000000009'], pages: [] },
        }),
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid' });
    expect(db.inserts).toEqual([]);
  });

  it('keeps the action when its baseline could not be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    readPlatformStates.mockRejectedValueOnce(new Error('down'));
    await expect(send()).resolves.toMatchObject({ created: true });
    expect(inserted('actions')[0].baseline).toMatchObject({ metrics: null, platforms: [] });
  });

  it('says the same finding sent twice at once is a duplicate', async () => {
    db.insertError = { code: '23505', message: 'duplicate key' };
    // The other send's action went in between this one's check and its insert.
    db.onRefusedInsert = () =>
      activeAction('act-race', 1301, {
        entities: [
          ['prompts', PROMPT_A],
          ['pages', '/pricing'],
        ],
      });
    await expect(send()).rejects.toMatchObject({
      status: 409,
      code: 'duplicate',
      extra: { action: { no: 1301 }, canCreateAnyway: false },
    });
    expect(inserted('action_tasks')).toEqual([]);
  });
});

describe('the baseline window', () => {
  it('is the 14 whole days before the day it was sent', () => {
    expect(baselineWindow(new Date('2026-10-31T00:30:00Z'))).toEqual({
      from: '2026-10-17',
      to: '2026-10-30',
    });
  });
});
