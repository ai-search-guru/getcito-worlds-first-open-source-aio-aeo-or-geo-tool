import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The task writer end to end (AC-004), on an in-memory database and a
 * scripted model: which tasks a rewrite keeps, the one retry for refused
 * tasks, metering, dry runs and a spent budget.
 */

let db;
let ops;
// The columns each read asked for.
let selects;

/** A row's value at a column, or at an embed's (`brands.organizations.…`). */
const valueAt = (row, col) => col.split('.').reduce((value, key) => value?.[key], row);

/** A query builder over `db`, recording every write. */
function table(name) {
  const q = {
    name,
    op: 'select',
    filters: [],
    payload: null,
    single: false,
    returning: false,
    free: false,
  };
  const rows = () =>
    (db[name] ?? [])
      .filter((row) => (q.free ? !row.tasks_writing_since : true))
      .filter((row) =>
        q.filters.every(([col, value]) =>
          col === 'action_signals.action_id'
            ? true
            : Array.isArray(value)
              ? value.includes(valueAt(row, col))
              : valueAt(row, col) === value,
        ),
      );
  const run = () => {
    if (q.op === 'select') {
      const data = rows();
      return { data: q.single ? (data[0] ?? null) : data, error: null };
    }
    ops.push({ table: name, op: q.op, payload: q.payload, filters: q.filters });
    if (q.op === 'insert' && name === 'action_tasks') {
      const inserted = q.payload.map((row, i) => ({ id: `new-${i + 1}`, ...row }));
      db.action_tasks.push(...inserted);
      return { data: inserted, error: null };
    }
    if (q.op === 'delete') {
      const ids = q.filters.find(([col]) => col === 'id')?.[1] ?? [];
      db[name] = (db[name] ?? []).filter((row) => !ids.includes(row.id));
    }
    if (q.op === 'update') {
      const matched = rows();
      for (const row of matched) Object.assign(row, q.payload);
      return { data: q.returning ? matched.map((row) => ({ id: row.id })) : null, error: null };
    }
    return { data: null, error: null };
  };
  const chain = {
    select: (columns) => (
      q.op === 'select' && selects.push({ table: name, columns }),
      (q.returning = q.op !== 'select'),
      chain
    ),
    // Only the claim uses or(): a free action, or one whose writer died.
    or: () => ((q.free = true), chain),
    eq: (col, value) => (q.filters.push([col, value]), chain),
    in: (col, value) => (q.filters.push([col, value]), chain),
    is: () => chain,
    gte: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    insert: (payload) => ((q.op = 'insert'), (q.payload = payload), chain),
    update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
    delete: () => ((q.op = 'delete'), chain),
    maybeSingle: async () => ((q.single = true), run()),
    single: async () => ((q.single = true), run()),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../../../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));

const generateObject = vi.fn();
vi.mock('ai', () => ({
  generateObject: (...args) => generateObject(...args),
  NoObjectGeneratedError: { isInstance: () => false },
}));
vi.mock('../../aiProvider.js', () => ({ resolveModel: () => ({}) }));
vi.mock('../../logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The budget hold (reserveAiBudget): what each call charged, and its release.
const charges = [];
const release = vi.fn();
const reserveAiBudget = vi.fn();
class PlanLimitError extends Error {}
vi.mock('../../planGuard.js', () => ({
  reserveAiBudget: (...args) => reserveAiBudget(...args),
  PlanLimitError,
}));
vi.mock('../definitions/index.js', () => ({
  loadDefinitions: async () => [{ id: 'recover_lost_citations', name: 'Recover Lost Citations' }],
}));
vi.mock('../fromPromptImprove.js', () => ({ IMPROVE_ACTION_KIND: 'prompt_improve' }));
vi.mock('../fromOpportunity.js', () => ({ OPPORTUNITY_ACTION_KIND: 'content_opportunity' }));

const { isTouched, keepsTask, sweepActionTasks, writeTasksForAction } = await import('./index.js');

const task = (over = {}) => ({
  title: 'Add a 2026 shipping table to /blog/shipping',
  url: 'acme.example/blog/shipping',
  where: 'acme.example/blog/shipping · lost on ChatGPT',
  why: 'Cited #2 until Oct 12.',
  change: { before: '', after: 'A 2026 table of countries and costs.' },
  how: ['Add a table.', 'Put "2026" in the title.'],
  doneWhen: 'Cited again within 14 days.',
  check: 'rerun',
  type: 'content',
  effort: '~2h',
  role: 'Content writer',
  refs: ['page:1'],
  ...over,
});
const answer = (tasks) => ({ object: { tasks }, usage: { inputTokens: 1000, outputTokens: 500 } });

beforeEach(() => {
  ops = [];
  selects = [];
  generateObject.mockReset();
  charges.length = 0;
  release.mockReset();
  reserveAiBudget.mockReset().mockResolvedValue({
    charge: async (usage) => charges.push(usage),
    release,
  });
  process.env.ACTION_TASKS_AI = 'true';
  db = {
    actions: [
      {
        id: 'a1',
        brand_id: 'b1',
        kind: 'recover_lost_citations',
        category: 'recover',
        status: 'new',
        payload: {},
        brands: { is_demo: false },
      },
    ],
    brands: [{ id: 'b1', name: 'Acme Coffee', description: null, organization_id: 'o1' }],
    brand_domains: [{ brand_id: 'b1', domain: 'acme.example' }],
    signals: [
      {
        id: 's1',
        brand_id: 'b1',
        kind: 'lost_citations',
        status: 'new',
        action_id: 'a1',
        payload: {
          promptId: 'p1',
          promptText: 'Which coffee subscriptions ship internationally?',
          lostUrls: [{ url: 'https://acme.example/blog/shipping', position: 2 }],
          citedNow: [{ url: 'https://seriouseats.com/best', domain: 'seriouseats.com' }],
        },
      },
    ],
    action_tasks: [
      {
        id: 't1',
        action_id: 'a1',
        position: 1,
        task_key: 'analyze_citations',
        status: 'completed',
        details: null,
      },
      {
        id: 't2',
        action_id: 'a1',
        position: 2,
        task_key: 'refresh_content',
        status: 'in_progress',
        details: null,
      },
      {
        id: 't3',
        action_id: 'a1',
        position: 3,
        task_key: 'prepare_outreach',
        status: 'todo',
        details: null,
      },
      { id: 't4', action_id: 'a1', position: 4, task_key: null, status: 'todo', details: null },
    ],
  };
});

describe('keepsTask', () => {
  it('keeps work done or under way and what a person added; never the analysis', () => {
    expect(keepsTask({ task_key: 'refresh_content', status: 'completed' })).toBe(true);
    expect(keepsTask({ task_key: 'refresh_content', status: 'in_progress' })).toBe(true);
    expect(keepsTask({ task_key: 'refresh_content', status: 'todo' })).toBe(false);
    expect(keepsTask({ task_key: null, status: 'todo', details: null })).toBe(true);
    expect(keepsTask({ task_key: null, status: 'todo', details: { source: 'ai' } })).toBe(false);
    // One a manager filled and approved from Needs review (AC-010, 00293) is theirs.
    expect(keepsTask({ task_key: null, status: 'todo', details: { source: 'reviewed' } })).toBe(
      true,
    );
    expect(keepsTask({ task_key: 'analyze_citations', status: 'completed' })).toBe(false);
    expect(keepsTask({ task_key: 'validate_citations', status: 'in_progress' })).toBe(false);
    // Sent to Content or a webhook: kept, whatever its status.
    expect(
      keepsTask({
        task_key: null,
        status: 'todo',
        details: { source: 'ai', sent: { webhook: {} } },
      }),
    ).toBe(true);
  });
});

describe('isTouched', () => {
  it('reads a plan as untouched until someone works on it', () => {
    const template = { task_key: 'refresh_content', title: null, status: 'todo', details: null };
    expect(isTouched([template])).toBe(false);
    expect(isTouched([{ ...template, status: 'in_progress' }])).toBe(true);
    expect(isTouched([{ ...template, title: 'Refresh /pricing' }])).toBe(true);
    expect(isTouched([{ task_key: null, title: 'Call G2', status: 'todo', details: null }])).toBe(
      true,
    );
    expect(
      isTouched([{ task_key: null, title: 'x', status: 'todo', details: { source: 'ai' } }]),
    ).toBe(false);
    // A template's details (AC-010) are no one's work; edited (the mark gone) or sent, they are.
    const filled = { doneWhen: 'Done', check: 'auto', source: 'template' };
    expect(isTouched([{ ...template, details: filled }])).toBe(false);
    expect(isTouched([{ ...template, details: { ...filled, source: undefined } }])).toBe(true);
    expect(
      isTouched([{ ...template, details: { ...filled, sent: { webhook: { at: 'x' } } } }]),
    ).toBe(true);
  });
});

describe('writeTasksForAction', () => {
  it('asks once more for the refused tasks, then writes the kept and the written in order', async () => {
    generateObject
      .mockResolvedValueOnce(
        answer([
          task(),
          task({ title: 'Refresh content for 7 prompts', refs: ['page:1'] }),
          task({
            title: 'Pitch acme to seriouseats.com',
            url: 'https://seriouseats.com/best',
            check: 'Manual',
            where: 'seriouseats.com/best',
            refs: ['domain:1'],
            type: 'outreach',
          }),
        ]),
      )
      .mockResolvedValueOnce(
        answer([task({ title: 'Link /blog/shipping from the pricing page', type: 'on_page' })]),
      );

    const result = await writeTasksForAction('a1', { trigger: 'regenerate', userId: 'u1' });

    expect(result).toMatchObject({ status: 'written', kept: 2 });
    expect(result.tasks.map((t) => t.title)).toEqual([
      'Add a 2026 shipping table to /blog/shipping',
      'Pitch acme to seriouseats.com',
      'Link /blog/shipping from the pricing page',
    ]);
    // The retry named what was refused and why.
    expect(generateObject.mock.calls[1][0].prompt).toContain(
      '"Refresh content for 7 prompts": the title counts prompts or pages instead of naming one',
    );

    const tasks = [...db.action_tasks].sort((a, b) => a.position - b.position);
    expect(tasks.map((t) => [t.position, t.task_key ?? t.title ?? t.id])).toEqual([
      [1, 'refresh_content'],
      [2, 't4'],
      [3, 'Add a 2026 shipping table to /blog/shipping'],
      [4, 'Pitch acme to seriouseats.com'],
      [5, 'Link /blog/shipping from the pricing page'],
    ]);
    expect(tasks[2].details).toMatchObject({ source: 'ai', type: 'content', refs: ['page:1'] });
    // The exact page, the change (nothing it replaces: null) and how it's checked (AC-010).
    // A host and path as the evidence shows it is stored with its https://.
    expect(tasks[2].details).toMatchObject({
      url: 'https://acme.example/blog/shipping',
      change: { before: null, after: 'A 2026 table of countries and costs.' },
      check: 'rerun',
    });
    expect(tasks[3].details).toMatchObject({ check: 'manual' });

    // Held on the budget once, then both calls charged to it.
    expect(reserveAiBudget).toHaveBeenCalledWith('o1', {
      feature: 'action_center',
      modelId: expect.any(String),
      actionId: 'a1',
    });
    expect(charges).toEqual([
      { inputTokens: 1000, outputTokens: 500 },
      { inputTokens: 1000, outputTokens: 500 },
    ]);
    expect(release).toHaveBeenCalled();
    expect(ops.find((op) => op.table === 'action_events').payload).toMatchObject({
      event: 'tasks_generated',
      data: { count: 3, kept: 2, trigger: 'regenerate' },
      actor_id: 'u1',
    });
    expect(db.actions[0].tasks_generated_at).toEqual(expect.any(String));
  });

  it('puts a task the last round gave without its page, change or check in review (AC-010)', async () => {
    generateObject
      .mockResolvedValueOnce(
        answer([task(), task({ title: 'Add an FAQ to /blog/shipping', url: '', check: 'later' })]),
      )
      .mockResolvedValueOnce(
        answer([
          task({
            title: 'Add a map to /blog/shipping',
            url: 'the shipping page',
            change: { before: '', after: ' ' },
          }),
        ]),
      );

    const result = await writeTasksForAction('a1', { trigger: 'regenerate', userId: 'u1' });

    expect(result.status).toBe('written');
    expect(result.tasks.map((t) => t.title)).toEqual([
      'Add a 2026 shipping table to /blog/shipping',
    ]);
    // The first round's was asked for again: only the last round's waits.
    expect(result.reviews.map((t) => t.title)).toEqual(['Add a map to /blog/shipping']);
    const reviews = ops.filter((op) => op.table === 'action_task_reviews');
    expect(reviews.map((op) => [op.op, op.filters])).toEqual([
      // The earlier writing's go first.
      [
        'delete',
        [
          ['action_id', 'a1'],
          ['source', 'ai'],
        ],
      ],
      ['insert', []],
    ]);
    // The reviews go in before the tasks: a failure there leaves the tasks as they were.
    const at = (table, op) => ops.findIndex((o) => o.table === table && o.op === op);
    expect(at('action_task_reviews', 'insert')).toBeLessThan(at('action_tasks', 'insert'));
    expect(reviews[1].payload).toEqual([
      {
        action_id: 'a1',
        title: 'Add a map to /blog/shipping',
        details: expect.objectContaining({ url: null, change: null, check: 'rerun', source: 'ai' }),
        missing: ['url', 'change'],
        source: 'ai',
      },
    ]);
    expect(ops.find((op) => op.table === 'action_events').payload.data).toMatchObject({
      count: 1,
      reviews: 1,
    });
  });

  it('keeps the template tasks when every written task waits for review', async () => {
    generateObject
      .mockResolvedValueOnce(answer([task({ url: '' })]))
      .mockResolvedValueOnce(answer([task({ check: 'weekly' })]));

    const result = await writeTasksForAction('a1', { trigger: 'regenerate', userId: 'u1' });

    expect(result).toMatchObject({ status: 'written', kept: null, tasks: [] });
    expect(result.reviews).toHaveLength(1);
    expect(ops.some((op) => op.table === 'action_tasks' && op.op === 'insert')).toBe(false);
    expect(
      ops.find((op) => op.table === 'action_task_reviews' && op.op === 'insert').payload[0].missing,
    ).toEqual(['check']);
  });

  it('writes and charges nothing on a dry run', async () => {
    generateObject.mockResolvedValueOnce(answer([task()]));
    const result = await writeTasksForAction('a1', { dryRun: true });
    expect(result.status).toBe('preview');
    expect(result.costUsd).toBeGreaterThan(0);
    expect(ops).toEqual([]);
    expect(reserveAiBudget).not.toHaveBeenCalled();
  });

  /** Its earlier rounds here (learning B5): what was done, and what it moved. */
  it("shows the model the brand's earlier rounds of the action, without the analysis steps", async () => {
    db.actions.push(
      {
        id: 'a0',
        brand_id: 'b1',
        kind: 'recover_lost_citations',
        status: 'completed',
        outcome: 'no_meaningful_change',
        validation: {
          primary: 'citations',
          final: true,
          metrics: [{ metric: 'citations', before: 3, after: 3 }],
        },
        completed_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
      },
      // Another brand's round is never shown.
      { id: 'x0', brand_id: 'b2', kind: 'recover_lost_citations', status: 'completed' },
    );
    db.action_tasks.push(
      {
        id: 'p1',
        action_id: 'a0',
        position: 1,
        task_key: 'analyze_citations',
        status: 'completed',
      },
      {
        id: 'p2',
        action_id: 'a0',
        position: 2,
        task_key: null,
        title: 'Add a FAQ to /blog/shipping',
        status: 'completed',
      },
    );
    generateObject.mockResolvedValueOnce(answer([task()]));

    const result = await writeTasksForAction('a1', { dryRun: true });

    expect(result.history).toEqual([
      {
        closed: '2026-09-01',
        result: 'no_meaningful_change',
        final: true,
        mainMetric: { metric: 'citations', before: 3, after: 3 },
        done: ['Add a FAQ to /blog/shipping'],
        notDone: [],
      },
    ]);
    const { prompt } = generateObject.mock.calls[0][0];
    expect(prompt).toContain('Earlier rounds of this action at this brand');
    expect(prompt).toContain('Add a FAQ to /blog/shipping');
    expect(prompt).not.toContain('Analyze citations');
  });

  it('says nothing of earlier rounds when there are none', async () => {
    generateObject.mockResolvedValueOnce(answer([task()]));
    const result = await writeTasksForAction('a1', { dryRun: true });
    expect(result.history).toEqual([]);
    expect(generateObject.mock.calls[0][0].prompt).not.toContain('Earlier rounds');
  });

  it("tells the model the brand's kind of site and its page types, chosen or guessed", async () => {
    db.brands[0] = { ...db.brands[0], site_type: 'ecommerce' };
    generateObject.mockResolvedValueOnce(answer([task()]));
    await writeTasksForAction('a1', { dryRun: true });
    const { prompt, system } = generateObject.mock.calls[0][0];
    expect(prompt).toContain(
      'Site type: E-commerce (an online shop selling products). Its page types: product page, category page, collection page, buying guide,',
    );
    expect(system).toContain("Name pages and content the way the brand's kind of site does");

    // None chosen: the guess, from Shopping mode or the industry, else B2B.
    db.brands[0] = { ...db.brands[0], site_type: null, industry: 'Travel & Hospitality' };
    generateObject.mockResolvedValueOnce(answer([task()]));
    await writeTasksForAction('a1', { dryRun: true });
    expect(generateObject.mock.calls[1][0].prompt).toContain(
      'Site type: B2C (a service for consumers). Its page types: destination page, itinerary,',
    );

    // A mobile app (00456): its own page types.
    db.brands[0] = { ...db.brands[0], site_type: 'app' };
    generateObject.mockResolvedValueOnce(answer([task()]));
    await writeTasksForAction('a1', { dryRun: true });
    expect(generateObject.mock.calls[2][0].prompt).toContain(
      'Site type: Mobile app (a mobile app people install from an app store). Its page types: feature page, comparison, alternatives,',
    );
  });

  it('calls no model when the signals name nothing to work on', async () => {
    db.signals[0].payload = {};
    const result = await writeTasksForAction('a1', { trigger: 'regenerate' });
    expect(result).toMatchObject({ status: 'skipped', reason: 'no_targets' });
    expect(generateObject).not.toHaveBeenCalled();
    expect(db.actions[0].tasks_generated_at).toEqual(expect.any(String));
  });

  it('leaves the tasks as they are once the budget is spent', async () => {
    reserveAiBudget.mockRejectedValueOnce(new PlanLimitError('Budget used up'));
    await expect(writeTasksForAction('a1', { trigger: 'regenerate' })).rejects.toThrow(
      'Budget used up',
    );
    expect(generateObject).not.toHaveBeenCalled();
    expect(ops.filter((op) => op.table !== 'actions')).toEqual([]);
    expect(db.actions[0].tasks_writing_since).toBeNull();
  });

  it('lets the hold on the budget go when the model fails', async () => {
    generateObject.mockRejectedValue(new Error('timeout'));
    await expect(writeTasksForAction('a1', { trigger: 'regenerate' })).rejects.toThrow();
    expect(charges).toEqual([]);
    expect(release).toHaveBeenCalled();
  });

  it('leaves a plan someone is working through to the night, and releases its claim', async () => {
    const result = await writeTasksForAction('a1', { trigger: 'auto' });
    expect(result).toMatchObject({ status: 'skipped', reason: 'in_use' });
    expect(generateObject).not.toHaveBeenCalled();
    expect(db.actions[0].tasks_writing_since).toBeNull();
  });

  it('refuses while another writer has the action', async () => {
    db.actions[0].tasks_writing_since = new Date().toISOString();
    await expect(writeTasksForAction('a1', { trigger: 'regenerate' })).rejects.toMatchObject({
      code: 'busy',
      status: 409,
    });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('refuses an action a person sent, which carries its own tasks', async () => {
    db.actions[0].kind = 'prompt_improve';
    await expect(writeTasksForAction('a1')).rejects.toThrow('carries the tasks it was sent with');
  });
});

describe('sweepActionTasks', () => {
  it('does nothing unless the deployment writes tasks', async () => {
    process.env.ACTION_TASKS_AI = '';
    expect(await sweepActionTasks()).toEqual({ skipped: 'disabled' });
  });

  it('skips the rest of a brand once its budget is spent', async () => {
    db.actions.push({ ...db.actions[0], id: 'a2' });
    db.action_tasks = [];
    reserveAiBudget.mockRejectedValue(new PlanLimitError('Budget used up'));
    const outcome = await sweepActionTasks();
    expect(outcome).toEqual({ written: 0, skipped: 0, failed: 1 });
    expect(reserveAiBudget).toHaveBeenCalledTimes(1);
  });

  /**
   * Once the plan has ended (2026-10-27), on the cloud: its actions are left
   * out by the query itself, so they never reach the model or the budget.
   */
  describe('on the cloud', () => {
    beforeEach(() => vi.stubEnv('IS_CLOUD', 'true'));
    afterEach(() => vi.unstubAllEnvs());

    const onPlan = (status) => ({ is_demo: false, organizations: { subscription_status: status } });

    it("writes no task for an organization whose plan has ended, and the paying one's still", async () => {
      db.actions = [
        { ...db.actions[0], id: 'lapsed', brand_id: 'b-lapsed', brands: onPlan('canceled') },
        { ...db.actions[0], id: 'paying', brand_id: 'b1', brands: onPlan('active') },
      ];
      db.action_tasks = [];
      generateObject.mockResolvedValue(answer([task()]));

      const outcome = await sweepActionTasks();

      expect(outcome).toEqual({ written: 1, skipped: 0, failed: 0 });
      expect(selects).toContainEqual({
        table: 'actions',
        columns:
          'id, brand_id, kind, status, brands!inner(is_demo, organizations!inner(subscription_status))',
      });
      expect(reserveAiBudget).toHaveBeenCalledTimes(1);
      expect(ops.filter((op) => op.table === 'actions' && op.op === 'update')).not.toContainEqual(
        expect.objectContaining({ filters: expect.arrayContaining([['id', 'lapsed']]) }),
      );
    });
  });

  describe('self-hosted', () => {
    beforeEach(() => vi.stubEnv('IS_CLOUD', 'false'));
    afterEach(() => vi.unstubAllEnvs());

    it('reads every action, unfiltered by plan', async () => {
      db.action_tasks = [];
      generateObject.mockResolvedValue(answer([task()]));

      expect(await sweepActionTasks()).toEqual({ written: 1, skipped: 0, failed: 0 });
      expect(selects).toContainEqual({
        table: 'actions',
        columns: 'id, brand_id, kind, status, brands!inner(is_demo)',
      });
    });

    it("never writes a demo brand's tasks (00380)", async () => {
      db.actions = [{ ...db.actions[0], id: 'demo', brands: { is_demo: true } }];
      db.action_tasks = [];
      generateObject.mockResolvedValue(answer([task()]));

      expect(await sweepActionTasks()).toEqual({ written: 0, skipped: 0, failed: 0 });
      expect(reserveAiBudget).not.toHaveBeenCalled();
    });
  });
});
