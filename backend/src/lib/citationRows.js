/**
 * Citations as rows (#732).
 *
 * `prompt_results.citations` keeps the provider's array as jsonb, which is
 * fine to store and expensive to read: every page load expands it again, and
 * pulling the host out of each URL is where the time goes. This writes the
 * same citations out once, at the moment the answer is stored, so reading them
 * later is an indexed scan over narrow rows instead.
 *
 * Exported so the backfill script runs the exact same code path over historical
 * answers rather than a second implementation that could disagree with this one.
 */

import supabaseAdmin from '../config/supabase.js';
import logger from './logger.js';

/**
 * A btree entry cannot exceed roughly 2,704 bytes, and the unique index on
 * `url` is what makes the dictionary a dictionary. The longest URL seen in
 * production is 1,333 characters; truncating well above that keeps one absurd
 * link from failing the insert and taking the citation with it.
 */
export const MAX_URL_LENGTH = 2048;

/**
 * Host without `www.`, lowercased — a port of `extractHostname` from
 * `frontend/src/lib/citations/classify.ts`, fallback included. Kept deliberately
 * identical: the stored domain has to group the way the surface groups, or the
 * two disagree about what a domain is, and every figure shifts when the page
 * switches over to reading these rows.
 */
export function extractDomain(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const host = new URL(rawUrl.trim()).hostname.replace(/^www\./i, '').toLowerCase();
    return host || null;
  } catch {
    // Not every citation arrives as a well-formed URL — 252 of the 2,023,979
    // in production have no scheme at all. The page counts those today by
    // recovering a hostname-like token, so this does too; dropping them here
    // would quietly lower every figure the new path reports against the old.
    const match = rawUrl.match(/^(?:https?:\/\/)?(?:www\.)?([^/\s?#]+)/i);
    return match ? match[1].toLowerCase() : null;
  }
}

/**
 * Citation entries worth storing, in array order.
 *
 * Entries without a parsable URL are dropped rather than stored with a null
 * domain: they cannot be grouped, counted per domain, or clicked, so a row for
 * one would only be a row that every reader has to remember to exclude.
 * `position` is the index in the original array, so the identity of a citation
 * survives that filtering.
 */
export function normalizeCitations(rawCitations) {
  if (!Array.isArray(rawCitations)) return [];

  const out = [];
  rawCitations.forEach((cite, index) => {
    const rawUrl = typeof cite?.url === 'string' ? cite.url.trim() : '';
    if (!rawUrl) return;
    const domain = extractDomain(rawUrl);
    if (!domain) return;

    out.push({
      position: index,
      url: rawUrl.slice(0, MAX_URL_LENGTH),
      domain,
      title: typeof cite?.title === 'string' ? cite.title.trim() || null : null,
    });
  });
  return out;
}

/**
 * Resolve URLs to dictionary ids, inserting the ones not seen before.
 *
 * One call to `citation_url_ids`, which takes the list as a jsonb argument in
 * the request body. The previous version filtered with `.in('url', ...)`,
 * which PostgREST spells out in the query string: URLs are percent-encoded on
 * the way into a URI, so even a hundred of them overflowed the request-line
 * limits in front of the API and failed with `Bad Request`, or reset the
 * connection outright. It failed on exactly the answers carrying the most
 * citations — 182 of 174,466 survived a chunked version of the same mistake.
 *
 * Nothing here needs chunking any more, and there is no lookup-then-insert
 * race to re-read around: the function inserts what is new and returns ids for
 * everything asked about, including rows a concurrent writer won.
 */
async function resolveUrlIds(entries) {
  const byUrl = new Map();
  for (const entry of entries) {
    if (!byUrl.has(entry.url)) byUrl.set(entry.url, entry);
  }
  if (byUrl.size === 0) return new Map();

  const { data, error } = await supabaseAdmin.rpc('citation_url_ids', {
    p_urls: [...byUrl.values()].map(({ url, domain, title }) => ({ url, domain, title })),
  });
  if (error) throw new Error(`citation url resolve: ${error.message}`);

  return new Map((data ?? []).map((row) => [row.url, row.id]));
}

/**
 * Write one answer's citations.
 *
 * Best effort by design: the caller has already stored the answer, and a
 * failure here must not cost that. The jsonb column still holds the same data,
 * so anything missed is recoverable by re-running the backfill over the
 * affected window.
 *
 * @returns {Promise<number|null>} rows actually inserted, or null if the write
 *   failed. Zero and null are deliberately different answers: zero means every
 *   row was already there, null means nothing was stored and the caller should
 *   retry. Conflating them is how a broken run reads as a quiet one.
 */
export async function persistCitationRows({ promptResultId, brandId, createdAt, citations }) {
  const entries = normalizeCitations(citations);
  if (entries.length === 0) return 0;

  try {
    const urlIds = await resolveUrlIds(entries);

    const rows = entries
      .map((entry) => ({
        prompt_result_id: promptResultId,
        position: entry.position,
        url_id: urlIds.get(entry.url),
        brand_id: brandId,
        created_at: createdAt,
      }))
      .filter((row) => row.url_id !== undefined);

    if (rows.length === 0) return 0;

    // Idempotent on (prompt_result_id, position): a retried insert, a
    // re-delivered webhook, or a re-run of the backfill over the same answer
    // adds nothing and errors on nothing.
    //
    // `.select()` so the return value is what was actually inserted rather
    // than what was attempted. The difference matters: a backfill run once
    // reported thousands of citations written while the table did not move,
    // because every one of them was silently discarded as a duplicate.
    const { data, error } = await supabaseAdmin
      .from('prompt_result_citations')
      .upsert(rows, { onConflict: 'prompt_result_id,position', ignoreDuplicates: true })
      .select('position');
    if (error) throw new Error(error.message);

    return (data ?? []).length;
  } catch (err) {
    logger.error(
      { err, promptResultId, brandId, citationCount: entries.length },
      '[citations] failed to persist citation rows',
    );
    return null;
  }
}
