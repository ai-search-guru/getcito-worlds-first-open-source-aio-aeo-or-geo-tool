import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import { agentContextFor, agentRefusalResponse, invalidAgentResponse } from '@/lib/chat/agentApi';
import { agentListQuery, createAgentInput } from '@/lib/chat/agentRules';
import { createAgent, listAgents, type AgentDetail, type AgentListResult } from '@/lib/chat/agents';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/agents?view=mine|workspace|paused|archived&q=
 *
 * Chat › Agents (CHAT-21 §B): the agents the person may see in a tab, with
 * each tab's count, the active count and the plan's cap. Every role reads;
 * a private agent only its owner and the Admins (§K item 51).
 *
 * POST /api/chat/agents `{ name, visibility?, maxRunShare?, maxMonthShare?,
 * skills, instructions?, mode?, connections?, model?, effort?, scope,
 * notifyUserIds?, followupDays?, triggers? }`
 *
 * A new agent as a draft (§D item 17): 201 with its detail. Admins and
 * Managers (§D item 20); `scope`, `connections` and each trigger's `config`
 * in the shape they are kept (snake_case). Shares, never dollars:
 * maxRunShare 0.01–0.50 (default: Settings › Chat's), maxMonthShare an
 * Admin's.
 *
 * Refusals as values (`{ ok: false, failure, code, error, denial? }`,
 * #1777): 400 a bad body, 401 no session, 402 a read-only workspace or the
 * demo brand, 403 the out-of-permission answer (CHAT-20 §4c), 404 Chat off
 * for the workspace (CHAT_AGENTIC), 409 a name taken.
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const query = agentListQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!query.success) return runFailure(400, 'failed', 'invalid', 'Invalid query');
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const list = await listAgents(ctx, query.data);
    return NextResponse.json<{ ok: true } & AgentListResult>({ ok: true, ...list });
  } catch (error) {
    console.error('[chat/agents] could not list agents:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read agents');
  }
}

export async function POST(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const input = createAgentInput.safeParse(await req.json().catch(() => null));
    if (!input.success) return invalidAgentResponse();
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const result = await createAgent(ctx, input.data);
    if (!result.ok) return agentRefusalResponse(result.refusal);
    return NextResponse.json<{ ok: true; agent: AgentDetail }>(
      { ok: true, agent: result.value },
      { status: 201 },
    );
  } catch (error) {
    console.error('[chat/agents] could not create an agent:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to create the agent');
  }
}
