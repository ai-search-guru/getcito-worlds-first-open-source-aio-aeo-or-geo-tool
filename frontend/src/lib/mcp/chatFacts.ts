import { supabaseAdmin } from '@/lib/supabase/admin';
import { dbClient, withDbClient } from '@/lib/supabase/scoped';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planGuard';
import { planFactsFromOrgRow, type PlanFacts } from '@/lib/chat/planFacts';

/**
 * What Chat's reads (CHAT-20 §9, W1-16) share: running a page's own loader
 * with the service role once the brand is known to be the caller's, the
 * plan's facts and platforms, and when the brand's data last changed
 * (`data_as_of`, §15a). Server only.
 */

/** Runs a dbClient() loader with the service role: only after brandAllowed. */
export const asService = <T>(read: () => Promise<T>) =>
  withDbClient(supabaseAdmin as unknown as Awaited<ReturnType<typeof dbClient>>, read);

/** The organization's plan facts, as the approval precedence reads them. */
export async function planFactsOf(organizationId: string): Promise<PlanFacts> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(ORG_PLAN_COLUMNS)
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return planFactsFromOrgRow(data);
}

/** The platforms the plan reads ("Platforms by plan", §7); null for all of them. */
export async function planPlatforms(organizationId: string): Promise<readonly string[] | null> {
  const facts = await planFactsOf(organizationId);
  return facts.limits.allowedScrapers ?? null;
}

/**
 * When the brand's newest tracked answer came in, on these platforms when
 * given (the plan's); null before its first one.
 */
export async function latestAnswerAt(
  brandId: string,
  platforms?: readonly string[] | null,
): Promise<string | null> {
  let query = supabaseAdmin.from('prompt_results').select('created_at').eq('brand_id', brandId);
  if (platforms) query = query.in('platform', [...platforms]);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.created_at ?? null;
}

/** The newest of some timestamps; null with none. */
export function newestOf(values: (string | null | undefined)[]): string | null {
  let newest: string | null = null;
  for (const value of values) {
    if (value && !Number.isNaN(Date.parse(value)) && (!newest || value > newest)) newest = value;
  }
  return newest;
}
