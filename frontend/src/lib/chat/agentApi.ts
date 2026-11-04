import { NextResponse } from 'next/server';
import type { ApiFailure } from '@/lib/apiFailure';
import type { AgentLifecycleAction } from './agentRules';
import {
  changeAgentState,
  readAgentContext,
  refused,
  type AgentContext,
  type AgentDetail,
  type AgentRefusal,
} from './agents';
import type { ChatActor } from './engine';
import { runFailure } from './runApi';

/**
 * What the agents routes (/api/chat/agents…) share: the person's agent
 * context, an agent's id from the path, and refusals as values the browser
 * reads (#1777): `{ ok: false, failure, code, error }`, with the
 * out-of-permission answer's four parts as `denial` (CHAT-20 §4c) and what
 * it refused as `asked` (chatAgents.asked: `fullAuto`, `workspace`…).
 * Server only.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An agent id from the path, or null. */
export const agentIdOf = (value: string) => (UUID.test(value) ? value : null);

export type AgentParams = { params: Promise<{ id: string }> };

/** The person's agent context, or 404 when they can't act in the workspace now. */
export async function agentContextFor(actor: ChatActor): Promise<AgentContext | NextResponse> {
  const ctx = await readAgentContext(actor);
  return ctx ?? runFailure(404, 'not_found', 'not_found', 'Not found');
}

/** A refusal as the browser reads it. */
export function agentRefusalResponse(refusal: AgentRefusal): NextResponse {
  if (refusal.kind === 'denied') {
    const failure: ApiFailure =
      refusal.status === 402 ? 'subscription' : refusal.code === 'plan_locked' ? 'plan' : 'failed';
    return NextResponse.json(
      {
        ok: false,
        failure,
        code: refusal.code,
        error: refusal.denial.rule.detail,
        denial: refusal.denial,
        ...(refusal.asked ? { asked: refusal.asked } : {}),
      },
      { status: refusal.status },
    );
  }
  const failure: ApiFailure =
    refusal.status === 404
      ? 'not_found'
      : refusal.code === 'demo_brand'
        ? 'subscription'
        : refusal.code === 'ai_limit' || refusal.code === 'agent_limit'
          ? 'limit'
          : 'failed';
  return NextResponse.json(
    {
      ok: false,
      failure,
      code: refusal.code,
      error: refusal.message,
      ...(refusal.detail ? { detail: refusal.detail } : {}),
    },
    { status: refusal.status },
  );
}

/** A body that doesn't parse: 400, as a value. */
export const invalidAgentResponse = () => agentRefusalResponse(refused('invalid').refusal);

/**
 * A change of state for a route (activate, pause, resume, archive,
 * restore): the agent's detail after it, or the refusal. The route checks
 * the session and the plan first.
 */
export async function agentStateResponse(
  actor: ChatActor,
  rawId: string,
  action: Exclude<AgentLifecycleAction, 'delete'>,
): Promise<NextResponse> {
  const id = agentIdOf(rawId);
  if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
  const ctx = await agentContextFor(actor);
  if (ctx instanceof NextResponse) return ctx;
  const result = await changeAgentState(ctx, id, action);
  if (!result.ok) return agentRefusalResponse(result.refusal);
  return NextResponse.json({ ok: true, agent: result.value as AgentDetail });
}
