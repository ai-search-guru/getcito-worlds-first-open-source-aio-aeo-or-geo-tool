'use server';

/**
 * Action Center actions — reads and execution writes.
 *
 * Rows are produced nightly by the server's generator (consolidating open
 * signals); this module reads them and carries the user's execution work:
 * status changes, assignment, due dates, task progress. Every mutation logs
 * an action_event, which is what the drawer's History tab shows — the trail
 * is written as it happens, not reconstructed.
 */

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import {
  ACTION_DISMISS_REASONS,
  type ActionCategory,
  type ActionDismissReason,
  type ActionImpact,
  missingDismissReason,
  taskProgress,
  type ActionStatus,
  type TaskStatus,
} from '@/lib/action-center/registry';
import { SIGNAL_ROW_COLUMNS, mapSignalRows, type Signal, type SignalRow } from '@/lib/signals/map';
import { OPEN_SIGNAL_STATUSES, type SignalStatus } from '@/lib/signals/registry';
import { readPromptPlaces } from '@/lib/signals/promptPlaces';
import {
  affectedOf,
  affectedSignals,
  affectedSummary,
  type KeptEntity,
} from '@/lib/action-center/affected';
import { readPromptDemand } from '@/lib/action-center/promptDemand';
import type { VolumeEstimate } from '@/lib/volumeEstimate';
import { readAssignees } from '@/lib/action-center/assignees';
import {
  currentTaskParams,
  readEntityCounts,
  readKeptEntities,
  readKeptEntityLists,
  withEntityCounts,
  withoutTargetIds,
} from '@/lib/action-center/entityCounts';
import {
  ACTION_COLUMNS,
  EVENT_COLUMNS,
  TASK_COLUMNS,
  actionItemFromRow,
  eventFromRow,
  kpiFromRow,
  taskFromRow,
  type ActionRow,
} from '@/lib/action-center/rows';
import type { KpiTimeframe } from '@/lib/kpis/registry';
import { parseImproveOutcome, type ImproveOutcome } from '@/lib/improveOutcome';
import {
  cleanTaskDetailsEdit,
  isTaskDetailsEdit,
  type ActionTaskDetails,
  type TaskDetailsEdit,
} from '@/lib/action-center/taskDetails';
import type { PriorityLevel, PriorityReason } from '@/lib/action-center/priority';
import type { CompetitorFindings } from '@/lib/action-center/competitorFindings';
import type { WinningFindings } from '@/lib/action-center/winningFindings';
import { assertWritable } from '@/lib/subscriptionGuard';
import { canAccessBrand } from '@/lib/brandAccess';
import { logEvent, touchAction, writeTaskStatus } from '@/lib/action-center/taskStatus';
import { readTaskAttachments, type TaskAttachment } from '@/lib/action-center/chatAttachments';

export interface ActionAssignee {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  /** What names a member with no full name (most have none); see readAssignees. */
  email?: string | null;
}

export interface ActionItem {
  id: string;
  actionNo: number;
  category: ActionCategory;
  /**
   * The server definition's id. Not narrowed to the kinds this build has copy
   * for: the definition registry grows on its own release cycle, and an
   * action we cannot name is still an action someone has to do.
   */
  kind: string;
  impact: ActionImpact;
  status: ActionStatus;
  payload: Record<string, unknown>;
  kpiKeys: string[];
  assignee: ActionAssignee | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  taskTotal: number;
  taskCompleted: number;
  signalCount: number;
  /**
   * When the nightly pass found it New with no one's event for a month
   * (00432); null when it isn't stale. Shown only while the action is New.
   */
  staleAt?: string | null;
  /** 0–100 (AC-006); null until the server has scored the action. */
  priorityScore: number | null;
  priorityLevel: PriorityLevel | null;
  priorityReason: PriorityReason | null;
}

export async function getActions(brandId: string): Promise<ActionItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('actions')
    .select(ACTION_COLUMNS)
    .eq('brand_id', brandId)
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ActionRow[];
  if (rows.length === 0) return [];

  const actionIds = rows.map((row) => row.id);
  const assigneeIds = [...new Set(rows.map((row) => row.assignee_id).filter(Boolean))] as string[];

  const [tasksRes, signalsRes, profiles, entityCounts] = await Promise.all([
    supabase.from('action_tasks').select('action_id, status').in('action_id', actionIds),
    // The signals that support each action now (AC-007): its open ones.
    supabase
      .from('signals')
      .select('action_id')
      .eq('brand_id', brandId)
      .in('status', OPEN_SIGNAL_STATUSES as SignalStatus[])
      .not('action_id', 'is', null),
    // Other members' profiles are hidden from the user (RLS): read as the team list reads them.
    readAssignees(supabase, brandId, assigneeIds),
    // Each action's list (AC-009): its count less what was removed since.
    readEntityCounts(supabase, actionIds),
  ]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (signalsRes.error) throw new Error(signalsRes.error.message);

  const taskStatuses = new Map<string, string[]>();
  for (const task of tasksRes.data ?? []) {
    const statuses = taskStatuses.get(task.action_id) ?? [];
    statuses.push(task.status);
    taskStatuses.set(task.action_id, statuses);
  }
  const signalCounts = new Map<string, number>();
  for (const signal of signalsRes.data ?? []) {
    if (!signal.action_id) continue;
    signalCounts.set(signal.action_id, (signalCounts.get(signal.action_id) ?? 0) + 1);
  }
  return rows.map((row) => {
    const progress = taskProgress(taskStatuses.get(row.id) ?? []);
    return actionItemFromRow(row, {
      assignee: row.assignee_id ? (profiles.get(row.assignee_id) ?? null) : null,
      taskTotal: progress.total,
      taskCompleted: progress.completed,
      signalCount: signalCounts.get(row.id) ?? 0,
      entityCounts: entityCounts.get(row.id),
    });
  });
}

export interface ActionTask {
  id: string;
  position: number;
  /** Template key for a generated task; null once someone renames or adds one. */
  taskKey: string | null;
  /** User-supplied text. Takes precedence over the template when present. */
  title: string | null;
  status: TaskStatus;
  /**
   * Values the task's text names — the platform, the competitor, the count.
   * Parameters rather than resolved text, so a planned task stays
   * translatable; empty when the task names nothing specific.
   */
  titleParams: Record<string, string | number>;
  /** Task keys within the same action that must finish first. */
  dependsOn: string[];
  /** Why the task was skipped; null for every other status. */
  skipReason: string | null;
  /**
   * What the task carries beyond its title: where, why, how, done-when, type
   * and effort (AC-004), and for a task sent from the Improve tab its body,
   * platform and evidence (PROMPT-004). Null when it carries nothing.
   */
  details: ActionTaskDetails | null;
  /** What Analyze competitor content found, once it ran (learning C1). */
  competitorFindings?: CompetitorFindings | null;
  /** What Find what sets your winning pages apart found, once it ran (learning C4). */
  winningFindings?: WinningFindings | null;
  /** Files and drafts Chat attached to it (CHAT-09 items 13, 16): "Attached from Chat". */
  attachments?: TaskAttachment[];
}

export interface ActionEvent {
  id: string;
  event: string;
  data: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
}

export interface ActionKpiRef {
  kpiKey: string;
  target: number;
  timeframe: KpiTimeframe;
}

export interface ActionDetail {
  tasks: ActionTask[];
  signals: Signal[];
  /** What it kept when it was created and still has (00244): its Affected rows; null unread. */
  entities?: KeptEntity[] | null;
  events: ActionEvent[];
  kpis: ActionKpiRef[];
  /** Improve actions only: positions now next to the baseline (PROMPT-008). */
  positionOutcome: ImproveOutcome | null;
  /** Sent from Chat: its chat, when the reader may open it (their own, or shared); else null. */
  chatHref?: string | null;
}

/**
 * Every signal the action has taken as evidence (AC-007), kept after a signal
 * moves on to a later cycle: a closed action still shows its own. With where
 * each prompt is tracked and its topic, as the Signals page reads them: the
 * Affected tab's platforms and topics (AC-003).
 */
async function readActionSignals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  actionId: string,
): Promise<Signal[]> {
  const [signalsRes, places] = await Promise.all([
    supabase
      .from('signals')
      .select(`${SIGNAL_ROW_COLUMNS}, action_signals!inner(action_id)`)
      .eq('brand_id', brandId)
      .eq('action_signals.action_id', actionId)
      .order('detected_at', { ascending: false }),
    readPromptPlaces(supabase, brandId),
  ]);
  if (signalsRes.error) throw new Error(signalsRes.error.message);
  // Without a big group's thousand target ids (AC-009): the drawer names 50.
  return mapSignalRows(
    ((signalsRes.data ?? []) as SignalRow[]).map((row) => withoutTargetIds(row)),
    places,
  );
}

/**
 * An action's evidence alone, for a drawer that already has the rest: the
 * History drawer's goal and what happened (AC-003).
 */
export async function getActionSignals(brandId: string, actionId: string): Promise<Signal[]> {
  const supabase = await createClient();
  return readActionSignals(supabase, brandId, actionId);
}

/** Everything the drawer's tabs need beyond the list row, in one round trip
 *  per source. `kpis` are the brand's configured definitions among the
 *  action's kpi_keys — evidence of which goals this work serves. */
export async function getActionDetail(brandId: string, actionId: string): Promise<ActionDetail> {
  const supabase = await createClient();
  const [tasksRes, signals, eventsRes, kpisRes, outcomeRes, entityCounts, entities] =
    await Promise.all([
      supabase
        .from('action_tasks')
        .select(TASK_COLUMNS)
        .eq('action_id', actionId)
        .order('position'),
      readActionSignals(supabase, brandId, actionId),
      supabase
        .from('action_events')
        .select(EVENT_COLUMNS)
        .eq('action_id', actionId)
        .order('created_at'),
      supabase
        .from('kpi_definitions')
        .select('kpi_key, target, timeframe')
        .eq('brand_id', brandId)
        .eq('is_active', true),
      supabase
        .from('actions')
        .select('position_outcome, payload')
        .eq('brand_id', brandId)
        .eq('id', actionId)
        .maybeSingle(),
      readEntityCounts(supabase, [actionId]),
      readKeptEntities(supabase, actionId),
    ]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (kpisRes.error) throw new Error(kpisRes.error.message);

  // A planned task that named the action's count names the count left (AC-009).
  const payload = withEntityCounts(
    (outcomeRes.data?.payload ?? {}) as Record<string, unknown>,
    entityCounts.get(actionId),
  );
  const tasks = (tasksRes.data ?? []).map(taskFromRow);
  const [attachments, chatHref] = await Promise.all([
    readTaskAttachments(
      supabase,
      brandId,
      tasks.map((task) => task.id),
    ),
    readableChat(supabase, payload),
  ]);
  return {
    tasks: tasks.map((task) => ({
      ...task,
      titleParams: currentTaskParams(task.titleParams, payload) ?? task.titleParams,
      attachments: attachments.get(task.id) ?? [],
    })),
    signals,
    entities,
    events: (eventsRes.data ?? []).map(eventFromRow),
    kpis: (kpisRes.data ?? []).map(kpiFromRow),
    positionOutcome: parseImproveOutcome(outcomeRes.data?.position_outcome ?? null),
    chatHref,
  };
}

/**
 * The chat a finding was sent from, read as the member (its author, or the
 * team when it is shared): a chat they can't read gets no link. Null for an
 * action not sent from Chat, or when it can't be read.
 */
async function readableChat(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const id = payload.source === 'chat' ? payload.conversationId : null;
  if (typeof id !== 'string' || !id) return null;
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return `/dashboard/chat/${data.id as string}`;
}

/**
 * Sets an action's status. A dismissal keeps why, when the person said
 * (learning A5); any other status clears it, as a dismissal it no longer is
 * (00366). A database without dismiss_reason still changes the status.
 */
export async function updateActionStatus(
  brandId: string,
  actionId: string,
  status: ActionStatus,
  reason: ActionDismissReason | null = null,
): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const dismissReason =
    status === 'dismissed' && reason && ACTION_DISMISS_REASONS.includes(reason) ? reason : null;
  const change = {
    status,
    completed_at: status === 'completed' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const write = (values: typeof change & { dismiss_reason?: string | null }) =>
    supabase.from('actions').update(values).eq('brand_id', brandId).eq('id', actionId);
  let { error } = await write({ ...change, dismiss_reason: dismissReason });
  // A database without 00366 has no dismiss_reason (PGRST204 from PostgREST's
  // schema cache, 42703 from Postgres): the status changes anyway, a
  // dismissal's reason kept in the event below only. Any other error stands.
  if (missingDismissReason(error)) ({ error } = await write(change));
  if (error) throw new Error(error.message);
  await logEvent(supabase, actionId, 'status_changed', {
    to: status,
    ...(dismissReason ? { reason: dismissReason } : {}),
  });
}

/**
 * Still relevant on a stale action (00432): no longer stale, and its month
 * starts again from this History line, as from anyone's change.
 */
export async function keepActionRelevant(brandId: string, actionId: string): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const { error } = await supabase
    .from('actions')
    .update({ stale_at: null, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('id', actionId);
  if (error) throw new Error(error.message);
  await logEvent(supabase, actionId, 'still_relevant', {});
}

/**
 * Delete an action from its row menu (admins and managers). The server hides
 * it rather than removing it: dismissed, with deleted_at (00168), so it
 * leaves every list while the nightly generator keeps its rest window.
 */
export async function deleteAction(actionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE_URL}/api/action-center/actions/${actionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
}

/**
 * Assign an action, or clear its assignee. The assignee must be someone who
 * can see the brand (BRAND-ACCESS §3.1): a teammate it wasn't shared with,
 * or anyone outside the workspace, is refused before anything is written.
 */
export async function assignAction(
  brandId: string,
  actionId: string,
  assigneeId: string | null,
): Promise<void> {
  await assertWritable({ brandId });
  if (assigneeId && !(await canAccessBrand(assigneeId, brandId))) {
    throw new Error("The assignee can't see this brand");
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('actions')
    .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('id', actionId);
  if (error) throw new Error(error.message);
  await logEvent(supabase, actionId, 'assigned', { assigneeId });
}

export async function setActionDueDate(
  brandId: string,
  actionId: string,
  dueDate: string | null,
): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const { error } = await supabase
    .from('actions')
    .update({ due_date: dueDate, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('id', actionId);
  if (error) throw new Error(error.message);
  await logEvent(supabase, actionId, 'due_date_set', { dueDate });
}

export async function updateTaskStatus(
  brandId: string,
  actionId: string,
  taskId: string,
  status: TaskStatus,
  skipReason?: string,
): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();

  // A skip records why. "We decided not to" is only useful to the next reader
  // if it says what the decision was; without it a skipped task is
  // indistinguishable from an abandoned one.
  const reason = status === 'skipped' ? (skipReason ?? '').trim().slice(0, 200) : null;
  if (status === 'skipped' && !reason) throw new Error('A skipped task needs a reason');

  await writeTaskStatus(supabase, { brandId, actionId, taskId }, status, { skipReason: reason });
}

/** Longest a task's text may be. Long enough for a real instruction, short
 *  enough to stay one line in the drawer. */
const TASK_TITLE_MAX = 200;

function cleanTaskTitle(raw: string): string {
  const title = raw.trim().slice(0, TASK_TITLE_MAX);
  if (!title) throw new Error('Task text is required');
  return title;
}

/**
 * Append a task of the user's own wording.
 *
 * `task_key` stays null — these have no template — so the renderable check
 * carries the title, and `unique (action_id, task_key)` does not apply to
 * them (Postgres treats nulls as distinct), which is what lets an action hold
 * as many as someone types.
 */
export async function addTask(brandId: string, actionId: string, title: string): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const text = cleanTaskTitle(title);

  // Append after the current last, reading through the caller's own RLS so a
  // position can only ever be computed from tasks they can see.
  const { data: last, error: lastErr } = await supabase
    .from('action_tasks')
    .select('position')
    .eq('action_id', actionId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw new Error(lastErr.message);

  const { error } = await supabase.from('action_tasks').insert({
    action_id: actionId,
    position: (last?.position ?? 0) + 1,
    title: text,
    status: 'todo',
  });
  if (error) throw new Error(error.message);

  await logEvent(supabase, actionId, 'task_added', { title: text });
  await touchAction(supabase, brandId, actionId);
}

/**
 * Edit a task's text and its details (AC-004): where, why, how, done-when,
 * type, effort and role. `title` is null to leave the text as it is, so a
 * library task keeps rendering from its template in the reader's language.
 *
 * The fields are merged into what the task already carries, so a task sent
 * from the Improve tab keeps its body, platform and evidence.
 */
export async function updateTaskDetails(
  brandId: string,
  actionId: string,
  taskId: string,
  edit: TaskDetailsEdit & { title: string | null },
): Promise<void> {
  await assertWritable({ brandId });
  if (!isTaskDetailsEdit(edit) || (edit.title !== null && typeof edit.title !== 'string')) {
    throw new Error('Invalid task details');
  }
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from('action_tasks')
    .select('details')
    .eq('action_id', actionId)
    .eq('id', taskId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) throw new Error('Task not found');

  const stored =
    row.details && typeof row.details === 'object' && !Array.isArray(row.details)
      ? (row.details as Record<string, unknown>)
      : {};
  const merged = { ...stored, ...cleanTaskDetailsEdit(edit) };
  // A template's details, edited, are the person's (AC-010): the task writer
  // reads the task as worked on (task-writer isTouched). An undefined key
  // isn't written.
  const fromTemplate = (stored as { source?: unknown }).source === 'template';
  const details = fromTemplate ? { ...merged, source: undefined } : merged;
  const title = edit.title === null ? null : cleanTaskTitle(edit.title);

  const { error } = await supabase
    .from('action_tasks')
    .update({
      details,
      ...(title === null ? {} : { title }),
      updated_at: new Date().toISOString(),
    })
    .eq('action_id', actionId)
    .eq('id', taskId);
  if (error) throw new Error(error.message);

  await logEvent(supabase, actionId, 'task_edited', { taskId, title });
  await touchAction(supabase, brandId, actionId);
}

/**
 * Remove a task and close the gap in the numbering.
 *
 * The drawer shows `position` to the reader ("1. 2. 3."), so leaving a hole
 * would show one. Renumbering runs row by row rather than in one statement
 * because PostgREST has no bulk conditional update; a handful of tasks per
 * action makes that a non-issue.
 */
export async function deleteTask(brandId: string, actionId: string, taskId: string): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();

  const { error } = await supabase
    .from('action_tasks')
    .delete()
    .eq('action_id', actionId)
    .eq('id', taskId);
  if (error) throw new Error(error.message);

  const { data: remaining, error: readErr } = await supabase
    .from('action_tasks')
    .select('id, position')
    .eq('action_id', actionId)
    .order('position');
  if (readErr) throw new Error(readErr.message);

  await Promise.all(
    (remaining ?? [])
      .map((task, index) => ({ task, wanted: index + 1 }))
      .filter(({ task, wanted }) => task.position !== wanted)
      .map(({ task, wanted }) =>
        supabase.from('action_tasks').update({ position: wanted }).eq('id', task.id),
      ),
  );

  await logEvent(supabase, actionId, 'task_deleted', { taskId });
  await touchAction(supabase, brandId, actionId);
}

/**
 * The estimated monthly AI searches of these prompts, for the Affected tab's
 * Volume column (AC-003); see readPromptDemand.
 */
export async function getPromptDemand(
  brandId: string,
  promptIds: string[],
): Promise<Record<string, VolumeEstimate>> {
  if (promptIds.length === 0) return {};
  const supabase = await createClient();
  return Object.fromEntries(await readPromptDemand(supabase, brandId, promptIds));
}

/** Action ids per request, and signal rows per page, for the list's export. */
const AFFECTED_ID_CHUNK = 100;
const AFFECTED_PAGE_SIZE = 1000;

/**
 * Each action's affected items, for the actions list's Export CSV (AC-005):
 * the count and names the drawer's Affected tab shows, from what the action
 * kept (00244) and the signals it rests on — or, for one a person sent, from
 * what it was sent about. Read page by page, so a brand with many signals is
 * read whole.
 */
export async function getActionsAffected(
  brandId: string,
  actionIds: string[],
): Promise<Record<string, { count: number; items: string[] }>> {
  const ids = [...new Set(actionIds)];
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += AFFECTED_ID_CHUNK) {
    chunks.push(ids.slice(i, i + AFFECTED_ID_CHUNK));
  }

  const readSignals = async (chunk: string[]) => {
    const rows: (SignalRow & { action_signals: { action_id: string }[] })[] = [];
    for (let from = 0; ; from += AFFECTED_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('signals')
        .select(`${SIGNAL_ROW_COLUMNS}, action_signals!inner(action_id)`)
        .eq('brand_id', brandId)
        .in('action_signals.action_id', chunk)
        // The drawer's order, made stable so pages don't shuffle.
        .order('detected_at', { ascending: false })
        .order('id')
        .range(from, from + AFFECTED_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as unknown as typeof rows;
      rows.push(...batch);
      if (batch.length < AFFECTED_PAGE_SIZE) return rows;
    }
  };
  const readPayloads = async (chunk: string[]) => {
    const { data, error } = await supabase
      .from('actions')
      .select('id, payload')
      .eq('brand_id', brandId)
      .in('id', chunk);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; payload: Record<string, unknown> | null }[];
  };

  const [signalChunks, payloadChunks, keptChunks, places, entityCounts] = await Promise.all([
    Promise.all(chunks.map(readSignals)),
    Promise.all(chunks.map(readPayloads)),
    // What each kept (00244): its rows, as in the drawer. Without them (a
    // database before 00244), the signals'.
    Promise.all(chunks.map((chunk) => readKeptEntityLists(supabase, chunk))),
    readPromptPlaces(supabase, brandId),
    // The count each action shows (AC-009), so the CSV's agrees with its title.
    readEntityCounts(supabase, ids),
  ]);

  const rowsByAction = new Map<string, SignalRow[]>();
  for (const row of signalChunks.flat()) {
    for (const link of row.action_signals ?? []) {
      const list = rowsByAction.get(link.action_id) ?? [];
      list.push(row);
      rowsByAction.set(link.action_id, list);
    }
  }
  const keptByAction = new Map<string, KeptEntity[]>();
  for (const lists of keptChunks) {
    for (const [actionId, kept] of lists ?? []) keptByAction.set(actionId, kept);
  }
  const summaries: Record<string, { count: number; items: string[] }> = {};
  for (const action of payloadChunks.flat()) {
    const signals = mapSignalRows(rowsByAction.get(action.id) ?? [], places);
    summaries[action.id] = affectedSummary(
      affectedOf(
        affectedSignals(signals, action.id),
        withEntityCounts(action.payload ?? {}, entityCounts.get(action.id)),
        keptByAction.get(action.id) ?? null,
      ),
    );
  }
  return summaries;
}
