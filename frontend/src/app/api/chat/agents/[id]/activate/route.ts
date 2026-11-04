import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import { agentStateResponse, type AgentParams } from '@/lib/chat/agentApi';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * POST /api/chat/agents/{id}/activate
 *
 * Activate (CHAT-21 §D item 18, §G): a draft turns on after the activation
 * checks (item 21): the plan's active agents, Full auto and engines, a
 * brand in scope, the AI limit. The person becomes its owner, whom its
 * triggered runs act as. The draft's owner or an Admin.
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
    return await agentStateResponse(actor, (await params).id, 'activate');
  } catch (error) {
    console.error('[chat/agents] could not turn on an agent:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to turn on the agent');
  }
}
