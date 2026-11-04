import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import { agentStateResponse, type AgentParams } from '@/lib/chat/agentApi';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * POST /api/chat/agents/{id}/pause
 *
 * Pause (CHAT-21 §G): an active agent pauses for a person's reason
 * (`manual`); its triggers stop firing, Run now still works. Its owner or
 * an Admin.
 *
 * Answers the agent's detail. Refusals as values (#1777): 402 read-only,
 * 403 the out-of-permission answer (CHAT-20 §4c), 404, 409 the wrong state.
 */
export async function POST(_req: Request, { params }: AgentParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    return await agentStateResponse(actor, (await params).id, 'pause');
  } catch (error) {
    console.error('[chat/agents] could not pause an agent:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to pause the agent');
  }
}
