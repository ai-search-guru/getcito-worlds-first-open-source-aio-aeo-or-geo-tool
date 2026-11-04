/**
 * Backfill prompt_result_citations from the raw prompt_results.citations jsonb.
 *
 * Run: `node src/scripts/backfillCitations.js`
 *
 * Options via env:
 *   - CITATIONS_BACKFILL_BATCH   answers pulled per batch (default 200)
 *   - CITATIONS_BACKFILL_DAYS    only answers newer than this many days
 *                                (default: no limit — the whole history)
 *   - CITATIONS_BACKFILL_PAUSE   milliseconds to wait between batches
 *                                (default 100)
 *
 * Pass `--force` to reprocess answers that already have rows. Only needed when
 * the stored rows are wrong rather than missing — a changed normalization rule,
 * say. Without it, answers already covered are skipped without resolving their
 * URLs, which is what makes a repair run take minutes instead of hours.
 *
 * Idempotent and restartable. `persistCitationRows` upserts on
 * `(prompt_result_id, position)` with `ignoreDuplicates`, so re-running skips
 * what is already there, and the walk is keyset-based on `(created_at, id)`
 * rather than OFFSET — a run that is interrupted can simply be started again.
 *
 * Deliberately unhurried. There are ~2M citations to write across ~177k
 * answers on a database that is already 1.1 GB on a 2 GB instance, and this
 * runs against the same instance serving the dashboard. Small batches with a
 * pause between them keep it from evicting the cache that live queries depend
 * on; finishing in twenty minutes instead of five is a good trade.
 */

import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { persistCitationRows } from '../lib/citationRows.js';

const BATCH = Number.parseInt(process.env.CITATIONS_BACKFILL_BATCH ?? '200', 10);
const PAUSE_MS = Number.parseInt(process.env.CITATIONS_BACKFILL_PAUSE ?? '100', 10);
const DAYS = process.env.CITATIONS_BACKFILL_DAYS
  ? Number.parseInt(process.env.CITATIONS_BACKFILL_DAYS, 10)
  : null;
const FORCE = process.argv.includes('--force');

/**
 * A `.in()` filter travels in the query string, so this is chunked for the
 * same reason the URL lookups in citationRows.js are — uuids are a fixed 36
 * characters, so 200 of them is a comfortable 8 KB.
 */
const DONE_LOOKUP_CHUNK = 200;

/**
 * PostgREST's own default page size. Reading in exactly this size means a
 * short page is an unambiguous end-of-results signal.
 */
const PAGE_LIMIT = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One page of answers, ordered by `(created_at, id)` so the cursor is total.
 *
 * Ordering on created_at alone would be ambiguous: a nightly run writes
 * thousands of answers inside the same second, and a cursor that cannot
 * separate them either repeats a page or skips one.
 */
async function fetchBatch(cursor) {
  let query = supabaseAdmin
    .from('prompt_results')
    // Deliberately without `citations`: the jsonb is the expensive half of the
    // row, and on a repair run almost every answer in the page is skipped. It
    // is fetched afterwards, only for the answers that still need writing.
    .select('id, brand_id, created_at')
    .not('citations', 'is', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(BATCH);

  if (DAYS !== null) {
    query = query.gte('created_at', new Date(Date.now() - DAYS * 86_400_000).toISOString());
  }
  if (cursor) {
    // `or` expresses the keyset condition: strictly later timestamp, or the
    // same timestamp and a later id.
    query = query.or(
      `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetch batch: ${error.message}`);
  return data ?? [];
}

/**
 * Which of these answers already have citation rows.
 *
 * The upsert makes re-running safe but not cheap: it skips the write and still
 * pays for resolving every URL of every answer first. On the full history that
 * is ~18 answers a second, so a re-run to repair a few hundred answers costs
 * most of three hours. One lookup per page — ids only, no jsonb — turns that
 * into minutes.
 *
 * Paginated, because the answer is one row per *citation* rather than per
 * answer: 200 answers matched 1,591 rows in production, and PostgREST caps an
 * un-paginated select at 1,000. The first version read only that first page,
 * so every answer past it looked unstored and was reprocessed — the upsert
 * then discarded the writes as duplicates, and the run reported thousands of
 * citations written while the table did not move at all. Same trap as #714
 * and #716.
 */
async function alreadyStored(ids) {
  if (ids.length === 0) return new Set();

  const done = new Set();
  for (let i = 0; i < ids.length; i += DONE_LOOKUP_CHUNK) {
    const slice = ids.slice(i, i + DONE_LOOKUP_CHUNK);

    for (let offset = 0; ; offset += PAGE_LIMIT) {
      const { data, error } = await supabaseAdmin
        .from('prompt_result_citations')
        .select('prompt_result_id')
        .in('prompt_result_id', slice)
        .order('prompt_result_id', { ascending: true })
        .order('position', { ascending: true })
        .range(offset, offset + PAGE_LIMIT - 1);
      if (error) throw new Error(`stored lookup: ${error.message}`);

      for (const row of data ?? []) done.add(row.prompt_result_id);
      if ((data ?? []).length < PAGE_LIMIT) break;
    }
  }
  return done;
}

/** The citation arrays for a specific set of answers, keyed by answer id. */
async function fetchCitations(ids) {
  const byId = new Map();
  for (let i = 0; i < ids.length; i += DONE_LOOKUP_CHUNK) {
    const slice = ids.slice(i, i + DONE_LOOKUP_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('prompt_results')
      .select('id, citations')
      .in('id', slice);
    if (error) throw new Error(`citations fetch: ${error.message}`);
    for (const row of data ?? []) byId.set(row.id, row.citations);
  }
  return byId;
}

async function main() {
  const startedAt = Date.now();
  let cursor = null;
  let answers = 0;
  let citations = 0;
  let empty = 0;
  let skipped = 0;
  const failed = [];

  console.log(
    `Backfilling citations — batch ${BATCH}, pause ${PAUSE_MS}ms` +
      (DAYS !== null ? `, last ${DAYS} days` : ', full history'),
  );

  for (;;) {
    const batch = await fetchBatch(cursor);
    if (batch.length === 0) break;

    // `--force` exists for the case where the rows are present but wrong — a
    // changed normalization rule, say — and every answer has to be rewritten.
    const skip = FORCE ? new Set() : await alreadyStored(batch.map((row) => row.id));
    const todo = batch.filter((row) => !skip.has(row.id));
    skipped += batch.length - todo.length;
    answers += batch.length - todo.length;

    const citationsById = await fetchCitations(todo.map((row) => row.id));

    for (const row of todo) {
      const raw = citationsById.get(row.id);
      const expected = Array.isArray(raw) ? raw.length : 0;
      const written = await persistCitationRows({
        promptResultId: row.id,
        brandId: row.brand_id,
        createdAt: row.created_at,
        citations: raw,
      });
      answers += 1;
      citations += written ?? 0;
      // Three outcomes, kept apart on purpose. No storable citations is normal.
      // A failure is not, and it is reported by returning null rather than 0 —
      // 0 legitimately means "every row was already there", which is what
      // `--force` produces on every answer it revisits. The first production
      // run lost 228 answers to a fault the totals alone made look healthy.
      if (expected === 0) empty += 1;
      else if (written === null) failed.push(row.id);
    }

    const last = batch[batch.length - 1];
    cursor = { createdAt: last.created_at, id: last.id };

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `  ${answers} answers · ${skipped} already stored · ${citations} citations · ` +
        `${empty} with none · ${failed.length} failed · ${elapsed}s · at ${last.created_at}`,
    );

    if (batch.length < BATCH) break;
    if (PAUSE_MS > 0) await sleep(PAUSE_MS);
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `\nDone. ${answers} answers scanned, ${skipped} already stored, ` +
      `${citations} citation rows written, ${empty} answers had none, ${elapsed}s.`,
  );

  if (failed.length > 0) {
    // Loud on purpose. These answers have citations and stored none, so the
    // table is short by however many they carried — and re-running the script
    // is the fix, since everything else is skipped as already present.
    console.error(
      `\n${failed.length} answer(s) had citations but stored none. Re-run to retry them.`,
    );
    console.error(`First few: ${failed.slice(0, 10).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  // Exit non-zero so a wrapper can tell a crash from a clean finish. The walk
  // is restartable, so the fix is to run it again rather than to resume from
  // some recorded position.
  console.error('Backfill failed:', err);
  process.exit(1);
});
