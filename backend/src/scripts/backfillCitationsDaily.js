/**
 * Backfill the Citations daily rollups (00118, and Competitor Gaps' rows from
 * 00203) from historical citations.
 *
 * Run: `node src/scripts/backfillCitationsDaily.js`
 *
 * Options via env:
 *   - CITATIONS_BACKFILL_PAUSE   milliseconds between refresh calls
 *                                (default 250)
 *   - CITATIONS_BACKFILL_BRAND   limit the run to one brand id
 *
 * Covers every brand with results, cancelled orgs included, for the same
 * reason as the Insights backfill: the read path switches for everyone at
 * once, and a reactivated account must not open an empty page.
 *
 * Idempotent and restartable. `refresh_citations_daily` is delete + insert
 * per day range, so an interrupted run can be started again. Chunked by
 * HISTORY_CHUNK_DAYS (the largest brand writes ~2 weeks in ~12s), with a
 * pause between calls because this shares the instance with live dashboards.
 */

import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { refreshCitationHistory } from '../lib/citationsRollups.js';

const PAUSE_MS = Number.parseInt(process.env.CITATIONS_BACKFILL_PAUSE ?? '250', 10);
const ONLY_BRAND = process.env.CITATIONS_BACKFILL_BRAND ?? null;

async function main() {
  const query = supabaseAdmin.from('brands').select('id');
  const { data: brands, error } = ONLY_BRAND ? await query.eq('id', ONLY_BRAND) : await query;
  if (error) throw new Error(error.message);

  let done = 0;
  let failed = 0;
  for (const brand of brands ?? []) {
    try {
      const chunks = await refreshCitationHistory(brand.id, { pauseMs: PAUSE_MS });
      done++;
      console.log(
        chunks === 0
          ? `[${done}/${brands.length}] ${brand.id} — no results, skipped`
          : `[${done}/${brands.length}] ${brand.id} — ${chunks} chunk(s)`,
      );
    } catch (err) {
      failed++;
      console.error(`FAILED ${brand.id}: ${err.message}`);
    }
  }
  console.log(`Backfill complete: ${done} brand(s), ${failed} failure(s).`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
