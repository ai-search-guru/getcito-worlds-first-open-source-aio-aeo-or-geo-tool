/**
 * One-off priority backfill (Action Center).
 *
 * Scores every action that has no priority score yet, for one brand or for
 * every brand. Scores arrived with migration 00144: an action is scored when
 * it is created and again every night while it is active, so the actions
 * opened before then show "—" until the next nightly pass, and the ones
 * already completed or dismissed never get one. This scores both now, from
 * their open signals as they stand today.
 *
 * Safe to re-run: only actions with no score are touched, so a repeat picks
 * up where a failed or capped run (1,000 actions per brand) stopped.
 *
 * `--all` takes paused brands too, unlike backfillSignals.js: their actions
 * are still listed in the Action Center, and scoring them costs no tracking.
 *
 * Run: node src/scripts/rescoreActions.js [brandId|--all]
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { rescoreBrandActions } from '../lib/action-center/priorityData.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node src/scripts/rescoreActions.js <brandId|--all>');
  process.exit(1);
}

let brandIds;
if (arg === '--all') {
  const { data, error } = await supabaseAdmin.from('brands').select('id').limit(1000);
  if (error) throw new Error(error.message);
  brandIds = (data ?? []).map((b) => b.id);
} else {
  brandIds = [arg];
}

for (const brandId of brandIds) {
  try {
    const scored = await rescoreBrandActions(brandId, { statuses: null, unscored: true });
    console.log(brandId, JSON.stringify({ scored }));
  } catch (err) {
    console.error(brandId, 'FAILED:', err.message);
  }
}
process.exit(0);
