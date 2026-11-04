/**
 * Backfill the Mentions Perception rollups (00231) from the answers' terms
 * already written (00161).
 *
 * Run: `node src/scripts/backfillMentionTermsDaily.js`
 *
 * Order on a deploy: 00231, then the server, then this, then 00237 (the read
 * that moves onto the rollups and doesn't fall back to the terms).
 *
 * Options via env:
 *   - MENTION_TERMS_BACKFILL_PAUSE   milliseconds between refresh calls
 *                                    (default 250)
 *   - MENTION_TERMS_BACKFILL_BRAND   limit the run to one brand id
 *
 * Covers every brand with terms. Idempotent and restartable:
 * `refresh_mention_terms_daily` is delete + insert per day range, a week per
 * call (MENTION_TERMS_ROLLUP_CHUNK_DAYS, about 5–8 s on the largest brand),
 * with a pause between calls because this shares the instance with live
 * dashboards. No answer text is read.
 */

import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { refreshMentionTermsHistory, refreshPerceptionSnapshots } from '../lib/mentionsRollups.js';

const PAUSE_MS = Number.parseInt(process.env.MENTION_TERMS_BACKFILL_PAUSE ?? '250', 10);
const ONLY_BRAND = process.env.MENTION_TERMS_BACKFILL_BRAND ?? null;

async function main() {
  const query = supabaseAdmin.from('brands').select('id');
  const { data: brands, error } = ONLY_BRAND ? await query.eq('id', ONLY_BRAND) : await query;
  if (error) throw new Error(error.message);

  let done = 0;
  let failed = 0;
  for (const brand of brands ?? []) {
    try {
      const chunks = await refreshMentionTermsHistory(brand.id, { pauseMs: PAUSE_MS });
      // The Perception tab's precomputed view (00241) reads the rebuilt rollups.
      if (chunks > 0) await refreshPerceptionSnapshots(brand.id);
      done++;
      console.log(
        chunks === 0
          ? `[${done}/${brands.length}] ${brand.id} — no terms, skipped`
          : `[${done}/${brands.length}] ${brand.id} — ${chunks} week(s)`,
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
