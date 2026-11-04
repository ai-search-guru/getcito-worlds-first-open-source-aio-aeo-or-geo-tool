import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/**
 * Nightly consistency check for the Tracked Prompts usage counters
 * (PROMPT-012, 00139). Triggers rebuild a brand's row on every prompt write;
 * this recomputes every brand from `prompts`, rebuilds the rows that differ
 * and logs them, so a write path the triggers miss shows up instead of
 * leaving the usage cards wrong.
 *
 * Returns the drifted rows ({ brand_id, stored_*, actual_* }).
 */
export async function checkPromptUsageCounters(client = supabaseAdmin) {
  const { data, error } = await client.rpc('repair_prompt_usage_counters');
  if (error) throw new Error(error.message);

  const drifted = data ?? [];
  if (drifted.length > 0) {
    logger.warn(
      { drifted: drifted.length, rows: drifted.slice(0, 20) },
      '[prompt-usage] counters drifted from prompts and were rebuilt',
    );
  } else {
    logger.info('[prompt-usage] counters match prompts');
  }
  return drifted;
}
