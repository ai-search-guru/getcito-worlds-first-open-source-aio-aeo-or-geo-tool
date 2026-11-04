'use server';

import { z } from 'zod';
import { writeTaskStatus, type EventData } from '@/lib/action-center/taskStatus';
import type { TaskStatus } from '@/lib/action-center/registry';
import { attachFileToTask } from '@/lib/actions/chatActionCenter';
import type { ChatTaskStrip } from '@/lib/chat/events';
import { readStrips, titleOfTask, weekEndIn, type DeliverableTask } from '@/lib/chat/taskStrip';
import { isManager } from '@/lib/sessionRole';
import { assertWritable, SUBSCRIPTION_INACTIVE } from '@/lib/subscriptionGuard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * The person's own clicks on a deliverable's card (CHAT-09 items 13, 16):
 * Attach to task & mark done, Attach only, and the Undo of a mark done.
 * Never Chat's: no model tool reaches these (item 15), and the task is
 * closed only here, by the person, through the Action Center's own write
 * (writeTaskStatus, as the drawer's tick), with their session as the actor
 * and Chat as the source in History. A card names its file by its run and
 * place (`runId`, `n`), as its download does: no id reaches the browser.
 * The run must be of the person's own chat; Admins and Managers only, as
 * every Chat change to Action Center (W2-10); a read-only workspace changes
 * nothing. Answers as values, never thrown (#1777).
 */

export type TaskCardFailure =
  'read_only' | 'not_found' | 'forbidden' | 'closed' | 'changed' | 'failed';

export type TaskCardResult =
  | {
      ok: true;
      /** The file's status now: draft, attached to the task, or done with it. */
      status: 'draft' | 'attached' | 'done';
      task: DeliverableTask;
      /** The card's run's task strip as it stands, when the task is in it. */
      strip: ChatTaskStrip | null;
    }
  | { ok: false; failure: TaskCardFailure };

/** How long the mark done's Undo stays (its toast's, with room to spare). */
const UNDO_MS = 60 * 60 * 1000;

const runIdSchema = z.guid();
const placeSchema = z.number().int().min(1).max(100);

type Client = Awaited<ReturnType<typeof createClient>>;

interface CardTask {
  supabase: Client;
  userId: string;
  conversationId: string;
  file: { id: string; status: 'draft' | 'attached' | 'done'; brand_id: string | null };
  task: {
    id: string;
    action_id: string;
    task_key: string | null;
    title: string | null;
    title_params: unknown;
    status: string;
    skip_reason: string | null;
    actions: { brand_id: string; status: string } | null;
  };
  /** The run whose strip holds the task, when one does. */
  stripRun: string | null;
}

const failure = (failure: TaskCardFailure) => ({ ok: false as const, failure });

function refusal(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return failure(code === SUBSCRIPTION_INACTIVE.code ? 'read_only' : 'failed');
}

function logFailure(what: string, error: unknown) {
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
  console.error(`[chat/task-card] could not ${what}:`, message ?? error);
}

/**
 * The card's file and its task: the run's n-th deliverable (readRunFile's
 * order), of the person's own chat, and the task its run drafted it for
 * (chat_task_state.file_id), else the one task it is attached to. The task
 * is read as the person: one of a brand they don't see isn't found.
 */
async function cardTask(runId: unknown, n: unknown): Promise<CardTask | null> {
  const run = runIdSchema.safeParse(runId);
  const place = placeSchema.safeParse(n);
  if (!run.success || !place.success) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: runRow, error: runError } = await supabaseAdmin
    .from('chat_runs')
    .select('conversation_id')
    .eq('id', run.data)
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!runRow?.conversation_id) return null;
  const { data: chat, error: chatError } = await supabase
    .from('chat_conversations')
    .select('id, user_id, deleted_at')
    .eq('id', runRow.conversation_id)
    .maybeSingle();
  if (chatError) throw new Error(chatError.message);
  // A teammate's shared chat is theirs: its cards change nothing for this person.
  if (!chat || chat.user_id !== user.id || chat.deleted_at) return null;
  const { data: files, error: filesError } = await supabaseAdmin
    .from('chat_files')
    .select('id, status, brand_id')
    .eq('run_id', run.data)
    .is('message_id', null)
    .order('created_at', { ascending: true });
  if (filesError) throw new Error(filesError.message);
  const file = ((files ?? []) as CardTask['file'][])[place.data - 1];
  if (!file) return null;
  const [{ data: state, error: stateError }, { data: links, error: linksError }] =
    await Promise.all([
      supabaseAdmin
        .from('chat_task_state')
        .select('action_task_id, run_id')
        .eq('conversation_id', chat.id)
        .eq('file_id', file.id)
        .maybeSingle(),
      supabaseAdmin
        .from('chat_file_task_links')
        .select('action_task_id')
        .eq('file_id', file.id)
        .limit(2),
    ]);
  if (stateError) throw new Error(stateError.message);
  if (linksError) throw new Error(linksError.message);
  const linked = (links ?? []) as { action_task_id: string }[];
  const taskId =
    (state as { action_task_id: string } | null)?.action_task_id ??
    (linked.length === 1 ? linked[0].action_task_id : null);
  if (!taskId) return null;
  const { data: task, error: taskError } = await supabase
    .from('action_tasks')
    .select(
      'id, action_id, task_key, title, title_params, status, skip_reason, actions!action_tasks_action_id_fkey!inner(brand_id, status)',
    )
    .eq('id', taskId)
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task) return null;
  const { data: stripRow, error: stripError } = await supabaseAdmin
    .from('chat_task_state')
    .select('run_id')
    .eq('conversation_id', chat.id)
    .eq('action_task_id', taskId)
    .maybeSingle();
  if (stripError) throw new Error(stripError.message);
  return {
    supabase,
    userId: user.id,
    conversationId: chat.id as string,
    file,
    task: task as unknown as CardTask['task'],
    stripRun: (stripRow as { run_id: string | null } | null)?.run_id ?? null,
  };
}

/** The card's run's strip, when its task is in it: the strip the card sits under. */
async function stripOf(card: CardTask, runId: string): Promise<ChatTaskStrip | null> {
  if (card.stripRun !== runId) return null;
  const { data: answer } = await card.supabase
    .from('chat_messages')
    .select('timezone')
    .eq('conversation_id', card.conversationId)
    .eq('role', 'assistant')
    .not('timezone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const weekEnd = weekEndIn(new Date(), (answer?.timezone as string | undefined) ?? 'UTC');
  return (await readStrips(card.supabase, card.conversationId, weekEnd, runId)).get(runId) ?? null;
}

const CLOSED_ACTIONS = ['completed', 'dismissed'];

/**
 * Whether the person may change the card's task: its brand is one they may
 * use (brand access, can_access_brand, as W2-10's writes check it; the task
 * read above sees the whole workspace's), and the file is of that brand.
 */
async function brandUsable(card: CardTask): Promise<boolean> {
  const brandId = card.task.actions?.brand_id;
  if (!brandId) return false;
  if (card.file.brand_id && card.file.brand_id !== brandId) return false;
  const { data, error } = await card.supabase.rpc('can_access_brand', { p_brand_id: brandId });
  if (error) throw new Error(error.message);
  return data === true;
}

/** The brand's own plan check (a demo brand changes nothing): before any write. */
async function brandWritable(card: CardTask) {
  try {
    await assertWritable({ brandId: card.task.actions!.brand_id });
    return null;
  } catch (error) {
    return refusal(error);
  }
}

/**
 * Attach to task & mark done (CHAT-09 item 13): the file linked to its task
 * by the person, the file done, and the task completed through the Action
 * Center's own write, the person as the actor and Chat as the source; the
 * action's progress moves as a tick in Action Center moves it. What was
 * there before is kept in the event, for its Undo.
 */
export async function markTaskDoneFromCard(runId: string, n: number): Promise<TaskCardResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  try {
    const card = await cardTask(runId, n);
    if (!card) return failure('not_found');
    if (!(await isManager(card.supabase))) return failure('forbidden');
    if (!(await brandUsable(card))) return failure('not_found');
    const refused = await brandWritable(card);
    if (refused) return refused;
    const { task, file } = card;
    const actionStatus = task.actions?.status ?? '';
    if (CLOSED_ACTIONS.includes(actionStatus)) return failure('closed');
    const { data: made, error: linkError } = await supabaseAdmin
      .from('chat_file_task_links')
      .upsert(
        { file_id: file.id, action_task_id: task.id, attached_by: card.userId },
        { onConflict: 'file_id,action_task_id', ignoreDuplicates: true },
      )
      .select('file_id');
    if (linkError) throw new Error(linkError.message);
    if (file.status !== 'done') {
      const { error } = await supabaseAdmin
        .from('chat_files')
        .update({ status: 'done' })
        .eq('id', file.id);
      if (error) throw new Error(error.message);
    }
    if (task.status !== 'completed') {
      const data: EventData = {
        source: 'chat',
        from: task.status,
        ...(task.status === 'skipped' && task.skip_reason ? { skipReason: task.skip_reason } : {}),
        fileId: file.id,
        fileFrom: file.status,
        linked: (made ?? []).length > 0,
        actionStatus,
        conversationId: card.conversationId,
        runId,
      };
      // Of two clicks at once, the one that completes it is in History.
      await writeTaskStatus(
        card.supabase,
        { brandId: task.actions!.brand_id, actionId: task.action_id, taskId: task.id },
        'completed',
        { data, onlyIfChanged: true },
      );
    }
    return {
      ok: true,
      status: 'done',
      task: { title: titleOfTask(task), state: 'done' },
      strip: await stripOf(card, runId),
    };
  } catch (error) {
    logFailure('mark the task done', error);
    return failure('failed');
  }
}

/**
 * Attach only (CHAT-09 item 16): the file linked to its task and
 * `attached`, the task left open, through W2-10's attach (History from
 * Chat, with the card's chat and run, as a mark done's).
 */
export async function attachOnlyFromCard(runId: string, n: number): Promise<TaskCardResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  try {
    const card = await cardTask(runId, n);
    if (!card) return failure('not_found');
    if (!(await isManager(card.supabase))) return failure('forbidden');
    const { task, file } = card;
    if (CLOSED_ACTIONS.includes(task.actions?.status ?? '')) return failure('closed');
    const attached = await attachFileToTask(task.actions!.brand_id, task.id, file.id, {
      conversationId: card.conversationId,
      runId,
    });
    if (!attached.ok) {
      return failure(
        attached.reason === 'forbidden_role'
          ? 'forbidden'
          : attached.reason === 'not_found'
            ? 'not_found'
            : attached.reason === 'conflict'
              ? 'closed'
              : 'failed',
      );
    }
    return {
      ok: true,
      status: file.status === 'done' ? 'done' : 'attached',
      task: { title: titleOfTask(task), state: task.status === 'completed' ? 'done' : 'open' },
      strip: await stripOf(card, runId),
    };
  } catch (error) {
    logFailure('attach the file', error);
    return failure('failed');
  }
}

interface DoneEvent {
  created_at: string;
  event: string;
  data: Record<string, unknown> | null;
}

/**
 * The Undo of a mark done from its card: the task back to what it was, the
 * file back to its status, and the link off when the click made it, each
 * through the same writes, as a new History event (source Chat, via Undo).
 * Only while nothing happened since: the action's latest History event is
 * still that mark done, the task still completed and the action's status
 * what it was. Anything else is the person's to sort out in Action Center
 * (`changed`), as W2-10's Undo answers.
 */
export async function undoTaskDoneFromCard(runId: string, n: number): Promise<TaskCardResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  try {
    const card = await cardTask(runId, n);
    if (!card) return failure('not_found');
    if (!(await isManager(card.supabase))) return failure('forbidden');
    if (!(await brandUsable(card))) return failure('not_found');
    const refused = await brandWritable(card);
    if (refused) return refused;
    const { task, file } = card;
    const { data: events, error } = await card.supabase
      .from('action_events')
      .select('created_at, event, data')
      .eq('action_id', task.action_id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const last = ((events ?? []) as DoneEvent[])[0];
    const data = last?.data ?? {};
    const ours =
      last?.event === 'task_status' &&
      data.source === 'chat' &&
      data.via !== 'undo' &&
      data.to === 'completed' &&
      data.taskId === task.id &&
      data.fileId === file.id &&
      Date.now() - Date.parse(last.created_at) <= UNDO_MS;
    if (
      !ours ||
      task.status !== 'completed' ||
      (task.actions?.status ?? '') !== data.actionStatus
    ) {
      return failure('changed');
    }
    const from = (typeof data.from === 'string' ? data.from : 'todo') as TaskStatus;
    await writeTaskStatus(
      card.supabase,
      { brandId: task.actions!.brand_id, actionId: task.action_id, taskId: task.id },
      from,
      {
        // A skipped task goes back with its why.
        skipReason:
          from === 'skipped' && typeof data.skipReason === 'string' ? data.skipReason : null,
        data: { source: 'chat', via: 'undo', fileId: file.id },
        // Of two Undos at once, the one that puts it back is in History.
        onlyIfChanged: true,
      },
    );
    const fileFrom =
      data.fileFrom === 'draft' || data.fileFrom === 'attached' ? data.fileFrom : 'done';
    if (fileFrom !== 'done') {
      const { error: fileError } = await supabaseAdmin
        .from('chat_files')
        .update({ status: fileFrom })
        .eq('id', file.id)
        .eq('status', 'done');
      if (fileError) throw new Error(fileError.message);
    }
    if (data.linked === true) {
      const { error: linkError } = await supabaseAdmin
        .from('chat_file_task_links')
        .delete()
        .eq('file_id', file.id)
        .eq('action_task_id', task.id);
      if (linkError) throw new Error(linkError.message);
    }
    return {
      ok: true,
      status: fileFrom,
      task: { title: titleOfTask(task), state: 'open' },
      strip: await stripOf(card, runId),
    };
  } catch (error) {
    logFailure('undo the mark done', error);
    return failure('failed');
  }
}
