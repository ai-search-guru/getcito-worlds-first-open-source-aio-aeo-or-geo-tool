import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { writeRefusal } from '@/lib/subscriptionGuard';
import { agentContextFor, agentIdOf, agentRefusalResponse } from '@/lib/chat/agentApi';
import { startActionChat } from '@/lib/chat/actionChat';
import { driveRun } from '@/lib/chat/engine';
import { chatActor, engineFailureResponse, runFailure } from '@/lib/chat/runApi';

/** The run works up to the function's limit, past the answer (after()). */
export const maxDuration = 300;

const body = z.object({ timezone: z.string().trim().max(64).optional() });

/**
 * POST /api/chat/actions/{id}/chat `{ timezone? }`
 *
 * Run with Chat on an Action Center action (CHAT-21 §F item 27, the Run
 * agent picker's no-agent choice): starts the person's own Chat run on the
 * action in their default mode, writes "Chat started on this action" to its
 * History, and drives the run past the answer; the side panel opens the
 * chat and follows it. 202 with the chat and whether it waits for a slot;
 * a second click by the same person within 60 seconds answers the same chat
 * (`repeated`) and starts nothing. Admins and Managers.
 *
 * Refusals as values (#1777): 400 a bad body, 401 no session, 402
 * read-only or the demo brand's action, 403 the out-of-permission answer
 * (CHAT-20 §4c), 404 Chat off for the workspace (CHAT_AGENTIC) or an action
 * the person can't see, 409 a closed action, 429 past the message limits.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const actionId = agentIdOf((await params).id);
    if (!actionId) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const input = body.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return runFailure(400, 'failed', 'invalid', 'Invalid body');
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const started = await startActionChat(ctx, actionId, input.data);
    if (!started.ok) {
      return 'engine' in started
        ? engineFailureResponse(started.engine)
        : agentRefusalResponse(started.refusal);
    }
    const { runId, conversationId, queued, repeated } = started.value;
    // Driven here, as a sent message is (streamRun): it goes on when the browser leaves.
    // A repeat's run is already driven by the first click.
    if (runId) {
      after(() =>
        driveRun(actor, runId).catch((err) =>
          console.error('[chat/actions] a Run with Chat run failed:', err),
        ),
      );
    }
    return NextResponse.json(
      { ok: true, chatId: conversationId, queued, repeated },
      { status: 202 },
    );
  } catch (error) {
    console.error('[chat/actions] could not start Chat on an action:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to start Chat');
  }
}
