import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  createChat,
  createInput,
  listChats,
  listQuery,
  type ChatListItem,
  type ChatListResult,
} from '@/lib/chat/conversations';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/conversations?view=active|archived&limit=
 *
 * The chat menu's and All chats' rows (CHAT-01 §6, agentic update): the
 * person's chats and the team's shared ones, newest first, each with its
 * brand's name, its dot (running, needs you, done, failed, idle) and the
 * step it is on in words; with the counts beside "Chats" and "Archived".
 * `archived` lists their own archived chats.
 *
 * POST /api/chat/conversations `{ brandId?, origin?, originPage? }`
 *
 * A new, empty chat (the side panel's New chat): 201 with its row.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400 a
 * bad query or body, 401 no session, 404 Chat off for the workspace
 * (CHAT_AGENTIC) or a brand that isn't the workspace's.
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = listQuery.safeParse(params);
    if (!query.success) return runFailure(400, 'failed', 'invalid', 'Invalid query');
    const list = await listChats(await createClient(), actor, query.data);
    return NextResponse.json<{ ok: true } & ChatListResult>({ ok: true, ...list });
  } catch (error) {
    console.error('[chat/conversations] could not list chats:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read chats');
  }
}

export async function POST(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const input = createInput.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return runFailure(400, 'failed', 'invalid', 'Invalid chat');
    const chat = await createChat(await createClient(), actor, input.data);
    if (!chat) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json<{ ok: true; chat: ChatListItem }>({ ok: true, chat }, { status: 201 });
  } catch (error) {
    console.error('[chat/conversations] could not start a chat:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to start a chat');
  }
}
