'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import { trackPagePrompts, type TrackPagePromptsResult } from '@/lib/actions/promptSuggestions';
import { questionKey, type PromptDemand } from '@/lib/promptDemand';

/**
 * A prompt's real demand (PROMPT-014) for its Demand card: what the
 * server's nightly sweep read. A failure comes back as a value, so the card
 * can say it couldn't load instead of the page failing. A 404 without our
 * error body is an API that doesn't have the route yet: `unavailable`, and
 * the page leaves the section out.
 */
export async function getPromptDemandSignals(
  promptId: string,
): Promise<{ demand: PromptDemand } | { error: string } | { unavailable: true }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  try {
    const res = await fetch(`${API_BASE_URL}/api/prompts/${encodeURIComponent(promptId)}/demand`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 && !data.error && !data.message) return { unavailable: true };
    if (!res.ok || !data.demand) {
      return { error: data.message || data.error || `Server error: ${res.status}` };
    }
    return { demand: data.demand as PromptDemand };
  } catch {
    return { error: 'Could not reach the server. Please try again.' };
  }
}

/** Prompts read per page: PostgREST's own cap. */
const PAGE = 1000;

/**
 * "+ Track" on a People Also Ask question: tracks it in the prompt's topic
 * (trackPagePrompts), unless the brand already tracks a prompt with the same
 * text (questionKey: case, accents, punctuation and spacing don't count).
 * Then nothing is added and `alreadyTracked` says so. The card already shows
 * those as tracked (the server's `tracked`); this holds for a question
 * tracked since the card loaded.
 */
export async function trackDemandQuestion(
  brandId: string,
  question: string,
  topic: string,
): Promise<TrackPagePromptsResult & { alreadyTracked?: boolean }> {
  const text = typeof question === 'string' ? question.trim() : '';
  if (!text) return { promptIds: [], error: 'Pick a question.' };

  const supabase = await createClient();
  const key = questionKey(text);
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('prompts')
      .select('id, text, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { promptIds: [], error: error.message };
    const rows = (data ?? []) as { text: string | null }[];
    if (rows.some((row) => questionKey(row.text ?? '') === key)) {
      return { promptIds: [], alreadyTracked: true };
    }
    if (rows.length < PAGE) break;
  }
  return trackPagePrompts(brandId, null, [{ text, topic }]);
}
