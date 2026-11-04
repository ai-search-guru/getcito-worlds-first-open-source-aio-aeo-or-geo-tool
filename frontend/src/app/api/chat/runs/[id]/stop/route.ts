import { NextResponse } from 'next/server';
import { stopChatRun } from '@/lib/chat/engine';
import { chatActor, engineFailureResponse, runFailure, runIdOf } from '@/lib/chat/runApi';

/**
 * POST /api/chat/runs/{id}/stop
 *
 * The person's Stop (CHAT-02, CHAT-03 item 19): the running step turns
 * skipped, the text so far stays, and the run's stream says "Stopped after …"
 * (`run.stopped`). Answers `{ ok: true }`, also for a run that already ended.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const runId = runIdOf((await params).id);
    if (!runId) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const stopped = await stopChatRun(actor, runId);
    if (!stopped.ok) return engineFailureResponse(stopped);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[chat/runs] could not stop a run:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to stop');
  }
}
