'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createTopic } from '@/lib/actions/topic';
import { TOPIC_NAME_CHARS } from '@/lib/topicNames';
import { API_BASE_URL } from '@/config/api';
import { NO_ANSWER, responseFailure, type ReadFailure } from '@/lib/apiFailure';

const AEO_SERVER_URL = API_BASE_URL;

export interface TopicSuggestion {
  id: string;
  brandId: string;
  name: string;
  reason: string | null;
  source: 'llm';
  status: 'new' | 'added' | 'dismissed';
  generatedAt: string;
}

interface SuggestionRow {
  id: string;
  brand_id: string;
  name: string;
  reason: string | null;
  source: 'llm';
  status: 'new' | 'added' | 'dismissed';
  generated_at: string;
}

function mapRow(row: SuggestionRow): TopicSuggestion {
  return {
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    reason: row.reason,
    source: row.source,
    status: row.status,
    generatedAt: row.generated_at,
  };
}

async function getSession() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session;
}

export type TopicSuggestionsRead = { ok: true; suggestions: TopicSuggestion[] } | ReadFailure;

/**
 * The brand's open topic suggestions. A failure comes back as a value, never
 * thrown: production hides a thrown message (React's #441), and an API that
 * didn't answer is marked retryable for the card's one automatic retry.
 */
export async function getTopicSuggestions(brandId: string): Promise<TopicSuggestionsRead> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, failure: 'session', retryable: false };
  try {
    const res = await fetch(`${AEO_SERVER_URL}/api/topics/suggestions/${brandId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      // Read-only lookup — a hung upstream must not pin the suggestions card
      // (and the serialized server-action queue behind it) indefinitely.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return await responseFailure(res);
    const data = (await res.json()) as { suggestions: SuggestionRow[] };
    return { ok: true, suggestions: data.suggestions.map(mapRow) };
  } catch {
    // No answer, or one cut off: a dropped connection or the timeout.
    return NO_ANSWER;
  }
}

export async function refreshTopicSuggestions(brandId: string): Promise<TopicSuggestion[]> {
  const session = await getSession();
  const res = await fetch(`${AEO_SERVER_URL}/api/topics/suggestions/${brandId}/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
  const data = (await res.json()) as { suggestions: SuggestionRow[] };
  return data.suggestions.map(mapRow);
}

export async function dismissTopicSuggestion(suggestionId: string): Promise<{ success: boolean }> {
  const session = await getSession();
  const res = await fetch(`${AEO_SERVER_URL}/api/topics/suggestions/${suggestionId}/dismiss`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
  return res.json();
}

/**
 * Accept a suggestion: create exactly ONE topic via the singular createTopic
 * action (never the plural createTopics, which replaces the brand's whole
 * topic list), then ack the server so the suggestion moves to `added`.
 */
export async function acceptTopicSuggestion(suggestionId: string): Promise<{ topicId: string }> {
  const session = await getSession();
  const supabase = await createClient();

  const { data: row, error: rowErr } = await supabase
    .from('topic_suggestions')
    .select('id, brand_id, name')
    .eq('id', suggestionId)
    .eq('status', 'new')
    .single();
  if (rowErr || !row) {
    throw new Error('Suggestion not found or already processed');
  }

  // A suggestion's name is the model's: cut to fit, not refused.
  const topic = await createTopic(row.brand_id, row.name.trim().slice(0, TOPIC_NAME_CHARS));

  const ack = await fetch(`${AEO_SERVER_URL}/api/topics/suggestions/${suggestionId}/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ topicId: topic.id }),
  });
  if (!ack.ok) {
    console.error('[topic-suggestions] accept ack failed:', await ack.text().catch(() => ''));
  }

  revalidatePath('/dashboard/prompts/topics');
  return { topicId: topic.id };
}
