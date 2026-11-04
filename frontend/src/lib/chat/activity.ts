import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import type { ChatMode, ChatSurface, ToolDecision, ToolDenial } from './precedence';
import type { ChatTool, ToolClass } from './registry/defineTool';

/**
 * The Activity log (CHAT-20 §10a layer 2; chat_activity_log, 00402): one row
 * for each WRITE or EXECUTE Chat ran (kind `change`), each Undo (`undo`) and
 * each call the precedence refused (`access.denied`, §4c). Written by the
 * server, never by the model. A row names its tool by the
 * label key and says what changed in the person's words: a key under
 * chatActivity.summary in messages/en.json and its values. A person reads
 * their own rows, an Admin the workspace's (00402's policy); what Undo
 * restores (undo_json) stays with the server. Server only.
 */

/**
 * How a change was approved: `ask` its card's OK, `click` an EXECUTE's
 * click, `auto` it ran without a card (via Always, Full auto or the person's
 * "Don't ask again", or an EXECUTE an allowed agent took live on its own:
 * go_live, AUTONOMOUS-GO-LIVE §6.4), `run` the person's own action, which
 * needs no card (an Undo, §10b).
 */
export type ActivityApproval =
  | { kind: 'ask' }
  | { kind: 'click' }
  | { kind: 'auto'; via: 'always' | 'full_auto' | 'dont_ask_again' | 'go_live' }
  | { kind: 'run' };

/**
 * The approval a decision leads to once it is acted on: a card the person
 * approved, an EXECUTE they clicked, or a WRITE that ran by itself. Null for
 * what isn't logged: a read, or a refusal.
 */
export function approvalFor(decision: ToolDecision): ActivityApproval | null {
  switch (decision.kind) {
    case 'run':
      return decision.via === 'read' ? null : { kind: 'auto', via: decision.via };
    case 'ask':
      return { kind: 'ask' };
    case 'click':
      return { kind: 'click' };
    default:
      return null;
  }
}

/** Where the row points: the chat, run and step the change was made in, when there was one. */
export interface ActivityPlace {
  conversationId: string | null;
  runId: string | null;
  stepId: string | null;
  /** The agent run the chat is (chat_conversations.agent_run_id); absent for a person's own. */
  agentRunId?: string | null;
}

/** One row to write. */
export interface ActivityEntry {
  organizationId: string;
  /** The person Chat acted as, or who undid. */
  userId: string;
  brandId: string | null;
  place: ActivityPlace;
  surface: ChatSurface;
  tool: Pick<ChatTool, 'labelKey' | 'class'>;
  /** The run's mode; null for an Undo. */
  mode: ChatMode | null;
  approval: ActivityApproval;
  target: { type: string; id: string | null };
  /** A key under chatActivity.summary, and its values. */
  summary: { key: string; params: Record<string, string> };
  /** What Undo restores and checks, and until when; null without an Undo. */
  undo: { data: { [key: string]: Json }; until: Date } | null;
  /** The change this row undoes. */
  undoesId?: string;
  /** The agent it was for, or whose run made it (CHAT-21, CHAT-27 item 29): its Activity filter. */
  agentId?: string | null;
  /** The agent run that made it, or that a Run now queued. */
  agentRunId?: string | null;
}

/** Writes a change's row, or an Undo's (undoesId), and returns its id. */
export async function logActivity(entry: ActivityEntry): Promise<string> {
  if (entry.tool.class === 'read') throw new Error('A read is not logged');
  // An EXECUTE's click, or an agent run's step that went live on its own (00445 checks it too).
  const onItsOwn =
    entry.approval.kind === 'auto' && entry.approval.via === 'go_live' && !!entry.agentRunId;
  if (entry.approval.kind === 'auto' && entry.approval.via === 'go_live' && !onItsOwn) {
    throw new Error('Only an agent run goes live on its own');
  }
  if (
    entry.tool.class === 'execute' &&
    (entry.undo || (entry.approval.kind !== 'click' && !onItsOwn))
  ) {
    throw new Error('An EXECUTE runs on a click and has no Undo');
  }
  if (entry.tool.class !== 'execute' && onItsOwn) {
    throw new Error('Only an EXECUTE goes live on its own');
  }
  const { data, error } = await supabaseAdmin
    .from('chat_activity_log')
    .insert({
      organization_id: entry.organizationId,
      user_id: entry.userId,
      brand_id: entry.brandId,
      conversation_id: entry.place.conversationId,
      run_id: entry.place.runId,
      step_id: entry.place.stepId,
      surface: entry.surface,
      kind: entry.undoesId ? 'undo' : 'change',
      tool_key: entry.tool.labelKey,
      class: entry.tool.class,
      mode: entry.mode,
      approval_kind: entry.approval.kind,
      auto_via: entry.approval.kind === 'auto' ? entry.approval.via : null,
      target_type: entry.target.type,
      target_id: entry.target.id,
      summary_key: entry.summary.key,
      summary_params: entry.summary.params,
      undo_json: entry.undo?.data ?? null,
      undo_until: entry.undo?.until.toISOString() ?? null,
      undoes_id: entry.undoesId ?? null,
      agent_id: entry.agentId ?? null,
      agent_run_id: entry.agentRunId ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not write the activity log: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * A call the precedence refused (§4c, §10a): the shape accessLog.ts's
 * accessDeniedEvent builds, so recordAccessDenied writes its row with
 * `recordActivity(accessDeniedEvent(ctx, denial))`. No approval, target or
 * Undo: nothing ran. brandId is null for a brand out of the person's scope.
 */
export interface AccessDeniedActivity {
  kind: 'access.denied';
  userId: string;
  organizationId: string;
  brandId: string | null;
  /** The row's label key, never the tool's name. */
  toolKey: string;
  toolClass: ToolClass;
  surface: ChatSurface;
  /** The denial's code (precedence.ts ToolDenial). */
  reason: ToolDenial['code'];
  /** The rest of the denial: { role, roles }, { needs }, { group }, or nothing. */
  detail: Record<string, unknown>;
  conversationId: string | null;
  runId: string | null;
}

/** Any row: a change or an Undo (logActivity's entry), or a denial. */
export type ActivityRecord = ({ kind: 'change' } & ActivityEntry) | AccessDeniedActivity;

const toolT = createTranslator({ locale: 'en', messages, namespace: 'chatTools' });

/** A tool's name in Settings' words, by label key; '' for a key with no words. */
function toolName(key: string): string {
  return Object.hasOwn(messages.chatTools, key)
    ? toolT(`${key as keyof (typeof messages)['chatTools']}.name`)
    : '';
}

/** Writes one row of any kind and returns its id. */
export async function recordActivity(record: ActivityRecord): Promise<string> {
  if (record.kind === 'change') return logActivity(record);
  const { data, error } = await supabaseAdmin
    .from('chat_activity_log')
    .insert({
      organization_id: record.organizationId,
      user_id: record.userId,
      brand_id: record.brandId,
      conversation_id: record.conversationId,
      run_id: record.runId,
      surface: record.surface,
      kind: 'access.denied',
      tool_key: record.toolKey,
      class: record.toolClass,
      denial_code: record.reason,
      denial_json: JSON.parse(JSON.stringify(record.detail ?? {})) as Json,
      summary_key: 'accessDenied',
      summary_params: { tool: toolName(record.toolKey) },
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not write the activity log: ${error.message}`);
  return (data as { id: string }).id;
}

const summaryT = createTranslator({ locale: 'en', messages, namespace: 'chatActivity.summary' });

type SummaryKey = keyof (typeof messages)['chatActivity']['summary'];

/** Whether chatActivity.summary has this key. */
export function isSummaryKey(key: string): key is SummaryKey {
  return Object.hasOwn(messages.chatActivity.summary, key);
}

/** A row's summary in words: "Saved the draft “Pricing FAQ”". */
export function activitySummary(key: string, params: Record<string, string>): string {
  return isSummaryKey(key) ? summaryT(key, params) : '';
}

/** A value for a summary: the text, on one line, at most 120 characters. */
export function summaryValue(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}
