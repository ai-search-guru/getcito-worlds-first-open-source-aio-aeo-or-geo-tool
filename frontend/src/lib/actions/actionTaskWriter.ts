'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';

/**
 * What a rewrite of an action's tasks came to (AC-004). A failure comes back
 * as a value, not a throw, so the drawer can say why — the budget is spent,
 * nothing passed the quality check — instead of the masked production
 * digest. `code` is the server's reason, which the drawer words; `message`
 * is its English text, for a reason this build has no words for.
 */
export type RegenerateTasksResult =
  /** `reviews`: tasks missing an AC-010 field, waiting in Needs review. */
  | { written: number; kept: number; reviews: number }
  | { error: 'server'; code: string | null; message: string }
  | { error: 'timeout' | 'unreachable' | 'unauthenticated' };

/** Write the action's tasks again from its evidence, on the server. */
export async function regenerateActionTasks(actionId: string): Promise<RegenerateTasksResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'unauthenticated' };

  try {
    const res = await fetch(
      `${API_BASE_URL}/api/action-center/actions/${actionId}/tasks/regenerate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
        // Up to two model calls (the second for refused tasks), each tried
        // twice at 40 s: inside this wait, so the server never writes after it.
        signal: AbortSignal.timeout(200_000),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: 'server',
        code: typeof data.code === 'string' ? data.code : null,
        message: data.error || `Server error: ${res.status}`,
      };
    }
    return {
      written: Number(data.written ?? 0),
      kept: Number(data.kept ?? 0),
      reviews: Number(data.reviews ?? 0),
    };
  } catch (err) {
    return {
      error: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'unreachable',
    };
  }
}
