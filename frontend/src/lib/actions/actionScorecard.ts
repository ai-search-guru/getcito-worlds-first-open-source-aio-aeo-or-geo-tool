'use server';

/**
 * The History tab's scorecard read (learning B3): the brand's actions summed
 * by kind in the database (action_scorecard, 00368). Read with the member's
 * session, so RLS keeps it to their organization's brands.
 */

import { createClient } from '@/lib/supabase/server';
import { parseScorecardRow, sortScorecard, type ScorecardRow } from '@/lib/action-center/scorecard';

/** One row per kind of the brand's actions raised since `from`; every one when absent. */
export async function getActionScorecard(
  brandId: string,
  opts?: { from?: string },
): Promise<ScorecardRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('action_scorecard', {
    p_brand_id: brandId,
    p_since: opts?.from ?? null,
  });
  if (error) throw new Error(error.message);
  return sortScorecard(
    (data ?? []).map(parseScorecardRow).filter((row): row is ScorecardRow => row !== null),
  );
}
