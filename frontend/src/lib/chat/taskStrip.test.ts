import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';

/**
 * The task strip under a /tasks answer (CHAT-09 §B, 00418): the week's
 * tasks a run takes on, at most 4, due first and by priority; Writing once
 * the run opens their action; back to Queued as it ends; Done only as the
 * Action Center has it; read back as the person may see it.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const {
  STRIP_MAX,
  pickTasks,
  queueTasks,
  readStrips,
  settleStrip,
  startAction,
  weekEndIn,
  linkDeliverable,
  readDeliverableTasks,
} = await import('./taskStrip');

const BRAND = 'brand-1';
const CHAT = 'chat-1';
const RUN = 'run-1';
const WEEK_END = '2026-11-01';

const action = (id: string, more: Record<string, unknown> = {}) => ({
  id,
  brand_id: BRAND,
  status: 'new',
  deleted_at: null,
  due_date: null,
  priority_score: 50,
  category: 'fix',
  ...more,
});
const task = (
  id: string,
  actionId: string,
  position: number,
  more: Record<string, unknown> = {},
) => {
  const parent = db.tables.actions.find((a) => a.id === actionId)!;
  return {
    id,
    action_id: actionId,
    position,
    task_key: null,
    title: `Task ${id}`,
    title_params: null,
    status: 'todo',
    actions: {
      category: parent.category,
      priority_score: parent.priority_score,
      due_date: parent.due_date,
    },
    ...more,
  };
};
const states = () =>
  [...db.tables.chat_task_state]
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((row) => [row.action_task_id, row.chat_status, row.run_id]);

beforeEach(() => {
  db.tables = {
    actions: [
      action('a-due-low', { due_date: '2026-10-30', priority_score: 40 }),
      action('a-due-high', { due_date: '2026-11-01', priority_score: 86 }),
      action('a-later', { due_date: '2026-11-20', priority_score: 95 }),
      action('a-hold', { status: 'on_hold', due_date: '2026-10-30', priority_score: 99 }),
      action('a-other-brand', { brand_id: 'brand-2', due_date: '2026-10-30' }),
    ],
    action_tasks: [],
    chat_task_state: [],
  };
  db.tables.action_tasks = [
    task('t-high-1', 'a-due-high', 1),
    task('t-high-2', 'a-due-high', 2, { status: 'completed' }),
    task('t-high-3', 'a-due-high', 3),
    task('t-low-1', 'a-due-low', 1),
    task('t-later-1', 'a-later', 1),
    task('t-later-2', 'a-later', 2),
    task('t-hold-1', 'a-hold', 1),
  ];
  db.unique = { chat_task_state: [['conversation_id', 'action_task_id']] };
  db.failures = {};
  db.log = [];
});

describe('weekEndIn', () => {
  it('is this week’s Sunday in the person’s zone', () => {
    // Friday 30 Oct, 23:30 UTC: Saturday in Istanbul, still Friday in New York.
    const at = new Date('2026-10-30T23:30:00Z');
    expect(weekEndIn(at, 'Europe/Istanbul')).toBe('2026-11-01');
    expect(weekEndIn(at, 'America/New_York')).toBe('2026-11-01');
    // Sunday is its own week's end; Monday starts the next.
    expect(weekEndIn(new Date('2026-11-01T12:00:00Z'), 'UTC')).toBe('2026-11-01');
    expect(weekEndIn(new Date('2026-11-02T12:00:00Z'), 'UTC')).toBe('2026-11-08');
    expect(weekEndIn(at, 'Not/AZone')).toBe('2026-11-01');
  });
});

describe('pickTasks', () => {
  it('takes the open tasks due this week first, by priority, then the rest, at most 4', async () => {
    const { taskIds, dueActions } = await pickTasks(supabaseAdmin, BRAND, WEEK_END);
    expect(taskIds).toEqual(['t-high-1', 't-high-3', 't-low-1', 't-later-1']);
    expect(taskIds).toHaveLength(STRIP_MAX);
    expect([...dueActions].sort()).toEqual(['a-due-high', 'a-due-low']);
  });

  it('takes none from a brand with no open work', async () => {
    expect(await pickTasks(supabaseAdmin, 'brand-3', WEEK_END)).toEqual({
      taskIds: [],
      dueActions: new Set(),
    });
  });
});

describe('queueTasks, startAction and settleStrip', () => {
  it('queues the tasks, opens an action as Writing and settles it back to Queued', async () => {
    await queueTasks(CHAT, RUN, ['t-high-1', 't-high-3', 't-low-1']);
    expect(states()).toEqual([
      ['t-high-1', 'queued', RUN],
      ['t-high-3', 'queued', RUN],
      ['t-low-1', 'queued', RUN],
    ]);
    await startAction(supabaseAdmin, CHAT, RUN, 'a-due-high');
    expect(states().map(([, status]) => status)).toEqual(['writing', 'writing', 'queued']);
    await settleStrip(CHAT, RUN);
    expect(states().map(([, status]) => status)).toEqual(['queued', 'queued', 'queued']);
  });

  it('keeps a task’s place and status when a later run takes it again, and never passes 4', async () => {
    await queueTasks(CHAT, RUN, ['t-high-1']);
    db.tables.chat_task_state[0].chat_status = 'ready_for_review';
    await queueTasks(CHAT, 'run-2', ['t-high-1', 't-high-3', 't-low-1', 't-later-1', 't-later-2']);
    expect(states()).toEqual([
      ['t-high-1', 'ready_for_review', 'run-2'],
      ['t-high-3', 'queued', 'run-2'],
      ['t-low-1', 'queued', 'run-2'],
      ['t-later-1', 'queued', 'run-2'],
    ]);
  });

  it('brings an opened action’s tasks in first, and leaves Ready for review as it is', async () => {
    await queueTasks(CHAT, RUN, ['t-later-1']);
    db.tables.chat_task_state[0].chat_status = 'ready_for_review';
    await startAction(supabaseAdmin, CHAT, RUN, 'a-later');
    expect(states()).toEqual([
      ['t-later-1', 'ready_for_review', RUN],
      ['t-later-2', 'writing', RUN],
    ]);
  });
});

describe('readStrips', () => {
  it('reads each run’s strip as the browser draws it: Done as Action Center has it', async () => {
    await queueTasks(CHAT, RUN, ['t-high-1', 't-high-3', 't-later-1']);
    db.tables.chat_task_state[1].chat_status = 'ready_for_review';
    // The person completed it in Action Center since.
    db.tables.action_tasks.find((t) => t.id === 't-later-1')!.status = 'completed';
    const strip = (await readStrips(supabaseAdmin, CHAT, WEEK_END)).get(RUN);
    expect(strip).toEqual({
      tasks: [
        {
          at: 1,
          title: 'Task t-high-1',
          priority: 86,
          category: 'fix',
          status: 'queued',
          due: '2026-11-01',
        },
        {
          at: 2,
          title: 'Task t-high-3',
          priority: 86,
          category: 'fix',
          status: 'ready_for_review',
          due: '2026-11-01',
        },
        {
          at: 3,
          title: 'Task t-later-1',
          priority: 95,
          category: 'fix',
          status: 'done',
          due: '2026-11-20',
        },
      ],
      ready: 2,
      total: 3,
      due: 2,
    });
  });

  it('never reads Done the run wrote, only the Action Center’s, and drops a task it can’t see', async () => {
    await queueTasks(CHAT, RUN, ['t-high-1', 't-low-1']);
    db.tables.chat_task_state[0].chat_status = 'done';
    db.tables.action_tasks = db.tables.action_tasks.filter((t) => t.id !== 't-low-1');
    const strip = (await readStrips(supabaseAdmin, CHAT, WEEK_END, RUN)).get(RUN)!;
    expect(strip.tasks.map((t) => [t.at, t.status])).toEqual([[1, 'queued']]);
    expect(strip.total).toBe(1);
  });

  it('words a task by its key from en.json, and never shows a key en.json doesn’t word', async () => {
    db.tables.action_tasks.push(
      task('t-key', 'a-due-low', 2, { title: null, task_key: 'fix_issues' }),
      task('t-odd', 'a-due-low', 3, { title: null, task_key: 'not_a_task_key' }),
    );
    await queueTasks(CHAT, RUN, ['t-key', 't-odd']);
    const strip = (await readStrips(supabaseAdmin, CHAT, WEEK_END, RUN)).get(RUN)!;
    expect(strip.tasks.map((t) => t.title)).toEqual(['Fix the highest-impact issues first', '']);
  });

  it('reads nothing for a chat with no strip', async () => {
    expect((await readStrips(supabaseAdmin, CHAT, WEEK_END)).size).toBe(0);
    expect(db.log.filter(([table]) => table === 'action_tasks')).toEqual([]);
  });

  it('fails as the read does', async () => {
    db.failures.chat_task_state = { message: 'down' };
    await expect(readStrips(supabaseAdmin, CHAT, WEEK_END)).rejects.toThrow('down');
  });
});

describe('linkDeliverable and readDeliverableTasks (W2-12)', () => {
  beforeEach(async () => {
    db.tables.chat_file_task_links = [];
    await queueTasks(CHAT, RUN, ['t-high-1', 't-high-3', 't-low-1']);
    await startAction(supabaseAdmin, CHAT, RUN, 'a-due-high');
  });
  const fileOf = (taskId: string) =>
    db.tables.chat_task_state.find((row) => row.action_task_id === taskId)?.file_id ?? null;

  it('ties the file to the one task of the opened action it writes, by its draft', async () => {
    db.tables.action_tasks.find((t) => t.id === 't-high-3')!.task_key = 'optimize_content';
    expect(await linkDeliverable(supabaseAdmin, CHAT, RUN, 'a-due-high', 'file-1', true)).toEqual({
      title: 'Task t-high-3',
      state: 'open',
    });
    expect([fileOf('t-high-1'), fileOf('t-high-3')]).toEqual([null, 'file-1']);
    // The next file finds that task taken: the other one is certain now.
    expect(await linkDeliverable(supabaseAdmin, CHAT, RUN, 'a-due-high', 'file-2', false)).toEqual({
      title: 'Task t-high-1',
      state: 'open',
    });
  });

  it('ties nothing when two tasks could be it, or the action isn’t the one being written', async () => {
    expect(
      await linkDeliverable(supabaseAdmin, CHAT, RUN, 'a-due-high', 'file-1', true),
    ).toBeNull();
    expect(
      await linkDeliverable(supabaseAdmin, CHAT, RUN, 'a-due-low', 'file-1', false),
    ).toBeNull();
    expect(
      await linkDeliverable(supabaseAdmin, CHAT, 'run-2', 'a-due-high', 'file-1', false),
    ).toBeNull();
    expect(db.tables.chat_task_state.every((row) => !row.file_id)).toBe(true);
  });

  it('reads each file’s task: the one drafted for first, else its one attached task', async () => {
    db.tables.chat_task_state.find((row) => row.action_task_id === 't-high-1')!.file_id = 'file-1';
    db.tables.action_tasks.find((t) => t.id === 't-high-1')!.status = 'completed';
    db.tables.chat_file_task_links = [
      { file_id: 'file-1', action_task_id: 't-low-1' },
      { file_id: 'file-2', action_task_id: 't-low-1' },
      // Attached to two tasks: no one task is its own.
      { file_id: 'file-3', action_task_id: 't-low-1' },
      { file_id: 'file-3', action_task_id: 't-high-3' },
    ];
    const tasks = await readDeliverableTasks(supabaseAdmin, CHAT, [
      'file-1',
      'file-2',
      'file-3',
      'file-4',
    ]);
    expect(Object.fromEntries(tasks)).toEqual({
      'file-1': { title: 'Task t-high-1', state: 'done' },
      'file-2': { title: 'Task t-low-1', state: 'open' },
    });
    expect((await readDeliverableTasks(supabaseAdmin, CHAT, [])).size).toBe(0);
  });
});
