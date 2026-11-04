/**
 * Recount brand and competitor mentions on historical prompt_results: re-runs
 * parseResponse over the stored answer text and rewrites what it derives
 * (mentionRecount.js).
 *
 * Run: `node src/scripts/backfillMentionCounts.js [--entity-markup] [--brand <id>] [--dry-run]`
 *
 * Two fixes, two scopes:
 *   - by default (#871): names starting or ending with a character outside
 *     ASCII [A-Za-z0-9_] ("Ümit", "İpek", "Acme, Inc.", "星云科技") were never
 *     matched, so their answers were stored with zero mentions. Brands of
 *     active or trialing organizations whose own name or any competitor name
 *     is such a name; every other brand's counts are unchanged by the fix.
 *   - `--entity-markup` (#1097): ChatGPT answers saved with its
 *     `<Entity … value="X" …/>` tags in the text. The tags' attributes counted
 *     as mentions and shifted positions. Every brand of an active or trialing
 *     organization, and only its answers that still hold a tag: the text is
 *     saved without the tags, as new answers are, and recounted.
 * --brand narrows to one brand regardless. Rows are counted by today's parser
 * (mentionRecount.js): the ones it rewrites pick up its other changes too.
 *
 * Before --entity-markup runs on production, keep a copy: nothing else holds
 * the text with its tags. In a schema of its own (no grants: a table made by
 * hand in public gets that schema's, with row level security off), a week of
 * answers at a time on the date index, dropped once the run is checked:
 *   create schema if not exists backfill_backup;
 *   create table backfill_backup.prompt_results_entity_markup as
 *     select id, brand_id, created_at, response, sentiment, mention_count, visibility_score,
 *            mention_position, mentioned_entity_count, competitor_mentions
 *     from public.prompt_results
 *     where false;
 *   -- once per week of answers, oldest first:
 *   insert into backfill_backup.prompt_results_entity_markup
 *     select id, brand_id, created_at, response, sentiment, mention_count, visibility_score,
 *            mention_position, mentioned_entity_count, competitor_mentions
 *     from public.prompt_results
 *     where created_at >= '<day>' and created_at < '<day + 7>'
 *       and response like '%<Entity%';
 * To put it back, in parts as it was filled: one brand at a time (or a week
 * at a time on b.created_at), then run the three refreshes it printed again:
 *   update public.prompt_results p
 *     set response = b.response, sentiment = b.sentiment, mention_count = b.mention_count,
 *         visibility_score = b.visibility_score, mention_position = b.mention_position,
 *         mentioned_entity_count = b.mentioned_entity_count,
 *         competitor_mentions = b.competitor_mentions
 *     from backfill_backup.prompt_results_entity_markup b
 *     where p.id = b.id and b.brand_id = '<id>';
 * Once the run is checked, on its own, never with the restore:
 *   drop schema backfill_backup cascade;
 *
 * Idempotent: rows whose recomputed values equal the stored ones are skipped,
 * and a cleaned answer leaves the filter, so a stopped run is run again. Each
 * changed brand's refresh commands are printed as soon as its rows are
 * written: a run stopped later, and run again, finds that brand clean. A dry
 * run prints a few rows per brand, before → after, and its sentiment changes.
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { IN_FILTER_CHUNK, selectInChunks } from '../lib/chunkedIn.js';
import { addDays, dayChunks, resultDayBound } from '../lib/citationsRollups.js';
import { recountRow } from '../lib/mentionRecount.js';

const BATCH_SIZE = 250;
const BATCH_PAUSE_MS = 250;
const CONCURRENCY = 20;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const entityMarkup = args.includes('--entity-markup');
const brandArg = args.includes('--brand') ? args[args.indexOf('--brand') + 1] : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry transient network failures (connection resets on long walks): thrown,
 * or returned by supabase-js as an error with no code.
 */
async function withRetry(fn, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await fn();
      if (result?.error && !result.error.code && attempt < 4) {
        console.warn(`  retry ${attempt}/3 after error in ${label}: ${result.error.message}`);
        await sleep(attempt * 2000);
        continue;
      }
      return result;
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`  retry ${attempt}/3 after error in ${label}: ${err.message}`);
      await sleep(attempt * 2000);
    }
  }
}

/** A name the old ASCII `\b` matcher could not match. */
const isAffectedName = (name) => Boolean(name) && !/^\w[\s\S]*\w$|^\w$/.test(name);

async function brandsInScope() {
  let query = supabaseAdmin.from('brands').select('id, name, organization_id');
  if (brandArg) {
    query = query.eq('id', brandArg);
  } else {
    const { data: orgs, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .in('subscription_status', ['active', 'trialing']);
    if (orgErr) throw new Error(orgErr.message);
    query = query.in(
      'organization_id',
      (orgs ?? []).map((o) => o.id),
    );
  }
  const { data: brands, error } = await query;
  if (error) throw new Error(error.message);
  return brands ?? [];
}

/**
 * The brand's domains and competitors, as an answer is counted with them. A
 * read that fails stops the run: counted without them, every answer would
 * lose its domain mentions or its competitors, and a cleaned answer leaves
 * the filter, so running again wouldn't revisit it.
 */
async function brandContext(brand) {
  const [domainsRes, competitorsRes] = await Promise.all([
    withRetry(
      () => supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brand.id),
      'brand domains',
    ),
    withRetry(
      () => supabaseAdmin.from('competitors').select('id, name, domain').eq('brand_id', brand.id),
      'competitors',
    ),
  ]);
  if (domainsRes.error) throw new Error(domainsRes.error.message);
  if (competitorsRes.error) throw new Error(competitorsRes.error.message);
  return {
    brandInfo: {
      brandName: brand.name,
      domains: (domainsRes.data ?? []).map((d) => d.domain),
    },
    competitors: competitorsRes.data ?? [],
  };
}

const ROW_COLUMNS =
  'id, response, citations, sentiment, mention_count, visibility_score, mention_position, mentioned_entity_count, competitor_mentions';

/** Rows a dry run prints per brand, before → after. */
const DRY_RUN_SAMPLES = 3;

/** The competitors an answer names, as its entries count them. */
const namedCompetitors = (entries) =>
  (Array.isArray(entries) ? entries : [])
    .filter((e) => e.mention_count > 0)
    .map((e) => e.name)
    .join(', ') || '—';

/** One row's change, as a dry run prints it. */
function sampleLine(row, next) {
  const moved = (label, before, after) =>
    before === after ? null : `${label} ${before ?? '—'} → ${after ?? '—'}`;
  const parts = [
    moved('mentions', row.mention_count, next.mention_count),
    moved('position', row.mention_position, next.mention_position),
    moved(
      'competitors named',
      namedCompetitors(row.competitor_mentions),
      namedCompetitors(next.competitor_mentions),
    ),
    next.response !== undefined ? 'text cleaned' : null,
    next.sentiment !== undefined ? `sentiment ${row.sentiment} → ${next.sentiment}` : null,
  ].filter(Boolean);
  return `    ${row.id}: ${parts.join(' · ') || 'score only'}`;
}

/**
 * Recounts these rows and writes the ones that changed (a dry run writes
 * none, and keeps a few as samples); returns [updated, skipped] and adds the
 * sentiment changes to `report`.
 */
async function recountRows(rows, brandInfo, competitors, report) {
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (row) => {
        const next = recountRow(row, brandInfo, competitors, { cleanMarkup: entityMarkup });
        if (!next) {
          skipped++;
          return;
        }
        if (next.sentiment !== undefined) report.sentiment++;
        if (dryRun && report.samples.length < DRY_RUN_SAMPLES) {
          report.samples.push(sampleLine(row, next));
        }
        if (!dryRun) {
          const { error: updateErr } = await withRetry(
            () => supabaseAdmin.from('prompt_results').update(next).eq('id', row.id),
            'row update',
          );
          if (updateErr) throw new Error(updateErr.message);
        }
        updated++;
      }),
    );
  }
  return [updated, skipped];
}

/** Tagged answers read per page: one UTC day of a brand's holds fewer. */
const ID_PAGE = 1000;

/**
 * The brand's answers that still hold a ChatGPT entity tag, by id, a UTC day
 * of answers at a time (the brand and date index; each answer's text read
 * once). Listed before any is cleaned: a cleaned answer leaves the filter,
 * which would shift offset pages taken during the writes.
 */
async function taggedRowIds(brandId) {
  const [first, last] = await withRetry(
    () => Promise.all([resultDayBound(brandId, true), resultDayBound(brandId, false)]),
    'answer days',
  );
  if (!first || !last) return [];
  const ids = [];
  for (const [day] of dayChunks(first, last, 1)) {
    for (let offset = 0; ; offset += ID_PAGE) {
      const { data, error } = await withRetry(
        () =>
          supabaseAdmin
            .from('prompt_results')
            .select('id')
            .eq('brand_id', brandId)
            .gte('created_at', `${day}T00:00:00Z`)
            .lt('created_at', `${addDays(day, 1)}T00:00:00Z`)
            .like('response', '%<Entity%')
            .order('id', { ascending: true })
            .range(offset, offset + ID_PAGE - 1),
        'tagged ids',
      );
      if (error) throw new Error(error.message);
      ids.push(...(data ?? []).map((r) => r.id));
      if (!data || data.length < ID_PAGE) break;
    }
  }
  return ids;
}

async function backfillTagged(brand, report) {
  const { brandInfo, competitors } = await brandContext(brand);
  const ids = await taggedRowIds(brand.id);
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    // A URL of 100 ids at a time (chunkedIn.js).
    const { data: rows, error } = await withRetry(
      () =>
        selectInChunks(
          ids.slice(i, i + BATCH_SIZE),
          (chunk) => supabaseAdmin.from('prompt_results').select(ROW_COLUMNS).in('id', chunk),
          IN_FILTER_CHUNK,
        ),
      'page fetch',
    );
    if (error) throw new Error(error.message);
    const [u, k] = await recountRows(rows ?? [], brandInfo, competitors, report);
    updated += u;
    skipped += k;
    console.log(
      `  ${brand.name}: ${updated} changed, ${skipped} unchanged of ${ids.length} tagged`,
    );
    await sleep(BATCH_PAUSE_MS);
  }
  return updated;
}

async function backfillBrand(brand, report) {
  if (entityMarkup) return backfillTagged(brand, report);
  const { brandInfo, competitors } = await brandContext(brand);
  let updated = 0;
  let skipped = 0;

  // Offset paging over a stable ordering: updates never change which rows
  // the filter selects, so pages stay consistent across the walk.
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const { data: rows, error } = await withRetry(
      () =>
        supabaseAdmin
          .from('prompt_results')
          .select(ROW_COLUMNS)
          .eq('brand_id', brand.id)
          .not('response', 'is', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(offset, offset + BATCH_SIZE - 1),
      'page fetch',
    );
    if (error) throw new Error(error.message);
    if (!rows?.length) break;

    const [u, k] = await recountRows(rows, brandInfo, competitors, report);
    updated += u;
    skipped += k;

    console.log(`  ${brand.name}: ${updated} changed, ${skipped} unchanged`);
    if (rows.length < BATCH_SIZE) break;
    await sleep(BATCH_PAUSE_MS);
  }

  return updated;
}

const candidates = await brandsInScope();
const brands = [];
for (const brand of candidates) {
  if (brandArg || entityMarkup || isAffectedName(brand.name)) {
    brands.push(brand);
    continue;
  }
  // A failed read stops the run, never drops the brand from it unsaid.
  const { data: comps, error: compsError } = await withRetry(
    () => supabaseAdmin.from('competitors').select('name').eq('brand_id', brand.id),
    'competitors',
  );
  if (compsError) throw new Error(compsError.message);
  if ((comps ?? []).some((c) => isAffectedName(c.name))) brands.push(brand);
}

console.log(
  `Recounting mentions${entityMarkup ? ' in answers with entity tags' : ''} for ${brands.length} brand(s)${dryRun ? ' — DRY RUN' : ''}`,
);

/**
 * A changed brand's refreshes. Each reads the counts: Insights' rollups;
 * Mentions' with the answers' terms (an entity's terms are kept only where
 * it's mentioned), their rollups and Perception's snapshots; Citations'
 * (we_mention, comp_present).
 */
const refreshCommands = (brand) => [
  `  INSIGHTS_BACKFILL_BRAND=${brand.id} node src/scripts/backfillInsightsDaily.js  # ${brand.name}`,
  `  MENTIONS_BACKFILL_BRAND=${brand.id} node src/scripts/backfillMentionsDaily.js  # ${brand.name}`,
  `  CITATIONS_BACKFILL_BRAND=${brand.id} node src/scripts/backfillCitationsDaily.js  # ${brand.name}`,
];

const changed = [];
let total = 0;
for (const brand of brands) {
  const report = { samples: [], sentiment: 0 };
  const n = await backfillBrand(brand, report);
  total += n;
  if (n === 0) continue;
  changed.push(brand);
  if (dryRun) {
    console.log(
      `  ${brand.name}: ${report.sentiment} sentiment change(s) to neutral; for example:`,
    );
    for (const line of report.samples) console.log(line);
  } else {
    // Now, not at the end: a run stopped later and run again finds this brand clean.
    console.log(`  ${brand.name} written; refresh its rollups:`);
    for (const line of refreshCommands(brand)) console.log(line);
  }
}

console.log(`Done. ${total} row(s) ${dryRun ? 'would be ' : ''}updated.`);
if (changed.length && !dryRun) {
  console.log('Refresh the rollups for the changed brands (each was printed as it finished):');
  for (const brand of changed) for (const line of refreshCommands(brand)) console.log(line);
}
process.exit(0);
