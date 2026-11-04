import { NextResponse } from 'next/server';
import { startChatRun } from '@/lib/chat/engine';
import { bodyHasApiKey } from '@/lib/chat/keyPaste';
import {
  apiKeyRefusal,
  chatActor,
  demoBrandRefusal,
  engineFailureResponse,
  runFailure,
  streamRun,
} from '@/lib/chat/runApi';

/** A run works up to the function's limit; it waits for a slot within it. */
export const maxDuration = 300;

/**
 * POST /api/chat/runs
 *
 * A new message to Chat (CHAT-00: one run, one answer): `{ message,
 * conversationId?, brandId?, mode?, timezone?, shortcutId? }`. A shortcut
 * (CHAT-08, W2-09) counts only while the message is still its own, and is
 * kept on the message (chat_messages.shortcut_id): the run then loads its
 * playbook and reads only its data plan. Keeps the message, starts
 * the run (or queues it while every slot is busy, CHAT-20 §14) and answers
 * with its events as Server-Sent Events, until the run waits on the person or
 * ends; the run goes on if the browser leaves. The chat and the run come in
 * the `x-chat-conversation` and `x-chat-run` headers, never in an event.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`): 400 a bad
 * body, or `api_key` for a message that holds an API key (W4-05: never
 * kept, sent to a model or logged), 401 no session, 402 a read-only
 * workspace (the server's subscription_inactive body) or a chat on the demo
 * brand (its demo_brand body: the demo's chats are sample data), 404 Chat off for the
 * workspace (CHAT_AGENTIC) or a chat that isn't the person's, 429 past the
 * message limits.
 */
export async function POST(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const body = await req.json().catch(() => null);
    if (bodyHasApiKey(body, 'message')) return apiKeyRefusal();
    const demo = await demoBrandRefusal(actor, body);
    if (demo) return demo;
    const started = await startChatRun(actor, body);
    if (!started.ok) return engineFailureResponse(started);
    return streamRun(req, actor, started.runId, {
      headers: { 'x-chat-conversation': started.conversationId, 'x-chat-run': started.runId },
    });
  } catch (error) {
    console.error('[chat/runs] could not start a run:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to start the run');
  }
}
