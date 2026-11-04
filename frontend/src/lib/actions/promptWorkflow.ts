'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritable } from '@/lib/subscriptionGuard';

/**
 * Prompt workflow (v1): per-prompt work status, a notes thread, and target
 * URLs. All access control lives in RLS (00031): members read, admin/manager
 * write, everything scoped to the caller's org through
 * prompts → prompt_sets → brands.
 */

export type PromptWorkStatus = 'todo' | 'in_progress' | 'done';

export interface PromptNote {
  id: string;
  promptId: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface PromptTargetUrl {
  id: string;
  promptId: string;
  url: string;
  label: string | null;
  createdAt: string;
  /** Answers for this prompt that cited the URL (backfill + live tracking). */
  citedCount: number;
  firstCitedAt: string | null;
  lastCitedAt: string | null;
}

export interface PromptWorkflowData {
  workStatus: PromptWorkStatus | null;
  notes: PromptNote[];
  targetUrls: PromptTargetUrl[];
}

function mapTargetUrlRow(r: Record<string, unknown>): PromptTargetUrl {
  return {
    id: r.id as string,
    promptId: r.prompt_id as string,
    url: r.url as string,
    label: (r.label as string | null) ?? null,
    createdAt: r.created_at as string,
    citedCount: (r.cited_count as number) ?? 0,
    firstCitedAt: (r.first_cited_at as string | null) ?? null,
    lastCitedAt: (r.last_cited_at as string | null) ?? null,
  };
}

export async function getPromptWorkflow(promptId: string): Promise<PromptWorkflowData> {
  const supabase = await createClient();

  const [promptRes, notesRes, urlsRes] = await Promise.all([
    supabase.from('prompts').select('work_status').eq('id', promptId).maybeSingle(),
    supabase
      .from('prompt_notes')
      .select('id, prompt_id, body, created_at, profiles(full_name)')
      .eq('prompt_id', promptId)
      .order('created_at', { ascending: false }),
    supabase
      .from('prompt_target_urls')
      .select('id, prompt_id, url, label, created_at, cited_count, first_cited_at, last_cited_at')
      .eq('prompt_id', promptId)
      .order('created_at', { ascending: true }),
  ]);

  if (notesRes.error) throw new Error(notesRes.error.message);
  if (urlsRes.error) throw new Error(urlsRes.error.message);

  const notes: PromptNote[] = (notesRes.data ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown>;
    const profile = r.profiles as { full_name: string | null } | null;
    return {
      id: r.id as string,
      promptId: r.prompt_id as string,
      body: r.body as string,
      authorName: profile?.full_name ?? null,
      createdAt: r.created_at as string,
    };
  });

  const targetUrls: PromptTargetUrl[] = (urlsRes.data ?? []).map((row) =>
    mapTargetUrlRow(row as unknown as Record<string, unknown>),
  );

  return {
    workStatus: (promptRes.data?.work_status as PromptWorkStatus | null) ?? null,
    notes,
    targetUrls,
  };
}

export async function setPromptWorkStatus(
  promptId: string,
  status: PromptWorkStatus | null,
): Promise<void> {
  await assertWritable();
  const supabase = await createClient();
  const { error } = await supabase
    .from('prompts')
    .update({ work_status: status })
    .eq('id', promptId);
  if (error) throw new Error(error.message);
}

export type AddPromptNoteResult = { note: PromptNote } | { error: string };

export async function addPromptNote(promptId: string, body: string): Promise<AddPromptNoteResult> {
  await assertWritable();
  const trimmed = body.trim();
  if (!trimmed) return { error: 'Note cannot be empty' };
  if (trimmed.length > 2000) return { error: 'Note is too long (max 2000 characters)' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('prompt_notes')
    .insert({ prompt_id: promptId, body: trimmed, author_id: user?.id ?? null })
    .select('id, prompt_id, body, created_at, profiles(full_name)')
    .single();
  if (error) return { error: error.message };

  const r = data as unknown as Record<string, unknown>;
  const profile = r.profiles as { full_name: string | null } | null;
  return {
    note: {
      id: r.id as string,
      promptId: r.prompt_id as string,
      body: r.body as string,
      authorName: profile?.full_name ?? null,
      createdAt: r.created_at as string,
    },
  };
}

export async function deletePromptNote(noteId: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();
  const { error } = await supabase.from('prompt_notes').delete().eq('id', noteId);
  if (error) throw new Error(error.message);
}

/** Basic sanity check — the value must parse as an http(s) URL. */
function normalizeTargetUrl(raw: string): string {
  const trimmed = raw.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are supported');
  }
  return parsed.toString();
}

/**
 * Match key for citation comparison — must stay in sync with the server-side
 * matcher in backend/src/lib/targetUrlStats.js: protocol, www., query,
 * fragment and trailing slashes are ignored.
 */
function urlMatchKey(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return null;
  }
}

const BACKFILL_PAGE_SIZE = 1000;
const BACKFILL_MAX_ROWS = 5000;

/**
 * One-time backfill when a target URL is added: scan the prompt's existing
 * results so citations that predate the URL still count. Live tracking keeps
 * the stats current from here on (backend/src/lib/targetUrlStats.js).
 * Best-effort — a scan failure leaves the row at zero, which live tracking
 * corrects over time.
 */
async function backfillCitedStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  promptId: string,
  targetId: string,
  targetUrl: string,
): Promise<{ citedCount: number; firstCitedAt: string | null; lastCitedAt: string | null }> {
  const key = urlMatchKey(targetUrl);
  const empty = { citedCount: 0, firstCitedAt: null, lastCitedAt: null };
  if (!key) return empty;

  let citedCount = 0;
  let firstCitedAt: string | null = null;
  let lastCitedAt: string | null = null;

  try {
    for (let from = 0; from < BACKFILL_MAX_ROWS; from += BACKFILL_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('prompt_results')
        .select('citations, created_at')
        .eq('prompt_id', promptId)
        .neq('platform', 'chatgpt-shopping')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + BACKFILL_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);

      const batch = (data ?? []) as { citations: { url?: string }[] | null; created_at: string }[];
      for (const row of batch) {
        const cites = Array.isArray(row.citations) ? row.citations : [];
        if (cites.some((c) => urlMatchKey(c?.url ?? '') === key)) {
          citedCount += 1;
          if (!firstCitedAt) firstCitedAt = row.created_at;
          lastCitedAt = row.created_at;
        }
      }
      if (batch.length < BACKFILL_PAGE_SIZE) break;
    }

    if (citedCount > 0) {
      await supabase
        .from('prompt_target_urls')
        .update({
          cited_count: citedCount,
          first_cited_at: firstCitedAt,
          last_cited_at: lastCitedAt,
        })
        .eq('id', targetId);
    }
  } catch (err) {
    console.error('[prompt-workflow] cited backfill failed:', err);
    return empty;
  }

  return { citedCount, firstCitedAt, lastCitedAt };
}

export type AddPromptTargetUrlResult = { targetUrl: PromptTargetUrl } | { error: string };

export async function addPromptTargetUrl(
  promptId: string,
  url: string,
  label?: string,
): Promise<AddPromptTargetUrlResult> {
  await assertWritable();
  let normalized: string;
  try {
    normalized = normalizeTargetUrl(url);
  } catch {
    return { error: 'Enter a valid URL' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('prompt_target_urls')
    .insert({
      prompt_id: promptId,
      url: normalized,
      label: label?.trim() || null,
      added_by: user?.id ?? null,
    })
    .select('id, prompt_id, url, label, created_at, cited_count, first_cited_at, last_cited_at')
    .single();
  if (error) {
    if (error.code === '23505') {
      return { error: 'This URL is already targeted for this prompt' };
    }

    return { error: error.message };
  }

  const mapped = mapTargetUrlRow(data as unknown as Record<string, unknown>);
  const stats = await backfillCitedStats(supabase, promptId, mapped.id, mapped.url);
  return {
    targetUrl: {
      ...mapped,
      ...stats,
    },
  };
}

export async function deletePromptTargetUrl(id: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();
  const { error } = await supabase.from('prompt_target_urls').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
