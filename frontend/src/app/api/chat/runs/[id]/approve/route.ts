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
 * POST /api/chat/runs/{id}/approve?after={seq}
 *
 * The person's OK on the card the run waits on, or their click on an
 * EXECUTE: `{ n, digest, dontAskAgain? }`, the step and the digest the card
 * came with (CHAT-20 §6). The call is decided again on facts read now, and
 * the run goes on; its events after `after` stream back as on POST
 * /api/chat/runs. 409 `approval_mismatch` when the card changed since
 * (it is shown again), 409 `not_waiting` when the run no longer waits; 402
 * while read-only, but for a request to the Admins.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const runId = runIdOf((await params).id);
    if (!runId) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const body = await req.json().catch(() => null);
    const prepared = await prepareResume(actor, runId, 'approve', body);
    if (!prepared.ok) return engineFailureResponse(prepared);
    return streamRun(req, actor, runId, { resume: prepared.resume, afterSeq: afterSeqOf(req) });
  } catch (error) {
    console.error('[chat/runs] could not approve:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to approve');
  }
}
