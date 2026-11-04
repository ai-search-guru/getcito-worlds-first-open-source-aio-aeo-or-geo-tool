import {
  finishChatUpload,
  prepareChatUpload,
  removeChatUpload,
  type ChatUploadFailure,
} from '@/lib/actions/chatUploads';
import { createClient } from '@/lib/supabase/client';
import { CHAT_UPLOAD_BUCKET, uploadTypeOf } from './uploads';

/**
 * One attachment from the browser (CHAT-02 items 18–21, 00409): a one-time
 * address from the app, the file sent to it, then marked ready. Anything
 * that fails takes its row back with it, so Retry starts over. The answer is
 * a value, never thrown.
 */
export async function uploadChatFile(
  file: File,
  conversationId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; failure: ChatUploadFailure }> {
  const type = uploadTypeOf(file);
  if (!type) return { ok: false, failure: 'type' };
  const prepared = await prepareChatUpload({
    name: file.name,
    type,
    size: file.size,
    conversationId,
  }).catch(() => ({ ok: false as const, failure: 'failed' as const }));
  if (!prepared.ok) return prepared;
  const { id, path, token } = prepared.ticket;
  try {
    const { error } = await createClient()
      .storage.from(CHAT_UPLOAD_BUCKET)
      // A File goes up as a form part whose type is the browser's, not
      // contentType: one with the type named here, so a .md the browser gave
      // no type isn't refused by the bucket as application/octet-stream.
      .uploadToSignedUrl(path, token, new File([file], file.name, { type }), { contentType: type });
    if (error) throw new Error(error.message);
    const done = await finishChatUpload(id);
    if (!done.ok) throw new Error(done.failure);
    return { ok: true, id };
  } catch (error) {
    console.error('[chat-uploads] the file did not go up:', error);
    await removeChatUpload(id).catch(() => null);
    return { ok: false, failure: 'failed' };
  }
}

/** × on a draft's file: its row and its file go. Best effort. */
export async function dropChatUpload(id: string): Promise<void> {
  await removeChatUpload(id).catch(() => null);
}
