import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  invalidMemoryResponse,
  memoryIdOf,
  memoryRefusalResponse,
  memoryViewerFor,
  missingMemoryResponse,
  type MemoryParams,
} from '@/lib/chat/memory/api';
import { deleteMemory, updateMemory } from '@/lib/chat/memory/store';
import { chatActor, runFailure } from '@/lib/chat/runApi';

const textBody = z.strictObject({ text: z.string().max(2_000) });

/**
 * PATCH /api/chat/memory/{id} `{ text }`
 *
 * Edits a line's words on the Memory page (CHAT-14 item 22): the line's
 * rules again (item 12), its scope's room (item 19). An edited "Call me"
 * line no longer follows the profile.
 *
 * DELETE /api/chat/memory/{id}
 *
 * Deletes it at once (item 23): `{ ok: true, undoUntil }`; POST
 * /api/chat/memory/{id}/restore brings it back until then.
 *
 * Who: Me its person; Brand an Admin or a Manager; Workspace an Admin.
 * While the workspace is read-only a person may still delete their own Me
 * line (their personal data, KVKK/GDPR): the store answers 402 for the
 * rest, so DELETE doesn't check the plan first; PATCH does.
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400,
 * 401, 402 a read-only workspace, 403 a scope they only read, 404 a line
 * they can't see, 409 memory off or full.
 */
export async function PATCH(req: Request, { params }: MemoryParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = memoryIdOf((await params).id);
    if (!id) return missingMemoryResponse();
    const body = textBody.safeParse(await req.json().catch(() => null));
    if (!body.success) return invalidMemoryResponse();
    const viewer = await memoryViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await updateMemory(viewer, id, body.data.text);
    if (!result.ok) return memoryRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true, item: result.value });
  } catch (error) {
    console.error('[chat/memory] could not change a line:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to change the memory');
  }
}

export async function DELETE(_req: Request, { params }: MemoryParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = memoryIdOf((await params).id);
    if (!id) return missingMemoryResponse();
    const viewer = await memoryViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await deleteMemory(viewer, id);
    if (!result.ok) return memoryRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true, undoUntil: result.value.undoUntil });
  } catch (error) {
    console.error('[chat/memory] could not delete a line:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to delete the memory');
  }
}
