import { NextResponse } from 'next/server';
import { prepareResume } from '@/lib/chat/engine';
import {
  afterSeqOf,
  chatActor,
  engineFailureResponse,
  runFailure,
  runIdOf,
  streamRun,
} from '@/lib/chat/runApi';

export const maxDuration = 300;

/**
 * POST /api/chat/runs/{id}/skip?after={seq}
 *
 * Skip on the card the run waits on: `{ n }`. The change isn't made, the
 * model is told so, and the run goes on; its events stream back as on POST
 * /api/chat/runs. 409 `not_waiting` when the run no longer waits on that step.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const runId = runIdOf((await params).id);
    if (!runId) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const body = await req.json().catch(() => null);
    const prepared = await prepareResume(actor, runId, 'skip', body);
    if (!prepared.ok) return engineFailureResponse(prepared);
    return streamRun(req, actor, runId, { resume: prepared.resume, afterSeq: afterSeqOf(req) });
  } catch (error) {
    console.error('[chat/runs] could not skip:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to skip');
  }
}
