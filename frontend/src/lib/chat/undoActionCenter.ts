import { readMemberEmails } from '@/lib/memberEmails';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { summaryValue } from './activity';
import type { UndoRule, WriteRecord } from './undo';
import { DAY_MS, asObject, check, textOf } from './undoParts';

/**
 * Undo for Chat's Action Center changes (CHAT-20 §9 rows 43–46, §10b): the
 * action it sent (24 hours, while no task has started: the action is
 * cancelled), the finding it added to an action (24 hours: withdrawn), a
 * file it attached to a task (7 days: taken off) and a task it set to Ready
 * for review (7 days: back to what the chat had). Action History stays
 * immutable: each Undo is a new event in it, by who clicked Undo, with
 * source `chat`. Anything changed since is the person's to sort out by hand
 * (`changed`). The inverses write with the service role, as undo.ts's do,
 * after Undo's own checks. Server only.
 */

const ACTION_HREF = (id: string) => `/dashboard/action-center/actions/${id}` as const;

/** A History event of Chat's Undo, by who clicked it; logged, not thrown, once the inverse ran. */
async function historyEvent(
  actionId: string,
  event: string,
  userId: string | undefined,
  data: Record<string, string | null>,
) {
  const { error } = await supabaseAdmin.from('action_events').insert({
    action_id: actionId,
    event,
    actor_id: userId ?? null,
    data: { source: 'chat', via: 'undo', ...data },
  });
  if (error) console.error('[chat/undo] Action History missed an Undo:', error.message);
}

/** An action as Undo checks it; null when it is gone (deleted, or not there). */
async function readAction(id: string, brandId: string | null) {
  let read = supabaseAdmin
    .from('actions')
    .select('id, brand_id, action_no, status, deleted_at')
    .eq('id', id);
  if (brandId) read = read.eq('brand_id', brandId);
  const { data, error } = await read.maybeSingle();
  check(error, 'the action');
  const row = data as {
    id: string;
    action_no: number;
    status: string;
    deleted_at: string | null;
  } | null;
  return row && !row.deleted_at ? row : null;
}

const ok = (output: unknown) => {
  const result = asObject(output);
  return result.ok === true ? result : null;
};

// ─── create_action: cancel it while nothing happened to it (§10b, 24 hours) ──

/** Who clicked Undo, as History names them: their name, else their e-mail. */
async function personName(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();
    const name = (data?.full_name as string | null | undefined)?.trim();
    if (name) return name;
    return (await readMemberEmails([userId])).get(userId) ?? null;
  } catch {
    return null;
  }
}

const createAction: UndoRule = {
  targetType: 'action',
  windowMs: DAY_MS,
  async before() {
    return null; // Nothing to read: the action is new.
  },
  async record(input, output): Promise<WriteRecord> {
    const made = ok(output);
    const id = textOf(made?.action_id);
    return {
      target: { type: 'action', id },
      summaryParams: {
        title: summaryValue(asObject(input).title),
        no: made ? `AC-${made.action_no}` : '',
      },
      // The same approval again made nothing new: nothing to cancel.
      undo: id && made?.created === true ? { after: { status: 'new' } } : null,
    };
  },
  async inverse({ id, brandId, userId }) {
    const action = await readAction(id, brandId);
    if (!action) return 'gone';
    // Picked up since: it's the team's now.
    if (action.status !== 'new') return 'changed';
    const [{ data: tasks, error }, { data: events, error: eventsError }] = await Promise.all([
      supabaseAdmin.from('action_tasks').select('status').eq('action_id', id),
      supabaseAdmin.from('action_events').select('event').eq('action_id', id),
    ]);
    check(error, "the action's tasks");
    check(eventsError, "the action's History");
    if ((tasks ?? []).some((task) => task.status !== 'todo')) return 'changed';
    // Assigned, edited, a task added, a finding or a file attached since: no longer as sent.
    if ((events ?? []).some((event) => event.event !== 'created')) return 'changed';
    const now = new Date().toISOString();
    // Dismissed, as the person would: it stays in the Dismissed list, with why in History.
    const { data: cancelled, error: cancelError } = await supabaseAdmin
      .from('actions')
      .update({ status: 'dismissed', completed_at: null, updated_at: now })
      .eq('id', id)
      .eq('status', 'new')
      .is('deleted_at', null)
      .select('id');
    if (cancelError) throw new Error(`Could not cancel the action: ${cancelError.message}`);
    if ((cancelled ?? []).length === 0) return 'changed';
    await historyEvent(id, 'cancelled', userId, { from: 'new', by: await personName(userId) });
    return 'ok';
  },
  href: ACTION_HREF,
};

// ─── attach_to_action: withdraw the finding (§9, 24 hours) ──────────────────

const attachToAction: UndoRule = {
  targetType: 'action',
  windowMs: DAY_MS,
  async before() {
    return null;
  },
  async record(input, output): Promise<WriteRecord> {
    const made = ok(output);
    const eventId = textOf(made?.event_id);
    return {
      target: { type: 'action', id: textOf(made?.action_id) },
      summaryParams: {
        no: made ? `AC-${made.action_no}` : '',
        finding: summaryValue(asObject(input).finding),
      },
      undo: eventId ? { after: { eventId } } : null,
    };
  },
  async inverse({ id, brandId, data, userId }) {
    const action = await readAction(id, brandId);
    if (!action) return 'gone';
    const eventId = textOf(asObject(data.after).eventId);
    const { data: events, error } = await supabaseAdmin
      .from('action_events')
      .select('id, event, data')
      .eq('action_id', id)
      .in('event', ['evidence_attached', 'evidence_withdrawn']);
    check(error, "the action's History");
    const rows = (events ?? []) as { id: string; event: string; data: unknown }[];
    if (!rows.some((row) => row.id === eventId)) return 'gone';
    if (
      rows.some(
        (row) => row.event === 'evidence_withdrawn' && asObject(row.data).eventId === eventId,
      )
    ) {
      return 'changed';
    }
    // Says which finding went: the one its event added.
    const finding = textOf(asObject(rows.find((row) => row.id === eventId)?.data).finding);
    await historyEvent(id, 'evidence_withdrawn', userId, { eventId, finding });
    return 'ok';
  },
  href: ACTION_HREF,
};

// ─── attach_file_to_task: take the file off the task (§9, 7 days) ───────────

/**
 * A task's action, its number and how it is named in History; null when it
 * isn't the logged brand's (the service role reads past the policies).
 */
async function readTask(taskId: string, brandId: string | null = null) {
  const { data, error } = await supabaseAdmin
    .from('action_tasks')
    .select('id, action_id, task_key, title, status, actions!inner(action_no, brand_id)')
    .eq('id', taskId)
    .maybeSingle();
  check(error, 'the task');
  const row = data as {
    id: string;
    action_id: string;
    task_key: string | null;
    title: string | null;
    status: string;
    actions: { action_no: number; brand_id: string } | null;
  } | null;
  return row && (!brandId || row.actions?.brand_id === brandId) ? row : null;
}

/** A task as the Activity log names it: "AC-1258 “Add a pricing FAQ…”". */
const taskWords = (task: Awaited<ReturnType<typeof readTask>>) =>
  task
    ? [
        task.actions ? `AC-${task.actions.action_no}` : null,
        task.title?.trim() ? `“${task.title.trim()}”` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : '';

const attachFileToTask: UndoRule = {
  targetType: 'action_task',
  windowMs: 7 * DAY_MS,
  async before() {
    return null;
  },
  async record(input, output): Promise<WriteRecord> {
    const made = ok(output);
    const fileId = textOf(made?.file_id);
    const taskId = textOf(made?.task_id) ?? textOf(asObject(input).task_id);
    const [file, task] = await Promise.all([
      fileId
        ? supabaseAdmin.from('chat_files').select('title').eq('id', fileId).maybeSingle()
        : null,
      taskId ? readTask(taskId) : null,
    ]);
    return {
      target: { type: 'action_task', id: taskId },
      summaryParams: {
        file: summaryValue(file?.data?.title),
        task: summaryValue(taskWords(task)),
      },
      // Attached already: this change linked nothing new.
      undo:
        fileId && made?.already !== true
          ? {
              after: { fileId, actionId: textOf(made?.action_id), file: file?.data?.title ?? null },
            }
          : null,
    };
  },
  async inverse({ id, brandId, data, userId }) {
    const after = asObject(data.after);
    const fileId = textOf(after.fileId);
    if (!fileId) return 'gone';
    const [{ data: file, error: fileError }, task] = await Promise.all([
      supabaseAdmin.from('chat_files').select('id, status').eq('id', fileId).maybeSingle(),
      readTask(id, brandId),
    ]);
    check(fileError, 'the file');
    if (!file || !task) return 'gone';
    // Marked done with it since (Attach to task & mark done): the person's now.
    if (file.status === 'done' || task.status === 'completed') return 'changed';
    const { data: removed, error } = await supabaseAdmin
      .from('chat_file_task_links')
      .delete()
      .eq('file_id', fileId)
      .eq('action_task_id', id)
      .select('file_id');
    if (error) throw new Error(`Could not take the file off the task: ${error.message}`);
    if ((removed ?? []).length === 0) return 'gone';
    // Back to a draft, unless another task still has it.
    const { count, error: countError } = await supabaseAdmin
      .from('chat_file_task_links')
      .select('file_id', { count: 'exact', head: true })
      .eq('file_id', fileId);
    check(countError, "the file's tasks");
    if ((count ?? 0) === 0) {
      const { error: statusError } = await supabaseAdmin
        .from('chat_files')
        .update({ status: 'draft' })
        .eq('id', fileId)
        .eq('status', 'attached');
      if (statusError) throw new Error(`Could not set the file back: ${statusError.message}`);
    }
    await historyEvent(task.action_id, 'file_detached', userId, {
      taskId: id,
      task: task.task_key,
      title: task.title,
      fileId,
      file: textOf(after.file),
    });
    return 'ok';
  },
  // Its action, on the Actions page: a task has no page of its own.
  href: () => '/dashboard/action-center/actions',
};

// ─── set_task_ready_for_review: back to what the chat had (§9, 7 days) ──────

const setTaskReadyForReview: UndoRule = {
  targetType: 'action_task',
  windowMs: 7 * DAY_MS,
  async before() {
    return null; // The chat's status before comes with the change's answer.
  },
  async record(input, output): Promise<WriteRecord> {
    const made = ok(output);
    const taskId = textOf(made?.task_id) ?? textOf(asObject(input).task_id);
    const task = taskId ? await readTask(taskId) : null;
    const previous = made ? textOf(made.previous) : null;
    const changed = made && previous !== 'ready_for_review' && previous !== 'done';
    return {
      target: { type: 'action_task', id: taskId },
      summaryParams: { task: summaryValue(taskWords(task)) },
      undo: changed
        ? {
            before: { status: previous },
            after: {
              status: 'ready_for_review',
              conversationId: textOf(made.conversation_id),
              actionId: textOf(made.action_id),
            },
          }
        : null,
    };
  },
  async inverse({ id, data, userId }) {
    const before = asObject(data.before);
    const after = asObject(data.after);
    const conversationId = textOf(after.conversationId);
    if (!conversationId) return 'gone';
    const { data: state, error } = await supabaseAdmin
      .from('chat_task_state')
      .select('chat_status')
      .eq('conversation_id', conversationId)
      .eq('action_task_id', id)
      .maybeSingle();
    check(error, "the chat's task");
    if (!state) return 'gone';
    if (state.chat_status !== 'ready_for_review') return 'changed';
    const previous = textOf(before.status);
    const write = previous
      ? supabaseAdmin
          .from('chat_task_state')
          .update({ chat_status: previous })
          .eq('conversation_id', conversationId)
          .eq('action_task_id', id)
          .eq('chat_status', 'ready_for_review')
      : supabaseAdmin
          .from('chat_task_state')
          .delete()
          .eq('conversation_id', conversationId)
          .eq('action_task_id', id)
          .eq('chat_status', 'ready_for_review');
    const { data: done, error: writeError } = await write.select('action_task_id');
    if (writeError) throw new Error(`Could not take Ready for review back: ${writeError.message}`);
    if ((done ?? []).length === 0) return 'changed';
    const task = await readTask(id);
    if (task) {
      await historyEvent(task.action_id, 'task_review_withdrawn', userId, {
        taskId: id,
        task: task.task_key,
        title: task.title,
      });
    }
    return 'ok';
  },
  // Its action, on the Actions page: a task has no page of its own.
  href: () => '/dashboard/action-center/actions',
};

/** The Action Center rows' Undo, by tool name (undo.ts UNDO_RULES). */
export const ACTION_CENTER_UNDO_RULES: Readonly<Record<string, UndoRule>> = {
  create_action: createAction,
  attach_to_action: attachToAction,
  attach_file_to_task: attachFileToTask,
  set_task_ready_for_review: setTaskReadyForReview,
};
