import { NextResponse } from 'next/server';
import { fileListQuery, listChatFiles, type ChatFileList } from '@/lib/chat/fileList';
import { chatActor, runFailure } from '@/lib/chat/runApi';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/chat/files?filter=&q=&offset=
 *
 * The Files page (CHAT-06 items 16–17, 26–29): the workspace's files,
 * newest first, 50 at a time under a filter chip and "Filter by name…",
 * with the storage they take and the plan allows. Every member reads them.
 * A query it can't read falls back to all files from the top.
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const query = fileListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    const list = await listChatFiles(await createClient(), actor, query);
    return NextResponse.json<{ ok: true } & ChatFileList>({ ok: true, ...list });
  } catch (error) {
    console.error('[chat/files] could not list files:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read Files');
  }
}
