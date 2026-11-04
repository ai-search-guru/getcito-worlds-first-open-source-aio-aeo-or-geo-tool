/**
 * Backfill the Insights daily rollups (00066) from historical prompt_results.
 *
 * Run: `node src/scripts/backfillInsightsDaily.js`
 *
 * Options via env:
 *   - INSIGHTS_BACKFILL_CHUNK_DAYS   days recomputed per refresh call
 *                                    (default 31)
 *   - INSIGHTS_BACKFILL_PAUSE        milliseconds between refresh calls
 *                                    (default 250)
 *   - INSIGHTS_BACKFILL_BRAND        limit the run to one brand id
 *
 * Covers every brand with results — including cancelled orgs, deliberately:
 * the read path switches for everyone at once, and a reactivated account
 * whose history was skipped would open an empty dashboard.
 *
 * Idempotent and restartable. `refresh_insights_daily` is delete + insert
 * per day range, so an interrupted run can simply be started again; at worst
 * it redoes chunks it already wrote. Chunked by calendar month so no single
 * call parses more than ~31 days of competitor jsonb, with a pause between
 * calls because this shares the instance with live dashboards.
 *
 * Ends by counting insights_prompt_daily rows the refresh has not rewritten
 * since 00164 (exit code 1 while any remain): topic views read the columns
 * those rows are missing.
 */

import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { refreshInsightsDaily, utcDay } from '../lib/insightsRollups.js';

const CHUNK_DAYS = Number.parseInt(process.env.INSIGHTS_BACKFILL_CHUNK_DAYS ?? '31', 10);
const PAUSE_MS = Number.parseInt(process.env.INSIGHTS_BACKFILL_PAUSE ?? '250', 10);
const ONLY_BRAND = process.env.INSIGHTS_BACKFILL_BRAND ?? null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** UTC day of a brand's first/last result, or null when it has none. */
async function resultDayBound(brandId, ascending) {
  const { data, error } = await supabaseAdmin
    .from('prompt_results')
    .select('created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.created_at ? utcDay(data[0].created_at) : null;
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d.toISOString());
}

async function backfillBrand(brandId) {
  const firstDay = await resultDayBound(brandId, true);
  if (!firstDay) return { chunks: 0, skipped: true };
  const lastDay = await resultDayBound(brandId, false);

  let chunks = 0;
  for (let from = firstDay; from <= lastDay; from = addDays(from, CHUNK_DAYS)) {
    const to = addDays(from, CHUNK_DAYS - 1) < lastDay ? addDays(from, CHUNK_DAYS - 1) : lastDay;
    const ok = await refreshInsightsDaily(brandId, from, to);
    if (!ok) throw new Error(`refresh failed for ${brandId} ${from}..${to}`);
    chunks++;
    await sleep(PAUSE_MS);
  }
  return { chunks, skipped: false, firstDay, lastDay };
}

async function main() {
  const query = supabaseAdmin.from('brands').select('id, name');
  const { data: brands, error } = ONLY_BRAND ? await query.eq('id', ONLY_BRAND) : await query;
  if (error) throw new Error(error.message);

  let done = 0;
  let failed = 0;
  for (const brand of brands ?? []) {
    try {
      const res = await backfillBrand(brand.id);
      done++;
      console.log(
        res.skipped
          ? `[${done}/${brands.length}] ${brand.id} — no results, skipped`
          : `[${done}/${brands.length}] ${brand.id} — ${res.firstDay}..${res.lastDay} in ${res.chunks} chunk(s)`,
      );
    } catch (err) {
      failed++;
      console.error(`FAILED ${brand.id}: ${err.message}`);
    }
  }
  console.log(`Backfill complete: ${done} brand(s), ${failed} failure(s).`);
  if (failed > 0) process.exitCode = 1;

  // 00164 added the topic-read measures to insights_prompt_daily as nullable
  // columns: a row no refresh has rewritten since reads as NULL. Topic views
  // read those columns, so they must not be switched on while any remain.
  const unfilled = supabaseAdmin
    .from('insights_prompt_daily')
    .select('brand_id', { count: 'exact', head: true })
    .is('max_created_at', null);
  const { count, error: countError } = ONLY_BRAND
    ? await unfilled.eq('brand_id', ONLY_BRAND)
    : await unfilled;
  if (countError) throw new Error(countError.message);
  console.log(`insights_prompt_daily rows not yet rewritten: ${count ?? 0}`);
  if ((count ?? 0) > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
