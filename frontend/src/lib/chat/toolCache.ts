import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { canonicalJson } from './idempotency';
import type { ChatTool } from './registry/defineTool';

/**
 * Chat's tool results kept within one chat (CHAT-04 items 9 and 27, CHAT-20
 * §15a; chat_tool_cache, 00410): the same read, with the same arguments as
 * the server scoped them, about the same brand, reuses the earlier result
 * instead of reading again. It costs no model tokens and never touches the
 * prompt cache. Server only: the browser sees the same step either way
 * (CHAT-04 Rule 5).
 *
 * How long a result holds depends on what it reads:
 *   - tracking data (visibility, mentions, citations, answers): until the
 *     brand's next tracking run completes (its data has refreshed, §15a:
 *     "the cache is dropped when data_as_of moves"), and a day at most;
 *   - everything else (lists, tasks, drafts, settings, Google's data): what
 *     the person or a teammate can change at any time, so a few minutes.
 * A change the chat makes (any WRITE that ran) drops the chat's results, so
 * a list read after it is read again. Writes and EXECUTEs are never kept,
 * nor is opening a page (no data to keep).
 *
 * Nothing here fails a run: a lookup or a save that goes wrong is logged and
 * the read runs as if nothing were kept.
 */

/** A tracking-data result holds a day at most (the table's default, CHAT-20 §15a). */
export const TRACKING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Any other read's result: the same question again within the same few minutes. */
export const LIVE_MAX_AGE_MS = 5 * 60 * 1000;
/** A result past this many characters isn't kept (the column's 1 MB, with room). */
export const MAX_CACHED_CHARS = 900_000;

/**
 * The reads of tracking data: their numbers change only when a tracking run
 * completes for the brand. A read not named here is a live one.
 */
export const TRACKING_READS: ReadonlySet<string> = new Set([
  'get_visibility_summary',
  'get_visibility_trend',
  'get_overview_summary',
  'get_prompt_performance',
  'get_prompt_insights',
  'get_fanouts',
  'list_ai_answers',
  'get_mentions_summary',
  'list_mentions',
  'get_mention',
  'get_mention_competitors',
  'get_mentions_perception',
  'list_citations',
  'get_competitor_comparison',
  'get_shopping_visibility',
]);

/**
 * Reads never kept: opening a page of the app reads no data, a web page's
 * words are kept nowhere (CHAT-10 §B), and What's new changes as the
 * person reads it (CHAT-11 §E).
 */
const NOT_KEPT: ReadonlySet<string> = new Set(['open_page', 'fetch_page', 'get_whats_new']);

export interface CachePolicy {
  /** The longest a result holds. */
  maxAgeMs: number;
  /** It goes as soon as the brand's next tracking run completes. */
  untilRefresh: boolean;
}

/** How long a tool's result holds within a chat; null for one never kept (every WRITE and EXECUTE). */
export function cachePolicy(tool: Pick<ChatTool, 'name' | 'class'>): CachePolicy | null {
  if (tool.class !== 'read' || NOT_KEPT.has(tool.name)) return null;
  return TRACKING_READS.has(tool.name)
    ? { maxAgeMs: TRACKING_MAX_AGE_MS, untilRefresh: true }
    : { maxAgeMs: LIVE_MAX_AGE_MS, untilRefresh: false };
}

/**
 * Arguments as one read's key sees them: empty values gone, text trimmed,
 * and a comma list of platforms or ids in one order, so "a, b" and "b,a"
 * read the same.
 */
export function normalizeArgs(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text.includes(',')) return text;
    return [
      ...new Set(
        text
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      ),
    ]
      .sort()
      .join(',');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizeArgs);
  if (typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const normal = normalizeArgs(inner);
      if (normal === null || normal === '') continue;
      if (Array.isArray(normal) && normal.length === 0) continue;
      out[key] = normal;
    }
    return out;
  }
  return null;
}

export interface CacheKeyParts {
  /** The read's registry name. */
  tool: string;
  /** Its input as the server scoped it (scope.ts): dates, platforms and rows set. */
  input: Record<string, unknown>;
  /** The brand it is about; null for a workspace read. */
  brandId: string | null;
  /** The scope the server used (`scope_json.used`). */
  scope: unknown;
  /** Who asked, with their role now: a result read for one role isn't another's. */
  userId: string;
  role: string;
}

/** A read's key in the chat: the sha-256 (hex) of its tool, arguments, brand and scope. */
export function cacheKey(parts: CacheKeyParts): string {
  return createHash('sha256')
    .update(
      canonicalJson([
        parts.tool,
        normalizeArgs(parts.input),
        parts.brandId,
        normalizeArgs(parts.scope),
        parts.userId,
        parts.role,
      ]),
    )
    .digest('hex');
}

/** What a read kept: its output after the row cap and the guard, before the run's budget. */
export interface CachedRead {
  value: Json;
  /** Its lists were cut to the row limit. */
  cut: boolean;
  /** The guard found text written to steer an assistant in it (untrusted.ts). */
  injection: boolean;
  rows: number | null;
  dataAsOf: string | null;
}

interface CacheRow {
  result_json: Json;
  row_count: number | null;
  data_as_of: string | null;
  hits: number;
  created_at: string;
  expires_at: string;
}

const isRecord = (value: Json): value is Record<string, Json> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Whether a tracking run completed for the brand after `since`: its data refreshed. */
async function refreshedSince(brandId: string, since: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('tracking_runs')
    .select('id')
    .eq('brand_id', brandId)
    .gt('completed_at', since)
    .limit(1);
  // Unknown: read again rather than risk an old answer.
  if (error) return true;
  return (data ?? []).length > 0;
}

/**
 * A read kept in this chat for `key`, while it still holds: not past its
 * time, and for tracking data not older than the brand's newest run. Its
 * hit is counted. Null when there is none, or on any failure.
 */
export async function readCached(
  conversationId: string,
  tool: string,
  key: string,
  policy: CachePolicy,
  brandId: string | null,
  now: Date = new Date(),
): Promise<CachedRead | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_tool_cache')
      .select('result_json, row_count, data_as_of, hits, created_at, expires_at')
      .eq('conversation_id', conversationId)
      .eq('tool', tool)
      .eq('scope_hash', key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as CacheRow | null;
    if (!row || Date.parse(row.expires_at) <= now.getTime()) return null;
    if (policy.untilRefresh && brandId && (await refreshedSince(brandId, row.created_at))) {
      return null;
    }
    const kept = row.result_json;
    if (!isRecord(kept) || !('value' in kept)) return null;
    const { error: hitError } = await supabaseAdmin
      .from('chat_tool_cache')
      .update({ hits: (row.hits ?? 0) + 1, last_hit_at: now.toISOString() })
      .eq('conversation_id', conversationId)
      .eq('tool', tool)
      .eq('scope_hash', key);
    if (hitError) console.error('[chat/tool-cache] could not count a hit:', hitError.message);
    return {
      value: kept.value,
      cut: kept.cut === true,
      injection: kept.injection === true,
      rows: row.row_count,
      dataAsOf: row.data_as_of,
    };
  } catch (err) {
    console.error('[chat/tool-cache] could not read a kept result:', (err as Error).message);
    return null;
  }
}

/**
 * Keeps a read's result for the rest of the chat, in place of an older one
 * under the same key, and clears the table's results past their time. A
 * result too large to keep isn't.
 */
export async function saveCached(
  conversationId: string,
  tool: string,
  key: string,
  policy: CachePolicy,
  brandId: string | null,
  read: CachedRead,
  now: Date = new Date(),
): Promise<void> {
  try {
    const result: Json = { value: read.value, cut: read.cut, injection: read.injection };
    if (JSON.stringify(result).length > MAX_CACHED_CHARS) return;
    const { error } = await supabaseAdmin.from('chat_tool_cache').upsert(
      {
        conversation_id: conversationId,
        tool,
        scope_hash: key,
        brand_id: brandId,
        result_json: result,
        row_count: read.rows,
        data_as_of: read.dataAsOf,
        hits: 0,
        created_at: now.toISOString(),
        last_hit_at: null,
        expires_at: new Date(now.getTime() + policy.maxAgeMs).toISOString(),
      },
      { onConflict: 'conversation_id,tool,scope_hash' },
    );
    if (error) throw new Error(error.message);
    await sweepToolCache(now);
  } catch (err) {
    console.error('[chat/tool-cache] could not keep a result:', (err as Error).message);
  }
}

/** A change the chat made: its kept results go, so what it changed is read again. */
export async function dropCached(conversationId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_tool_cache')
    .delete()
    .eq('conversation_id', conversationId);
  if (error) console.error('[chat/tool-cache] could not drop kept results:', error.message);
}

/** Every kept result past its time, in every chat. Safe to run at any time. */
export async function sweepToolCache(now: Date = new Date()): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_tool_cache')
    .delete()
    .lt('expires_at', now.toISOString());
  if (error) console.error('[chat/tool-cache] could not sweep:', error.message);
}
