import { NextResponse } from 'next/server';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/runApi';
import { readWhyAnswer } from '@/lib/chat/why/answer';

type Params = { params: Promise<{ id: string; n: string; cause: string; row: string }> };

/** A place in a list, from 1 for n and from 0 for a cause or a row; null otherwise. */
const placeOf = (value: string, min: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n < 1000 ? n : null;
};

/**
 * GET /api/chat/runs/{id}/why/{n}/{cause}/{row}
 *
 * The evidence drawer's answer on a Why card (CHAT-22 §1 item 4): the
 * engine, its day, a passage with the brand named, and the pages it cited,
 * of the row's answer in the run's n-th analysis. Read as the person: only
 * a chat they can open (their own, or one shared with them); anything else
 * is 404.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const path = await params;
    const runId = runIdOf(path.id);
    const n = placeOf(path.n, 1);
    const cause = placeOf(path.cause, 0);
    const row = placeOf(path.row, 0);
    if (!runId || n === null || cause === null || row === null) {
      return runFailure(404, 'not_found', 'not_found', 'Not found');
    }
    const answer = await readWhyAnswer(runId, n, cause, row);
    if (!answer) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json({ answer }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[chat/runs] could not read a Why answer:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the answer');
  }
}
