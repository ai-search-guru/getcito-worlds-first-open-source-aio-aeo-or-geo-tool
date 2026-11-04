import { NextResponse } from 'next/server';
import { z } from 'zod';
import { agentContextFor, agentRefusalResponse } from '@/lib/chat/agentApi';
import { compatibleAgents, type CompatibleAgents } from '@/lib/chat/agentAction';
import { agentActDenial } from '@/lib/chat/agentRules';
import { denied } from '@/lib/chat/agents';
import { chatActor, runFailure } from '@/lib/chat/runApi';

const query = z.object({ actionId: z.guid() });

/**
 * GET /api/chat/agents/compatible?actionId=
 *
 * Run agent's picker on an Action Center action (CHAT-21 §F item 27): the
 * agents the person may run whose scope covers the action's brand, last
 * used on this kind of action first, and the skill "Create an agent for
 * this kind of action" starts from. Admins and Managers (§K item 51).
 *
 * Refusals as values (#1777): 400 a bad query, 401 no session, 402 the
 * demo brand's action, 403 the out-of-permission answer (CHAT-20 §4c), 404
 * Chat off for the workspace (CHAT_AGENTIC) or an action the person can't
 * see, 409 a closed action.
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const input = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!input.success) return runFailure(400, 'failed', 'invalid', 'Invalid query');
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    const denial = agentActDenial('run', ctx.viewer, null, ctx.settings);
    if (denial) return agentRefusalResponse((await denied(ctx, denial)).refusal);
    const result = await compatibleAgents(ctx, input.data.actionId);
    if (!result.ok) return agentRefusalResponse(result.refusal);
    return NextResponse.json<{ ok: true } & CompatibleAgents>({ ok: true, ...result.value });
  } catch (error) {
    console.error('[chat/agents] could not read the agents for an action:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the agents');
  }
}
