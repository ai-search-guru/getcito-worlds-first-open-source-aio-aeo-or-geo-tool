import type { SupabaseClient } from '@supabase/supabase-js';
import { readAssignees } from '@/lib/action-center/assignees';

/**
 * What Chat attached to an action's tasks (CHAT-09 items 13, 16; the owner's
 * decision of 2026-10-31): each task's files and drafts from Files, with who
 * attached them, when, and where they open. Read as the member
 * (chat_file_task_links is readable where its file is, 00411), so a file
 * they can't see isn't listed. A read that fails lists nothing: the drawer
 * still opens.
 */

export interface TaskAttachment {
  fileId: string;
  title: string;
  type: 'document' | 'table' | 'code' | 'image' | 'report';
  attachedAt: string;
  /** Who attached it, by name or e-mail; null when they left the workspace. */
  attachedBy: string | null;
  /** A draft opens in the Content Editor; any other file downloads in its main format. */
  href: string;
  draft: boolean;
}

interface LinkRow {
  action_task_id: string;
  attached_by: string | null;
  attached_at: string;
  chat_files: {
    id: string;
    title: string;
    type: TaskAttachment['type'];
    content_draft_id: string | null;
  } | null;
}

/** The files attached to each of the tasks, oldest first, by task id. */
export async function readTaskAttachments(
  supabase: SupabaseClient,
  brandId: string,
  taskIds: string[],
): Promise<Map<string, TaskAttachment[]>> {
  const byTask = new Map<string, TaskAttachment[]>();
  if (taskIds.length === 0) return byTask;
  try {
    const { data, error } = await supabase
      .from('chat_file_task_links')
      .select(
        'action_task_id, attached_by, attached_at, chat_files!chat_file_task_links_file_id_fkey(id, title, type, content_draft_id)',
      )
      .in('action_task_id', taskIds)
      .order('attached_at', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as unknown as LinkRow[]).filter((row) => row.chat_files);
    if (rows.length === 0) return byTask;
    const people = await readAssignees(
      supabase,
      brandId,
      rows.map((row) => row.attached_by).filter((id): id is string => !!id),
    );
    for (const row of rows) {
      const file = row.chat_files!;
      const person = row.attached_by ? people.get(row.attached_by) : undefined;
      const attachment: TaskAttachment = {
        fileId: file.id,
        title: file.title,
        type: file.type,
        attachedAt: row.attached_at,
        attachedBy: person ? person.fullName?.trim() || person.email || null : null,
        href: file.content_draft_id
          ? `/dashboard/content/editor/${file.content_draft_id}`
          : `/api/chat/files/${file.id}`,
        draft: !!file.content_draft_id,
      };
      byTask.set(row.action_task_id, [...(byTask.get(row.action_task_id) ?? []), attachment]);
    }
  } catch (err) {
    console.error('[action-center] could not read what Chat attached:', err);
  }
  return byTask;
}
