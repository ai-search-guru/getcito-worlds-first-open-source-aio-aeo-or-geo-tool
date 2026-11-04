/**
 * Recompute `prompt_results.citation_count` for a brand from the stored
 * citations JSONB and the brand's CURRENT domain list.
 *
 * citation_count is computed at tracking time and frozen into the row, so a
 * later change to `brand_domains` silently desyncs it from what the
 * Citations page computes live — the same "own citations" metric then shows
 * different numbers on different surfaces. The web layer calls this through
 * `/api/internal/recount-citations` whenever a brand's domain list changes.
 *
 * `visibility_score` is intentionally NOT recomputed: it is a point-in-time
 * heuristic, and rewriting it would retroactively reshape historical trend
 * charts. Only the citation tally is brought in line.
 */

import supabaseAdmin from '../config/supabase.js';
import { countOwnDomainCitations } from './responseParser.js';
import logger from './logger.js';

const RECOUNT_PAGE_SIZE = 1000;
const RECOUNT_MAX_ROWS = 200_000;

export async function recountBrandCitations(brandId) {
  const { data: domainRows, error: domainErr } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);
  if (domainErr) throw new Error(domainErr.message);
  const domains = (domainRows || []).map((r) => r.domain);

  let scanned = 0;
  let updated = 0;

  for (let offset = 0; offset < RECOUNT_MAX_ROWS; offset += RECOUNT_PAGE_SIZE) {
    const { data: rows, error } = await supabaseAdmin
      .from('prompt_results')
      .select('id, citations, citation_count')
      .eq('brand_id', brandId)
      // Deterministic order so .range() pages don't shuffle between requests
      // (citation_count updates don't touch the ordering columns).
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + RECOUNT_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const batch = rows || [];
    scanned += batch.length;

    for (const row of batch) {
      const citations = Array.isArray(row.citations) ? row.citations : [];
      const fresh = countOwnDomainCitations(citations, domains);
      if (fresh !== row.citation_count) {
        const { error: updateErr } = await supabaseAdmin
          .from('prompt_results')
          .update({ citation_count: fresh })
          .eq('id', row.id);
        if (updateErr) throw new Error(updateErr.message);
        updated++;
      }
    }

    if (batch.length < RECOUNT_PAGE_SIZE) break;
  }

  logger.info({ brandId, scanned, updated }, '[citations] recount complete');
  return { scanned, updated };
}
