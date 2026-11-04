/**
 * Backfill prompt_result_shopping_cards from the raw
 * prompt_results.shopping_cards JSONB column.
 *
 * Run: `node src/scripts/backfillShoppingCards.js`
 *
 * Options via env:
 *   - SHOPPING_BACKFILL_DAYS    how far back to walk, in days (default 90)
 *   - SHOPPING_BACKFILL_BATCH   prompt_results pulled per batch (default 200)
 *
 * Idempotent: the underlying `persistShoppingCards` upserts on
 * `(prompt_result_id, position)` with `ignoreDuplicates: true`, so re-running
 * this script is safe and skips work that's already there.
 *
 * Brand info + competitors are loaded per brand (not per row) and reused
 * across every prompt_result that targets that brand — same data the
 * worker uses live; same matcher.
 */

import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { persistShoppingCards } from '../lib/cloroResultHandler.js';

const DAYS = Number.parseInt(process.env.SHOPPING_BACKFILL_DAYS ?? '90', 10);
const BATCH = Number.parseInt(process.env.SHOPPING_BACKFILL_BATCH ?? '200', 10);

/**
 * @param {string} brandId
 * @returns {Promise<{ brandInfo: { brandId: string, brandName: string, domains: string[] }|null, competitors: Array<{ id: string, name: string, domain: string|null }> }>}
 */
async function loadBrandContext(brandId) {
  const [{ data: brand }, { data: domainRows }, { data: competitorRows }] = await Promise.all([
    supabaseAdmin.from('brands').select('id, name').eq('id', brandId).maybeSingle(),
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
    supabaseAdmin.from('competitors').select('id, name, domain').eq('brand_id', brandId),
  ]);

  if (!brand) return { brandInfo: null, competitors: [] };

  return {
    brandInfo: {
      brandId: brand.id,
      brandName: brand.name,
      domains: (domainRows ?? []).map((d) => d.domain).filter(Boolean),
    },
    competitors: (competitorRows ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain ?? null,
    })),
  };
}

async function main() {
  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  console.log(`[backfill] Walking prompt_results since ${cutoff} (${DAYS}d, batch=${BATCH})`);

  // Cache brand context across rows — vast majority of results share a
  // handful of brand_ids per run.
  const brandCache = new Map();

  let offset = 0;
  let totalRows = 0;
  let totalCards = 0;
  let totalSkipped = 0;

  while (true) {
    const { data: rows, error } = await supabaseAdmin
      .from('prompt_results')
      .select('id, brand_id, platform, region, shopping_cards')
      .gte('created_at', cutoff)
      .not('shopping_cards', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) {
      console.error('[backfill] Failed to fetch prompt_results batch:', error.message);
      process.exit(1);
    }

    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      totalRows += 1;
      const cards = Array.isArray(row.shopping_cards) ? row.shopping_cards : [];
      if (cards.length === 0) {
        totalSkipped += 1;
        continue;
      }

      let ctx = brandCache.get(row.brand_id);
      if (!ctx) {
        ctx = await loadBrandContext(row.brand_id);
        brandCache.set(row.brand_id, ctx);
      }
      if (!ctx.brandInfo) {
        // Brand row missing — orphaned result, skip rather than fail.
        totalSkipped += 1;
        continue;
      }

      const inserted = await persistShoppingCards({
        promptResultId: row.id,
        brandId: row.brand_id,
        platform: row.platform,
        region: row.region,
        rawCards: cards,
        brandInfo: ctx.brandInfo,
        competitors: ctx.competitors,
      });
      totalCards += inserted;
    }

    console.log(
      `[backfill] +${rows.length} rows  (running: ${totalRows} rows, ${totalCards} cards, ${totalSkipped} skipped)`,
    );
    offset += rows.length;
    if (rows.length < BATCH) break;
  }

  console.log(
    `[backfill] Done. ${totalRows} prompt_results scanned, ${totalCards} cards normalized, ${totalSkipped} skipped.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] Fatal:', err);
  process.exit(1);
});
