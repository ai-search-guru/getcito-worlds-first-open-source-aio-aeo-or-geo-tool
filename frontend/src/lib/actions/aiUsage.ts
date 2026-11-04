'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import { aiUsageFromApi, type AiUsage } from '@/lib/billing/aiUsage';

/**
 * This period's AI usage for the member's workspace, for the Billing page's
 * meter. Null without an active plan (a new workspace, past due, canceled):
 * there is no allowance to meter.
 */
export async function getAiUsage(): Promise<AiUsage | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE_URL}/api/billing/ai-usage`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.error === 'plan_limit') return null;
    throw new Error(body.message || body.error || `Server error: ${res.status}`);
  }
  return aiUsageFromApi(await res.json());
}
