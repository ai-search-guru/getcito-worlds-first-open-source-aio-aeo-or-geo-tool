import type { McpAuthContext } from '@/lib/mcpAuth';
import { readBrandIntegrations } from '@/lib/brandIntegrations';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getTrafficGoogleTotals } from '@/lib/actions/traffic';
import { brandAllowed } from './data';
import { asService } from './chatFacts';

/**
 * Chat's Google reads (CHAT-20 §9 row 35): Search Console clicks and
 * Analytics sessions over a window, against the window before, as AI
 * Referral Traffic reads them (getTrafficGoogleTotals). A brand without the
 * source connected (the Google sign-in it uses on, its property picked)
 * says so (`connected: false`). `data_as_of` is the last
 * day Google reported, with `source_lag` (§15a). Null for a brand outside
 * the organization.
 */

const DAY_MS = 86_400_000;
const windowOf = (days: number) => ({
  dateFrom: new Date(Date.now() - (days - 1) * DAY_MS).toISOString(),
  dateTo: new Date().toISOString(),
});

/**
 * Whether each source is connected for the brand, as AI Referral Traffic
 * reads it (googleSourceStatus): the Google sign-in the brand uses is on
 * (00470, lib/brandIntegrations.ts) and the brand has its property picked.
 * The brand is the caller's (brandAllowed, before this).
 */
async function sourcesOf(brandId: string) {
  const [brand, integrations] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('gsc_property, ga_property_id')
      .eq('id', brandId)
      .maybeSingle(),
    readBrandIntegrations(supabaseAdmin, brandId),
  ]);
  if (brand.error) throw new Error(brand.error.message);
  const on = (provider: string) => Boolean(integrations.get(provider)?.connected);
  return {
    gsc: on('google-search-console') && Boolean(brand.data?.gsc_property),
    ga: on('google-analytics') && Boolean(brand.data?.ga_property_id),
  };
}

/** The last day a Google source reported for the brand; null with none. */
async function lastReportedDay(table: 'gsc_query_stats' | 'ga_ai_traffic_stats', brandId: string) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('date')
    .eq('brand_id', brandId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { date?: string } | null)?.date ?? null;
}

export async function getGscSummaryFor(
  auth: McpAuthContext,
  params: { brandId: string; days?: number },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const days = params.days ?? 28;
  if (!(await sourcesOf(params.brandId)).gsc) {
    return { connected: false, days, data_as_of: null, source_lag: '2–3 days' };
  }
  const [totals, lastDay] = await Promise.all([
    asService(() =>
      getTrafficGoogleTotals(params.brandId, windowOf(days), {
        ga: false,
        gsc: true,
        // As the page reads a short range (traffic-kpis): Google's latest
        // reported days, since it reports about two days late.
        gscLatestDays: days <= 7 ? days : null,
      }),
    ),
    lastReportedDay('gsc_query_stats', params.brandId),
  ]);
  return {
    connected: true,
    days,
    clicks: totals.gsc?.clicks ?? 0,
    previous_clicks: totals.gsc?.prevClicks ?? null,
    since: totals.gsc?.since ?? null,
    until: totals.gsc?.until ?? null,
    data_as_of: lastDay,
    source_lag: '2–3 days',
  };
}

export async function getGaSummaryFor(
  auth: McpAuthContext,
  params: { brandId: string; days?: number },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const days = params.days ?? 28;
  if (!(await sourcesOf(params.brandId)).ga) {
    return { connected: false, days, data_as_of: null, source_lag: '1 day' };
  }
  const [totals, latest] = await Promise.all([
    asService(() =>
      getTrafficGoogleTotals(params.brandId, windowOf(days), {
        ga: true,
        gsc: false,
        gscLatestDays: null,
      }),
    ),
    lastReportedDay('ga_ai_traffic_stats', params.brandId),
  ]);
  const ga = totals.ga;
  return {
    connected: true,
    days,
    sessions: ga?.sessions ?? 0,
    ai_sessions: ga?.aiSessions ?? 0,
    ai_engaged_sessions: ga?.aiEngagedSessions ?? 0,
    ai_key_events: ga?.aiKeyEvents ?? 0,
    ai_revenue: ga?.aiRevenue ?? 0,
    organic_sessions: ga?.organic.sessions ?? 0,
    data_as_of: latest,
    source_lag: '1 day',
  };
}
