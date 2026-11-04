import { NextResponse } from 'next/server';
import { afterSeqOf, chatActor, ownsRun, runFailure, runIdOf, tailRun } from '@/lib/chat/runApi';

export const maxDuration = 300;

/**
 * GET /api/chat/runs/{id}/events?after={seq}
 *
 * A run's events after the last one the browser got, then the new ones as
 * they come, until the run waits on the person or ends (CHAT-03 item 21: a
 * lost connection resumes where it was; `after=0` rebuilds the run after a
 * reload). Server-Sent Events, the seq as each event's id. The run's own
 * person only; 404 otherwise or while Chat is off.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const runId = runIdOf((await params).id);
    if (!runId || !(await ownsRun(actor, runId))) {
      return runFailure(404, 'not_found', 'not_found', 'Not found');
    }
    const lastEventId = Number(req.headers.get('last-event-id') ?? 0);
    const afterSeq = Math.max(afterSeqOf(req), Number.isInteger(lastEventId) ? lastEventId : 0);
    return tailRun(req, runId, afterSeq);
  } catch (error) {
    console.error('[chat/runs] could not read a run’s events:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read events');
  }
}
