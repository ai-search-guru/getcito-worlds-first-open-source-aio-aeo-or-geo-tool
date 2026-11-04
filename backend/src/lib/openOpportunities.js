import supabaseAdmin from '../config/supabase.js';

const PAGE = 1000;

/**
 * A brand's cluster opportunities, every status, as { id, title, status,
 * prompt_id, promptText, cluster_id, related_cluster_ids, opportunity_score,
 * targetPages, assets }. Paged: a
 * large brand can hold more than PostgREST's 1,000-row default, and a short
 * read would let a covered cluster be suggested again.
 */
export async function loadClusterOpportunities(brandId) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .select(
        'id, title, status, prompt_id, promptText:source_data->>promptText, cluster_id, related_cluster_ids, opportunity_score, targetPages:source_data->targetPages, assets:source_data->assets',
      )
      .eq('brand_id', brandId)
      .not('cluster_id', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * A brand's opportunities that can still block a duplicate (CONTENT-004):
 * every status but archived, with the source data that holds their prompt
 * and fan-out baskets, and their question (opportunitySameQuestion.js).
 * Older per-prompt rows (no cluster) are included, since a new cluster can
 * repeat them too.
 */
export async function loadOpportunityBaskets(brandId) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .select(
        'id, title, status, source, created_at, updated_at, prompt_id, cluster_id, related_cluster_ids, opportunity_score, impact, webhook_sent_at, source_data',
      )
      .eq('brand_id', brandId)
      .neq('status', 'archived')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}
