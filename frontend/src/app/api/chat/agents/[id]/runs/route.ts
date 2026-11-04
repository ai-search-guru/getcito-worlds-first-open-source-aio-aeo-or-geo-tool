import { NextResponse } from 'next/server';
import { agentContextFor, agentIdOf, type AgentParams } from '@/lib/chat/agentApi';
import { agentRunsQuery } from '@/lib/chat/agentRules';
import { listAgentRuns, type AgentRunView } from '@/lib/chat/agents';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/agents/{id}/runs?limit=
 *
 * The agent's Runs tab (CHAT-21 §C item 13): its last runs (50 at most),
 * newest first, each with its trigger, version, brand, the person it acted
 * as, its state and outcome, its AI use against its cap as shares, and its
 * chat's handle once it has one. Whoever sees the agent; else 404.
 */
export async function GET(req: Request, { params }: AgentParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = agentIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const query = agentRunsQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!query.success) return runFailure(400, 'failed', 'invalid', 'Invalid query');
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const runs = await listAgentRuns(ctx, id, query.data.limit);
    if (!runs) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json<{ ok: true; runs: AgentRunView[] }>({ ok: true, runs });
  } catch (error) {
    console.error('[chat/agents] could not read runs:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the runs');
  }
}
