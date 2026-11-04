import { API_BASE_URL } from '@/config/api';
import type { AiProvider } from '@/lib/agent/providers';

/**
 * Asks the server to tell the workspace's Admins its own AI key fails
 * (AGENT-OWN-KEY §5.3; server routes/internalChatNotices.js, 00441): each
 * Admin's Inbox notice and, by their "Notify me when an agent needs me", an
 * e-mail. The server tells an episode once, and its one reminder 3 days in;
 * a call for an episode already told changes nothing. Server only
 * (CRON_SECRET). Never throws: a notice that didn't go out leaves the key
 * marked, and the banners still say it.
 */

/** How long the server may take to write the notices and send the e-mails. */
const NOTICE_TIMEOUT_MS = 15_000;

export async function notifyOwnKeyFailure(
  organizationId: string,
  provider: AiProvider,
  since: string,
  { reminder = false }: { reminder?: boolean } = {},
): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[chat/key] CRON_SECRET must be configured to tell the Admins');
    return false;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/internal/chat/notices/own-key`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: organizationId, provider, since, reminder }),
      cache: 'no-store',
      signal: AbortSignal.timeout(NOTICE_TIMEOUT_MS),
    });
    return res.ok;
  } catch (err) {
    console.error('[chat/key] the Admins’ notice got no answer:', (err as Error)?.name ?? err);
    return false;
  }
}
