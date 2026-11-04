// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';
import { ACTION, FILE, TASK, seedActionCenter } from '@/lib/chat/testing/actionCenterFixtures';

/**
 * Chat's changes to the Action Center (CHAT-09 §D–E; CHAT-20 §9 rows
 * 43–46): Send to Action Center goes through the server's route with the
 * run's place and one idempotency key per approval, and its duplicate comes
 * back for the model to offer Add to AC-{n}; a finding, a file and Ready for
 * review are each written once, with their History event from Chat; and
 * nothing here completes a task or touches an action's targets. Admins and
 * Managers only; a chat that isn't the person's is never recorded as theirs.
 */

const ME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BRAND = '33333333-3333-4333-8333-333333333333';
const CHAT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
const manager = vi.hoisted(() => ({ is: true }));
vi.mock('@/lib/sessionRole', () => ({ isManager: async () => manager.is }));
const writable = vi.hoisted(() => vi.fn(async () => {}));
/** The brands the person may use (can_access_brand): every one unless a test narrows it. */
const brandAccess = vi.hoisted(() => ({ only: null as string[] | null }));
vi.mock('@/lib/subscriptionGuard', () => ({ assertWritable: writable }));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));
vi.mock('@/lib/supabase/server', async () => {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const db = supabaseAdmin as unknown as FakeSupabase;
  return {
    // The member's own client: the same rows here (RLS isn't what these tests are about).
    createClient: async () => ({
      from: (table: string) => db.from(table),
      rpc: async (fn: string, args: { p_brand_id: string }) => {
        if (fn !== 'can_access_brand') throw new Error(`unexpected rpc ${fn}`);
        return {
          data: !brandAccess.only || brandAccess.only.includes(args.p_brand_id),
          error: null,
        };
      },
      auth: {
        getUser: async () => ({ data: { user: { id: ME } } }),
        getSession: async () => ({ data: { session: { access_token: 'token-1' } } }),
      },
    }),
  };
});

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const {
  attachFileToTask,
  attachToAction,
  checkChatActionCover,
  createChatAction,
  setTaskReadyForReview,
} = await import('./chatActionCenter');

const place = {
  conversationId: CHAT,
  runId: RUN,
  approvalKey: 'step-1',
  executionMode: 'assisted' as const,
};
const proposal = {
  title: 'Win back pricing citations on /pricing',
  category: 'recover' as const,
  why: 'Google AI Overviews stopped citing /pricing.',
  entities: { prompts: [], pages: ['/pricing'], competitors: [], platforms: [] },
  tasks: [
    {
      title: 'Add a pricing FAQ block to /pricing',
      type: 'on_page' as const,
      url: '/pricing',
      done_when: 'The FAQ block is live',
    },
  ],
};
/**
 * The run step the change runs on now, as the engine wrote it: its tool, and
 * its mark when it ran without a card (Full auto). The embed reads its run.
 */
function stepFor(tool: string, auto = false) {
  db.tables.chat_run_steps = [
    {
      id: 'step-1',
      run_id: RUN,
      status: 'running',
      tool,
      debug_json: auto ? { auto: true } : { input: {} },
      chat_runs: { conversation_id: CHAT },
    },
  ];
}
const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const sent = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
const events = (event: string) => db.tables.action_events.filter((e) => e.event === event);

beforeEach(() => {
  vi.clearAllMocks();
  manager.is = true;
  brandAccess.only = null;
  vi.stubGlobal('fetch', fetchMock);
  db.tables = {};
  db.unique = {};
  db.failures = {};
  seedActionCenter(db);
  for (const row of db.tables.actions) row.brand_id = BRAND;
  for (const row of db.tables.action_tasks)
    row.actions = { action_no: 1258, brand_id: BRAND, status: 'new' };
  for (const row of db.tables.chat_files) row.brand_id = BRAND;
  db.tables.chat_conversations = [{ id: CHAT, user_id: ME, brand_id: BRAND }];
  db.tables.chat_runs = [{ id: RUN, conversation_id: CHAT }];
  stepFor('create_action');
});
afterEach(() => vi.unstubAllGlobals());

describe('createChatAction (Send to Action Center)', () => {
  it("sends it through the server's route, with the chat, the run and the approval's key", async () => {
    answer(201, { actionId: ACTION, actionNo: 1271, created: true });
    await expect(createChatAction(BRAND, proposal, place)).resolves.toEqual({
      ok: true,
      action_id: ACTION,
      action_no: 1271,
      created: true,
      href: `/dashboard/action-center/actions/${ACTION}`,
    });
    expect(writable).toHaveBeenCalledWith({ brandId: BRAND });
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/action-center/chat-actions');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(sent()).toEqual({
      brandId: BRAND,
      proposal,
      conversationId: CHAT,
      runId: RUN,
      executionMode: 'assisted',
      idempotencyKey: 'chat:step-1',
      createAnyway: false,
    });
  });

  /** As every person's send: never refused for the day's new actions, and said once they're reached. */
  it("passes on the one sentence Chat says when the day's new actions are reached", async () => {
    answer(201, {
      actionId: ACTION,
      actionNo: 1275,
      created: true,
      dailyLimit: { used: 5, limit: 5, reached: true },
    });
    await expect(createChatAction(BRAND, proposal, place)).resolves.toEqual({
      ok: true,
      action_id: ACTION,
      action_no: 1275,
      created: true,
      href: `/dashboard/action-center/actions/${ACTION}`,
      daily_limit_reached: true,
      daily_limit_note:
        "This is one of the 5 new actions the brand gets today, so Action Center's own new actions wait until tomorrow.",
    });
    // Below the limit, or without a count: nothing to say.
    answer(201, {
      actionId: ACTION,
      actionNo: 1276,
      created: true,
      dailyLimit: { used: 4, limit: 5, reached: false },
    });
    const below = await createChatAction(BRAND, proposal, place);
    expect(below).not.toHaveProperty('daily_limit_reached');
    expect(below).not.toHaveProperty('daily_limit_note');
  });

  it('reads how it was approved from its step, never from what the caller says', async () => {
    // Ran without a card: the engine marked its step.
    stepFor('create_action', true);
    answer(201, { actionId: ACTION, actionNo: 1271, created: true });
    await createChatAction(BRAND, proposal, { ...place, executionMode: 'assisted' });
    expect(sent()).toMatchObject({ executionMode: 'automated', idempotencyKey: 'chat:step-1' });

    // A caller's word alone: another chat, a step of another tool, or one not running now.
    const nothing = { conversationId: null, runId: null, executionMode: null };
    for (const [why, setUp] of [
      ['not their chat', () => (db.tables.chat_conversations[0].user_id = 'someone-else')],
      ['another tool', () => stepFor('attach_to_action', true)],
      ['not running', () => (db.tables.chat_run_steps[0].status = 'done')],
    ] as const) {
      db.tables.chat_conversations[0].user_id = ME;
      stepFor('create_action', true);
      setUp();
      answer(201, { actionId: ACTION, actionNo: 1272, created: true });
      await createChatAction(BRAND, proposal, { ...place, executionMode: 'automated' });
      expect(sent(), why).toMatchObject(nothing);
      expect(sent().idempotencyKey, why).not.toBe('chat:step-1');
    }
  });

  it('answers a duplicate with the action that covers it, for Add to AC-{n}', async () => {
    answer(409, {
      code: 'duplicate',
      action: { id: ACTION, no: 1258, covers: 'some' },
      canCreateAnyway: true,
    });
    await expect(createChatAction(BRAND, proposal, place, true)).resolves.toEqual({
      ok: false,
      reason: 'duplicate',
      message: 'AC-1258 already covers this.',
      action_id: ACTION,
      action_no: 1258,
      can_create_anyway: true,
    });
    expect(sent().createAnyway).toBe(true);
  });

  it('refuses an Analyst before anything is sent, and says the server’s refusals in words', async () => {
    manager.is = false;
    await expect(createChatAction(BRAND, proposal, place)).resolves.toMatchObject({
      ok: false,
      reason: 'forbidden_role',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    manager.is = true;
    answer(400, { details: 'Task 1 only looks ("Analyze pricing"): say the change to make.' });
    await expect(createChatAction(BRAND, proposal, place)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
      message: 'Task 1 only looks ("Analyze pricing"): say the change to make.',
    });
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(createChatAction(BRAND, proposal, place)).resolves.toMatchObject({
      ok: false,
      reason: 'failed',
    });
  });

  it("says another workspace's brand, or one outside the person's access, and a cancelled one", async () => {
    for (const code of ['not_in_workspace', 'no_brand_access']) {
      answer(403, { code, details: "This brand isn't in your workspace" });
      await expect(createChatAction(BRAND, proposal, place), code).resolves.toEqual({
        ok: false,
        reason: 'not_found',
        message: "This brand isn't in your workspace",
      });
    }
    answer(409, { code: 'conflict', details: 'The action this approval made was cancelled.' });
    await expect(createChatAction(BRAND, proposal, place)).resolves.toEqual({
      ok: false,
      reason: 'conflict',
      message: 'The action this approval made was cancelled.',
    });
  });
});

describe('checkChatActionCover', () => {
  it('goes on when nothing covers it, or the check fails; else names the closest action', async () => {
    answer(200, { covering: [] });
    await expect(checkChatActionCover(BRAND, proposal.entities, 'recover')).resolves.toEqual({
      ok: true,
    });
    expect(sent()).toEqual({ brandId: BRAND, entities: proposal.entities, category: 'recover' });
    answer(200, { covering: [{ actionId: ACTION, actionNo: 1258, covers: 'all' }] });
    await expect(checkChatActionCover(BRAND, proposal.entities)).resolves.toMatchObject({
      reason: 'duplicate',
      action_no: 1258,
      can_create_anyway: false,
    });
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(checkChatActionCover(BRAND, proposal.entities)).resolves.toEqual({ ok: true });
  });
});

describe('attachToAction (Add to AC-{n})', () => {
  it('adds the finding to its History from Chat, and changes nothing else', async () => {
    const before = JSON.stringify(db.tables.actions);
    stepFor('attach_to_action', true);
    const added = await attachToAction(
      ACTION,
      { finding: 'Lost 6 citations on /pricing.', note: 'Same pages', sources: ['Citations'] },
      place,
    );
    expect(added).toMatchObject({ ok: true, action_id: ACTION, action_no: 1258 });
    expect(events('evidence_attached')).toEqual([
      expect.objectContaining({
        action_id: ACTION,
        actor_id: ME,
        data: {
          source: 'chat',
          finding: 'Lost 6 citations on /pricing.',
          note: 'Same pages',
          sources: ['Citations'],
          conversationId: CHAT,
          runId: RUN,
          execution: { mode: 'automated' },
          idempotencyKey: 'chat:step-1',
        },
      }),
    ]);
    // Its targets never grow: the action itself isn't written.
    expect(JSON.stringify(db.tables.actions)).toBe(before);
  });

  it('adds the finding once per approval: a retry finds the event it wrote', async () => {
    stepFor('attach_to_action');
    const finding = { finding: 'Lost 6 citations on /pricing.' };
    const first = await attachToAction(ACTION, finding, place);
    expect(first).toMatchObject({ ok: true });
    expect(await attachToAction(ACTION, finding, place)).toEqual(first);
    // Closed since: the retry still answers what its approval did.
    db.tables.actions[0].status = 'completed';
    expect(await attachToAction(ACTION, finding, place)).toEqual(first);
    expect(events('evidence_attached')).toHaveLength(1);

    // Another approval is another finding.
    db.tables.actions[0].status = 'new';
    db.tables.chat_run_steps.push({ ...db.tables.chat_run_steps[0], id: 'step-2' });
    await attachToAction(ACTION, finding, { ...place, approvalKey: 'step-2' });
    expect(
      events('evidence_attached').map((e) => (e.data as Record<string, unknown>).idempotencyKey),
    ).toEqual(['chat:step-1', 'chat:step-2']);
  });

  it('refuses a closed action, and one it can’t find', async () => {
    db.tables.actions[0].status = 'completed';
    await expect(attachToAction(ACTION, { finding: 'x' }, place)).resolves.toMatchObject({
      reason: 'conflict',
    });
    await expect(
      attachToAction('ffffffff-ffff-4fff-8fff-ffffffffffff', { finding: 'x' }, place),
    ).resolves.toMatchObject({ reason: 'not_found' });
    expect(events('evidence_attached')).toEqual([]);
  });
});

describe('attachFileToTask (Attach only)', () => {
  it('links the file by the person, marks it attached, and says so in History, once', async () => {
    stepFor('attach_file_to_task');
    await expect(attachFileToTask(BRAND, TASK, FILE, place)).resolves.toEqual({
      ok: true,
      file_id: FILE,
      task_id: TASK,
      action_id: ACTION,
      already: false,
    });
    expect(db.tables.chat_file_task_links).toEqual([
      expect.objectContaining({ file_id: FILE, action_task_id: TASK, attached_by: ME }),
    ]);
    expect(db.tables.chat_files[0].status).toBe('attached');
    // The task stays as it was: marking it done is the person's click.
    expect(db.tables.action_tasks[0].status).toBe('todo');
    expect(events('file_attached')).toEqual([
      expect.objectContaining({
        action_id: ACTION,
        actor_id: ME,
        data: expect.objectContaining({
          source: 'chat',
          taskId: TASK,
          title: 'Add a pricing FAQ block to /pricing',
          fileId: FILE,
          file: 'Pricing FAQ',
          execution: { mode: 'assisted' },
        }),
      }),
    ]);

    await expect(attachFileToTask(BRAND, TASK, FILE, place)).resolves.toMatchObject({
      already: true,
    });
    expect(events('file_attached')).toHaveLength(1);
  });

  it("records a card's chat and run (Attach only), only when they are the person's own", async () => {
    await attachFileToTask(BRAND, TASK, FILE, { conversationId: CHAT, runId: RUN });
    expect(events('file_attached')[0].data).toMatchObject({
      conversationId: CHAT,
      runId: RUN,
      // The person's own click: no change Chat made.
      execution: null,
    });

    db.tables.chat_file_task_links = [];
    db.tables.action_events = [];
    // A run of another chat isn't recorded as this one's.
    db.tables.chat_runs.push({ id: 'other-run', conversation_id: 'other-chat' });
    await attachFileToTask(BRAND, TASK, FILE, { conversationId: CHAT, runId: 'other-run' });
    expect(events('file_attached')[0].data).toMatchObject({ conversationId: null, runId: null });
  });

  it("refuses another brand's task or file, and a closed action's task", async () => {
    await expect(
      attachFileToTask('99999999-0000-4000-8000-000000000000', TASK, FILE, place),
    ).resolves.toMatchObject({ reason: 'not_found' });
    db.tables.chat_files[0].brand_id = '99999999-0000-4000-8000-000000000000';
    await expect(attachFileToTask(BRAND, TASK, FILE, place)).resolves.toMatchObject({
      reason: 'not_found',
    });
    db.tables.chat_files[0].brand_id = BRAND;
    (db.tables.action_tasks[0].actions as { status: string }).status = 'dismissed';
    await expect(attachFileToTask(BRAND, TASK, FILE, place)).resolves.toMatchObject({
      reason: 'conflict',
    });
    expect(db.tables.chat_file_task_links).toEqual([]);
  });
});

describe('setTaskReadyForReview', () => {
  it("puts the task last in the chat's strip as Ready for review, and says so in History", async () => {
    stepFor('set_task_ready_for_review');
    db.tables.chat_task_state.push({
      conversation_id: CHAT,
      action_task_id: 'other-task',
      position: 2,
      chat_status: 'writing',
    });
    await expect(setTaskReadyForReview(BRAND, TASK, place)).resolves.toEqual({
      ok: true,
      task_id: TASK,
      action_id: ACTION,
      conversation_id: CHAT,
      previous: null,
    });
    expect(db.tables.chat_task_state.find((s) => s.action_task_id === TASK)).toMatchObject({
      position: 3,
      chat_status: 'ready_for_review',
      run_id: RUN,
    });
    // Its Action Center status doesn't change.
    expect(db.tables.action_tasks[0].status).toBe('todo');
    expect(events('task_ready_for_review')).toEqual([
      expect.objectContaining({
        action_id: ACTION,
        actor_id: ME,
        data: expect.objectContaining({ source: 'chat', taskId: TASK, conversationId: CHAT }),
      }),
    ]);
  });

  it('moves a task the chat was writing, and says what it was for Undo', async () => {
    stepFor('set_task_ready_for_review');
    db.tables.chat_task_state.push({
      conversation_id: CHAT,
      action_task_id: TASK,
      position: 1,
      chat_status: 'writing',
    });
    await expect(setTaskReadyForReview(BRAND, TASK, place)).resolves.toMatchObject({
      previous: 'writing',
    });
    expect(db.tables.chat_task_state[0].chat_status).toBe('ready_for_review');
  });

  it("refuses a task of a brand other than its chat's", async () => {
    stepFor('set_task_ready_for_review');
    db.tables.chat_conversations[0].brand_id = '99999999-0000-4000-8000-000000000000';
    await expect(setTaskReadyForReview(BRAND, TASK, place)).resolves.toMatchObject({
      reason: 'invalid',
      message: 'This chat is about another brand: set Ready for review from its own chat.',
    });
    expect(db.tables.chat_task_state).toEqual([]);
  });

  it('refuses a task done in Action Center, and outside a chat', async () => {
    stepFor('set_task_ready_for_review');
    await expect(setTaskReadyForReview(BRAND, TASK, undefined)).resolves.toMatchObject({
      reason: 'invalid',
    });
    db.tables.action_tasks[0].status = 'completed';
    await expect(setTaskReadyForReview(BRAND, TASK, place)).resolves.toMatchObject({
      reason: 'conflict',
    });
    expect(db.tables.chat_task_state).toEqual([]);
  });
});

describe('brand access (Selected brands)', () => {
  const OTHER = '44444444-4444-4444-8444-444444444444';

  it("adds no finding, file or Ready for review on a brand the person wasn't given", async () => {
    brandAccess.only = [OTHER];
    stepFor('attach_to_action');
    await expect(attachToAction(ACTION, { finding: 'Lost 6.' }, place)).resolves.toMatchObject({
      ok: false,
      reason: 'not_found',
    });
    stepFor('attach_file_to_task');
    await expect(attachFileToTask(BRAND, TASK, FILE, place)).resolves.toMatchObject({
      ok: false,
      reason: 'not_found',
    });
    stepFor('set_task_ready_for_review');
    await expect(setTaskReadyForReview(BRAND, TASK, place)).resolves.toMatchObject({
      ok: false,
      reason: 'not_found',
    });
    expect(db.tables.action_events ?? []).toEqual([]);
    expect(db.tables.chat_file_task_links ?? []).toEqual([]);
    expect(db.tables.chat_task_state ?? []).toEqual([]);
  });

  it('still works on a brand the person was given', async () => {
    brandAccess.only = [BRAND];
    stepFor('attach_to_action');
    await expect(attachToAction(ACTION, { finding: 'Lost 6.' }, place)).resolves.toMatchObject({
      ok: true,
    });
  });
});
