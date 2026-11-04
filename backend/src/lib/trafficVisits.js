/**
 * Which visit a tracking-snippet pageview belongs to (AT-003).
 *
 * The snippet sends a beacon on every AI-referred page load, so a reload or a
 * second link from the same answer arrives as another row. A visit is a
 * session, as Google Analytics counts one: the same visitor (their
 * anonymous key from visitorKey.js, and user agent) from the same AI
 * platform, with less than VISIT_GAP_MINUTES between pageviews. A different
 * platform starts a new visit, as a new traffic source starts a new session
 * in GA4.
 *
 * The answer is stored on the row as `visit_of` (migration 00172, which
 * grouped the rows stored before it with the same rule): null when the
 * pageview starts a visit, otherwise the id of the pageview that did.
 */

import supabaseAdmin from '../config/supabase.js';

export const VISIT_GAP_MINUTES = 30;

/**
 * The id of the visit this pageview continues, or null when it starts one.
 *
 * The gap is measured from the visitor's latest pageview, not the visit's
 * first, so a visit stays open while its pageviews keep coming. A pageview
 * with no visitor key or user agent can't be matched to anyone's, so it
 * starts a visit of its own.
 */
export async function findVisitOf({
  brandId,
  sourcePlatform,
  visitorKey,
  userAgent,
  now = Date.now(),
}) {
  if (!visitorKey || !userAgent) return null;

  const since = new Date(now - VISIT_GAP_MINUTES * 60_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('ai_traffic_logs')
    .select('id, visit_of')
    .eq('brand_id', brandId)
    .eq('source_platform', sourcePlatform)
    .eq('visitor_key', visitorKey)
    .eq('user_agent', userAgent)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? (data.visit_of ?? data.id) : null;
}
