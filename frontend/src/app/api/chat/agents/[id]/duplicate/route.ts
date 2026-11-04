import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  agentContextFor,
  agentIdOf,
  agentRefusalResponse,
  type AgentParams,
} from '@/lib/chat/agentApi';
import { duplicateAgent, type AgentDetail } from '@/lib/chat/agents';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * POST /api/chat/agents/{id}/duplicate
 *
 * Duplicate (CHAT-21 edge case 12): the agent's current version as a new
 * draft, "{name} copy", owned by the person, its triggers copied switched
 * off. Admins and Managers. 201 with the copy's detail.
 *
 * Refusals as values (#1777): 402 read-only, 403 the out-of-permission
 * answer (CHAT-20 §4c), 404.
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
    const result = await duplicateAgent(ctx, id);
    if (!result.ok) return agentRefusalResponse(result.refusal);
    return NextResponse.json<{ ok: true; agent: AgentDetail }>(
      { ok: true, agent: result.value },
      { status: 201 },
    );
  } catch (error) {
    console.error('[chat/agents] could not duplicate an agent:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to duplicate the agent');
  }
}
