import { randomUUID } from 'node:crypto';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planRow';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CHAT_FILES_BUCKET, storageFits, storageLimitBytes, type ChatStorage } from './files';
import { planFactsFromOrgRow, type OrgPlanRow } from './planFacts';

/**
 * Filing on the server (CHAT-06 items 9, 26–29): the storage a workspace's
 * plan and storage packs allow, and a file's row and content, the server's
 * to write (00411). No person's session here: the engine files a run's
 * deliverables with it as they are made, and Save to Files an answer.
 */

/** The workspace's Files: bytes and files kept, and its limit (plan + active storage packs). */
export async function readChatStorage(organizationId: string): Promise<ChatStorage> {
  const now = new Date().toISOString();
  const [org, usage, grants] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select(ORG_PLAN_COLUMNS)
      .eq('id', organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_storage_usage')
      .select('bytes_used, file_count')
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('storage_grants')
      .select('bytes')
      .eq('organization_id', organizationId)
      .gt('active_until', now),
  ]);
  if (org.error) throw new Error(`Could not read the plan: ${org.error.message}`);
  if (usage.error) throw new Error(`Could not read the storage used: ${usage.error.message}`);
  if (grants.error) throw new Error(`Could not read the storage packs: ${grants.error.message}`);
  const facts = planFactsFromOrgRow((org.data ?? {}) as OrgPlanRow);
  const granted = (grants.data ?? []).reduce((sum, row) => sum + Number(row.bytes ?? 0), 0);
  return {
    usedBytes: Number(usage.data?.bytes_used ?? 0),
    fileCount: Number(usage.data?.file_count ?? 0),
    limitBytes: storageLimitBytes(
      { isTrial: facts.isTrial, maxStorageGb: facts.limits.maxStorageGb },
      granted,
    ),
  };
}

/** Something Chat made, to file for the workspace (CHAT-06 item 9). */
export interface ChatOutput {
  organizationId: string;
  createdBy: string | null;
  brandId: string | null;
  title: string;
  type: 'document' | 'table' | 'code' | 'image' | 'report';
  /** The formats it downloads in, its main one first. */
  formats: string[];
  /** The canonical content (CHAT-06 data notes: Markdown for a document) and its type. */
  body: Uint8Array;
  mimeType: string;
  /** Its object's name under {organization}/{file}/. */
  fileName: string;
  origin: 'task' | 'chat' | 'schedule' | 'editor';
  conversationId: string | null;
  messageId: string | null;
  runId: string | null;
  generatedAt: string;
  dataAsOf: string | null;
  timezone: string | null;
  /** The Content draft made from it, or that it was made as ("Used in Content draft"). */
  contentDraftId?: string | null;
}

/**
 * Files something Chat made (CHAT-06 items 9, 26–29): its row, then its
 * content in chat-files. It counts toward storage (the row's trigger), and
 * a full workspace files nothing new. Save to Files files an answer with
 * it; a run's deliverables are filed with it as they are made. Answers as
 * a value; content that didn't go up leaves no row.
 */
export async function fileChatOutput(
  output: ChatOutput,
): Promise<{ ok: true; id: string } | { ok: false; failure: 'storage_full' | 'failed' }> {
  const storage = await readChatStorage(output.organizationId);
  if (!storageFits(storage, output.body.byteLength)) return { ok: false, failure: 'storage_full' };

  const id = randomUUID();
  const path = `${output.organizationId}/${id}/${output.fileName}`;
  const { error: rowError } = await supabaseAdmin.from('chat_files').insert({
    id,
    organization_id: output.organizationId,
    brand_id: output.brandId,
    created_by: output.createdBy,
    title: output.title.slice(0, 200),
    type: output.type,
    formats: output.formats,
    mime_type: output.mimeType,
    storage_path: path,
    size_bytes: output.body.byteLength,
    origin: output.origin,
    conversation_id: output.conversationId,
    message_id: output.messageId,
    run_id: output.runId,
    generated_at: output.generatedAt,
    data_as_of: output.dataAsOf,
    timezone: output.timezone,
    content_draft_id: output.contentDraftId ?? null,
  });
  if (rowError) {
    console.error('[chat-files] could not file it:', rowError.message);
    return { ok: false, failure: 'failed' };
  }
  let uploadError: string | null;
  try {
    const { error } = await supabaseAdmin.storage
      .from(CHAT_FILES_BUCKET)
      .upload(path, output.body, { contentType: output.mimeType, upsert: false });
    uploadError = error?.message ?? null;
  } catch (error) {
    uploadError = error instanceof Error ? error.message : 'upload failed';
  }
  if (uploadError) {
    console.error('[chat-files] could not keep its content:', uploadError);
    await supabaseAdmin.from('chat_files').delete().eq('id', id);
    return { ok: false, failure: 'failed' };
  }
  return { ok: true, id };
}
