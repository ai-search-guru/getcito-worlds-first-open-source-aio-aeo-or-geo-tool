import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import type {
  ChatActionDuplicate,
  ChatActionEntities,
  ChatActionFailure,
  ChatActionProposal,
  CreateChatActionResult,
} from '@/lib/actions/chatActionCenter';
import type { ChatWritePlace } from '@/lib/chat/registry/defineTool';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Send to Action Center through the API (CHAT-09 §E, CHAT-20 §12): the
 * duplicate check and the send, their place in a run, and what the API's
 * answers mean. Shared by the person's own send (lib/actions/
 * chatActionCenter.ts) and a run's send for its person with no session
 * (lib/chat/actor/actionCenter.ts), so both read the API the same way.
 * Server only, and never a server action: the chat named is the caller's word.
 */

/** The API's answer: its status and its JSON body; null when there was no one to send as. */
export type ActionApiAnswer = { status: number; ok: boolean; body: Record<string, unknown> } | null;

const cardT = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.actionCard' });

export const FORBIDDEN: ChatActionFailure = {
  ok: false,
  reason: 'forbidden_role',
  message: 'Only an admin or a manager can change Action Center from Chat.',
};
export const NOT_FOUND = (what: string): ChatActionFailure => ({
  ok: false,
  reason: 'not_found',
  message: `I couldn't find that ${what}.`,
});
export const FAILED = (what: string): ChatActionFailure => ({
  ok: false,
  reason: 'failed',
  message: `${what} Try again.`,
});

/** The action's page with its drawer open: the redirect at actions/[id]. */
export const actionHref = (id: string) => `/dashboard/action-center/actions/${id}` as const;

/** Where a change was made, as the server read it: never as a caller said it. */
export interface Where {
  conversationId: string;
  brandId: string | null;
  runId: string;
  /** The run step it runs on: one per approval, its idempotency key. None for a card's click. */
  approvalKey: string | null;
  /** None for the person's own click on a card: no change Chat made. */
  executionMode: 'assisted' | 'automated' | null;
}

/** The person's own chat, as the caller reads it (their session, or the run's person). */
export type OwnChat = (
  conversationId: string,
) => Promise<{ id: string; brandId: string | null } | null>;

/**
 * The chat, run and step a change runs on, read on the server (a server
 * action can be called with anything): the person's own chat, a run of it,
 * and the step of that run running this very tool now. How it was approved
 * comes from the step: one the engine ran without a card is marked so
 * (engine.ts writeCall), any other waited on the person's card. Null when
 * any of it doesn't hold: nothing of it is recorded then.
 */
export async function placeIn(
  ownChat: OwnChat,
  place: ChatWritePlace | undefined,
  tool: string,
): Promise<Where | null> {
  if (!place?.conversationId || !place.runId || !place.approvalKey) return null;
  const chat = await ownChat(place.conversationId);
  if (!chat) return null;
  const { data: step, error: stepError } = await supabaseAdmin
    .from('chat_run_steps')
    .select('id, run_id, status, tool, debug_json, chat_runs!inner(conversation_id)')
    .eq('id', place.approvalKey)
    .eq('run_id', place.runId)
    .maybeSingle();
  if (stepError) throw new Error(stepError.message);
  const row = step as {
    id: string;
    run_id: string;
    status: string;
    tool: string | null;
    debug_json: { auto?: unknown } | null;
    chat_runs: { conversation_id: string } | null;
  } | null;
  if (
    !row ||
    row.status !== 'running' ||
    row.tool !== tool ||
    row.chat_runs?.conversation_id !== chat.id
  ) {
    return null;
  }
  return {
    conversationId: chat.id,
    brandId: chat.brandId,
    runId: row.run_id,
    approvalKey: row.id,
    executionMode: row.debug_json?.auto === true ? 'automated' : 'assisted',
  };
}

/** The API's refusal, in Chat's codes. */
function apiRefusal(status: number, body: Record<string, unknown>): ChatActionFailure {
  const details = typeof body.details === 'string' ? body.details : null;
  if (status === 403 && body.code === 'forbidden') return FORBIDDEN;
  // Another workspace's brand, or one outside the person's brand access.
  if (status === 403 && (body.code === 'not_in_workspace' || body.code === 'no_brand_access')) {
    return {
      ok: false,
      reason: 'not_found',
      message: details ?? "This brand isn't one you can work on.",
    };
  }
  if (status === 404) return NOT_FOUND('brand');
  // The action this approval made was cancelled since.
  if (status === 409 && body.code === 'conflict') {
    return { ok: false, reason: 'conflict', message: details ?? 'This changed since.' };
  }
  if (status === 400) {
    return { ok: false, reason: 'invalid', message: details ?? 'This proposal is incomplete.' };
  }
  return FAILED("The Action Center didn't answer.");
}

/** A 409 duplicate's body, as the model reads it. */
function duplicateOf(body: Record<string, unknown>): ChatActionDuplicate {
  const action = (body.action ?? {}) as { id?: string; no?: number };
  const no = Number(action.no);
  return {
    ok: false,
    reason: 'duplicate',
    message: `AC-${no} already covers this.`,
    action_id: String(action.id ?? ''),
    action_no: no,
    can_create_anyway: body.canCreateAnyway === true,
  };
}

/** The server's count of the day's new actions, when it says they are reached. */
function dailyLimitOf(body: Record<string, unknown>) {
  const limit = (body.dailyLimit ?? null) as { limit?: unknown; reached?: unknown } | null;
  if (!limit || limit.reached !== true) return {};
  return {
    daily_limit_reached: true as const,
    daily_limit_note: cardT('dailyLimit', { limit: Number(limit.limit) || 5 }),
  };
}

/** The duplicate check's request (POST /api/action-center/chat-actions/check). */
export const coverRequest = (
  brandId: string,
  entities: ChatActionEntities,
  category?: ChatActionProposal['category'],
) => ({ path: '/chat-actions/check' as const, body: { brandId, entities, category } });

/** The check's answer: the first action covering the finding, or none (`{ ok: true }`). */
export function coverResult(res: ActionApiAnswer): { ok: true } | ChatActionDuplicate {
  const first = (res?.ok ? (res.body.covering as unknown[] | undefined) : null)?.[0] as
    { actionId: string; actionNo: number; covers: 'all' | 'some' } | undefined;
  if (!first) return { ok: true };
  return duplicateOf({
    action: { id: first.actionId, no: first.actionNo },
    canCreateAnyway: first.covers === 'some',
  });
}

/** The send's request (POST /api/action-center/chat-actions), at its place in the run. */
export const sendRequest = (
  brandId: string,
  proposal: ChatActionProposal,
  where: Where | null,
  idempotencyKey: string,
  createAnyway: boolean,
) => ({
  path: '/chat-actions' as const,
  body: {
    brandId,
    proposal,
    conversationId: where?.conversationId ?? null,
    runId: where?.runId ?? null,
    executionMode: where?.executionMode ?? null,
    // One per approval (the run step): a retry finds what it made (§11c).
    idempotencyKey,
    createAnyway,
  },
});

/** The send's answer: the action made, the one that covers it, or the refusal. */
export function sendResult(res: ActionApiAnswer): CreateChatActionResult {
  if (!res) return FAILED('Your session ended.');
  if (res.status === 409 && res.body.code === 'duplicate') return duplicateOf(res.body);
  if (!res.ok) return apiRefusal(res.status, res.body);
  const actionId = String(res.body.actionId);
  return {
    ok: true,
    action_id: actionId,
    action_no: Number(res.body.actionNo),
    created: res.body.created === true,
    href: actionHref(actionId),
    ...dailyLimitOf(res.body),
  };
}
