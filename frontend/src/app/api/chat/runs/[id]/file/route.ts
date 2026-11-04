import { NextResponse } from 'next/server';
import { saveRunAnswer } from '@/lib/chat/fileStore';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/runApi';
import { writeRefusal } from '@/lib/subscriptionGuard';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/chat/runs/{id}/file
 *
 * Save to Files (CHAT-06 items 36–37): the answer filed as a document of
 * the workspace, once; a filed answer answers its file (`already`). Every
 * role may file what it can open. A read-only workspace is refused (402),
 * and a full one files nothing new (409 storage_full, item 29).
 */
export async function POST(_req: Request, { params }: Params) {
  try {
    const refused = await writeRefusal();
    if (refused) return refused;
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const runId = runIdOf((await params).id);
    if (!runId) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const saved = await saveRunAnswer(actor, runId);
    if (saved.ok) return NextResponse.json(saved, { status: saved.already ? 200 : 201 });
    if (saved.failure === 'not_found') {
      return runFailure(404, 'not_found', 'not_found', 'Not found');
    }
    if (saved.failure === 'storage_full') {
      return runFailure(409, 'failed', 'storage_full', 'Storage is full');
    }
    return runFailure(500, 'failed', 'failed', 'Failed to save the file');
  } catch (error) {
    console.error('[chat/runs] could not save an answer to Files:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to save the file');
  }
}
