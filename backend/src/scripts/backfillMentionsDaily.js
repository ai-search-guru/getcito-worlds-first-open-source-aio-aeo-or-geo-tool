/**
 * Backfill the Mentions daily rollups (00157) and per-answer terms (00161)
 * from historical prompt_results.
 *
 * Run: `node src/scripts/backfillMentionsDaily.js`
 *
 * Options via env:
 *   - MENTIONS_BACKFILL_PAUSE   milliseconds between refresh calls
 *                               (default 250)
 *   - MENTIONS_BACKFILL_BRAND   limit the run to one brand id
 *
 * Covers every brand with results, cancelled orgs included, as the Insights
 * and Citations backfills do: the page must not open empty on launch day, or
 * for a reactivated account.
 *
 * Idempotent and restartable. `refresh_mentions_daily` is delete + insert per
 * day range, so an interrupted run can be started again. Chunked by
 * MENTION_HISTORY_CHUNK_DAYS, with a pause between calls because this shares the
 * instance with live dashboards.
 */

import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { refreshMentionHistory, refreshPerceptionSnapshots } from '../lib/mentionsRollups.js';

const PAUSE_MS = Number.parseInt(process.env.MENTIONS_BACKFILL_PAUSE ?? '250', 10);
const ONLY_BRAND = process.env.MENTIONS_BACKFILL_BRAND ?? null;

async function main() {
  const query = supabaseAdmin.from('brands').select('id');
  const { data: brands, error } = ONLY_BRAND ? await query.eq('id', ONLY_BRAND) : await query;
  if (error) throw new Error(error.message);

  let done = 0;
  let failed = 0;
  for (const brand of brands ?? []) {
    try {
      const chunks = await refreshMentionHistory(brand.id, { pauseMs: PAUSE_MS });
      // The Perception tab's precomputed view (00241) reads the rebuilt rollups.
      if (chunks > 0) await refreshPerceptionSnapshots(brand.id);
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
