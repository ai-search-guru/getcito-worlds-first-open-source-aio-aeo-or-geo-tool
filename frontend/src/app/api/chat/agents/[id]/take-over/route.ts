import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  agentContextFor,
  agentIdOf,
  agentRefusalResponse,
  type AgentParams,
} from '@/lib/chat/agentApi';
import { takeOverAgent, type AgentDetail } from '@/lib/chat/agents';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * POST /api/chat/agents/{id}/take-over
 *
 * Take over (CHAT-21 §G item 34, edge case 1): the Admin becomes the
 * agent's owner, whom its triggered runs act as. An agent that is on, or
 * paused because of its owner, passes the activation checks under its new
 * owner first; one paused because of its owner turns on again. Admins only;
 * not an archived agent. Answers its detail.
 *
 * Refusals as values (#1777): 402 read-only, 403 the out-of-permission
 * answer (CHAT-20 §4c) or the plan's active agents, 404, 409 archived or no
 * brand left, 429 the AI limit used up.
 */
export async function POST(_req: Request, { params }: AgentParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = agentIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const result = await takeOverAgent(ctx, id);
    if (!result.ok) return agentRefusalResponse(result.refusal);
    return NextResponse.json<{ ok: true; agent: AgentDetail }>({ ok: true, agent: result.value });
  } catch (error) {
    console.error('[chat/agents] could not take an agent over:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to take the agent over');
  }
}
