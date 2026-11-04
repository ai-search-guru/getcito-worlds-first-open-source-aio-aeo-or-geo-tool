import { NextResponse } from 'next/server';
import {
  memoryIdOf,
  memoryRefusalResponse,
  memoryViewerFor,
  missingMemoryResponse,
  type MemoryParams,
} from '@/lib/chat/memory/api';
import { restoreMemory } from '@/lib/chat/memory/store';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * POST /api/chat/memory/{id}/restore
 *
 * Undo (CHAT-14 item 23): brings a line deleted in the last 10 seconds
 * back. After that the minute tick deleted it for good: 409 undo_expired.
 * A read-only workspace's person may still bring back their own Me line
 * (the store answers 402 for the rest), as they may delete it.
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 401,
 * 402, 403, 404 a line they can't see, 409 too late or the scope full.
 */
export async function POST(_req: Request, { params }: MemoryParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = memoryIdOf((await params).id);
    if (!id) return missingMemoryResponse();
    const viewer = await memoryViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await restoreMemory(viewer, id);
    if (!result.ok) return memoryRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[chat/memory] could not bring a line back:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to undo');
  }
}
