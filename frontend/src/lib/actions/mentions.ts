'use server';

import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import { mentionExcerpt } from '@/lib/mentionMatch';
import { MENTIONS_EXPORT_CAP } from '@/lib/mentionsExport';
import type { MentionsQuery } from '@/lib/mentionsFilters';
import {
  MENTIONS_PAGE_SIZE,
  parseMentionsList,
  parseSentimentOverride,
  type MentionSentiment,
  type MentionsList,
  type MentionsTableState,
  type SentimentOverride,
} from '@/lib/mentionsList';
import { parseMentionsOverview, type MentionsOverview } from '@/lib/mentionsOverview';
import { parseMentionsPerception, type MentionsPerception } from '@/lib/mentionsPerception';
import type { Citation } from '@/types';
import { assertWritable } from '@/lib/subscriptionGuard';

/**
 * The Mentions & Sentiment Overview's figures (MS-06) for a window and the
 * window before it, from the mention rollups (00157). One database call, and
 * no LLM: every figure aggregates what tracking stored.
 *
 * Null when there is nothing to read: the database doesn't have the function
 * yet (PostgREST's PGRST202, a web build deployed before the migration), or
 * the caller isn't in the brand's organization.
 */
export async function getMentionsOverview(
  brandId: string,
  query: MentionsQuery,
): Promise<MentionsOverview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('mentions_overview', {
    p_brand_id: brandId,
    p_date_from: query.from,
    p_date_to: query.to,
    p_platform: query.platform,
    p_region: query.region,
    p_topic_id: query.topicId,
    p_search: query.search,
  });
  if (error?.code === 'PGRST202') return null;
  if (error) throw new Error(error.message);
  return parseMentionsOverview(data);
}

/**
 * A page of the Mentions table (MS-07): the answers naming the brand in the
 * window, filtered, sorted and grouped as the table asks, from mentions_list
 * (00158). Each answer's text is cut here to the passage around the brand's
 * first mention, so the page receives excerpts only.
 *
 * Null as getMentionsOverview: no function yet (PGRST202), or no access.
 */
export async function listMentions(
  brandId: string,
  query: MentionsQuery,
  table: MentionsTableState,
  page: number,
): Promise<MentionsList | null> {
  const supabase = await createClient();
  const [list, brandTerms] = await Promise.all([
    readMentionsPage(supabase, brandId, query, table, page),
    readBrandTerms(supabase, brandId),
  ]);
  if (list.error?.code === 'PGRST202') return null;
  if (list.error) throw new Error(list.error.message);

  const parsed = parseMentionsList(list.data, (response) => mentionExcerpt(response, brandTerms));
  return parsed ? { ...parsed, brandTerms } : null;
}

/** The table's pages Export CSV reads at once. */
const EXPORT_PAGES_AT_ONCE = 5;

/**
 * Every mention for Export CSV (MS-13): the table's pages under the same
 * filters, read a few at a time up to MENTIONS_EXPORT_CAP, in the table's sort
 * and ungrouped, each cut to its excerpt as listMentions does. `total` is
 * every match, so the caller can tell when the file holds fewer.
 *
 * Null as getMentionsOverview: no function yet (PGRST202), or no access.
 */
export async function exportMentions(
  brandId: string,
  query: MentionsQuery,
  table: MentionsTableState,
): Promise<MentionsList | null> {
  const supabase = await createClient();
  const flat: MentionsTableState = { ...table, group: '' };
  const [first, brandTerms] = await Promise.all([
    readMentionsPage(supabase, brandId, query, flat, 0),
    readBrandTerms(supabase, brandId),
  ]);
  if (first.error?.code === 'PGRST202') return null;
  if (first.error) throw new Error(first.error.message);

  const excerptOf = (response: string) => mentionExcerpt(response, brandTerms);
  const head = parseMentionsList(first.data, excerptOf);
  if (!head) return null;

  const pages = Math.ceil(Math.min(head.total, MENTIONS_EXPORT_CAP) / MENTIONS_PAGE_SIZE);
  const rows = [...head.rows];
  for (let next = 1; next < pages; next += EXPORT_PAGES_AT_ONCE) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(EXPORT_PAGES_AT_ONCE, pages - next) }, (_, i) =>
        readMentionsPage(supabase, brandId, query, flat, next + i),
      ),
    );
    for (const page of batch) {
      if (page.error) throw new Error(page.error.message);
      rows.push(...(parseMentionsList(page.data, excerptOf)?.rows ?? []));
    }
  }
  // An answer stored mid-export shifts the pages by a row: keep each answer once.
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  return { total: head.total, prompts: head.prompts, rows: unique, brandTerms };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

function readMentionsPage(
  supabase: Supabase,
  brandId: string,
  query: MentionsQuery,
  table: MentionsTableState,
  page: number,
) {
  return supabase.rpc('mentions_list', {
    p_brand_id: brandId,
    p_date_from: query.from,
    p_date_to: query.to,
    p_platform: query.platform,
    p_region: query.region,
    p_topic_id: query.topicId,
    p_search: query.search,
    p_sentiment: table.sentiment || undefined,
    p_competitor_id: table.competitor || undefined,
    p_sort: table.sort,
    p_group: table.group || undefined,
    p_limit: MENTIONS_PAGE_SIZE,
    p_offset: Math.max(0, page) * MENTIONS_PAGE_SIZE,
  });
}

/** The names tracking matches the brand by: its name and its domains. */
async function readBrandTerms(supabase: Supabase, brandId: string): Promise<string[]> {
  const { data } = await supabase
    .from('brands')
    .select('name, brand_domains(domain)')
    .eq('id', brandId)
    .maybeSingle();
  const row = data as { name?: string; brand_domains?: { domain?: string }[] } | null;
  return [row?.name ?? '', ...(row?.brand_domains ?? []).map((d) => d.domain ?? '')].filter(
    Boolean,
  );
}

/**
 * One answer's stored text and citations, and its latest sentiment
 * correction, for the response drawer. Read as the caller, so row-level
 * security limits it to their organization's answers; null when it isn't
 * theirs or no longer exists.
 */
export async function getMentionResponse(
  brandId: string,
  resultId: string,
): Promise<{ response: string; citations: Citation[]; override: SentimentOverride | null } | null> {
  const supabase = await createClient();
  const [answer, correction] = await Promise.all([
    supabase
      .from('prompt_results')
      .select('response, citations')
      .eq('id', resultId)
      .eq('brand_id', brandId)
      .maybeSingle(),
    supabase
      .from('sentiment_overrides')
      .select('sentiment, previous_sentiment, note, user_name, created_at')
      .eq('result_id', resultId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (answer.error) throw new Error(answer.error.message);
  const data = answer.data;
  if (!data) return null;
  return {
    response: typeof data.response === 'string' ? data.response : '',
    citations: Array.isArray(data.citations) ? (data.citations as unknown as Citation[]) : [],
    // A missing table (a build before 00160) reads as no correction.
    override: correction.error ? null : parseSentimentOverride(correction.data),
  };
}

/**
 * "Sentiment is wrong" in the response drawer (MS-08): sets an answer's
 * sentiment toward the brand, with an optional note. The database checks
 * that the caller is an admin or manager of the answer's organization,
 * changes the answer everywhere its sentiment counts, refreshes that day's
 * rollups and keeps the correction's history (00160).
 */
export async function overrideMentionSentiment(
  resultId: string,
  sentiment: MentionSentiment,
  note?: string,
): Promise<
  | { changed: boolean; sentiment: MentionSentiment; override: SentimentOverride | null }
  | { error: 'forbidden' | 'invalid' | 'missing' | 'unknown'; message: string }
> {
  await assertWritable();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('override_mention_sentiment', {
    p_result_id: resultId,
    p_sentiment: sentiment,
    p_note: note?.trim() || undefined,
  });
  if (error) {
    const kind =
      error.code === '42501'
        ? 'forbidden'
        : error.code === '22023'
          ? 'invalid'
          : error.code === 'P0002'
            ? 'missing'
            : 'unknown';
    return { error: kind, message: error.message };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    changed: r.changed === true,
    sentiment,
    override: parseSentimentOverride(r.override),
  };
}

/**
 * "Send to Action Center" on the Mentions tab (MS-08): the chosen answers
 * as one action to change how AI describes the brand. The server reads the
 * answers again; the excerpts are the table's, so the action quotes what the
 * person saw. The same answers sent again return the open action.
 */
export async function sendMentionsToActionCenter(
  brandId: string,
  mentions: { id: string; excerpt: string }[],
): Promise<{ actionId: string; actionNo: number; created: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const res = await fetch(`${API_BASE_URL}/api/mentions/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      brandId,
      resultIds: mentions.map((m) => m.id),
      excerpts: Object.fromEntries(mentions.map((m) => [m.id, m.excerpt])),
    }),
  });

  // Returned, not thrown: a thrown error's message is masked in production.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.details || body.error || `Server error: ${res.status}` };
  }
  return res.json();
}

/**
 * The Perception tab's figures (MS-09) for a window and the window before it,
 * from the per-answer terms (00161): the brand's terms, the attributes that
 * tell it and its competitors apart, and the competitors named beside it.
 *
 * Null as getMentionsOverview: no function yet (PGRST202), or no access.
 */
export async function getMentionsPerception(
  brandId: string,
  query: MentionsQuery,
): Promise<MentionsPerception | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('mentions_perception', {
    p_brand_id: brandId,
    p_date_from: query.from,
    p_date_to: query.to,
    p_platform: query.platform,
    p_region: query.region,
    p_topic_id: query.topicId,
    p_search: query.search,
  });
  if (error?.code === 'PGRST202') return null;
  if (error) throw new Error(error.message);
  return parseMentionsPerception(data);
}
