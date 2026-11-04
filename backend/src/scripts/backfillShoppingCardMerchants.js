/**
 * Classify destinations on existing normalized shopping-card rows.
 *
 * Run after migration 00225:
 *   node src/scripts/backfillShoppingCardMerchants.js
 *
 * Add --all to reclassify every row with a merchant URL after brand-domain changes:
 *   node src/scripts/backfillShoppingCardMerchants.js --all
 *
 * By default, only unclassified rows are selected, so an interrupted run can be
 * safely resumed by running the command again. Pages across the normalized
 * card table and uses the same pure classifier as
 * the live result handler. Cards without a merchant URL remain unclassified.
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { classifyMerchant } from '../lib/merchantDetection.js';

const BATCH_SIZE = Number.parseInt(process.env.SHOPPING_MERCHANT_BACKFILL_BATCH ?? '500', 10);
const UPDATE_CONCURRENCY = 20;

async function loadBrandDomains(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);
  if (error) throw new Error(`Failed to load domains for ${brandId}: ${error.message}`);
  return (data ?? []).map((row) => row.domain).filter(Boolean);
}

async function updateBatch(rows, domainCache) {
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const withUrls = rows.filter(
    (row) => typeof row.merchant_url === 'string' && row.merchant_url.trim(),
  );
  skipped += rows.length - withUrls.length;

  for (let start = 0; start < withUrls.length; start += UPDATE_CONCURRENCY) {
    const slice = withUrls.slice(start, start + UPDATE_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (row) => {
        let domainsPromise = domainCache.get(row.brand_id);
        if (!domainsPromise) {
          domainsPromise = loadBrandDomains(row.brand_id);
          domainCache.set(row.brand_id, domainsPromise);
        }
        const domains = await domainsPromise;
        const destination = classifyMerchant(row.merchant_url, { brandDomains: domains });
        const { error } = await supabaseAdmin
          .from('prompt_result_shopping_cards')
          .update({
            merchant_kind: destination.kind,
            marketplace: destination.marketplace,
            listing_id: destination.listingId,
          })
          .eq('id', row.id);
        if (error) return { failed: true, error, id: row.id };
        return { updated: true };
      }),
    );

    for (const result of results) {
      if (result.failed) {
        failed += 1;
        console.error(`[backfill] Failed to classify ${result.id}: ${result.error.message}`);
      } else {
        updated += 1;
      }
    }
  }

  return { updated, skipped, failed };
}

async function main() {
  const domainCache = new Map();
  const reclassifyAll = process.argv.includes('--all');
  let lastId = null;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  while (true) {
    let query = supabaseAdmin
      .from('prompt_result_shopping_cards')
      .select('id, brand_id, merchant_url')
      .not('merchant_url', 'is', null)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (!reclassifyAll) query = query.is('merchant_kind', null);
    if (lastId) query = query.gt('id', lastId);

    const { data: rows, error } = await query;

    if (error) throw new Error(`Failed to read shopping cards: ${error.message}`);
    if (!rows?.length) break;

    const result = await updateBatch(rows, domainCache);
    scanned += rows.length;
    updated += result.updated;
    skipped += result.skipped;
    failed += result.failed;
    console.log(
      `[backfill] scanned=${scanned} updated=${updated} skipped(no URL)=${skipped} failed=${failed}`,
    );

    // The keyset cursor is stable while merchant_kind updates rows that this
    // default run has already classified. It also avoids OFFSET skipping rows
    // if older cards are concurrently deleted.
    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(
    `[backfill] complete: scanned=${scanned}, updated=${updated}, skipped=${skipped}, failed=${failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[backfill] Fatal:', error);
  process.exitCode = 1;
});
