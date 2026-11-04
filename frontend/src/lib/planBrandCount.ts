import type { createClient } from '@/lib/supabase/server';

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/** The function isn't there: PostgREST doesn't know it, or Postgres doesn't. */
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);

/**
 * The brands an organization's plan counts against maxBrands: every one of
 * them, whatever brands the person sees (BRAND-ACCESS, 00390), and never the
 * demo brand (00380). createBrand enforces the limit with it and the Brands
 * page offers Add Brand by it, so the two can't disagree.
 *
 * org_brand_count answers the organization's members (0 for anyone else).
 * Until 00390 is on the database, the count falls back to the brands the
 * person reads, as before: every one of them while everyone has All brands.
 * Any other error is thrown: a limit must not pass on a failed count.
 */
export async function countPlanBrands(
  supabase: Pick<ServerSupabase, 'rpc' | 'from'>,
  organizationId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('org_brand_count', {
    p_organization_id: organizationId,
  });
  if (!error) return data ?? 0;
  if (!MISSING_FUNCTION.has(error.code)) throw new Error(error.message);

  const { count } = await supabase
    .from('brands')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('is_demo', false);
  return count ?? 0;
}
