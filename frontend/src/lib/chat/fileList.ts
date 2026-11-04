import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { createClient } from '@/lib/supabase/server';
import { searchTermsOf } from './conversations';
import type { ChatActor } from './engine';
import { maskIds, type ChatDeliverable } from './events';
import { readChatStorage } from './fileOutput';
import {
  FILE_FILTERS,
  FILES_PAGE_ROWS,
  type ChatFileFilter,
  type ChatFileItem,
  type ChatStorage,
  type FileMaker,
} from './files';

/**
 * The Files page's rows (CHAT-06 items 16–17, 24; mockup `#s-files`): the
 * workspace's files, newest first, 50 at a time, under a filter and the
 * words typed in "Filter by name…" (title, summary and tags). Files belong
 * to the workspace, so every member reads them (00411's policy, read as
 * them); a file's chat is named only when they can open it.
 */

type Reader = Awaited<ReturnType<typeof createClient>>;

/** The type each type chip keeps. */
const TYPE_OF: Partial<Record<ChatFileFilter, ChatDeliverable['type']>> = {
  drafts: 'document',
  reports: 'report',
  code: 'code',
  tables: 'table',
  images: 'image',
};

export const fileListQuery = z.object({
  filter: z.enum(FILE_FILTERS).catch('all'),
  q: z.string().max(200).catch(''),
  offset: z.coerce.number().int().min(0).max(100_000).catch(0),
});
export type FileListQuery = z.output<typeof fileListQuery>;

export interface ChatFileList {
  files: ChatFileItem[];
  hasMore: boolean;
  storage: ChatStorage;
}

const FILE_COLUMNS =
  'id, title, type, formats, origin, created_by, conversation_id, content_draft_id, size_bytes, generated_at, data_as_of, timezone';

interface FileRow {
  id: string;
  title: string;
  type: ChatDeliverable['type'];
  formats: string[];
  origin: 'task' | 'chat' | 'schedule' | 'editor';
  created_by: string | null;
  conversation_id: string | null;
  content_draft_id: string | null;
  size_bytes: number | string;
  generated_at: string;
  data_as_of: string | null;
  timezone: string | null;
}

function makerOf(row: FileRow, actor: ChatActor, names: Map<string, string | null>): FileMaker {
  if (row.origin === 'task') return { kind: 'agent' };
  if (row.origin === 'schedule') return { kind: 'schedule' };
  if (row.created_by === actor.userId) return { kind: 'you' };
  return { kind: 'member', name: row.created_by ? (names.get(row.created_by) ?? null) : null };
}

/** A page of the workspace's files, with its storage for the meter. A read that fails throws. */
export async function listChatFiles(
  reader: Reader,
  actor: ChatActor,
  query: FileListQuery,
): Promise<ChatFileList> {
  let files = reader
    .from('chat_files')
    .select(FILE_COLUMNS)
    .eq('organization_id', actor.organizationId);
  const type = TYPE_OF[query.filter];
  if (type) files = files.eq('type', type);
  if (query.filter === 'me') files = files.eq('created_by', actor.userId);
  if (query.filter === 'agents') files = files.in('origin', ['task', 'schedule']);
  const terms = searchTermsOf(query.q);
  if (terms) files = files.textSearch('search_tsv', terms, { config: 'simple' });

  // One row past the page says whether there is more.
  const [read, storage] = await Promise.all([
    files
      .order('created_at', { ascending: false })
      .range(query.offset, query.offset + FILES_PAGE_ROWS),
    readChatStorage(actor.organizationId),
  ]);
  if (read.error) throw new Error(`Could not read Files: ${read.error.message}`);
  const rows = ((read.data ?? []) as unknown as FileRow[]).slice(0, FILES_PAGE_ROWS);

  const chatIds = [
    ...new Set(rows.map((r) => r.conversation_id).filter((id): id is string => !!id)),
  ];
  const memberIds = [
    ...new Set(
      rows.map((r) => r.created_by).filter((id): id is string => !!id && id !== actor.userId),
    ),
  ];
  const [chats, members] = await Promise.all([
    // As the person: a chat they can't open stays unnamed.
    chatIds.length
      ? reader
          .from('chat_conversations')
          .select('id, title')
          .in('id', chatIds)
          .is('deleted_at', null)
      : Promise.resolve({ data: [], error: null }),
    // Other members' profiles are hidden from the person (their policy): read
    // with the server's client, kept to this workspace, for the names only.
    memberIds.length
      ? supabaseAdmin
          .from('profiles')
          .select('id, full_name')
          .in('id', memberIds)
          .eq('organization_id', actor.organizationId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (chats.error) throw new Error(`Could not read the files' chats: ${chats.error.message}`);
  if (members.error) throw new Error(`Could not read the files' authors: ${members.error.message}`);
  const chatTitle = new Map(
    ((chats.data ?? []) as { id: string; title: string | null }[]).map((c) => [c.id, c.title]),
  );
  const names = new Map(
    ((members.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [
      p.id,
      p.full_name,
    ]),
  );

  return {
    files: rows.map((row) => ({
      id: row.id,
      title: maskIds(row.title),
      type: row.type,
      formats: row.formats,
      madeBy: makerOf(row, actor, names),
      chat:
        row.conversation_id && chatTitle.has(row.conversation_id)
          ? {
              href: `/dashboard/chat/${row.conversation_id}`,
              title: maskIds(chatTitle.get(row.conversation_id) ?? '') || null,
            }
          : null,
      draftHref: row.content_draft_id ? `/dashboard/content/editor/${row.content_draft_id}` : null,
      sizeBytes: Number(row.size_bytes),
      generatedAt: row.generated_at,
      dataAsOf: row.data_as_of,
      timezone: row.timezone,
    })),
    hasMore: (read.data ?? []).length > FILES_PAGE_ROWS,
    storage,
  };
}
