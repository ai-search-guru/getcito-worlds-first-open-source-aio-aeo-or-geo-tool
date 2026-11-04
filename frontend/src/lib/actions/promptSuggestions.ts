'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { addPromptToSet, type PromptAddFailureCode } from '@/lib/actions/prompt';
import { addPromptTargetUrl } from '@/lib/actions/promptWorkflow';
import { API_BASE_URL } from '@/config/api';
// Types only — this file is `'use server'`, so the guards that go with them
// live in a plain module (every runtime export here must be a server action).
import type { PromptSuggestionSource, SuggestionSourceData } from '@/lib/promptSuggestionSource';
import { assertWritable } from '@/lib/subscriptionGuard';
import {
  NO_ANSWER,
  apiFailure,
  isTransientStatus,
  responseFailure,
  type ReadFailure,
} from '@/lib/apiFailure';
import { NO_TOPICS, NO_TOPICS_MESSAGE } from '@/lib/topicsRequired';

const AEO_SERVER_URL = API_BASE_URL;

export interface PromptSuggestion {
  id: string;
  brandId: string;
  suggestedText: string;
  topicName: string | null;
  topicId: string | null;
  reason: string | null;
  estVolume: number | null;
  /** 0–1, how closely it fits the brand (VIS-011); null before 00138. */
  relevance: number | null;
  source: PromptSuggestionSource;
  sourceData: SuggestionSourceData | null;
  status: 'new' | 'added' | 'dismissed';
  generatedAt: string;
  expiresAt: string;
}

interface SuggestionRow {
  id: string;
  brand_id: string;
  suggested_text: string;
  topic_name: string | null;
  topic_id: string | null;
  reason: string | null;
  est_volume: number | null;
  relevance?: number | null;
  source: PromptSuggestionSource;
  source_data: SuggestionSourceData | null;
  status: 'new' | 'added' | 'dismissed';
  generated_at: string;
  expires_at: string;
}

function mapRow(row: SuggestionRow): PromptSuggestion {
  return {
    id: row.id,
    brandId: row.brand_id,
    suggestedText: row.suggested_text,
    topicName: row.topic_name,
    topicId: row.topic_id,
    reason: row.reason,
    estVolume: row.est_volume,
    relevance: row.relevance ?? null,
    source: row.source,
    sourceData: row.source_data ?? null,
    status: row.status,
    generatedAt: row.generated_at,
    expiresAt: row.expires_at,
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

export type PromptSuggestionsRead =
  { ok: true; suggestions: PromptSuggestion[]; stale: boolean } | ReadFailure;

/**
 * The brand's open suggestions. A failure comes back as a value, never
 * thrown: production hides a thrown message (React's #441), and an API that
 * didn't answer is marked retryable for the card's one automatic retry.
 */
export async function getPromptSuggestions(brandId: string): Promise<PromptSuggestionsRead> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, failure: 'session', retryable: false };
  try {
    const res = await fetch(`${AEO_SERVER_URL}/api/prompts/suggestions/${brandId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      // Read-only cache lookup — a hung upstream must not pin the suggestions
      // card (and the serialized server-action queue behind it) indefinitely.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return await responseFailure(res);
    const data = (await res.json()) as {
      suggestions: SuggestionRow[];
      stale: boolean;
    };
    return {
      ok: true,
      suggestions: data.suggestions.map(mapRow),
      stale: data.stale,
    };
  } catch {
    // No answer, or one cut off: a dropped connection or the timeout.
    return NO_ANSWER;
  }
}

export type RefreshPromptSuggestionsResult =
  | { ok: true; suggestions: PromptSuggestion[] }
  | { ok: false; failure: typeof NO_TOPICS }
  | ReadFailure;

/**
 * A fresh batch of suggestions. Every failure comes back as a value, as
 * getPromptSuggestions' do (#1777): production hides a thrown message, so a
 * used-up AI budget, a read-only workspace or the demo brand, a role refusal
 * or an outage read as React's #441. A brand with no topic yet gets
 * `no_topics`, before anything is generated: suggestions are prompts, which
 * are grouped under topics.
 */
export async function refreshPromptSuggestions(
  brandId: string,
): Promise<RefreshPromptSuggestionsResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, failure: 'session', retryable: false };
  try {
    const res = await fetch(`${AEO_SERVER_URL}/api/prompts/suggestions/${brandId}/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      // Read once: no_topics is this route's own, the rest are the API's shared failures.
      const body = await res.json().catch(() => ({}));
      if (body.code === NO_TOPICS) return { ok: false, failure: NO_TOPICS };
      return {
        ok: false,
        failure: apiFailure(res.status, body),
        retryable: isTransientStatus(res.status),
      };
    }
    const data = (await res.json()) as { suggestions: SuggestionRow[] };
    return { ok: true, suggestions: data.suggestions.map(mapRow) };
  } catch {
    // No answer, or one cut off: a dropped connection.
    return NO_ANSWER;
  }
}

export async function dismissSuggestion(suggestionId: string): Promise<{ success: boolean }> {
  const session = await getSession();
  const res = await fetch(`${AEO_SERVER_URL}/api/prompts/suggestions/${suggestionId}/dismiss`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
  return res.json();
}

/** Suggestions one dismiss round sends at once. */
const DISMISS_BATCH = 10;

export type DismissSuggestionsResult =
  { ok: true; dismissed: string[]; failed: string[] } | { ok: false; failure: 'failed' };

/**
 * Dismisses several suggestions, each through the same route as one by one
 * (so a Search Console or Analytics one stays hidden for 30 days, as when
 * dismissed alone), a few at a time. Never throws (#1777): what couldn't be
 * dismissed is listed, and a call that couldn't start is `failed`.
 */
export async function dismissSuggestions(
  suggestionIds: string[],
): Promise<DismissSuggestionsResult> {
  try {
    const session = await getSession();
    const ids = [...new Set(suggestionIds.filter((id) => typeof id === 'string' && id))];
    const dismissed: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < ids.length; i += DISMISS_BATCH) {
      await Promise.all(
        ids.slice(i, i + DISMISS_BATCH).map(async (id) => {
          try {
            const res = await fetch(
              `${AEO_SERVER_URL}/api/prompts/suggestions/${encodeURIComponent(id)}/dismiss`,
              { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } },
            );
            (res.ok ? dismissed : failed).push(id);
          } catch {
            failed.push(id);
          }
        }),
      );
    }
    return { ok: true, dismissed, failed };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

export type AcceptSuggestionResult =
  { promptId: string } | { error: string; code?: PromptAddFailureCode };

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Where an accepted suggestion goes: the brand's first prompt set, with the
 * platforms and models of its newest active prompt unless the caller picks.
 */
async function promptTarget(
  supabase: ServerClient,
  brandId: string,
  options?: { platforms?: string[]; models?: string[] },
): Promise<{ promptSetId: string; platforms: string[]; models: string[] } | { error: string }> {
  const { data: ps, error: psErr } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (psErr || !ps) {
    return { error: 'No prompt set exists for this brand. Create one first.' };
  }

  const { data: defaults } = await supabase
    .from('prompts')
    .select('platforms, models')
    .eq('prompt_set_id', ps.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const platforms =
    options?.platforms ??
    (Array.isArray(defaults?.platforms) && defaults!.platforms.length > 0
      ? (defaults!.platforms as string[])
      : ['chatgpt-web']);
  const models =
    options?.models ?? (Array.isArray(defaults?.models) ? (defaults!.models as string[]) : []);
  return { promptSetId: ps.id, platforms, models };
}

/** Marks the suggestion added on the server; a failure is logged, not returned. */
async function ackAccepted(accessToken: string, suggestionId: string, promptId: string) {
  const ack = await fetch(`${AEO_SERVER_URL}/api/prompts/suggestions/${suggestionId}/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ promptId }),
  });
  if (!ack.ok) {
    console.error('[prompt-suggestions] accept ack failed:', await ack.text().catch(() => ''));
  }
}

export async function acceptSuggestion(
  suggestionId: string,
  options?: { platforms?: string[]; models?: string[] },
): Promise<AcceptSuggestionResult> {
  const session = await getSession();
  const supabase = await createClient();

  const { data: row, error: rowErr } = await supabase
    .from('prompt_suggestions')
    .select('id, brand_id, suggested_text, topic_name')
    .eq('id', suggestionId)
    .eq('status', 'new')
    .single();
  if (rowErr || !row) {
    return { error: 'Suggestion not found or already processed' };
  }

  const target = await promptTarget(supabase, row.brand_id, options);
  if ('error' in target) return target;

  const result = await addPromptToSet({
    ...target,
    text: row.suggested_text,
    category: row.topic_name ?? undefined,
  });
  if ('error' in result) {
    return { error: result.error, code: result.code };
  }

  await ackAccepted(session.access_token, suggestionId, result.prompt.id);
  revalidatePath('/dashboard/prompts');
  return { promptId: result.prompt.id };
}

export interface TrackSuggestionsResult {
  /** Tracked, in the order given. */
  trackedIds: string[];
  /** Already accepted or dismissed elsewhere: skipped, nothing to track. */
  skippedIds: string[];
  /**
   * Why the rest weren't; `code` 'plan_limit' when the plan's prompt
   * locations ran out, 'no_topics' when the brand has no topic yet.
   */
  error?: string;
  code?: PromptAddFailureCode;
}

/** More than an Opportunities item can hold: a refresh makes 25 suggestions. */
const MAX_TRACK_AT_ONCE = 25;

/**
 * Track suggestions together: an Opportunities topic's "Track N" (VIS-011).
 * The suggestions and where they go are read once; then each prompt is added
 * on its own through addPromptToSet, so each passes the same plan check as a
 * single Track, and the run stops at the first one that fails: the plan's
 * prompt locations are full, or the rest can't be added either. Suggestions
 * already accepted or dismissed elsewhere are skipped, not a failure.
 */
export async function trackSuggestions(suggestionIds: string[]): Promise<TrackSuggestionsResult> {
  const ids = Array.isArray(suggestionIds)
    ? [...new Set(suggestionIds.filter((id) => typeof id === 'string'))]
    : [];
  if (ids.length === 0 || ids.length > MAX_TRACK_AT_ONCE) {
    return { trackedIds: [], skippedIds: [], error: 'Pick between 1 and 25 suggestions.' };
  }

  const session = await getSession();
  const supabase = await createClient();
  const { data: rows, error: rowsErr } = await supabase
    .from('prompt_suggestions')
    .select('id, brand_id, suggested_text, topic_name')
    .in('id', ids)
    .eq('status', 'new');
  if (rowsErr) return { trackedIds: [], skippedIds: [], error: rowsErr.message };

  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
  const skippedIds = ids.filter((id) => !byId.has(id));
  const brandIds = new Set((rows ?? []).map((r) => r.brand_id as string));
  if (brandIds.size === 0) return { trackedIds: [], skippedIds };
  if (brandIds.size > 1) {
    return { trackedIds: [], skippedIds, error: 'Track suggestions of one brand at a time.' };
  }

  const target = await promptTarget(supabase, [...brandIds][0]);
  if ('error' in target) return { trackedIds: [], skippedIds, error: target.error };

  const added: { id: string; promptId: string }[] = [];
  let failure: { error: string; code?: PromptAddFailureCode } | undefined;
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const result = await addPromptToSet({
      ...target,
      text: row.suggested_text as string,
      category: (row.topic_name as string | null) ?? undefined,
    });
    if ('error' in result) {
      failure = { error: result.error, code: result.code };
      break;
    }
    added.push({ id, promptId: result.prompt.id });
  }

  await Promise.all(added.map((a) => ackAccepted(session.access_token, a.id, a.promptId)));
  if (added.length > 0) revalidatePath('/dashboard/prompts');
  return { trackedIds: added.map((a) => a.id), skippedIds, ...failure };
}

export interface TrackPagePromptsResult {
  /** The prompts added, in the order given. */
  promptIds: string[];
  /**
   * Why the rest weren't; `code` 'plan_limit' when the plan's prompt
   * locations ran out, 'no_topics' when the brand has no topic yet.
   */
  error?: string;
  code?: PromptAddFailureCode;
}

/** More than a page's suggestions: it gets five. */
const MAX_PAGE_PROMPTS = 10;

/**
 * Track prompts suggested for one page (AT-006 part B2), each pointing at
 * it. Added one by one through addPromptToSet, as Insights' "Track N" does,
 * so each passes the same plan check and the run stops at the first that
 * fails. A prompt goes under the brand's topic of that name, in the brand's
 * own spelling, or a new topic made for it, as an import does. Each added
 * prompt gets the page as its target URL, so its answers show whether AI
 * cites the page; a target that can't be saved leaves the prompt tracked.
 * Their first answers come with the next tracking run. A brand with no topic
 * yet gets `no_topics` before any topic is made for it: the person adds one.
 */
export async function trackPagePrompts(
  brandId: string,
  pageUrl: string | null,
  prompts: { text: string; topic: string }[],
): Promise<TrackPagePromptsResult> {
  await assertWritable({ brandId });
  const wanted = (Array.isArray(prompts) ? prompts : [])
    .filter((p) => typeof p?.text === 'string' && p.text.trim())
    .slice(0, MAX_PAGE_PROMPTS);
  if (wanted.length === 0) return { promptIds: [], error: 'Pick at least one prompt.' };

  const supabase = await createClient();
  const target = await promptTarget(supabase, brandId);
  if ('error' in target) return { promptIds: [], error: target.error };

  const keyOf = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
  const { data: topicRows, error: topicsError } = await supabase
    .from('topics')
    .select('name')
    .eq('brand_id', brandId)
    .eq('is_active', true);
  // A failed read isn't a brand without topics: the adds below say what went wrong.
  if (!topicsError && !topicRows?.length) {
    return { promptIds: [], error: NO_TOPICS_MESSAGE, code: NO_TOPICS };
  }
  const topics = new Map((topicRows ?? []).map((t) => [keyOf(t.name as string), t.name as string]));

  const promptIds: string[] = [];
  let failure: { error: string; code?: PromptAddFailureCode } | undefined;
  for (const p of wanted) {
    const named = typeof p.topic === 'string' ? p.topic.trim().slice(0, 60) : '';
    let topic = named ? topics.get(keyOf(named)) : undefined;
    let madeTopicId: string | null = null;
    if (named && !topic) {
      const { data: made } = await supabase
        .from('topics')
        .insert({ brand_id: brandId, name: named, is_active: true })
        .select('id, name')
        .single();
      if (made) {
        topic = made.name as string;
        madeTopicId = made.id as string;
        topics.set(keyOf(topic), topic);
      }
    }

    const result = await addPromptToSet({
      ...target,
      text: p.text.trim(),
      category: topic ?? (named || undefined),
    });
    if ('error' in result) {
      // A topic made for a prompt that wasn't added would sit empty.
      if (madeTopicId) await supabase.from('topics').delete().eq('id', madeTopicId);
      failure = { error: result.error, code: result.code };
      break;
    }
    promptIds.push(result.prompt.id);
    if (pageUrl) {
      const targeted = await addPromptTargetUrl(result.prompt.id, pageUrl);
      if ('error' in targeted) console.error('Page target URL not saved:', targeted.error);
    }
  }

  if (promptIds.length > 0) revalidatePath('/dashboard/prompts');
  return { promptIds, ...failure };
}
