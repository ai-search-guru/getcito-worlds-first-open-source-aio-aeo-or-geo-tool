/**
 * Reading AI-referred visits past PostgREST's row cap: the AI Traffic page,
 * the report and the MCP traffic tool all read through here.
 *
 * PostgREST silently caps an un-paginated select at 1,000 rows, which froze
 * the page's visits KPI at 1,000 and truncated every breakdown on busy brands
 * (#450). Totals come from exact count queries, which transfer no rows; the
 * breakdowns page through the window in a fixed order, up to a hard ceiling
 * so a pathological brand can't pin the server.
 *
 * Both read the rows that start a visit (visit_of is null, 00172), so they
 * count visits, not pageviews (AT-003) — unless a count asks for pageviews.
 *
 * Server-only: callers pass their own client — the member's session, or the
 * service role after checking the brand belongs to the caller.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const TRAFFIC_PAGE_SIZE = 1000;
export const TRAFFIC_MAX_ROWS = 50_000;

export interface TrafficScanWindow {
  from?: string;
  to?: string;
  /** Whether `to` is the window's last moment (lte) rather than its end (lt). */
  toInclusive?: boolean;
}

/** Visits in the window — or, with `visits: false`, every pageview. */
export async function countTrafficLogs(
  supabase: SupabaseClient,
  brandId: string,
  window: TrafficScanWindow,
  { visits = true }: { visits?: boolean } = {},
): Promise<number> {
  let query = supabase
    .from('ai_traffic_logs')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId);
  if (visits) query = query.is('visit_of', null);
  if (window.from) query = query.gte('created_at', window.from);
  if (window.to) {
    query = window.toInclusive
      ? query.lte('created_at', window.to)
      : query.lt('created_at', window.to);
  }
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Every visit in the window, up to TRAFFIC_MAX_ROWS, one page at a time. */
export async function scanTrafficLogs(
  supabase: SupabaseClient,
  brandId: string,
  window: TrafficScanWindow & { columns: string },
  onRow: (row: Record<string, unknown>) => void,
): Promise<void> {
  for (let start = 0; start < TRAFFIC_MAX_ROWS; start += TRAFFIC_PAGE_SIZE) {
    let query = supabase
      .from('ai_traffic_logs')
      .select(window.columns)
      .eq('brand_id', brandId)
      .is('visit_of', null)
      // Deterministic order so .range() pages don't shuffle between requests.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(start, start + TRAFFIC_PAGE_SIZE - 1);
    if (window.from) query = query.gte('created_at', window.from);
    if (window.to) {
      query = window.toInclusive
        ? query.lte('created_at', window.to)
        : query.lt('created_at', window.to);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    for (const row of batch) onRow(row);
    if (batch.length < TRAFFIC_PAGE_SIZE) break;
  }
}
