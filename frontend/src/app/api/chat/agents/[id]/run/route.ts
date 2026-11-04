import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  agentContextFor,
  agentIdOf,
  agentRefusalResponse,
  invalidAgentResponse,
  type AgentParams,
} from '@/lib/chat/agentApi';
import { runAgentNow, runAgentOnAction, type RunNowItem } from '@/lib/chat/agentRuns';
import { runNowInput } from '@/lib/chat/agentRules';
import { chatActor, runFailure } from '@/lib/chat/runApi';

// A run that starts is driven past the answer (the agent run driver's after()), within this.
export const maxDuration = 300;

/**
 * POST /api/chat/agents/{id}/run `{ brandId? } | { actionId }`
 *
 * Run now (CHAT-21 §E Manual): a run per brand of the agent's scope, or
 * for the one brand named, queued and acting as the person; started when
 * the workspace has room (§M). A second click within a minute is the
 * first; past 3 waiting, it joins the last. Admins and Managers (a
 * Manager's own private agent, or any workspace agent); never an archived
 * agent. 202 with each brand's run state, never a run's id.
 *
 * With `actionId`, Run agent on an Action Center action (CHAT-21 §F): one
 * run on the action's brand, scoped to the action. 202 with its state and,
 * once it started, its chat (`chatId`, the person's own) for the side
 * panel, or why a run that ended before it started stopped (`stopReason`).
 * 404 an action the person can't see, 409 a closed one or 3 runs waiting
 * on other actions, 402 the demo brand's, 400 an agent whose scope doesn't
 * cover its brand.
 *
 * Refusals as values (#1777): 400 a bad body or a brand outside its scope,
 * 402 read-only, 403 the out-of-permission answer (CHAT-20 §4c), 404, 409
 * archived or no brand left, 429 the AI limit used up.
 */
export async function POST(req: Request, { params }: AgentParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = agentIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const input = runNowInput.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return invalidAgentResponse();
    const ctx = await agentContextFor(actor);
    if (ctx instanceof NextResponse) return ctx;
    if (input.data.actionId) {
      const onAction = await runAgentOnAction(ctx, id, input.data.actionId);
      if (!onAction.ok) return agentRefusalResponse(onAction.refusal);
      const { run } = onAction.value;
      return NextResponse.json<{
        ok: true;
        runs: RunNowItem[];
        chatId: string | null;
        stopReason: string | null;
      }>(
        {
          ok: true,
          runs: [
            {
              brand: run.brand,
              status: run.status,
              repeated: run.repeated,
              coalesced: run.coalesced,
            },
          ],
          chatId: run.chatId,
          stopReason: run.stopReason,
        },
        { status: 202 },
      );
    }
    const result = await runAgentNow(ctx, id, input.data);
    if (!result.ok) return agentRefusalResponse(result.refusal);
    return NextResponse.json<{ ok: true; runs: RunNowItem[] }>(
      { ok: true, runs: result.value.runs },
      { status: 202 },
    );
  } catch (error) {
    console.error('[chat/agents] could not run an agent:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to run the agent');
  }
}
