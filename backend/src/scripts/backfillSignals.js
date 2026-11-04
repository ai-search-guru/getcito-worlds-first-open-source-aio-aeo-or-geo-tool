/**
 * One-off signal backfill (Action Center).
 *
 * Runs the nightly pass once for one brand or for every active brand, so the
 * Signals page has real rows before the next tracking cycle.
 *
 * Goes through `runSignalPass` rather than calling the recorder and the
 * generator itself, so a manual recovery logs itself in `signal_runs` like any
 * other pass. Calling them directly left the ledger saying the pass had not
 * run when it had, which made the catch-up sweep repeat work and made the one
 * table that answers "did it run last night" unreliable — the exact question
 * it was added to answer.
 *
 * Safe to re-run: recording dedupes on (brand, dedup_key) and the ledger row
 * is keyed to the tracking run, so a repeat updates rather than duplicates.
 *
 * Run: node src/scripts/backfillSignals.js [brandId|--all]
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { runSignalPass } from '../lib/signals/pass.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node src/scripts/backfillSignals.js <brandId|--all>');
  process.exit(1);
}

let brandIds;
if (arg === '--all') {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('is_active', true)
    .limit(1000);
  if (error) throw new Error(error.message);
  brandIds = (data ?? []).map((b) => b.id);
} else {
  brandIds = [arg];
}

for (const brandId of brandIds) {
  try {
    console.log(brandId, JSON.stringify(await runSignalPass(brandId)));
  } catch (err) {
    console.error(brandId, 'FAILED:', err.message);
  }
}
process.exit(0);
