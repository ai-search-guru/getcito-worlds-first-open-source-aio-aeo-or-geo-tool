import { prepareImageUpload } from '@/lib/actions/contentImages';
import { createClient } from '@/lib/supabase/client';
import {
  IMAGE_UPLOAD_BUCKET,
  IMAGE_UPLOAD_MAX_BYTES,
  IMAGE_UPLOAD_TYPES,
  imageUploadExtension,
} from './imageUploadTypes';

/**
 * Upload an image instead of pasting its address (00272): most people have
 * the screenshot or photo on their computer. The app gives a one-time
 * address under the member's organization's folder (prepareImageUpload,
 * which says who may and how much), the browser sends the file straight to
 * it (no server action's body limit), and the page and the CMS show it by
 * its public address.
 */

export { IMAGE_UPLOAD_BUCKET, IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_TYPES };
/** The file picker's filter. */
export const IMAGE_UPLOAD_ACCEPT = Object.keys(IMAGE_UPLOAD_TYPES).join(',');

/**
 * Why a file can't go up: its type, its size, the organization's plan (on
 * the cloud, an active one), the day's uploads made, or the upload failing.
 */
export type ImageUploadError = 'type' | 'size' | 'plan' | 'limit' | 'failed';

/** Why a file can't go up, before it is sent, or null. */
export function imageUploadProblem(file: File): ImageUploadError | null {
  if (!imageUploadExtension(file.type)) return 'type';
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) return 'size';
  return null;
}

/** Uploads one image: its public address, or why it didn't go up. */
export async function uploadContentImage(
  file: File,
): Promise<{ url: string } | { error: ImageUploadError }> {
  const problem = imageUploadProblem(file);
  if (problem) return { error: problem };
  try {
    // A new name each time, the app's: nothing already up is overwritten.
    const ticket = await prepareImageUpload(file.type);
    if ('error' in ticket) return { error: ticket.error };
    const { error } = await createClient()
      .storage.from(IMAGE_UPLOAD_BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, file, {
        contentType: file.type,
        cacheControl: '31536000',
      });
    if (error) {
      console.error('Failed to upload the image:', error.message);
      return { error: 'failed' };
    }
    return { url: ticket.url };
  } catch (err) {
    console.error('Failed to upload the image:', err);
    return { error: 'failed' };
  }
}
