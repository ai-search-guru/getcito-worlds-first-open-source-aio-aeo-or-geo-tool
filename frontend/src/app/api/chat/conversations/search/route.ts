import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { searchChats, searchQuery, type ChatListItem } from '@/lib/chat/conversations';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/conversations/search?q=&view=active|archived&limit=
 *
 * Search chats, the Ctrl K palette and All chats' search (CHAT-01 item 6;
 * CHAT-23 G2): the chats whose title or messages hold every word typed,
 * newest first, as the menu's rows. `active` (the default): the person's
 * own and the team's shared chats that aren't archived; `archived`: their
 * own archived chats.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400 a
 * bad query, 401 no session, 404 Chat off for the workspace (CHAT_AGENTIC).
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = searchQuery.safeParse(params);
    if (!query.success) return runFailure(400, 'failed', 'invalid', 'Invalid query');
    const chats = await searchChats(await createClient(), actor, query.data);
    return NextResponse.json<{ ok: true; chats: ChatListItem[] }>({ ok: true, chats });
  } catch (error) {
    console.error('[chat/conversations] could not search chats:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to search chats');
  }
}
