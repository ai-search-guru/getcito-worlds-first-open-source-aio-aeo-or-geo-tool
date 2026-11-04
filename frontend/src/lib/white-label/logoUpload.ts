import { createClient } from '@/lib/supabase/client';
import type { LogoUploadTicket, WhiteLabelFailure } from '@/lib/actions/whiteLabel';
import { WHITE_LABEL_BUCKET, logoProblem, type LogoProblem } from './kit';

/** Why a logo didn't go up: its type or size, or what the server said. */
export type LogoUploadError = LogoProblem | WhiteLabelFailure;

/**
 * Uploads a logo (00429): checks the file, asks the server for a one-time
 * address (`prepare`, which checks the role, the plan and the brand), and
 * sends the file straight to it, with no server action's body limit. Gives
 * back the path to set the logo to, or why it didn't go up.
 */
export async function uploadLogo(
  file: File,
  prepare: (
    type: string,
    size: number,
  ) => Promise<LogoUploadTicket | { ok: false; failure: WhiteLabelFailure }>,
): Promise<{ ok: true; path: string } | { ok: false; error: LogoUploadError }> {
  const problem = logoProblem(file);
  if (problem) return { ok: false, error: problem };
  try {
    const ticket = await prepare(file.type, file.size);
    if (!ticket.ok) return { ok: false, error: ticket.failure };
    const { error } = await createClient()
      .storage.from(WHITE_LABEL_BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
    if (error) {
      console.error('Failed to upload the logo:', error.message);
      return { ok: false, error: 'failed' };
    }
    return { ok: true, path: ticket.path };
  } catch (err) {
    console.error('Failed to upload the logo:', err);
    return { ok: false, error: 'failed' };
  }
}
