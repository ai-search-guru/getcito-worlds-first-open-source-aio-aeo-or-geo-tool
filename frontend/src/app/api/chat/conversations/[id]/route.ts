import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  chatIdOf,
  deleteChat,
  readChat,
  updateChat,
  updateInput,
  type ChatListItem,
} from '@/lib/chat/conversations';
import { chatActor, runFailure } from '@/lib/chat/runApi';
import { loadChatThread, type ThreadMessage } from '@/lib/chat/thread';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/chat/conversations/{id}
 *
 * One chat as its page and the side panel open it (CHAT-01 item 24): its
 * row, and its messages with each answer's run and steps as kept (never a
 * tool or its debug record). The person's own chat or one shared with the
 * team; anything else, or a deleted chat, is 404 ("This chat isn't
 * available.", item 26).
 *
 * PATCH /api/chat/conversations/{id} `{ pinned?, title?, shared?, archived? }`
 *
 * The ⋯ menu's Pin, Rename, Share with team and Archive, and their
 * reverses (CHAT-23 G9): the author's own chat only, else 404; answers its
 * new row.
 *
 * DELETE /api/chat/conversations/{id}
 *
 * Delete (CHAT-23 `chat.delete`): its running agent is stopped first, then
 * it is gone for every member; Undo (…/restore) brings it back for a
 * minute. The author's, or an Admin's for a shared chat; else 404.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777).
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = chatIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const chat = await readChat(await createClient(), actor, id);
    const thread = chat ? await loadChatThread(id) : null;
    if (!chat || !thread) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json<{ ok: true; chat: ChatListItem; messages: ThreadMessage[] }>({
      ok: true,
      chat,
      messages: thread.messages,
    });
  } catch (error) {
    console.error('[chat/conversations] could not read a chat:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the chat');
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = chatIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const patch = updateInput.safeParse(await req.json().catch(() => null));
    if (!patch.success) return runFailure(400, 'failed', 'invalid', 'Invalid change');
    const chat = await updateChat(await createClient(), actor, id, patch.data);
    if (!chat) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json<{ ok: true; chat: ChatListItem }>({ ok: true, chat });
  } catch (error) {
    console.error('[chat/conversations] could not change a chat:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to change the chat');
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = chatIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const deleted = await deleteChat(actor, id);
    if (!deleted.ok) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[chat/conversations] could not delete a chat:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to delete the chat');
  }
}
