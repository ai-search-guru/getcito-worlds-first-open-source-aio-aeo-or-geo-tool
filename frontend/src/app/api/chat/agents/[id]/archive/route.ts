import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import { agentStateResponse, type AgentParams } from '@/lib/chat/agentApi';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * POST /api/chat/agents/{id}/archive
 *
 * Archive (CHAT-21 §G): the agent moves to Archived; its waiting runs
 * stop, a running one finishes. Its owner or an Admin.
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
    return await agentStateResponse(actor, (await params).id, 'archive');
  } catch (error) {
    console.error('[chat/agents] could not archive an agent:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to archive the agent');
  }
}
