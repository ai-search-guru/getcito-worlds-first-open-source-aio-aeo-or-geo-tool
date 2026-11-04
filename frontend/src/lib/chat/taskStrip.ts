import { createTranslator } from 'next-intl';
import type { SupabaseClient } from '@supabase/supabase-js';
import messages from '../../../messages/en.json';
import { taskText } from '@/lib/action-center/display';
import { ACTION_CATEGORIES, type ActionCategory } from '@/lib/action-center/registry';
import { draftMethodForTask } from '@/lib/content/actionDrafts';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ChatTaskRow, ChatTaskStatus, ChatTaskStrip } from './events';

/**
 * The task strip under a /tasks answer (CHAT-09 §B, mockup #s-work):
 * the Action Center tasks a run works on, in the order it took them, with
 * Chat's own status for each (chat_task_state, 00418). Kept by the server
 * as the run goes (the engine's hooks, only while the run uses the /tasks
 * skill), and read back the same way for the event (`tasks.updated`) and
 * for a reload (thread.ts). Statuses describe Chat's work, never the task's
 * Action Center status, which nothing here changes (CHAT-09 guardrail):
 *   - queued: in the strip, not started;
 *   - writing: the run opened its action (get_action) and works on it;
 *   - ready_for_review: Chat or an agent said its work is finished
 *     (set_task_ready_for_review, W2-10);
 *   - done: only as read, once the person completed the task in Action
 *     Center (§B item 6); never written from a run.
 * Getting started steps aren't action_tasks: they get no row.
 */

/** The most tasks a strip holds (the /tasks skill and mockup: "4 due"). */
export const STRIP_MAX = 4;

/** An action Chat works through: new or in progress, not on hold, dismissed or done. */
const OPEN_ACTIONS = ['new', 'in_progress'];
/** A task still to do (as Ready for review reads it, chatActionCenter.ts OPEN_TASK). */
const OPEN_TASKS = ['todo', 'in_progress', 'waiting_approval'];

const taskT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.actionTasks' });

type Db = Pick<SupabaseClient, 'from'>;

/**
 * The last day of this week, Sunday (weeks run Monday to Sunday), as
 * YYYY-MM-DD in `zone`: as Home's endOfWeek counts "due this week", on the
 * server, in the person's time zone (the run's), so an overdue task counts.
 */
export function weekEndIn(now: Date, zone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(now);
  } catch {
    return weekEndIn(now, 'UTC');
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
  const day = new Date(Date.UTC(+part('year'), +part('month') - 1, +part('day')));
  day.setUTCDate(day.getUTCDate() + ((7 - weekday) % 7));
  return day.toISOString().slice(0, 10);
}

interface TaskCandidate {
  id: string;
  action_id: string;
  position: number;
  status: string;
}

interface ActionCandidate {
  id: string;
  due_date: string | null;
  priority_score: number | null;
}

/** Highest priority first; an unscored action last. */
const byPriority = (a: ActionCandidate, b: ActionCandidate) =>
  (b.priority_score ?? -1) - (a.priority_score ?? -1);

/**
 * The tasks a /tasks run takes on, at most STRIP_MAX: the open tasks of the
 * brand's open actions due by the end of this week, highest Priority Score
 * first (CHAT-09 item 1), then, while there's room, the other open actions'
 * by priority, so a brand without due dates still gets its top work. In each
 * action, its tasks' own order.
 */
export async function pickTasks(
  db: Db,
  brandId: string,
  weekEnd: string,
): Promise<{ taskIds: string[]; dueActions: Set<string> }> {
  const { data: actions, error } = await db
    .from('actions')
    .select('id, due_date, priority_score')
    .eq('brand_id', brandId)
    .in('status', OPEN_ACTIONS)
    .is('deleted_at', null)
    .order('priority_score', { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const open = (actions ?? []) as ActionCandidate[];
  const due = open.filter((a) => a.due_date !== null && a.due_date <= weekEnd).sort(byPriority);
  const rest = open.filter((a) => !due.includes(a)).sort(byPriority);
  const ordered = [...due, ...rest];
  if (ordered.length === 0) return { taskIds: [], dueActions: new Set() };
  const { data: tasks, error: tasksError } = await db
    .from('action_tasks')
    .select('id, action_id, position, status')
    .in(
      'action_id',
      ordered.map((a) => a.id),
    )
    .in('status', OPEN_TASKS)
    .order('position');
  if (tasksError) throw new Error(tasksError.message);
  const byAction = new Map<string, TaskCandidate[]>();
  for (const task of (tasks ?? []) as TaskCandidate[]) {
    byAction.set(task.action_id, [...(byAction.get(task.action_id) ?? []), task]);
  }
  const taskIds = ordered
    .flatMap((a) => (byAction.get(a.id) ?? []).sort((x, y) => x.position - y.position))
    .slice(0, STRIP_MAX)
    .map((task) => task.id);
  return { taskIds, dueActions: new Set(due.map((a) => a.id)) };
}

interface StateRow {
  action_task_id: string;
  position: number;
  chat_status: string;
  run_id: string | null;
}

async function stateRows(conversationId: string): Promise<StateRow[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_task_state')
    .select('action_task_id, position, chat_status, run_id')
    .eq('conversation_id', conversationId)
    .order('position');
  if (error) throw new Error(error.message);
  return (data ?? []) as StateRow[];
}

/**
 * Put tasks in the chat's strip for this run, queued, after the ones it
 * holds: one already there keeps its status and place and is now this
 * run's. Never past STRIP_MAX rows in this run. The ids of this run's rows.
 */
export async function queueTasks(
  conversationId: string,
  runId: string,
  taskIds: readonly string[],
): Promise<void> {
  if (taskIds.length === 0) return;
  const rows = await stateRows(conversationId);
  const held = new Map(rows.map((row) => [row.action_task_id, row]));
  let mine = rows.filter((row) => row.run_id === runId).length;
  let last = rows.reduce((max, row) => Math.max(max, row.position), 0);
  for (const taskId of new Set(taskIds)) {
    const row = held.get(taskId);
    if (row?.run_id === runId) continue;
    if (mine >= STRIP_MAX) break;
    mine += 1;
    if (row) {
      const { error } = await supabaseAdmin
        .from('chat_task_state')
        .update({ run_id: runId })
        .eq('conversation_id', conversationId)
        .eq('action_task_id', taskId);
      if (error) throw new Error(error.message);
      continue;
    }
    last += 1;
    const { error } = await supabaseAdmin.from('chat_task_state').insert({
      conversation_id: conversationId,
      action_task_id: taskId,
      position: last,
      chat_status: 'queued',
      run_id: runId,
    });
    if (error) throw new Error(error.message);
  }
}

/**
 * The run opened an action (get_action): its tasks in the strip it is
 * working on now are Writing. One not in the strip yet comes in first, while
 * there's room. Ready for review stays: its work is finished.
 */
export async function startAction(
  db: Db,
  conversationId: string,
  runId: string,
  actionId: string,
): Promise<void> {
  const { data: tasks, error } = await db
    .from('action_tasks')
    .select('id, action_id, position, status')
    .eq('action_id', actionId)
    .in('status', OPEN_TASKS)
    .order('position');
  if (error) throw new Error(error.message);
  const ids = ((tasks ?? []) as TaskCandidate[]).map((task) => task.id);
  if (ids.length === 0) return;
  await queueTasks(conversationId, runId, ids);
  const { error: writeError } = await supabaseAdmin
    .from('chat_task_state')
    .update({ chat_status: 'writing' })
    .eq('conversation_id', conversationId)
    .eq('run_id', runId)
    .eq('chat_status', 'queued')
    .in('action_task_id', ids);
  if (writeError) throw new Error(writeError.message);
}

/**
 * The run ended: what it was still writing goes back to Queued, for the
 * next run to take up; Ready for review stays.
 */
export async function settleStrip(conversationId: string, runId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_task_state')
    .update({ chat_status: 'queued' })
    .eq('conversation_id', conversationId)
    .eq('run_id', runId)
    .eq('chat_status', 'writing');
  if (error) throw new Error(error.message);
}

interface TaskRow {
  id: string;
  task_key: string | null;
  title: string | null;
  title_params: unknown;
  status: string;
  actions: {
    category: string | null;
    priority_score: number | null;
    due_date: string | null;
  } | null;
}

const STATUSES: readonly ChatTaskStatus[] = ['queued', 'writing', 'ready_for_review', 'done'];

/**
 * A task's title as the Action Center words it (taskText): its own, else its
 * key's words in en.json. A key en.json doesn't word gives none, never the
 * key itself: the strip then says "An Action Center task".
 */
export function titleOfTask(task: Pick<TaskRow, 'task_key' | 'title' | 'title_params'>): string {
  if (
    !task.title?.trim() &&
    task.task_key &&
    !(taskT.has as (key: string) => boolean)(task.task_key)
  )
    return '';
  return taskText(
    {
      taskKey: task.task_key,
      title: task.title,
      titleParams: (task.title_params ?? {}) as Record<string, string | number>,
    },
    taskT as (key: string, values?: Record<string, string | number>) => string,
  ).slice(0, 200);
}

/**
 * The strips of a chat, by the run that last worked on their tasks, as the
 * browser draws them: each task's title (as the Action Center words it),
 * its action's Priority Score and category, Chat's status for it (Done once
 * the person completed it in Action Center), and how many are ready. Read
 * through `db`: the person's session for a reload (thread.ts), so only the
 * tasks they may see come back; the server's for the run's own event.
 * `weekEnd` counts the strip's tasks due this week, for its header.
 */
export async function readStrips(
  db: Db,
  conversationId: string,
  weekEnd: string,
  onlyRun?: string,
): Promise<Map<string, ChatTaskStrip>> {
  let query = db
    .from('chat_task_state')
    .select('action_task_id, position, chat_status, run_id')
    .eq('conversation_id', conversationId)
    .not('run_id', 'is', null)
    .order('position');
  if (onlyRun) query = query.eq('run_id', onlyRun);
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  const states = (rows ?? []) as StateRow[];
  const strips = new Map<string, ChatTaskStrip>();
  if (states.length === 0) return strips;
  const { data: tasks, error: tasksError } = await db
    .from('action_tasks')
    .select(
      'id, task_key, title, title_params, status, actions!action_tasks_action_id_fkey!inner(category, priority_score, due_date)',
    )
    .in(
      'id',
      states.map((row) => row.action_task_id),
    );
  if (tasksError) throw new Error(tasksError.message);
  const byId = new Map(((tasks ?? []) as unknown as TaskRow[]).map((task) => [task.id, task]));
  for (const state of states) {
    const task = byId.get(state.action_task_id);
    if (!task || !state.run_id) continue;
    const stored = (STATUSES as readonly string[]).includes(state.chat_status)
      ? (state.chat_status as ChatTaskStatus)
      : 'queued';
    const due = task.actions?.due_date ?? null;
    const row: ChatTaskRow = {
      at: 0,
      title: titleOfTask(task),
      priority:
        typeof task.actions?.priority_score === 'number'
          ? Math.round(task.actions.priority_score)
          : null,
      category: (ACTION_CATEGORIES as readonly unknown[]).includes(task.actions?.category)
        ? (task.actions!.category as ActionCategory)
        : null,
      // Done only as Action Center has it: the person's click (§B item 6).
      status: task.status === 'completed' ? 'done' : stored === 'done' ? 'queued' : stored,
      ...(due ? { due } : {}),
    };
    const strip = strips.get(state.run_id) ?? { tasks: [], ready: 0, total: 0, due: 0 };
    row.at = strip.tasks.length + 1;
    strip.tasks.push(row);
    strip.total += 1;
    if (row.status === 'ready_for_review' || row.status === 'done') strip.ready += 1;
    if (due && due <= weekEnd) strip.due += 1;
    strips.set(state.run_id, strip);
  }
  return strips;
}

// ─── Deliverables and their tasks (CHAT-09 items 12–16, W2-12) ──────────────

/** A deliverable's task, as its card reads it: its words, and whether Action Center has it done. */
export interface DeliverableTask {
  title: string;
  state: 'open' | 'done';
}

const taskOf = (task: Pick<TaskRow, 'task_key' | 'title' | 'title_params' | 'status'>) => ({
  title: titleOfTask(task),
  state: task.status === 'completed' ? ('done' as const) : ('open' as const),
});

/**
 * The task a deliverable a /tasks run filed is for (CHAT-09 item 12), kept as
 * chat_task_state.file_id: one of the strip's tasks this run is writing, of
 * the action it opened last (get_action). Only when that is certain: the
 * one such task, or, for a page draft, the one with a draft to write; else
 * none, and the person picks with Attach only. Its task, or null.
 */
export async function linkDeliverable(
  db: Db,
  conversationId: string,
  runId: string,
  actionId: string,
  fileId: string,
  isDraft: boolean,
): Promise<DeliverableTask | null> {
  const { data: rows, error } = await supabaseAdmin
    .from('chat_task_state')
    .select('action_task_id')
    .eq('conversation_id', conversationId)
    .eq('run_id', runId)
    .eq('chat_status', 'writing')
    .is('file_id', null);
  if (error) throw new Error(error.message);
  const ids = ((rows ?? []) as { action_task_id: string }[]).map((row) => row.action_task_id);
  if (ids.length === 0) return null;
  const { data: tasks, error: tasksError } = await db
    .from('action_tasks')
    .select('id, task_key, title, title_params, status')
    .eq('action_id', actionId)
    .in('id', ids);
  if (tasksError) throw new Error(tasksError.message);
  let candidates = (tasks ?? []) as (TaskRow & { id: string })[];
  if (candidates.length > 1 && isDraft) {
    candidates = candidates.filter((task) => draftMethodForTask(task.task_key) !== null);
  }
  if (candidates.length !== 1) return null;
  const [task] = candidates;
  const { error: linkError } = await supabaseAdmin
    .from('chat_task_state')
    .update({ file_id: fileId })
    .eq('conversation_id', conversationId)
    .eq('action_task_id', task.id)
    .is('file_id', null);
  if (linkError) throw new Error(linkError.message);
  return taskOf(task);
}

/**
 * The tasks of a chat's deliverables, by file, as their cards show them
 * after a reload: the task its run drafted it for (chat_task_state.file_id),
 * else the one task it was attached to. Read through `db`: the person's
 * session, so only the tasks they may see.
 */
export async function readDeliverableTasks(
  db: Db,
  conversationId: string,
  fileIds: readonly string[],
): Promise<Map<string, DeliverableTask>> {
  const out = new Map<string, DeliverableTask>();
  if (fileIds.length === 0) return out;
  const [states, links] = await Promise.all([
    db
      .from('chat_task_state')
      .select('action_task_id, file_id')
      .eq('conversation_id', conversationId)
      .in('file_id', [...fileIds]),
    db
      .from('chat_file_task_links')
      .select('action_task_id, file_id')
      .in('file_id', [...fileIds]),
  ]);
  if (states.error) throw new Error(states.error.message);
  if (links.error) throw new Error(links.error.message);
  const taskOfFile = new Map<string, string>();
  const linked = new Map<string, string[]>();
  for (const row of (links.data ?? []) as { action_task_id: string; file_id: string }[]) {
    linked.set(row.file_id, [...(linked.get(row.file_id) ?? []), row.action_task_id]);
  }
  for (const [fileId, taskIds] of linked)
    if (taskIds.length === 1) taskOfFile.set(fileId, taskIds[0]);
  // What the run drafted it for comes first.
  for (const row of (states.data ?? []) as { action_task_id: string; file_id: string }[]) {
    taskOfFile.set(row.file_id, row.action_task_id);
  }
  if (taskOfFile.size === 0) return out;
  const { data: tasks, error } = await db
    .from('action_tasks')
    .select('id, task_key, title, title_params, status')
    .in('id', [...new Set(taskOfFile.values())]);
  if (error) throw new Error(error.message);
  const byId = new Map(((tasks ?? []) as (TaskRow & { id: string })[]).map((t) => [t.id, t]));
  for (const [fileId, taskId] of taskOfFile) {
    const task = byId.get(taskId);
    if (task) out.set(fileId, taskOf(task));
  }
  return out;
}
