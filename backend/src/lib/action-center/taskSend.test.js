import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sending a task onward (AC-004): the opportunity a content task becomes, a
 * second send returning it, the webhook's answers, and the trail the task
 * keeps.
 */

let db;
let ops;

/** A column, or a JSON path as PostgREST writes one ("source_data->fromAction->>taskId"). */
const read = (row, col) => col.split(/->>?/).reduce((value, key) => value?.[key], row);

/** The uuid columns a prompt is read by: Postgres refuses text there (22P02). */
const UUID_COLUMNS = { prompts: ['id'], prompt_cluster_members: ['prompt_id'] };
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function table(name) {
  const q = { op: 'select', filters: [], payload: null, returning: false, invalid: null };
  const rows = () => (db[name] ?? []).filter((row) => q.filters.every((test) => test(row)));
  const run = (single) => {
    if (q.invalid) {
      return {
        data: null,
        error: { code: '22P02', message: `invalid input syntax for type uuid: "${q.invalid}"` },
      };
    }
    if (q.op === 'select') {
      const data = rows();
      return { data: single ? (data[0] ?? null) : data, error: null };
    }
    ops.push({ table: name, op: q.op, payload: q.payload });
    if (q.op === 'insert') {
      // Another send's row, landing between this one's check and its insert.
      if (name === 'content_opportunities' && db.raceRow) {
        db[name].push(db.raceRow);
        db.raceRow = null;
      }
      // 00151: one open opportunity per task.
      const taskId = q.payload.source_data?.fromAction?.taskId;
      if (
        name === 'content_opportunities' &&
        (db[name] ?? []).some(
          (row) => row.source_data?.fromAction?.taskId === taskId && row.status !== 'archived',
        )
      ) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const row = { id: `${name}-${(db[name] ?? []).length + 1}`, ...q.payload };
      (db[name] ??= []).push(row);
      return { data: single ? row : [row], error: null };
    }
    const matched = rows();
    for (const row of matched) Object.assign(row, q.payload);
    return { data: q.returning ? matched : null, error: null };
  };
  const chain = {
    select: () => ((q.returning = q.op !== 'select'), chain),
    eq: (col, value) => {
      if (UUID_COLUMNS[name]?.includes(col) && !UUID_TEXT.test(String(value))) q.invalid = value;
      q.filters.push((row) => read(row, col) === value);
      return chain;
    },
    neq: (col, value) => (q.filters.push((row) => read(row, col) !== value), chain),
    is: (col, value) => (q.filters.push((row) => (read(row, col) ?? null) === value), chain),
    order: () => chain,
    range: () => chain,
    limit: () => chain,
    insert: (payload) => ((q.op = 'insert'), (q.payload = payload), chain),
    update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
    maybeSingle: async () => run(true),
    single: async () => run(true),
    then: (resolve, reject) => Promise.resolve(run(false)).then(resolve, reject),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const dispatchBrandWebhook = vi.fn();
vi.mock('../webhookDispatch.js', () => ({
  dispatchBrandWebhook: (...args) => dispatchBrandWebhook(...args),
}));
vi.mock('./fromOpportunity.js', () => ({ OPPORTUNITY_ACTION_KIND: 'content_opportunity' }));

const { opportunityFromTask, ownPageOf, sendTaskToContent, sendTaskToWebhook, taskQuestion } =
  await import('./taskSend.js');

const details = {
  where: 'acme.example/blog/shipping · lost on ChatGPT',
  why: 'Cited #2 until Oct 12.',
  how: ['Add a table.', 'Put "2026" in the title.'],
  doneWhen: 'Cited again within 14 days.',
  type: 'content',
  effort: '~2h',
  role: 'Content writer',
  source: 'ai',
};

beforeEach(() => {
  ops = [];
  dispatchBrandWebhook.mockReset();
  db = {
    action_tasks: [
      {
        id: 't1',
        action_id: 'a1',
        task_key: null,
        title: 'Add a 2026 table to /blog/shipping',
        status: 'todo',
        details: { ...details },
        updated_at: '2026-10-16T09:00:00Z',
      },
    ],
    actions: [
      {
        id: 'a1',
        action_no: 12,
        brand_id: 'b1',
        kind: 'recover_lost_citations',
        category: 'recover',
        impact: 'high',
        status: 'new',
        priority_score: 84,
        priority_level: 'high',
      },
    ],
    brands: [{ id: 'b1', name: 'Acme Coffee', industry: 'Coffee' }],
    brand_domains: [{ brand_id: 'b1', domain: 'acme.example', is_primary: true }],
    webhook_configs: [{ id: 'w1', brand_id: 'b1', is_active: true, events: ['action_task.sent'] }],
    content_opportunities: [],
  };
});

describe('ownPageOf', () => {
  it("finds the brand's page in Where, as a URL", () => {
    expect(ownPageOf('acme.example/blog/shipping · lost on ChatGPT', ['acme.example'])).toBe(
      'https://acme.example/blog/shipping',
    );
    expect(ownPageOf('"/pricing" on Gemini', ['acme.example'])).toBe(
      'https://acme.example/pricing',
    );
    expect(ownPageOf('g2.com/categories/ai-rank-tracking', ['acme.example'])).toBeNull();
  });

  it('reads a long Where in bounded time, up to the length the drawer keeps', () => {
    ownPageOf('acme.example/pricing', ['acme.example']);
    const started = Date.now();
    expect(ownPageOf(`${'.'.repeat(100_000)}x`, ['acme.example'])).toBeNull();
    expect(ownPageOf(`"${'“'.repeat(100_000)}`, ['acme.example'])).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
    // What the drawer keeps is read as before.
    expect(ownPageOf(`${'a '.repeat(240)}acme.example/pricing`, ['acme.example'])).toBe(
      'https://acme.example/pricing',
    );
  });
});

describe('opportunityFromTask', () => {
  it('works on the named page, with every field Content reads, and points back at the action', () => {
    const row = opportunityFromTask({
      task: db.action_tasks[0],
      title: 'Add a 2026 table to /blog/shipping',
      action: db.actions[0],
      brandDomains: ['acme.example'],
    });
    expect(row).toMatchObject({
      source: 'action',
      status: 'new',
      type: 'owned',
      impact: 'high',
      opportunity_score: 84,
      decision: 'optimize',
      description: 'Cited #2 until Oct 12.',
    });
    expect(row.source_data.assets).toEqual([
      {
        key: 'a1',
        type: 'blog_post',
        channel: 'owned',
        decision: 'optimize',
        title: 'Add a 2026 table to /blog/shipping',
        pages: [{ url: 'https://acme.example/blog/shipping', title: '' }],
      },
    ]);
    expect(row.source_data.actions).toEqual({ all: 'a1' });
    expect(row.source_data.fromAction).toMatchObject({ actionNo: 12, taskId: 't1' });
  });

  describe('with the exact page and the change (AC-010)', () => {
    const fromTask = (over) =>
      opportunityFromTask({
        task: { ...db.action_tasks[0], details: { ...details, check: 'auto', ...over } },
        title: 'Add a 2026 table',
        action: db.actions[0],
        brandDomains: ['acme.example'],
      });
    const replaces = { before: 'Old intro', after: 'A 2026 table of countries and costs.' };
    const adds = { before: null, after: 'A 2026 table of countries and costs.' };

    it('carries them, and works on the page Where names', () => {
      const row = fromTask({ url: '/guides/shipping-costs', change: replaces });
      expect(row.source_data.assets[0].pages).toEqual([
        { url: 'https://acme.example/blog/shipping', title: '' },
      ]);
      expect(row.source_data.fromAction.task).toMatchObject({
        url: '/guides/shipping-costs',
        change: { before: 'Old intro', after: 'A 2026 table of countries and costs.' },
      });
    });

    it('works on the URL when Where names no page and the change replaces its text', () => {
      const row = fromTask({ where: 'Gemini · 3 prompts', url: '/pricing', change: replaces });
      expect(row).toMatchObject({ decision: 'optimize' });
      expect(row.source_data.assets[0].pages).toEqual([
        { url: 'https://acme.example/pricing', title: '' },
      ]);
    });

    it('makes a new page of a URL whose change only adds: it may not be there yet', () => {
      const row = fromTask({ where: 'Gemini · 3 prompts', url: '/guides/new', change: adds });
      expect(row).toMatchObject({ decision: 'create' });
      expect(row.source_data.assets[0].pages).toEqual([]);
    });
  });
});

describe('sendTaskToContent', () => {
  it('makes the opportunity, records it on the task and in History, and returns it on a second send', async () => {
    const first = await sendTaskToContent({ taskId: 't1', title: '', userId: 'u1' });
    expect(first).toEqual({ opportunityId: 'content_opportunities-1', created: true });
    expect(db.action_tasks[0].details.sent.content.opportunityId).toBe('content_opportunities-1');
    expect(ops.find((op) => op.table === 'action_events').payload).toMatchObject({
      event: 'task_sent',
      data: { taskId: 't1', to: 'content', title: 'Add a 2026 table to /blog/shipping' },
      actor_id: 'u1',
    });

    const again = await sendTaskToContent({ taskId: 't1', title: '', userId: 'u1' });
    expect(again).toEqual({ opportunityId: 'content_opportunities-1', created: false });
    expect(db.content_opportunities).toHaveLength(1);
  });

  it('takes only a content task, and none from an action Content sent', async () => {
    db.action_tasks[0].details.type = 'outreach';
    await expect(sendTaskToContent({ taskId: 't1', title: '' })).rejects.toMatchObject({
      code: 'not_content',
    });
    db.action_tasks[0].details.type = 'content';
    db.actions[0].kind = 'content_opportunity';
    await expect(sendTaskToContent({ taskId: 't1', title: '' })).rejects.toMatchObject({
      code: 'from_content',
    });
  });

  it("uses the drawer's text for a library task", async () => {
    db.action_tasks[0].title = null;
    await sendTaskToContent({ taskId: 't1', title: 'Refresh /blog/shipping', userId: null });
    expect(db.content_opportunities[0].title).toBe('Refresh /blog/shipping');
  });
});

describe('one open opportunity per question', () => {
  const QUESTION = 'What are the best coffee subscription services in 2026?';
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const aboutOnePrompt = () => {
    db.action_entities = [
      {
        action_id: 'a1',
        entity_type: 'prompts',
        entity_key: P1,
        label: QUESTION,
        removed_at: null,
      },
    ];
    db.prompts = [{ id: P1, text: QUESTION }];
    db.prompt_cluster_members = [{ prompt_id: P1, cluster_id: 'c9' }];
  };
  const openOne = (over = {}) => ({
    id: 'o-open',
    brand_id: 'b1',
    status: 'reviewed',
    source: 'system',
    prompt_id: null,
    cluster_id: 'c1',
    related_cluster_ids: [],
    opportunity_score: 52,
    impact: 'medium',
    source_data: {
      promptText: 'What are the best coffee subscription services in 2025?',
      prompts: ['What are the best coffee subscription services in 2025?'],
      estAiVolume: 3038,
      scoreComponents: { demand: 40 },
    },
    ...over,
  });

  it('adds a task about one prompt to the open opportunity on its question, once', async () => {
    aboutOnePrompt();
    db.content_opportunities = [openOne()];

    const sent = await sendTaskToContent({ taskId: 't1', title: '', userId: 'u1' });
    expect(sent).toEqual({ opportunityId: 'o-open', created: false, merged: true });
    expect(db.content_opportunities).toHaveLength(1);
    const [opp] = db.content_opportunities;
    // The opportunity's measured signal and its score stay, a task has none;
    // the task's higher impact is kept.
    expect(opp).toMatchObject({ opportunity_score: 52, impact: 'high' });
    expect(opp.source_data.estAiVolume).toBe(3038);
    expect(opp.source_data.prompts).toHaveLength(1);
    expect(opp.source_data.merged).toEqual([
      expect.objectContaining({ source: 'action', actionNo: 12, taskId: 't1' }),
    ]);
    expect(db.action_tasks[0].details.sent.content.opportunityId).toBe('o-open');
    expect(ops.find((op) => op.table === 'action_events').payload.data).toMatchObject({
      to: 'content',
      merged: true,
    });

    ops = [];
    expect(await sendTaskToContent({ taskId: 't1', title: '', userId: 'u1' })).toMatchObject({
      opportunityId: 'o-open',
    });
    expect(opp.source_data.merged).toHaveLength(1);
    expect(ops.filter((op) => op.table === 'action_events')).toHaveLength(0);
  });

  it("matches the question's cluster too, and never a closed opportunity", async () => {
    aboutOnePrompt();
    db.content_opportunities = [
      openOne({ id: 'o-done', status: 'done' }),
      openOne({ id: 'o-cluster', source_data: { promptText: 'Other words' }, cluster_id: 'c9' }),
    ];
    const sent = await sendTaskToContent({ taskId: 't1', title: '', userId: 'u1' });
    expect(sent.opportunityId).toBe('o-cluster');
  });

  it('opens its own opportunity, carrying the question, when none answers it', async () => {
    aboutOnePrompt();
    db.content_opportunities = [openOne({ source_data: { promptText: 'Best espresso machines' } })];
    const sent = await sendTaskToContent({ taskId: 't1', title: '', userId: 'u1' });
    expect(sent.created).toBe(true);
    const row = db.content_opportunities.find((r) => r.id === sent.opportunityId);
    expect(row).toMatchObject({ prompt_id: P1, source_data: { promptText: QUESTION } });
  });

  it('opens its own opportunity when its action is about several prompts', async () => {
    aboutOnePrompt();
    db.action_entities.push({
      action_id: 'a1',
      entity_type: 'prompts',
      entity_key: P2,
      label: 'Best espresso machines',
      removed_at: null,
    });
    db.content_opportunities = [openOne()];
    const sent = await sendTaskToContent({ taskId: 't1', title: '', userId: 'u1' });
    expect(sent.created).toBe(true);
    expect(db.content_opportunities).toHaveLength(2);
  });

  it("sends a topic opportunity's task, whose prompt is keyed by the suggestion's text, without a question", async () => {
    aboutOnePrompt();
    db.actions[0].kind = 'topic_opportunity';
    // AC-009: a topic opportunity counts its suggestions, kept by their text.
    db.action_entities[0].entity_key = QUESTION;
    db.content_opportunities = [openOne()];

    expect(await taskQuestion('a1')).toBeNull();
    const sent = await sendTaskToContent({ taskId: 't1', title: '', userId: 'u1' });
    expect(sent.created).toBe(true);
    const row = db.content_opportunities.find((r) => r.id === sent.opportunityId);
    expect(row.prompt_id).toBeNull();
    expect(row.source_data).not.toHaveProperty('promptText');
  });

  it('reads the question of a prompt keyed by its id', async () => {
    aboutOnePrompt();
    expect(await taskQuestion('a1')).toEqual({ promptId: P1, text: QUESTION, clusterId: 'c9' });
  });
});

describe('sendTaskToWebhook', () => {
  it('posts the task as action_task.sent and records it', async () => {
    dispatchBrandWebhook.mockResolvedValueOnce({ sent: 1, failed: 0 });
    expect(await sendTaskToWebhook({ taskId: 't1', title: '', userId: 'u1' })).toEqual({
      delivered: 1,
      failed: 0,
    });
    const [brandId, payload] = dispatchBrandWebhook.mock.calls[0];
    expect(brandId).toBe('b1');
    expect(payload).toMatchObject({
      event: 'action_task.sent',
      task: {
        id: 't1',
        type: 'content',
        done_when: 'Cited again within 14 days.',
        // AC-010's fields, null when the task has none.
        url: null,
        change: null,
        check: null,
      },
      action: { id: 'a1', action_no: 12, priority_score: 84 },
      brand: { name: 'Acme Coffee', domain: 'acme.example' },
    });
    expect(payload.action.link).toMatch(/\/dashboard\/action-center\/actions\?action=a1$/);
    expect(db.action_tasks[0].details.sent.webhook).toMatchObject({ delivered: 1 });
  });

  it('distinguishes no active webhook from an active webhook without the task subscription', async () => {
    db.webhook_configs = [];
    await expect(sendTaskToWebhook({ taskId: 't1', title: '' })).rejects.toMatchObject({
      code: 'no_webhook',
      status: 409,
    });

    db.webhook_configs = [
      { id: 'w1', brand_id: 'b1', is_active: true, events: ['opportunity.sent'] },
    ];
    await expect(sendTaskToWebhook({ taskId: 't1', title: '' })).rejects.toMatchObject({
      code: 'webhook_not_subscribed',
      status: 409,
    });

    db.webhook_configs = [
      { id: 'w1', brand_id: 'b1', is_active: true, events: ['action_task.sent'] },
    ];
    dispatchBrandWebhook.mockResolvedValueOnce({ sent: 0, failed: 1 });
    await expect(sendTaskToWebhook({ taskId: 't1', title: '' })).rejects.toMatchObject({
      code: 'webhook_failed',
    });
    expect(db.action_tasks[0].details.sent).toBeUndefined();
  });
});

describe('what the review found', () => {
  it('makes one opportunity when two sends race, and the second finds it', async () => {
    // The other send inserts between this one's check and its insert.
    db.raceRow = {
      id: 'o-race',
      source: 'action',
      status: 'new',
      source_data: { fromAction: { taskId: 't1' } },
    };
    const result = await sendTaskToContent({ taskId: 't1', title: '', userId: 'u1' });
    expect(result).toEqual({ opportunityId: 'o-race', created: false });
    expect(db.content_opportunities).toHaveLength(1);
    expect(db.action_tasks[0].details.sent.content.opportunityId).toBe('o-race');
  });

  it('keeps an edit saved while the task was being sent', async () => {
    dispatchBrandWebhook.mockImplementationOnce(async () => {
      // Someone edits the task while the webhook answers.
      Object.assign(db.action_tasks[0], {
        details: { ...db.action_tasks[0].details, where: 'acme.example/new-page' },
        updated_at: '2026-10-16T09:00:05Z',
      });
      return { sent: 1, failed: 0 };
    });
    await sendTaskToWebhook({ taskId: 't1', title: '', userId: 'u1' });
    expect(db.action_tasks[0].details).toMatchObject({
      where: 'acme.example/new-page',
      sent: { webhook: { delivered: 1 } },
    });
  });

  it("puts a bare path on the brand's primary domain", async () => {
    db.brand_domains = [
      { brand_id: 'b1', domain: 'shop.acme.example', is_primary: false },
      { brand_id: 'b1', domain: 'acme.example', is_primary: true },
    ];
    db.action_tasks[0].details.where = '/pricing on Gemini';
    await sendTaskToContent({ taskId: 't1', title: '', userId: null });
    expect(db.content_opportunities[0].source_data.targetPages).toEqual([
      { url: 'https://acme.example/pricing', title: '' },
    ]);
  });
});
