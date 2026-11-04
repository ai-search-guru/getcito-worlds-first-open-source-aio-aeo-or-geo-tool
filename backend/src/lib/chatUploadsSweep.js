import supabaseAdmin from '../config/supabase.js';
import { chunkIds } from './chunkedIn.js';
import { logger } from './logger.js';

/**
 * Chat's attachments (00409) are kept 90 days (expires_at). The daily run
 * deletes the expired ones here, each file in the private bucket
 * chat-uploads first, then its row, also after its chat or message was
 * deleted, so no file is left without a row. Nothing is attached while the
 * new Chat is off, so the table is empty and this reads nothing.
 */

/** The private bucket attachments are in (frontend/src/lib/chat/uploads.ts). */
export const CHAT_UPLOAD_BUCKET = 'chat-uploads';
/** Attachments read per batch. */
export const SWEEP_BATCH = 500;
/** Attachments deleted per daily run at most; the rest waits a day. */
export const MAX_SWEPT = 10_000;

/**
 * Deletes the attachments past their expires_at, SWEEP_BATCH at a time and
 * MAX_SWEPT a run at most, and says how many went. A file the bucket can't
 * delete keeps its row for tomorrow. Never throws: a failure is logged and
 * the rest waits a day.
 *
 * @param {{ db?: object, now?: Date }} [options]
 * @returns {Promise<number>}
 */
export async function sweepExpiredChatUploads({ db = supabaseAdmin, now = new Date() } = {}) {
  const at = now.toISOString();
  let swept = 0;
  try {
    while (swept < MAX_SWEPT) {
      const size = Math.min(SWEEP_BATCH, MAX_SWEPT - swept);
      const { data, error } = await db
        .from('chat_uploads')
        .select('id, storage_path')
        .lt('expires_at', at)
        .limit(size);
      if (error) throw new Error(`chat_uploads read: ${error.message}`);
      const rows = data ?? [];
      if (rows.length === 0) break;
      const { error: removeError } = await db.storage
        .from(CHAT_UPLOAD_BUCKET)
        .remove(rows.map((row) => row.storage_path));
      if (removeError) throw new Error(`chat-uploads remove: ${removeError.message}`);
      // A delete's ids go in its address: IN_FILTER_CHUNK at a time.
      for (const chunk of chunkIds(rows.map((row) => row.id))) {
        const { error: failed } = await db.from('chat_uploads').delete().in('id', chunk);
        if (failed) throw new Error(`chat_uploads delete: ${failed.message}`);
      }
      swept += rows.length;
      if (rows.length < size) break;
    }
  } catch (err) {
    logger.warn(
      { err: { name: err?.name, message: err?.message }, swept },
      '[chat-uploads] expired attachments sweep failed; the rest goes tomorrow',
    );
    return swept;
  }
  logger.info({ swept }, '[chat-uploads] expired attachments swept');
  return swept;
}
