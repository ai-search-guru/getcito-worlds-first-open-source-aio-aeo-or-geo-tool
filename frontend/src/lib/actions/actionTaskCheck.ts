'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import type { TaskLastCheck } from '@/lib/action-center/taskDetails';

/**
 * Why nothing was checked: no check here, done, the page didn't answer,
 * changed meanwhile, a closed action, or a shopping links task whose draft
 * has no shopping path left.
 */
export type CheckSkippedReason =
  'not_checkable' | 'not_open' | 'no_answer' | 'changed' | 'closed' | 'no_shopping_path';

/**
 * What checking a task now came to (AC-010): the check kept on it, or why
 * there's none. A failure comes back as a value, as the other task actions'
 * do, so the drawer can say why.
 */
export type CheckTaskResult =
  | { checked: TaskLastCheck; reason: null }
  | { checked: null; reason: CheckSkippedReason }
  | { error: 'server'; code: string | null; message: string }
  | { error: 'timeout' | 'unreachable' | 'unauthenticated' };

/** Check a task on its page now, on the server, as the nightly sweep does. */
export async function checkActionTask(taskId: string): Promise<CheckTaskResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'unauthenticated' };

  try {
    const res = await fetch(`${API_BASE_URL}/api/action-center/tasks/${taskId}/check`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      // The page and, for crawler access, its robots.txt: 10 s each.
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: 'server',
        code: typeof data.code === 'string' ? data.code : null,
        message: data.error || `Server error: ${res.status}`,
      };
    }
    const checked = data.checked;
    if (checked && typeof checked === 'object') {
      return {
        checked: {
          at: String(checked.at),
          passed: Boolean(checked.passed),
          missing: Array.isArray(checked.missing) ? checked.missing.map(String) : [],
        },
        reason: null,
      };
    }
    const reasons: CheckSkippedReason[] = [
      'not_checkable',
      'not_open',
      'no_answer',
      'changed',
      'closed',
      'no_shopping_path',
    ];
    return {
      checked: null,
      reason: reasons.includes(data.reason) ? data.reason : 'no_answer',
    };
  } catch (err) {
    return {
      error: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'unreachable',
    };
  }
}
