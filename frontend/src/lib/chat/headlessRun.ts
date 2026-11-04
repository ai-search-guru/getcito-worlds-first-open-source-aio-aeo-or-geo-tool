import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { newProgress, type RunProgress } from './engineStore';
import type { ChatMode } from './precedence';
import type { ChatEffort } from './runLimits';
import { startTouchedBrands } from './touchedBrands';

/**
 * A Chat run nobody's browser started (CHAT-21 §H item 36, CHAT-12 item
 * 11): an agent's run (agentDriver.ts) or a scheduled job's
 * (schedule/worker.ts). It is written as a person's message would be, in
 * the order Chat reads it, acting as the person it names, so it shows in
 * their chat list and Inbox: its chat (made here, or the job's own chat
 * again), the message, the empty answer, the Chat run and its state. The
 * Chat engine then drives it headless (driveRun), with no session behind
 * it. The caller checks first whether the person may run it, and drives
 * it after. Server only.
 */

/** The chat a headless run is made in: a new one, or one it already has. */
export type HeadlessChat =
  | { id: string }
  | {
      create: {
        brandId: string | null;
        title: string;
        /** The agent run this chat is (one chat per agent run, 00419). */
        agentRunId?: string;
        /** The scheduled job this chat is (one live chat per job, 00457). */
        scheduleId?: string;
      };
    };

export interface HeadlessRunInput {
  /** Whose run it is: an agent's or a scheduled job's (the chat's origin). */
  origin: 'agent' | 'schedule';
  organizationId: string;
  /** The person it acts as: the chat is theirs. */
  userId: string;
  chat: HeadlessChat;
  /** The message as the chat shows it, and its scope for the chat (context_json). */
  message: { text: string; context: Json };
  /** What the model reads as the question; the message's text when left out. */
  question?: string;
  timezone: string;
  brandId: string | null;
  mode: ChatMode;
  model: string;
  effort: ChatEffort;
  /**
   * running: its slot is already its own (an agent run's, chat_start_next_agent_run);
   * queued: it takes a slot of the workspace's runs at once first (claimRunSlot).
   */
  status: 'running' | 'queued';
  /** More of the run's progress: its scope for the model, a taint. */
  progress?: Partial<RunProgress> & Record<string, unknown>;
  now: Date;
}

export interface HeadlessRun {
  conversationId: string;
  /** The message, and the answer the run writes. */
  questionId: string;
  answerId: string;
  chatRunId: string;
}

async function insertId(table: string, row: Record<string, unknown>, what: string) {
  const { data, error } = await supabaseAdmin
    .from(table as 'chat_messages')
    .insert(row as never)
    .select('id')
    .single();
  if (error || !data) {
    const failure = new Error(`Could not ${what}: ${error?.message ?? 'no row'}`);
    (failure as Error & { code?: string }).code = error?.code;
    throw failure;
  }
  return (data as { id: string }).id;
}

/**
 * Writes a headless run (above). Null when its chat is made already: one
 * chat per agent run, one live chat per job (23505), so a second driver
 * leaves it. Anything else that fails throws.
 */
export async function openHeadlessRun(input: HeadlessRunInput): Promise<HeadlessRun | null> {
  const what = input.origin === 'agent' ? 'agent run' : 'job';
  let conversationId: string;
  if ('id' in input.chat) {
    conversationId = input.chat.id;
  } else {
    const { create } = input.chat;
    try {
      conversationId = await insertId(
        'chat_conversations',
        {
          organization_id: input.organizationId,
          user_id: input.userId,
          brand_id: create.brandId,
          title: create.title.slice(0, 200),
          origin: input.origin,
          ...(create.agentRunId ? { agent_run_id: create.agentRunId } : {}),
          ...(create.scheduleId ? { schedule_id: create.scheduleId } : {}),
        },
        `start the ${what}'s chat`,
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return null;
      throw err;
    }
    // A new chat keeps the brands it touches from its own on (00436), before anything is in it.
    await startTouchedBrands(conversationId);
  }
  // One after the other, so the question comes before its answer.
  const questionId = await insertId(
    'chat_messages',
    {
      conversation_id: conversationId,
      role: 'user',
      content_md: input.message.text,
      context_json: input.message.context,
    },
    `keep the ${what}'s message`,
  );
  const answerId = await insertId(
    'chat_messages',
    {
      conversation_id: conversationId,
      role: 'assistant',
      content_md: '',
      timezone: input.timezone,
    },
    `make the ${what}'s answer`,
  );
  const chatRunId = await insertId(
    'chat_runs',
    {
      message_id: answerId,
      conversation_id: conversationId,
      status: input.status,
      model: input.model,
      effort: input.effort,
      ...(input.status === 'running' ? { started_at: input.now.toISOString() } : {}),
    },
    `make the ${what}'s Chat run`,
  );
  const { error } = await supabaseAdmin.from('chat_run_state').insert({
    run_id: chatRunId,
    organization_id: input.organizationId,
    user_id: input.userId,
    mode: input.mode,
    progress: {
      ...newProgress(input.timezone, input.brandId, 'read'),
      question: input.question ?? input.message.text,
      ...input.progress,
    } as unknown as Json,
    heartbeat_at: input.now.toISOString(),
  });
  if (error) throw new Error(`Could not keep the ${what}: ${error.message}`);
  return { conversationId, questionId, answerId, chatRunId };
}
