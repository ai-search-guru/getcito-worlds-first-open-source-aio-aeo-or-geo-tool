'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';

/**
 * Whether the brand has an active webhook to send a task to (AC-004). Reads
 * only that: the drawer has no business with the URL or the secret.
 */
export async function hasActiveWebhook(brandId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('webhook_configs')
    .select('id, events')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .limit(1);
  if (error) return false;
  return (data ?? []).some((config) => config.events?.includes('action_task.sent'));
}

/**
 * What sending a task came to. A failure comes back as a value, so the drawer
 * can word the server's reason (`code`) — not a content task, no webhook, the
 * webhook refused it — instead of the masked production digest.
 */
export type SendTaskResult =
  | { to: 'content'; opportunityId: string; created: boolean; merged: boolean }
  | { to: 'webhook'; delivered: number; failed: number }
  | { error: 'server'; code: string | null; message: string }
  | { error: 'timeout' | 'unreachable' | 'unauthenticated' };

/**
 * Send a task to Content as an opportunity, or to the brand's webhook.
 * `title` is the task's text as the drawer shows it, for a library task.
 */
export async function sendActionTask(
  taskId: string,
  to: 'content' | 'webhook',
  title: string,
): Promise<SendTaskResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'unauthenticated' };

  try {
    const res = await fetch(`${API_BASE_URL}/api/action-center/tasks/${taskId}/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, title }),
      cache: 'no-store',
      // The server gives each active webhook 15 s, one after another.
      signal: AbortSignal.timeout(75_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: 'server',
        code: typeof data.code === 'string' ? data.code : null,
        message: data.error || `Server error: ${res.status}`,
      };
    }
    return to === 'content'
      ? {
          to,
          opportunityId: String(data.opportunityId),
          created: Boolean(data.created),
          // Added to the open opportunity on its question.
          merged: Boolean(data.merged),
        }
      : { to, delivered: Number(data.delivered ?? 0), failed: Number(data.failed ?? 0) };
  } catch (err) {
    return {
      error: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'unreachable',
    };
  }
}
