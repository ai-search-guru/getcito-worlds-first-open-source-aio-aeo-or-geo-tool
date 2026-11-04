import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/**
 * Closed-loop citation tracking for prompt target URLs (00032).
 *
 * Normalization must stay in sync with the web-side matcher in
 * frontend/src/lib/actions/promptWorkflow.ts: protocol, www., query, fragment
 * and trailing slashes are ignored, so "https://www.foo.com/blog/x?a=1" and
 * "http://foo.com/blog/x/" count as the same page.
 */
export function normalizeUrlForMatch(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/**
 * Update cited stats for a prompt's target URLs against one freshly saved
 * result's citations. Best-effort by design — a stats failure must never
 * fail the result insert; callers should not await-and-throw.
 */
export async function updateTargetUrlStats(promptId, citations, observedAtIso) {
  try {
    if (!Array.isArray(citations) || citations.length === 0) return;

    const { data: targets } = await supabaseAdmin
      .from('prompt_target_urls')
      .select('id, url, cited_count, first_cited_at')
      .eq('prompt_id', promptId);
    if (!targets || targets.length === 0) return;

    const citedKeys = new Set(citations.map((c) => normalizeUrlForMatch(c?.url)).filter(Boolean));
    if (citedKeys.size === 0) return;

    const observedAt = observedAtIso || new Date().toISOString();
    for (const target of targets) {
      const key = normalizeUrlForMatch(target.url);
      if (!key || !citedKeys.has(key)) continue;
      const { error } = await supabaseAdmin
        .from('prompt_target_urls')
        .update({
          cited_count: (target.cited_count || 0) + 1,
          first_cited_at: target.first_cited_at ?? observedAt,
          last_cited_at: observedAt,
        })
        .eq('id', target.id);
      if (error) {
        logger.warn({ err: error, targetId: target.id }, '[target-urls] stats update failed');
      }
    }
  } catch (err) {
    logger.warn({ err, promptId }, '[target-urls] stats pass failed');
  }
}
