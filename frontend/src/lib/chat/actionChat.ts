import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { categoryName, logActionRunEvent, readActionForRun } from './agentAction';
import { RUN_NOW_REPEAT_MS, runWithChatDenial } from './agentRules';
import { denied, refused, type AgentContext, type AgentResult } from './agents';
import { composerSetupOf } from './composerSetup';
import { startChatRun, type ChatActor, type EngineFailure } from './engine';
import { idempotencyKey, requestHash, sweepExpiredKeys, withIdempotencyKey } from './idempotency';
import { DEFAULT_CHAT_SETTINGS } from './precedence';

/**
 * Run with Chat on an Action Center action (CHAT-21 §F item 27: the
 * picker's no-agent choice): the person's own Chat run on the action, in
 * their default mode, as if they had asked from the action's row with it
 * attached (Ask about this). Its message names the action by number and
 * category only; its title goes in the scope (an `Action · {title}` chip
 * and the action as an @ reference), read as untrusted data, and the run
 * starts tainted: the title may come from outside (CHAT-20 §16a). The
 * action's History gets one line, "Chat started on this action", with the
 * person (owner decision 2026-10-31). A second click by the same person on
 * the same action within 60 seconds opens the same chat. Admins and
 * Managers, as Run agent. Server only.
 *
 * Unlike an agent's run on the action (agentDriver.ts, edge case 7), this
 * run doesn't stop when the action closes: it is the person's own chat,
 * they are there, and they stop it with Stop as any chat of theirs.
 */

const chatT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.runWithChat' });

/** Where a chat started from an action says it was opened (chat_conversations.origin_page). */
export const ACTION_CENTER_PAGE = '/dashboard/action-center/actions';

export interface ActionChat {
  /** The run to drive; null for a repeat, whose run is already under way. */
  runId: string | null;
  conversationId: string;
  queued: boolean;
  /** The same person's chat on this action from the last 60 seconds. */
  repeated: boolean;
}

export type ActionChatResult = AgentResult<ActionChat> | { ok: false; engine: EngineFailure };

/** What a click started, kept for its repeats: the chat, or the engine's refusal (not kept). */
type Started =
  | { ok: true; runId: string; conversationId: string; queued: boolean }
  | { ok: false; status: number; code: string; message: string };

/** The person's saved default mode, as their composer starts with it (W1-10). */
async function defaultModeOf(ctx: AgentContext) {
  const { data, error } = await supabaseAdmin
    .from('chat_user_prefs')
    .select('default_mode')
    .eq('user_id', ctx.actor.userId)
    .maybeSingle();
  if (error) console.error('[chat/actions] could not read the default mode:', error.message);
  return composerSetupOf((data as { default_mode?: string | null } | null)?.default_mode, {
    role: ctx.viewer.role,
    plan: ctx.plan,
    settings: {
      ...DEFAULT_CHAT_SETTINGS,
      fullAutoForMembers: ctx.settings.fullAutoForMembers,
    },
  }).defaultMode;
}

/** The person's Run with Chat on the action from the last 60 seconds: its chat. */
async function recentActionChat(actionId: string, userId: string, now: Date) {
  const { data, error } = await supabaseAdmin
    .from('action_events')
    .select('data, created_at')
    .eq('action_id', actionId)
    .eq('event', 'chat_started')
    .eq('actor_id', userId)
    .gte('created_at', new Date(now.getTime() - RUN_NOW_REPEAT_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read the action's History: ${error.message}`);
  const row = ((data ?? []) as { data: { conversation_id?: unknown } | null }[])[0];
  const id = row?.data?.conversation_id;
  return typeof id === 'string' ? id : null;
}

/**
 * Starts the person's Chat run on the action (above): kept and started, or
 * queued while every slot is busy, as a message they sent; the caller drives
 * it. The action has to be open and in their brands.
 */
export async function startActionChat(
  ctx: AgentContext,
  actionId: string,
  input: { timezone?: string } = {},
  now = new Date(),
): Promise<ActionChatResult> {
  const denial = runWithChatDenial(ctx.viewer);
  if (denial) return denied(ctx, denial);
  const action = await readActionForRun(ctx, actionId, now);
  if (!action.ok) return action;
  const { snapshot, brand } = action.value;
  const actor: ChatActor = ctx.actor;
  const org = ctx.actor.organizationId;

  const recent = await recentActionChat(snapshot.id, actor.userId, now);
  if (recent) {
    return {
      ok: true,
      value: { runId: null, conversationId: recent, queued: false, repeated: true },
    };
  }

  // Two clicks at once start one chat: they claim one key (the person, the action, the minute).
  const minute = String(Math.floor(now.getTime() / RUN_NOW_REPEAT_MS));
  const outcome = await withIdempotencyKey<Started>(
    {
      organizationId: org,
      key: idempotencyKey('actionChat', [snapshot.id, actor.userId, minute]),
      requestHash: requestHash('actionChat', { action: snapshot.id }),
    },
    async () => {
      const started = await startChatRun(
        actor,
        {
          message: chatT('message', { no: snapshot.no, category: categoryName(snapshot.category) }),
          brandId: brand.id,
          mode: await defaultModeOf(ctx),
          timezone: input.timezone,
          origin: 'panel',
          originPage: ACTION_CENTER_PAGE,
          context: {
            route: ACTION_CENTER_PAGE,
            chips: [
              { key: 'brand', label: brand.name, value: brand.id },
              {
                key: 'action',
                label: chatT('chip', { title: snapshot.title }).slice(0, 200),
                value: snapshot.id,
              },
            ],
          },
          references: [{ type: 'task', id: snapshot.id, label: snapshot.title.slice(0, 200) }],
        },
        { tainted: true, scopeUntrusted: true },
      );
      if (!started.ok) {
        const { status, code, message } = started;
        return { result: { ok: false, status, code, message }, activityId: null };
      }
      await logActionRunEvent(
        snapshot.id,
        'chat_started',
        { conversation_id: started.conversationId },
        actor.userId,
      );
      const { runId, conversationId, queued } = started;
      return { result: { ok: true, runId, conversationId, queued }, activityId: null };
    },
    // A refusal isn't kept: the next click tries again.
    { keep: (result) => result.ok },
  );
  if (outcome.kind === 'ran') await sweepExpiredKeys(org);
  if (outcome.kind === 'mismatch' || outcome.kind === 'busy') return refused('failed');
  const started = outcome.result;
  if (!started.ok) {
    return { ok: false, engine: { ...started, ok: false } as EngineFailure };
  }
  return {
    ok: true,
    value: {
      runId: outcome.kind === 'ran' ? started.runId : null,
      conversationId: started.conversationId,
      queued: started.queued,
      repeated: outcome.kind === 'repeat',
    },
  };
}
