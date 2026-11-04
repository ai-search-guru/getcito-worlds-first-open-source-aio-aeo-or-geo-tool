import { BRAND, ORG } from './chatFixtures';
import { fakeId, type FakeSupabase } from './fakeSupabase';

/**
 * An Action Center for Chat's tests (W2-10): one open action of the brand
 * with one task, a draft in Files, and stand-ins for the server actions in
 * lib/actions/chatActionCenter.ts that change the in-memory tables as the
 * real ones change the database. A task row carries its action's number as
 * the embed (`actions!inner(action_no)`) would read it. Tests only.
 */

export const ACTION = '88888888-8888-4888-8888-888888888888';
export const TASK = '99999999-9999-4999-8999-999999999999';
export const FILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CONVERSATION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export function seedActionCenter(db: FakeSupabase) {
  Object.assign(db.tables, {
    actions: [
      {
        id: ACTION,
        brand_id: BRAND,
        action_no: 1258,
        kind: 'recover_lost_citations',
        status: 'new',
        deleted_at: null,
        payload: {},
      },
    ],
    action_tasks: [
      {
        id: TASK,
        action_id: ACTION,
        task_key: null,
        title: 'Add a pricing FAQ block to /pricing',
        status: 'todo',
        actions: { action_no: 1258, brand_id: BRAND },
      },
    ],
    action_events: [],
    chat_files: [
      {
        id: FILE,
        organization_id: ORG,
        brand_id: BRAND,
        title: 'Pricing FAQ',
        type: 'document',
        status: 'draft',
        content_draft_id: null,
      },
    ],
    chat_file_task_links: [],
    chat_task_state: [],
  });
  db.unique.chat_file_task_links = [['file_id', 'action_task_id']];
  db.unique.chat_task_state = [['conversation_id', 'action_task_id']];
}

type Place = { conversationId?: string | null; runId?: string | null } | undefined;

/** Send to Action Center: a new action of the brand, with its task and its created event. */
export function fakeCreateChatAction(db: FakeSupabase) {
  let no = 1300;
  return async (brandId: string, proposal: { title: string; tasks: { title: string }[] }) => {
    const id = fakeId();
    const actionNo = (no += 1);
    db.tables.actions.push({
      id,
      brand_id: brandId,
      action_no: actionNo,
      kind: 'chat_finding',
      status: 'new',
      deleted_at: null,
      payload: { source: 'chat', title: proposal.title },
    });
    proposal.tasks.forEach((task, i) =>
      db.tables.action_tasks.push({
        id: fakeId(),
        action_id: id,
        position: i + 1,
        task_key: null,
        title: task.title,
        status: 'todo',
        actions: { action_no: actionNo, brand_id: brandId },
      }),
    );
    db.tables.action_events.push({ id: fakeId(), action_id: id, event: 'created', data: {} });
    return {
      ok: true,
      action_id: id,
      action_no: actionNo,
      created: true,
      href: `/dashboard/action-center/actions/${id}`,
    };
  };
}

/** Add to AC-{n}: the finding as an event in the action's History. */
export function fakeAttachToAction(db: FakeSupabase) {
  return async (actionId: string, evidence: { finding: string }) => {
    const action = db.tables.actions.find((a) => a.id === actionId);
    if (!action) return { ok: false, reason: 'not_found', message: "I couldn't find that action." };
    const eventId = fakeId();
    db.tables.action_events.push({
      id: eventId,
      action_id: actionId,
      event: 'evidence_attached',
      data: { source: 'chat', finding: evidence.finding },
    });
    return {
      ok: true,
      action_id: actionId,
      action_no: action.action_no,
      event_id: eventId,
      href: `/dashboard/action-center/actions/${actionId}`,
    };
  };
}

/** Attach only: the link, the file attached, and the event. */
export function fakeAttachFileToTask(db: FakeSupabase) {
  return async (_brandId: string, taskId: string, fileId: string) => {
    const task = db.tables.action_tasks.find((t) => t.id === taskId)!;
    const already = db.tables.chat_file_task_links.some(
      (l) => l.file_id === fileId && l.action_task_id === taskId,
    );
    if (!already) {
      db.tables.chat_file_task_links.push({ file_id: fileId, action_task_id: taskId });
      const file = db.tables.chat_files.find((f) => f.id === fileId)!;
      if (file.status === 'draft') file.status = 'attached';
      db.tables.action_events.push({
        id: fakeId(),
        action_id: task.action_id,
        event: 'file_attached',
        data: { source: 'chat', taskId, fileId },
      });
    }
    return { ok: true, file_id: fileId, task_id: taskId, action_id: task.action_id, already };
  };
}

/** Ready for review: the chat's status for the task, and the event. */
export function fakeSetTaskReadyForReview(db: FakeSupabase) {
  return async (_brandId: string, taskId: string, place?: Place) => {
    const task = db.tables.action_tasks.find((t) => t.id === taskId)!;
    const conversationId = place?.conversationId ?? CONVERSATION;
    const state = db.tables.chat_task_state.find(
      (s) => s.conversation_id === conversationId && s.action_task_id === taskId,
    );
    const previous = (state?.chat_status as string | undefined) ?? null;
    if (state) state.chat_status = 'ready_for_review';
    else {
      db.tables.chat_task_state.push({
        conversation_id: conversationId,
        action_task_id: taskId,
        position: 1,
        chat_status: 'ready_for_review',
      });
    }
    db.tables.action_events.push({
      id: fakeId(),
      action_id: task.action_id,
      event: 'task_ready_for_review',
      data: { source: 'chat', taskId },
    });
    return {
      ok: true,
      task_id: taskId,
      action_id: task.action_id,
      conversation_id: conversationId,
      previous,
    };
  };
}
