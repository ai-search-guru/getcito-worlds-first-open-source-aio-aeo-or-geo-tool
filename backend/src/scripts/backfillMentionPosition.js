/**
 * Backfill mention-position signals on historical prompt_results from the
 * stored answer text (00038):
 *
 *   - mention_position / mentioned_entity_count columns (own brand)
 *   - mention_position inside each competitor_mentions entry (competitors)
 *
 * Run: `node src/scripts/backfillMentionPosition.js [--days N] [--brand <id>] [--dry-run]`
 *
 * Scope: brands of organizations whose subscription is active or trialing
 * (churned orgs' data never surfaces in any dashboard, so recomputing it is
 * wasted work). Narrow further with --brand, or --days to limit history.
 *
 * Idempotent: rows whose columns are set AND whose competitor entries all
 * carry a mention_position key are skipped, so re-running only processes
 * what's missing. Batches are small, concurrent in bounded chunks, and
 * paced so the shared database stays responsive.
 *
 * Positions are computed against the brand's CURRENT competitor roster —
 * competitors added or removed since a result was scraped shift historical
 * positions accordingly, same as every other read-time aggregation here.
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { computeMentionPosition } from '../lib/responseParser.js';

const BATCH_SIZE = 250;
const BATCH_PAUSE_MS = 250;
const CONCURRENCY = 20;

/** Retry transient network failures (connection resets on long walks). */
async function withRetry(fn, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`  retry ${attempt}/3 after error in ${label}: ${err.message}`);
      await sleep(attempt * 2000);
    }
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const daysArg = args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : null;
const brandArg = args.includes('--brand') ? args[args.indexOf('--brand') + 1] : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eligibleBrands() {
  const { data: orgs, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .in('subscription_status', ['active', 'trialing']);
  if (orgErr) throw new Error(orgErr.message);

  let query = supabaseAdmin
    .from('brands')
    .select('id, name, organization_id')
    .in(
      'organization_id',
      (orgs ?? []).map((o) => o.id),
    );
  if (brandArg) query = query.eq('id', brandArg);

  const { data: brands, error } = await query;
  if (error) throw new Error(error.message);
  return brands ?? [];
}

async function brandContext(brand) {
  const [{ data: domains }, { data: competitors }] = await Promise.all([
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brand.id),
    supabaseAdmin.from('competitors').select('id, name, domain').eq('brand_id', brand.id),
  ]);
  return {
    brandInfo: { brandName: brand.name, domains: (domains ?? []).map((d) => d.domain) },
    competitors: competitors ?? [],
  };
}

function rowNeedsWork(row) {
  if (row.mentioned_entity_count == null) return true;
  const entries = Array.isArray(row.competitor_mentions) ? row.competitor_mentions : [];
  return entries.some((entry) => !('mention_position' in entry));
}

async function backfillBrand(brand) {
  const { brandInfo, competitors } = await brandContext(brand);
  let updated = 0;
  let skipped = 0;

  // Offset paging over a stable ordering: updates never change which rows
  // the filter selects, so pages stay consistent across the walk.
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const fetchPage = () => {
      let query = supabaseAdmin
        .from('prompt_results')
        .select('id, response, competitor_mentions, mentioned_entity_count')
        .eq('brand_id', brand.id)
        .not('response', 'is', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + BATCH_SIZE - 1);
      if (daysArg) {
        query = query.gte('created_at', new Date(Date.now() - daysArg * 86_400_000).toISOString());
      }
      return query;
    };

    const { data: rows, error } = await withRetry(fetchPage, 'page fetch');
    if (error) throw new Error(error.message);
    if (!rows?.length) break;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (row) => {
          if (!rowNeedsWork(row)) {
            skipped++;
            return;
          }
          const { mentionPosition, mentionedEntityCount, competitorPositions } =
            computeMentionPosition(row.response ?? '', brandInfo, competitors);
          const entries = Array.isArray(row.competitor_mentions) ? row.competitor_mentions : [];
          const annotated = entries.map((entry) => ({
            ...entry,
            mention_position: competitorPositions.get(entry.competitor_id) ?? null,
          }));
          if (!dryRun) {
            const { error: updateErr } = await withRetry(
              () =>
                supabaseAdmin
                  .from('prompt_results')
                  .update({
                    mention_position: mentionPosition,
                    mentioned_entity_count: mentionedEntityCount,
                    competitor_mentions: annotated,
                  })
                  .eq('id', row.id),
              'row update',
            );
            if (updateErr) throw new Error(updateErr.message);
          }
          updated++;
        }),
      );
    }

    console.log(`  ${brand.name}: ${updated} updated, ${skipped} already done`);
    if (rows.length < BATCH_SIZE) break;
    await sleep(BATCH_PAUSE_MS);
  }

  return updated;
}

const brands = await eligibleBrands();
console.log(
  `Backfilling mention positions for ${brands.length} brand(s)` +
    `${daysArg ? `, last ${daysArg} day(s)` : ', full history'}${dryRun ? ' — DRY RUN' : ''}`,
);

let total = 0;
for (const brand of brands) {
  total += await backfillBrand(brand);
}
console.log(`Done. ${total} row(s) ${dryRun ? 'would be ' : ''}updated.`);
process.exit(0);
