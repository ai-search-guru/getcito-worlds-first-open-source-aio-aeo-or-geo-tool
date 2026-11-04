'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
// Types only — the helpers that go with them live in a plain module.
import type {
  ImproveQuota,
  ImproveRangeInput,
  ImproveSent,
  ImproveSet,
  ImproveSource,
} from '@/lib/promptImprove';

/**
 * Failures come back as a value, not a throw, so the panel can show the real
 * message (plan limit, missing AI key) instead of the masked production
 * digest (#427).
 */
type ImproveResult =
  | { improve: ImproveSet | null; quota: ImproveQuota | null }
  | { error: string; code?: 'plan_limit' | 'quota_exceeded' };

async function call(
  promptId: string,
  range: ImproveRangeInput,
  method: 'GET' | 'POST',
): Promise<ImproveResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const url = new URL(`${API_BASE_URL}/api/prompts/${promptId}/improve`);
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(range)) if (typeof v === 'string' && v) body[k] = v;
  if (method === 'GET') for (const [k, v] of Object.entries(body)) url.searchParams.set(k, v);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      // Reading the cache is quick; generating is one model call (target p95 < 15 s).
      signal: AbortSignal.timeout(method === 'GET' ? 15_000 : 60_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: data.message || data.error || `Server error: ${res.status}`,
        code:
          data.error === 'plan_limit' || data.error === 'quota_exceeded' ? data.error : undefined,
      };
    }
    return {
      improve: (data.improve ?? null) as ImproveSet | null,
      quota: (data.quota ?? null) as ImproveQuota | null,
    };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.name === 'TimeoutError'
          ? 'Generating suggestions took too long. Please try again.'
          : 'Could not reach the server. Please try again.',
    };
  }
}

/** The cached set for this prompt and range, or null when none was built yet. */
export async function getImproveSuggestions(
  promptId: string,
  range: ImproveRangeInput,
): Promise<ImproveResult> {
  return call(promptId, range, 'GET');
}

/** Build (or rebuild) the set for this prompt and range. */
export async function generateImproveSuggestions(
  promptId: string,
  range: ImproveRangeInput,
): Promise<ImproveResult> {
  return call(promptId, range, 'POST');
}

export interface SendImproveInput {
  /** One per send, so a double click or a retry creates one action. */
  idempotencyKey: string;
  suggestions: {
    id: string;
    platform: string;
    title: string;
    body: string;
    sources: ImproveSource[];
  }[];
}

type SendResult =
  | { actionId: string; actionNo: number; created: boolean; taskCount: number; sent: ImproveSent }
  | { error: string };

/** Send the selected suggestions, as edited, to Action Center as one action (PROMPT-004). */
export async function sendImproveToActionCenter(
  promptId: string,
  range: ImproveRangeInput,
  input: SendImproveInput,
): Promise<SendResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };
  const range_: Record<string, string> = {};
  for (const [k, v] of Object.entries(range)) if (typeof v === 'string' && v) range_[k] = v;
  try {
    const res = await fetch(`${API_BASE_URL}/api/prompts/${promptId}/improve/action`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...range_, ...input }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.message || data.error || `Server error: ${res.status}` };
    return data as SendResult;
  } catch {
    return { error: 'Could not reach the server. Please try again.' };
  }
}
