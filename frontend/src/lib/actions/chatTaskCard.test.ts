// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * The person's clicks on a deliverable's card (CHAT-09 items 13–16): Attach
 * to task & mark done completes the task through the Action Center's own
 * write, the person as the actor and Chat as the source; its Undo puts the
 * task, the file and the link back while nothing happened since, else says
 * `changed`; Attach only leaves the task open. Only on the person's own
 * chat, for Admins and Managers, never in a read-only workspace; the card
 * names its file by its run and place, never an id.
 */

const ME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BRAND = '33333333-3333-4333-8333-333333333333';
const CHAT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK = '99999999-9999-4999-8999-999999999999';
const FILE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
const manager = vi.hoisted(() => ({ is: true }));
vi.mock('@/lib/sessionRole', () => ({ isManager: async () => manager.is }));
const writable = vi.hoisted(() => vi.fn(async () => {}));
// Brand access (can_access_brand): a person given Selected brands may lack the card's.
const access = vi.hoisted(() => ({ brand: true }));
vi.mock('@/lib/subscriptionGuard', () => ({
  assertWritable: writable,
  SUBSCRIPTION_INACTIVE: { code: 'subscription_inactive' },
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));
vi.mock('@/lib/supabase/server', async () => {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const db = supabaseAdmin as unknown as FakeSupabase;
  return {
    // The person's own client: the same rows here (RLS isn't what these tests are about).
    createClient: async () => ({
      from: (table: string) => db.from(table),
      auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
      rpc: async (fn: string) => ({
        data: fn === 'can_access_brand' ? access.brand : null,
        error: null,
      }),
    }),
  };
});

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { attachOnlyFromCard, markTaskDoneFromCard, undoTaskDoneFromCard } =
  await import('./chatTaskCard');

const parent = {
  brand_id: BRAND,
  status: 'new',
  category: 'fix',
  priority_score: 86,
  due_date: null,
};
const task = () => db.tables.action_tasks[0];
const file = () => db.tables.chat_files[0];
const events = () => db.tables.action_events;

beforeEach(() => {
  manager.is = true;
  access.brand = true;
  writable.mockReset().mockResolvedValue(undefined);
  db.failures = {};
  db.defaults = { action_events: () => ({ created_at: new Date().toISOString() }) };
  db.unique = {
    chat_file_task_links: [['file_id', 'action_task_id']],
    chat_task_state: [['conversation_id', 'action_task_id']],
  };
  db.tables = {
    chat_runs: [{ id: RUN, conversation_id: CHAT }],
    chat_conversations: [{ id: CHAT, user_id: ME, brand_id: BRAND, deleted_at: null }],
    chat_messages: [],
    chat_files: [
      {
        id: FILE,
        run_id: RUN,
        message_id: null,
        brand_id: BRAND,
        title: 'Pricing FAQ',
        status: 'draft',
        created_at: '2026-10-31T09:00:00.000Z',
      },
    ],
    chat_task_state: [
      {
        conversation_id: CHAT,
        action_task_id: TASK,
        position: 1,
        chat_status: 'ready_for_review',
        run_id: RUN,
        file_id: FILE,
      },
    ],
    chat_file_task_links: [],
    actions: [{ id: ACTION, brand_id: BRAND, status: 'new', updated_at: null }],
    action_tasks: [
      {
        id: TASK,
        action_id: ACTION,
        task_key: null,
        title: 'Add a pricing FAQ block to /pricing',
        title_params: null,
        status: 'todo',
        actions: parent,
      },
    ],
    action_events: [],
  };
});

describe('markTaskDoneFromCard', () => {
  it('attaches the file, and completes the task the Action Center’s way, as the person, from Chat', async () => {
    const result = await markTaskDoneFromCard(RUN, 1);
    expect(result).toMatchObject({
      ok: true,
      status: 'done',
      task: { title: 'Add a pricing FAQ block to /pricing', state: 'done' },
      strip: { ready: 1, total: 1, tasks: [{ at: 1, status: 'done' }] },
    });
    expect(task().status).toBe('completed');
    expect(file().status).toBe('done');
    expect(db.tables.chat_file_task_links).toEqual([
      expect.objectContaining({ file_id: FILE, action_task_id: TASK, attached_by: ME }),
    ]);
    expect(events()).toEqual([
      expect.objectContaining({
        action_id: ACTION,
        event: 'task_status',
        actor_id: ME,
        data: {
          taskId: TASK,
          to: 'completed',
          source: 'chat',
          from: 'todo',
          fileId: FILE,
          fileFrom: 'draft',
          linked: true,
          actionStatus: 'new',
          conversationId: CHAT,
          runId: RUN,
        },
      }),
    ]);
    // The action's progress moves as a tick in Action Center moves it; its status stays.
    expect(db.tables.actions[0]).toMatchObject({ status: 'new', updated_at: expect.any(String) });
  });

  it('writes no second event for a task already completed', async () => {
    task().status = 'completed';
    expect(await markTaskDoneFromCard(RUN, 1)).toMatchObject({ ok: true, status: 'done' });
    expect(events()).toEqual([]);
  });

  it('writes one event for two clicks at once: the one that completes the task', async () => {
    const both = await Promise.all([markTaskDoneFromCard(RUN, 1), markTaskDoneFromCard(RUN, 1)]);
    for (const result of both) expect(result).toMatchObject({ ok: true, status: 'done' });
    expect(task().status).toBe('completed');
    expect(events()).toHaveLength(1);
    expect(events()[0].data).toMatchObject({ to: 'completed', from: 'todo', linked: true });
  });

  it('finds the task by the file’s one attachment when its run didn’t draft it for one', async () => {
    db.tables.chat_task_state = [];
    db.tables.chat_file_task_links = [{ file_id: FILE, action_task_id: TASK, attached_by: ME }];
    expect(await markTaskDoneFromCard(RUN, 1)).toMatchObject({ ok: true, strip: null });
    expect(task().status).toBe('completed');
    // Already attached: the event says the click didn't link it.
    expect(events()[0].data).toMatchObject({ linked: false });
  });

  it('refuses a teammate’s chat, a deleted one, a card without a task and a bad place', async () => {
    db.tables.chat_conversations[0].user_id = 'someone-else';
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'not_found' });
    db.tables.chat_conversations[0].user_id = ME;
    db.tables.chat_conversations[0].deleted_at = '2026-10-31T10:00:00.000Z';
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'not_found' });
    db.tables.chat_conversations[0].deleted_at = null;
    expect(await markTaskDoneFromCard(RUN, 2)).toEqual({ ok: false, failure: 'not_found' });
    expect(await markTaskDoneFromCard('not-a-run', 1)).toEqual({ ok: false, failure: 'not_found' });
    db.tables.chat_task_state = [];
    // Attached to two tasks: which one isn't certain.
    db.tables.chat_file_task_links = [
      { file_id: FILE, action_task_id: TASK },
      { file_id: FILE, action_task_id: 'other-task' },
    ];
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'not_found' });
    expect(task().status).toBe('todo');
    expect(events()).toEqual([]);
  });

  it('is an Admin’s or a Manager’s, on an open action, in a workspace that can write', async () => {
    manager.is = false;
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'forbidden' });
    manager.is = true;
    task().actions = { ...parent, status: 'dismissed' };
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'closed' });
    task().actions = parent;
    writable.mockRejectedValueOnce(
      Object.assign(new Error('read only'), { code: 'subscription_inactive' }),
    );
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'read_only' });
    writable.mockRejectedValueOnce(new Error('plan unread'));
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'failed' });
    expect(task().status).toBe('todo');
    expect(file().status).toBe('draft');
    expect(db.tables.chat_file_task_links).toEqual([]);
  });

  it('changes nothing on a brand the person may not use, or for a file of another brand', async () => {
    access.brand = false;
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'not_found' });
    access.brand = true;
    file().brand_id = '44444444-4444-4444-8444-444444444444';
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'not_found' });
    expect(task().status).toBe('todo');
    expect(file().status).toBe('draft');
    expect(db.tables.chat_file_task_links).toEqual([]);
    expect(events()).toEqual([]);
  });

  it('checks the task’s brand can write (a demo brand) before any write', async () => {
    writable.mockImplementation(async (opts?: { brandId?: string | null }) => {
      if (opts?.brandId) throw Object.assign(new Error('demo'), { code: 'demo_brand' });
    });
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'failed' });
    expect(writable).toHaveBeenCalledWith({ brandId: BRAND });
    expect(file().status).toBe('draft');
    expect(db.tables.chat_file_task_links).toEqual([]);
    expect(events()).toEqual([]);
  });

  it('answers a failed write as a value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.failures.action_tasks = { message: 'down' };
    expect(await markTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'failed' });
    logged.mockRestore();
  });
});

describe('undoTaskDoneFromCard', () => {
  it('puts the task, the file and the link back, as a new History event from Chat', async () => {
    await markTaskDoneFromCard(RUN, 1);
    const result = await undoTaskDoneFromCard(RUN, 1);
    expect(result).toMatchObject({
      ok: true,
      status: 'draft',
      task: { state: 'open' },
      // Back to what the chat had for it: Ready for review.
      strip: { ready: 1, tasks: [{ status: 'ready_for_review' }] },
    });
    expect(task().status).toBe('todo');
    expect(file().status).toBe('draft');
    expect(db.tables.chat_file_task_links).toEqual([]);
    expect(events().map((e) => [e.event, (e.data as { to: string }).to, e.actor_id])).toEqual([
      ['task_status', 'completed', ME],
      ['task_status', 'todo', ME],
    ]);
    expect(events()[1].data).toMatchObject({ source: 'chat', via: 'undo' });
  });

  it('writes one event for two Undos at once', async () => {
    await markTaskDoneFromCard(RUN, 1);
    const both = await Promise.all([undoTaskDoneFromCard(RUN, 1), undoTaskDoneFromCard(RUN, 1)]);
    for (const result of both) expect(result).toMatchObject({ ok: true, status: 'draft' });
    expect(task().status).toBe('todo');
    expect(events().map((e) => (e.data as { to: string }).to)).toEqual(['completed', 'todo']);
  });

  it('puts a skipped task back with its why', async () => {
    task().status = 'skipped';
    task().skip_reason = 'Covered by the new page';
    await markTaskDoneFromCard(RUN, 1);
    expect(task().skip_reason).toBeNull();
    expect(await undoTaskDoneFromCard(RUN, 1)).toMatchObject({ ok: true });
    expect(task()).toMatchObject({ status: 'skipped', skip_reason: 'Covered by the new page' });
  });

  it('changes nothing on a brand the person may no longer use', async () => {
    await markTaskDoneFromCard(RUN, 1);
    access.brand = false;
    expect(await undoTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'not_found' });
    expect(task().status).toBe('completed');
    expect(file().status).toBe('done');
    expect(db.tables.chat_file_task_links).toHaveLength(1);
  });

  it('keeps a link and a file status it didn’t make', async () => {
    db.tables.chat_file_task_links = [{ file_id: FILE, action_task_id: TASK, attached_by: ME }];
    file().status = 'attached';
    task().status = 'in_progress';
    await markTaskDoneFromCard(RUN, 1);
    expect(await undoTaskDoneFromCard(RUN, 1)).toMatchObject({ ok: true, status: 'attached' });
    expect(task().status).toBe('in_progress');
    expect(db.tables.chat_file_task_links).toHaveLength(1);
  });

  it('says changed, and changes nothing, once anything happened since', async () => {
    await markTaskDoneFromCard(RUN, 1);
    // Someone reopened the task in Action Center.
    task().status = 'in_progress';
    expect(await undoTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'changed' });
    task().status = 'completed';
    // The action moved on (closed by someone, say).
    task().actions = { ...parent, status: 'completed' };
    expect(await undoTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'changed' });
    task().actions = parent;
    // A newer History event on the action.
    events().push({
      action_id: ACTION,
      event: 'assigned',
      actor_id: 'someone-else',
      data: {},
      created_at: new Date(Date.now() + 1000).toISOString(),
    });
    expect(await undoTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'changed' });
    expect(file().status).toBe('done');
    expect(db.tables.chat_file_task_links).toHaveLength(1);
  });

  it('says changed after its hour, and for a task this card never marked done', async () => {
    await markTaskDoneFromCard(RUN, 1);
    events()[0].created_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(await undoTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'changed' });
    events().length = 0;
    task().status = 'completed';
    expect(await undoTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'changed' });
    expect(task().status).toBe('completed');
  });

  it('is an Admin’s or a Manager’s, in a workspace that can write', async () => {
    await markTaskDoneFromCard(RUN, 1);
    manager.is = false;
    expect(await undoTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'forbidden' });
    manager.is = true;
    writable.mockRejectedValueOnce(
      Object.assign(new Error('read only'), { code: 'subscription_inactive' }),
    );
    expect(await undoTaskDoneFromCard(RUN, 1)).toEqual({ ok: false, failure: 'read_only' });
    expect(task().status).toBe('completed');
  });
});

describe('attachOnlyFromCard', () => {
  it('attaches the file and leaves the task open (CHAT-09 item 16)', async () => {
    expect(await attachOnlyFromCard(RUN, 1)).toMatchObject({
      ok: true,
      status: 'attached',
      task: { state: 'open' },
    });
    expect(task().status).toBe('todo');
    expect(file().status).toBe('attached');
    expect(db.tables.chat_file_task_links).toEqual([
      expect.objectContaining({ file_id: FILE, action_task_id: TASK, attached_by: ME }),
    ]);
    expect(events().map((e) => [e.event, e.actor_id])).toEqual([['file_attached', ME]]);
    // Its History event names the card's chat and run, as a mark done's does.
    expect(events()[0].data).toMatchObject({ source: 'chat', conversationId: CHAT, runId: RUN });
  });

  it('refuses as Mark done does', async () => {
    manager.is = false;
    expect(await attachOnlyFromCard(RUN, 1)).toEqual({ ok: false, failure: 'forbidden' });
    manager.is = true;
    db.tables.chat_conversations[0].user_id = 'someone-else';
    expect(await attachOnlyFromCard(RUN, 1)).toEqual({ ok: false, failure: 'not_found' });
    expect(db.tables.chat_file_task_links).toEqual([]);
  });
});
