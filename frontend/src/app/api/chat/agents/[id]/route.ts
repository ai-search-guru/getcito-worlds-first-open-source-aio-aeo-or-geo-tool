import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  agentContextFor,
  agentIdOf,
  agentRefusalResponse,
  invalidAgentResponse,
  type AgentParams,
} from '@/lib/chat/agentApi';
import { updateAgentInput } from '@/lib/chat/agentRules';
import { changeAgentState, readAgent, updateAgent, type AgentDetail } from '@/lib/chat/agents';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/agents/{id}
 *
 * An agent's detail (CHAT-21 §C): its settings (the current version), its
 * triggers with their next fire, its last runs, its AI use as shares of the
 * monthly limit (CHAT-27 item 25) and what the person may do with it. One
 * they can't see is 404.
 *
 * PATCH /api/chat/agents/{id} `{ expectedVersion?, name?, visibility?,
 * maxRunShare?, maxMonthShare?, skills?, instructions?, mode?, connections?,
 * model?, effort?, scope?, notifyUserIds?, followupDays?, triggers? }`
 *
 * Settings' save (§C item 14): a change to what it does is a new version,
 * never an edit of one; `triggers` replaces them all. Its owner (an Admin
 * or Manager) or an Admin; not while archived.
 *
 * DELETE /api/chat/agents/{id}
 *
 * Delete, once archived (§B item 7, §G): its runs, chats and files stay.
 *
 * Refusals as values (`{ ok: false, failure, code, error, denial? }`,
 * #1777): 400, 401, 402 (read-only, demo brand), 403 (CHAT-20 §4c), 404,
 * 409 (a name taken, a save over another, the wrong state).
 */
export async function GET(_req: Request, { params }: AgentParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = agentIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const agent = await readAgent(ctx, id);
    if (!agent) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json<{ ok: true; agent: AgentDetail }>({ ok: true, agent });
  } catch (error) {
    console.error('[chat/agents] could not read an agent:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the agent');
  }
}

export async function PATCH(req: Request, { params }: AgentParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = agentIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const patch = updateAgentInput.safeParse(await req.json().catch(() => null));
    if (!patch.success) return invalidAgentResponse();
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const result = await updateAgent(ctx, id, patch.data);
    if (!result.ok) return agentRefusalResponse(result.refusal);
    return NextResponse.json<{ ok: true; agent: AgentDetail }>({ ok: true, agent: result.value });
  } catch (error) {
    console.error('[chat/agents] could not change an agent:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to change the agent');
  }
}

export async function DELETE(_req: Request, { params }: AgentParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = agentIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const result = await changeAgentState(ctx, id, 'delete');
    if (!result.ok) return agentRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[chat/agents] could not delete an agent:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to delete the agent');
  }
}
