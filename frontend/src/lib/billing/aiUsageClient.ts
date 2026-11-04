import { BROWSER_API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/client';
import type { PromptUsageSummary } from '@/lib/promptUsageSummary';
import { aiUsageFromApi, type AiUsage, type UsageLimits } from './aiUsage';

/**
 * The header meter's reads (AI usage spec §3.1), from the browser through
 * the API's same-origin proxy: never through a server action, which Next
 * runs one at a time, so the meter would wait behind a page's own (the
 * Content Agent's last a whole run) and hold them up in turn.
 */

/** A read that hangs gives up after this, so the meter can read again. */
const READ_TIMEOUT_MS = 15_000;

async function accessToken(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * This period's AI usage for the member's workspace (GET /api/billing/ai-usage,
 * the Billing page's figures). Null without an active plan (a new workspace,
 * past due, canceled): there is no allowance to meter. Throws when it can't
 * be read.
 */
export async function readAiUsage(): Promise<AiUsage | null> {
  const token = await accessToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${BROWSER_API_BASE_URL}/api/billing/ai-usage`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (body.error === 'plan_limit') return null;
    throw new Error(body.message || body.error || `Server error: ${res.status}`);
  }
  return aiUsageFromApi((await res.json()) as AiUsage);
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * The limits that aren't AI, for the meter's popover (spec §2: they stay
 * counts): the Site Audit pages audited this period (running ones included,
 * as the audit quota holds their slots) and the account's active prompt
 * locations, each of its plan's limit. One with no cap, or that can't be
 * read, is left out; without a brand there are no prompt counts to read.
 */
export async function readUsageLimits(brandId: string | null): Promise<UsageLimits> {
  const token = await accessToken();
  const [audit, prompts] = await Promise.all([
    token
      ? readJson<{ quota?: { used: number; running: number; limit: number } }>(
          `${BROWSER_API_BASE_URL}/api/audits/quota`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
      : null,
    brandId
      ? readJson<PromptUsageSummary>(`/api/prompts/usage?brandId=${encodeURIComponent(brandId)}`)
      : null,
  ]);
  const quota = audit?.quota;
  const locationLimit = prompts?.plan.locationLimit ?? null;
  return {
    auditPages:
      quota && quota.limit > 0 ? { used: quota.used + quota.running, limit: quota.limit } : null,
    promptLocations:
      prompts && locationLimit !== null
        ? { used: prompts.account.locationsUsed, limit: locationLimit }
        : null,
  };
}

/**
 * A Content Editor page's share of this period's AI usage, in percent to a
 * tenth (GET /api/billing/ai-usage/draft/:id), for the editor meter's popover.
 * Null when it can't be read, or on a plan without an allowance.
 */
export async function readDraftAiUsage(draftId: string): Promise<number | null> {
  const token = await accessToken();
  if (!token) return null;
  const read = await readJson<{ unlimited: boolean; percent: number | null }>(
    `${BROWSER_API_BASE_URL}/api/billing/ai-usage/draft/${encodeURIComponent(draftId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return read && !read.unlimited ? read.percent : null;
}
