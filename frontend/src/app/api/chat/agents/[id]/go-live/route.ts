import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  agentContextFor,
  agentIdOf,
  agentRefusalResponse,
  invalidAgentResponse,
  type AgentParams,
} from '@/lib/chat/agentApi';
import type { AgentGoLiveDetail } from '@/lib/chat/agentGoLive';
import { setAgentGoLive } from '@/lib/chat/agentGoLivePermission';
import { GO_LIVE_LIMIT_MAX, GO_LIVE_LIMIT_MIN } from '@/lib/chat/goLive';
import { readAgent } from '@/lib/chat/agents';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/agents/{id}/go-live
 *
 * An agent's permission to publish and send on its own (AUTONOMOUS-GO-LIVE
 * §7.2): the workspace's switch, the permission (for which version, its
 * daily limit, who gave it and when) and its last day's go-lives. For
 * whoever may see the agent; `goLive: null` while CHAT_AUTO_GO_LIVE is off.
 *
 * PUT /api/chat/agents/{id}/go-live `{ dailyLimit }` (1–20)
 *
 * An Admin gives it for the version the agent is on, or changes its limit.
 * Needs the workspace's switch on (go_live_off), Full auto open to agents
 * (403 as the precedence says) and the agent in Full auto (go_live_mode).
 * Its own request, never part of the agent's save: a Manager's edit can't
 * carry it.
 *
 * DELETE /api/chat/agents/{id}/go-live
 *
 * An Admin takes it away.
 *
 * Refusals as values (#1777): 400, 401, 402 (read-only), 403 (CHAT-20 §4c:
 * not an Admin), 404, 409.
 */

const putInput = z.strictObject({
  dailyLimit: z.number().int().min(GO_LIVE_LIMIT_MIN).max(GO_LIVE_LIMIT_MAX),
});

type Answer = { ok: true; goLive: AgentGoLiveDetail | null };

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
    return NextResponse.json<Answer>({ ok: true, goLive: agent.goLive ?? null });
  } catch (error) {
    console.error('[chat/agents] could not read an agent’s go-live permission:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the agent');
  }
}

/** PUT and DELETE: an Admin's change, as a value. */
async function change(req: Request, { params }: AgentParams, give: boolean) {
  const actor = await chatActor();
  if (actor instanceof NextResponse) return actor;
  const refusal = await writeRefusal();
  if (refusal) return refusal;
  const id = agentIdOf((await params).id);
  if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
  let dailyLimit: number | null = null;
  if (give) {
    const body = putInput.safeParse(await req.json().catch(() => null));
    if (!body.success) return invalidAgentResponse();
    dailyLimit = body.data.dailyLimit;
  }
  const ctx = await agentContextFor(actor);
  if (ctx instanceof NextResponse) return ctx;
  const result = await setAgentGoLive(ctx, id, dailyLimit);
  if (!result.ok) return agentRefusalResponse(result.refusal);
  return NextResponse.json<Answer>({ ok: true, goLive: result.detail });
}

export async function PUT(req: Request, context: AgentParams) {
  try {
    return await change(req, context, true);
  } catch (error) {
    console.error('[chat/agents] could not give an agent its go-live permission:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to change the agent');
  }
}

export async function DELETE(req: Request, context: AgentParams) {
  try {
    return await change(req, context, false);
  } catch (error) {
    console.error('[chat/agents] could not take an agent’s go-live permission away:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to change the agent');
  }
}
