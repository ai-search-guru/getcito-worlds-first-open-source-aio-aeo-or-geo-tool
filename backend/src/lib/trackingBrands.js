import supabaseAdmin from '../config/supabase.js';

/**
 * The brands the nightly run looks at: the active ones (a paused brand,
 * is_active = false, is the person's own stop: it should not spend Cloro or
 * LLM credits daily), never a demo brand (00380), whose answers are the
 * sample the demo generator writes. Their plan and prompts are checked
 * after, brand by brand. Returns the query's own { data, error }.
 */
export function listDailyTrackingBrands() {
  return supabaseAdmin
    .from('brands')
    .select('id, organization_id')
    .eq('is_active', true)
    .eq('is_demo', false);
}
