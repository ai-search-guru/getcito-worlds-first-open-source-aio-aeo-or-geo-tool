// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatEvent } from './events';
import { createFakeSupabase, type FakeSupabase } from './testing/fakeSupabase';

/**
 * A saved chat as its page opens it (CHAT-03 items 18–19, 21–22; W1-15): an
 * answer that ended keeps what its end event told the browser — why it
 * failed, in the same words, and the header's time and steps — so a reload
 * shows the reason and Retry, and "Stopped after 41s"; and nothing of a
 * step's tool or debug record ever comes with it.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase, user: '' }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(Object.create(fake.db), {
      auth: { getUser: async () => ({ data: { user: { id: fake.user } } }) },
    }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  get supabaseAdmin() {
    return fake.db;
  },
}));

const { loadChatThread } = await import('./thread');

const USER = '11111111-1111-4111-8111-111111111111';
const CHAT = '33333333-3333-4333-8333-333333333333';
const UUID = '99999999-9999-4999-8999-999999999999';
const REASON = "Chat couldn't check your AI usage just now, so it didn't start this step.";

function seed(runs: { id: string; status: string; error?: string | null }[]) {
  fake.db.tables.chat_conversations = [
    { id: CHAT, title: 'Citations', brand_id: null, user_id: USER },
  ];
  fake.db.tables.chat_messages = runs.flatMap((run, i) => [
    {
      id: `q-${run.id}`,
      conversation_id: CHAT,
      role: 'user',
      content_md: `Question ${i + 1}`,
      context_json: null,
      generated_at: null,
      data_as_of: null,
      timezone: null,
      created_at: `2026-10-30T09:0${i}:00.000Z`,
    },
    {
      id: `a-${run.id}`,
      conversation_id: CHAT,
      role: 'assistant',
      content_md: 'So far: two pages.',
      generated_at: null,
      data_as_of: null,
      timezone: 'UTC',
      created_at: `2026-10-30T09:0${i}:01.000Z`,
    },
  ]);
  fake.db.tables.chat_runs = runs.map((run) => ({
    id: run.id,
    message_id: `a-${run.id}`,
    conversation_id: CHAT,
    status: run.status,
    error: run.error ?? null,
  }));
  fake.db.tables.chat_files = [];
}

const event = (runId: string, e: ReturnType<typeof chatEvent>) => ({
  run_id: runId,
  seq: e.seq,
  type: e.type,
  data: e.data,
});

beforeEach(() => {
  fake.db = createFakeSupabase();
  fake.user = USER;
});

describe('loadChatThread', () => {
  it('keeps why a run failed, in its own words, after a reload', async () => {
    seed([{ id: 'run-1', status: 'error', error: 'failed' }]);
    fake.db.tables.chat_run_steps = [];
    fake.db.tables.chat_run_events = [
      event('run-1', chatEvent('text.delta', 1, { text: 'So far' })),
      event(
        'run-1',
        chatEvent('run.error', 2, {
          workingMs: 3000,
          stepCount: 0,
          sources: [],
          code: 'failed',
          reason: REASON,
        }),
      ),
    ];
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run).toMatchObject({
      status: 'error',
      errorReason: REASON,
      summary: { workingMs: 3000, stepCount: 0, sources: [] },
    });
  });

  it('rebuilds a /tasks run’s task strip as it stands, Done as Action Center has it (CHAT-09 §B)', async () => {
    seed([{ id: 'run-1', status: 'done' }]);
    fake.db.tables.chat_run_steps = [];
    fake.db.tables.chat_run_events = [];
    fake.db.tables.chat_task_state = [
      {
        conversation_id: CHAT,
        action_task_id: 't1',
        position: 1,
        chat_status: 'ready_for_review',
        run_id: 'run-1',
      },
      {
        conversation_id: CHAT,
        action_task_id: 't2',
        position: 2,
        chat_status: 'queued',
        run_id: 'run-1',
      },
    ];
    const parent = { category: 'fix', priority_score: 86, due_date: '2026-10-30' };
    fake.db.tables.action_tasks = [
      {
        id: 't1',
        task_key: null,
        title: 'Add FAQ block to /pricing',
        title_params: null,
        status: 'todo',
        actions: parent,
      },
      // The person completed it in Action Center after the run.
      {
        id: 't2',
        task_key: null,
        title: 'Fix 2 broken links',
        title_params: null,
        status: 'completed',
        actions: parent,
      },
    ];
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run?.tasks).toMatchObject({
      tasks: [
        {
          at: 1,
          title: 'Add FAQ block to /pricing',
          priority: 86,
          category: 'fix',
          status: 'ready_for_review',
        },
        { at: 2, title: 'Fix 2 broken links', status: 'done' },
      ],
      ready: 2,
      total: 2,
    });
  });

  it('reads a task an ended run still has Writing as Queued, and keeps a running run’s Writing', async () => {
    seed([
      { id: 'run-1', status: 'done' },
      { id: 'run-2', status: 'running' },
    ]);
    fake.db.tables.chat_run_steps = [];
    fake.db.tables.chat_run_events = [];
    // run-1's Ready for review was undone after it ended: Undo put back its Writing.
    fake.db.tables.chat_task_state = [
      {
        conversation_id: CHAT,
        action_task_id: 't1',
        position: 1,
        chat_status: 'writing',
        run_id: 'run-1',
      },
      {
        conversation_id: CHAT,
        action_task_id: 't2',
        position: 2,
        chat_status: 'writing',
        run_id: 'run-2',
      },
    ];
    const parent = { category: 'fix', priority_score: 86, due_date: null };
    fake.db.tables.action_tasks = ['t1', 't2'].map((id) => ({
      id,
      task_key: null,
      title: `Task ${id}`,
      title_params: null,
      status: 'todo',
      actions: parent,
    }));
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run?.tasks?.tasks.map((t) => t.status)).toEqual(['queued']);
    expect(thread!.messages[3].run?.tasks?.tasks.map((t) => t.status)).toEqual(['writing']);
  });

  it('gives a deliverable its task back: drafted for it, or its one attachment (W2-12)', async () => {
    seed([{ id: 'run-1', status: 'done' }]);
    fake.db.tables.chat_run_steps = [];
    fake.db.tables.chat_run_events = [];
    const made = (id: string, title: string) => ({
      id,
      run_id: 'run-1',
      message_id: null,
      title,
      type: 'document',
      formats: ['md'],
      status: 'draft',
      content_draft_id: null,
      created_at: `2026-10-30T09:00:0${id.slice(-1)}.000Z`,
    });
    fake.db.tables.chat_files = [
      made('f1', 'Pricing FAQ'),
      made('f2', 'Link fixes'),
      made('f3', 'Notes'),
    ];
    fake.db.tables.chat_task_state = [
      {
        conversation_id: CHAT,
        action_task_id: 't1',
        position: 1,
        chat_status: 'queued',
        run_id: 'run-1',
        file_id: 'f1',
      },
    ];
    fake.db.tables.chat_file_task_links = [{ file_id: 'f2', action_task_id: 't2' }];
    const parent = { category: 'fix', priority_score: 86, due_date: null };
    fake.db.tables.action_tasks = [
      {
        id: 't1',
        task_key: null,
        title: 'Add FAQ block to /pricing',
        title_params: null,
        status: 'todo',
        actions: parent,
      },
      {
        id: 't2',
        task_key: null,
        title: 'Fix 2 broken links',
        title_params: null,
        status: 'completed',
        actions: parent,
      },
    ];
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run?.deliverables.map((d) => [d.title, d.task ?? null])).toEqual([
      ['Pricing FAQ', { title: 'Add FAQ block to /pricing', state: 'open' }],
      ['Link fixes', { title: 'Fix 2 broken links', state: 'done' }],
      ['Notes', null],
    ]);
  });

  it('opens the chat without its strip when the strip can’t be read', async () => {
    seed([{ id: 'run-1', status: 'done' }]);
    fake.db.tables.chat_run_steps = [];
    fake.db.tables.chat_run_events = [];
    fake.db.failures.chat_task_state = { message: 'down' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run?.tasks).toBeNull();
    logged.mockRestore();
  });

  it('keeps what a run sent to the Action Center, after a reload (CHAT-09 item 19)', async () => {
    seed([{ id: 'run-1', status: 'done' }]);
    fake.db.tables.chat_run_steps = [];
    const sent = {
      kind: 'action_created' as const,
      actionNo: 1271,
      title: 'Win back pricing citations',
      href: '/dashboard/action-center/actions/a1' as const,
    };
    fake.db.tables.chat_run_events = [
      event('run-1', chatEvent('action.sent', 1, sent)),
      event(
        'run-1',
        chatEvent('run.finished', 2, {
          workingMs: 3000,
          stepCount: 1,
          sources: [],
          generatedAt: '2026-10-31T09:00:00.000Z',
          dataAsOf: null,
        }),
      ),
    ];
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run).toMatchObject({
      sent: [sent],
      summary: { workingMs: 3000, stepCount: 1, sources: [] },
    });
  });

  it("keeps What's new's cards, after a reload (CHAT-11 item 10)", async () => {
    seed([{ id: 'run-1', status: 'done' }]);
    fake.db.tables.chat_run_steps = [];
    const entries = [
      {
        slug: 'agent-center',
        feature: 'Agent Center',
        lines: ['Why.', 'What.', 'How it helps.'],
        href: '/dashboard/agents' as const,
      },
    ];
    fake.db.tables.chat_run_events = [event('run-1', chatEvent('whats_new.ready', 1, { entries }))];
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run?.whatsNew).toEqual(entries);
  });

  it("keeps a stopped run's time and steps, its stopped step skipped with why", async () => {
    seed([{ id: 'run-1', status: 'stopped' }]);
    fake.db.tables.chat_run_steps = [
      {
        id: 's1',
        run_id: 'run-1',
        position: 1,
        kind: 'read',
        status: 'skipped',
        label: 'Read Citations',
        detail: 'Stopped',
        scope_json: null,
        row_count: null,
        data_as_of: null,
        started_at: null,
        finished_at: null,
      },
    ];
    fake.db.tables.chat_run_events = [
      event(
        'run-1',
        chatEvent('run.stopped', 4, {
          workingMs: 41_000,
          stepCount: 5,
          sources: [],
          reason: 'person',
        }),
      ),
    ];
    const run = (await loadChatThread(CHAT))!.messages[1].run!;
    expect(run.summary).toEqual({ workingMs: 41_000, stepCount: 5, sources: [] });
    expect(run.errorReason).toBeNull();
    expect(run.steps).toEqual([
      { n: 1, kind: 'read', status: 'skipped', label: 'Read Citations', detail: 'Stopped' },
    ]);
  });

  it('reads no end for a run still under way: the page rebuilds it from its events', async () => {
    seed([{ id: 'run-1', status: 'running' }]);
    fake.db.tables.chat_run_steps = [];
    fake.db.tables.chat_run_events = [];
    const run = (await loadChatThread(CHAT))!.messages[1].run!;
    expect(run).toMatchObject({ status: 'running', summary: null, errorReason: null });
    expect(fake.db.log).not.toContainEqual(['chat_run_events', 'select']);
  });

  it('still opens the chat when the ends can’t be read', async () => {
    seed([{ id: 'run-1', status: 'error', error: 'failed' }]);
    fake.db.tables.chat_run_steps = [];
    fake.db.failures.chat_run_events = { message: 'down' };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = (await loadChatThread(CHAT))!.messages[1].run!;
    expect(run).toMatchObject({ status: 'error', errorReason: null, summary: null });
    error.mockRestore();
  });

  it('says which questions Retry may send again as they were: no files, no page scope', async () => {
    seed([
      { id: 'run-1', status: 'error', error: 'failed' },
      { id: 'run-2', status: 'error', error: 'failed' },
      { id: 'run-3', status: 'error', error: 'failed' },
    ]);
    fake.db.tables.chat_messages[2].context_json = {
      context: { route: '/dashboard/mentions', chips: [{ key: 'page', label: 'Mentions' }] },
    };
    fake.db.tables.chat_uploads = [{ id: 'u1', message_id: 'q-run-3' }];
    fake.db.tables.chat_run_steps = [];
    fake.db.tables.chat_run_events = [];
    const messages = (await loadChatThread(CHAT))!.messages;
    expect(messages.map((m) => m.resendable)).toEqual([
      true,
      undefined,
      false,
      undefined,
      false,
      undefined,
    ]);
    // The scope itself stays on the server.
    expect(JSON.stringify(messages)).not.toContain('/dashboard/mentions');

    // Unread, no question is sent again short of its files.
    fake.db.failures.chat_uploads = { message: 'down' };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await loadChatThread(CHAT))!.messages[0].resendable).toBe(false);
    error.mockRestore();
  });

  it("never carries a step's tool, its debug record or its measure, even from a full row", async () => {
    seed([{ id: 'run-1', status: 'done' }]);
    fake.db.tables.chat_run_steps = [
      {
        id: 's1',
        run_id: 'run-1',
        position: 1,
        kind: 'read',
        status: 'done',
        label: 'Read Citations',
        detail: 'Perplexity · Last 30 days · 18 rows',
        scope_json: { subject: 'Pricing', brand_id: UUID },
        row_count: 18,
        data_as_of: null,
        started_at: null,
        finished_at: null,
        // The server's columns, as a service-role read would give them.
        tool: 'list_citations',
        debug_json: { input: { brand_id: UUID }, output: { rows: [] }, latencyMs: 840 },
        latency_ms: 840,
        cache_hit: true,
        truncated: false,
        result_tokens: 1200,
      },
    ];
    fake.db.tables.chat_run_events = [
      event(
        'run-1',
        chatEvent('run.finished', 2, {
          workingMs: 8000,
          stepCount: 1,
          sources: [{ label: 'Citations', count: 18 }],
          generatedAt: '2026-10-30T09:14:00.000Z',
          dataAsOf: null,
        }),
      ),
    ];
    const thread = await loadChatThread(CHAT);
    const wire = JSON.stringify(thread);
    expect(wire).not.toMatch(/list_citations|debug|latency|cache_hit|result_tokens|tool/i);
    expect(wire).not.toContain(UUID);
    expect(thread!.messages[1].run!.summary).toEqual({
      workingMs: 8000,
      stepCount: 1,
      sources: [{ label: 'Citations', count: 18 }],
    });
  });
});

/**
 * A finished run's next moves in rank order (CHAT-07 §C: they come back
 * after a reload), with the ghost mark and never their class.
 */
describe('loadChatThread, next moves', () => {
  const CHAT = 'c1';
  beforeEach(() => {
    fake.user = 'u1';
    Object.assign(fake.db.tables, {
      chat_conversations: [{ id: CHAT, title: 'Citations', brand_id: 'b1', user_id: 'u1' }],
      chat_messages: [
        {
          id: 'm1',
          conversation_id: CHAT,
          role: 'user',
          content_md: 'Why did citations fall?',
          generated_at: null,
          data_as_of: null,
          timezone: null,
          created_at: '2026-10-30T09:00:00.000Z',
        },
        {
          id: 'm2',
          conversation_id: CHAT,
          role: 'assistant',
          content_md: 'Two pages lost most of it.',
          generated_at: '2026-10-30T09:01:00.000Z',
          data_as_of: null,
          timezone: 'UTC',
          created_at: '2026-10-30T09:00:01.000Z',
        },
      ],
      chat_runs: [{ id: 'r1', message_id: 'm2', conversation_id: CHAT, status: 'done' }],
      chat_run_steps: [],
      chat_files: [],
      chat_next_moves: [
        {
          run_id: 'r1',
          rank: 2,
          label: 'Compare with Perplexity',
          prompt: 'Compare these citations with Perplexity',
          class: 'read',
          ghost_ok: false,
        },
        {
          run_id: 'r1',
          rank: 1,
          label: 'Do the same for /features',
          prompt: 'Do the same for /features',
          class: 'write',
          ghost_ok: true,
        },
      ],
    });
  });

  it('brings a finished run’s next moves back in rank order, with the ghost mark only', async () => {
    const thread = await loadChatThread(CHAT);
    expect(thread?.mine).toBe(true);
    const run = thread!.messages[1].run!;
    expect(run.nextMoves).toEqual([
      { label: 'Do the same for /features', prompt: 'Do the same for /features', ghost: true },
      { label: 'Compare with Perplexity', prompt: 'Compare these citations with Perplexity' },
    ]);
    expect(JSON.stringify(thread)).not.toContain('"class"');
  });

  it('opens the chat without moves when they can’t be read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.db.failures.chat_next_moves = { message: 'relation does not exist' };
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run!.nextMoves).toEqual([]);
    expect(thread!.messages[1].text).toBe('Two pages lost most of it.');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('shows a teammate’s shared chat without its author’s moves, and doesn’t read them', async () => {
    fake.user = 'u2';
    const thread = await loadChatThread(CHAT);
    expect(thread!.mine).toBe(false);
    expect(thread!.messages[1].run!.nextMoves).toEqual([]);
    expect(fake.db.log.some(([table]) => table === 'chat_next_moves')).toBe(false);
  });

  it('brings a run’s Why analyses back as their cards, in order, with no ids', async () => {
    const result = (valueB: number) => ({
      metric: 'citations',
      unit: 'pts',
      period_a: { from: '2026-10-12', to: '2026-10-18' },
      period_b: { from: '2026-10-19', to: '2026-10-25' },
      value_a: 58,
      value_b: valueB,
      delta: valueB - 58,
      se: 0.8,
      noise_verdict: 'beyond_normal_swing',
      direction: 'declined',
      change_point: null,
      causes: [
        {
          kind: 'lost_citation_to_competitor',
          share: 100,
          contribution: valueB - 58,
          offset: false,
          confidence: 'high',
          cells: 3,
          evidence_refs: [{ type: 'answer', id: 'answer-secret', date: '2026-10-20', period: 'b' }],
          fix_skill: 'winback',
          urls: ['https://www.acme.example/blog/aeo'],
          rows: [
            {
              prompt: 'what is aeo',
              before: 'https://acme.example/blog/aeo',
              now: null,
              date: '2026-10-20',
              answer: { type: 'answer', id: 'answer-secret', date: '2026-10-20', period: 'b' },
            },
          ],
        },
      ],
      excluded_cells: 0,
      stable_cells: 40,
      unexplained: { kind: 'unexplained', contribution: 0, share: 0 },
      evidence_partial: false,
    });
    fake.db.tables.chat_why_analyses = [
      {
        id: 'w2',
        run_id: 'r1',
        scope_json: { engines: ['google-aio'], runs_compared: { a: 9, b: 8, cells: 40 } },
        result_json: result(50),
        created_at: '2026-10-30T09:00:03.000Z',
      },
      {
        id: 'w1',
        run_id: 'r1',
        scope_json: {},
        result_json: result(52),
        created_at: '2026-10-30T09:00:02.000Z',
      },
    ];
    const why = (await loadChatThread(CHAT))!.messages[1].run!.why;
    expect(why.map((w) => [w.n, w.valueB])).toEqual([
      [1, 52],
      [2, 50],
    ]);
    expect(why[1]).toMatchObject({ engines: ['google-aio'], runs: { a: 9, b: 8, cells: 40 } });
    expect(why[0].causes[0].urls).toEqual(['acme.example/blog/aeo']);
    expect(why[0].causes[0].rows[0]).toEqual({
      prompt: 'what is aeo',
      before: 'acme.example/blog/aeo',
      now: null,
      date: '2026-10-20',
      answer: true,
    });
    expect(JSON.stringify(why)).not.toContain('answer-secret');
  });

  it('leaves out an analysis it can’t show, keeping the next one’s place for its drawer', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.db.tables.chat_why_analyses = [
      // Kept broken, or by a version that kept another shape.
      {
        id: 'w1',
        run_id: 'r1',
        scope_json: null,
        result_json: null,
        created_at: '2026-10-30T09:00:02.000Z',
      },
      {
        id: 'w2',
        run_id: 'r1',
        scope_json: null,
        // Old enough to lack most parts: they read as none.
        result_json: { metric: 'citations', unit: 'pts', value_a: 40, value_b: 35, delta: -5 },
        created_at: '2026-10-30T09:00:03.000Z',
      },
    ];
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].text).toBe('Two pages lost most of it.');
    const why = thread!.messages[1].run!.why;
    expect(why).toHaveLength(1);
    expect(why[0]).toMatchObject({
      n: 2,
      valueA: 40,
      causes: [],
      periodB: { from: '', to: '' },
      remainder: { points: 0, share: null },
      partial: false,
      engines: [],
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('opens the chat without Why cards when they can’t be read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.db.failures.chat_why_analyses = { message: 'relation does not exist' };
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run!.why).toEqual([]);
    expect(thread!.messages[1].text).toBe('Two pages lost most of it.');
    logged.mockRestore();
  });

  it('gives a run without moves none', async () => {
    fake.db.tables.chat_next_moves = [];
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run!.nextMoves).toEqual([]);
  });
});
