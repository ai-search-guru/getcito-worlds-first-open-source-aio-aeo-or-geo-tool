import supabaseAdmin from '../config/supabase.js';

/**
 * The model calls Quality's AI checks may make for one draft in a day,
 * all of them together (the kinds of its sources' sites, a call a site,
 * CE-046; the claims in its paragraphs, CE-045; the page's proof read,
 * CE-049): the editor asks after saves. The claims make 50 at most, the
 * page reads PAGE_READS_PER_DAY (counted on their row), leaving the sources
 * 40 (SOURCE_READS_PER_DAY); the sources may take what the others haven't.
 */
export const QUALITY_CALLS_PER_DAY = 110;
/** The page's proof reads (CE-049) a draft makes in a day at most. */
export const PAGE_READS_PER_DAY = 20;

/** How many the draft has made in the last day: its "quality" rows (prompt_improve_usage). */
export async function qualityCallsToday(orgId, draftId) {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { count, error } = await supabaseAdmin
    .from('prompt_improve_usage')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('content_draft_id', draftId)
    .eq('feature', 'quality')
    .gte('used_at', dayAgo);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
