import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * What says whether a brand's tracking snippet is installed, as AI Traffic,
 * MCP and Chat read it (trafficSources.ts snippetState): its newest AI
 * visit, and the home page check kept on the brand (00433, server
 * lib/trackingSnippetCheck.js).
 */
export interface SnippetReading {
  /** The snippet's newest visit, or null when it has never sent one. */
  lastVisitAt: string | null;
  /** When the home page check last found the snippet; null when it didn't, or none ran. */
  foundAt: string | null;
  /** When the home page was last checked for the snippet; null when never. */
  checkedAt: string | null;
}

/** Postgres' code for a column that doesn't exist (00433 not applied yet). */
const UNDEFINED_COLUMN = '42703';

export async function readSnippet(
  supabase: SupabaseClient,
  brandId: string,
): Promise<SnippetReading> {
  const [lastVisit, check] = await Promise.all([
    supabase
      .from('ai_traffic_logs')
      .select('created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('brands')
      .select('snippet_found_at, snippet_checked_at')
      .eq('id', brandId)
      .maybeSingle(),
  ]);
  if (lastVisit.error) throw new Error(lastVisit.error.message);
  // Before 00433 is applied, no check is kept: the visits alone say.
  if (check.error && check.error.code !== UNDEFINED_COLUMN) throw new Error(check.error.message);
  const row = (check.error ? null : check.data) as {
    snippet_found_at?: string | null;
    snippet_checked_at?: string | null;
  } | null;
  return {
    lastVisitAt: (lastVisit.data?.created_at as string | undefined) ?? null,
    foundAt: row?.snippet_found_at ?? null,
    checkedAt: row?.snippet_checked_at ?? null,
  };
}
