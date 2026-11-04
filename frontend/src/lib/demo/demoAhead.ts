import type { createClient } from '@/lib/supabase/client';

type BrowserSupabase = ReturnType<typeof createClient>;

/** A subscription that is a plan: the demo isn't built ahead for it. */
const PLANNED = new Set(['active', 'trialing']);

/**
 * Whether onboarding builds the organization's demo brand ahead, as soon as
 * the organization exists (usePreloadDemo): its admin, a workspace without a
 * plan, and no demo brand yet. The first build takes a few seconds; the
 * steps before the plan step, where "Explore the demo" waits on it, take
 * longer. Anything unread says no: the plan step's own preload stays.
 */
export async function wantsDemoAhead(
  supabase: BrowserSupabase,
  { organizationId, userId }: { organizationId: string; userId: string },
): Promise<boolean> {
  const [profile, organization, demo] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
    supabase
      .from('organizations')
      .select('subscription_status')
      .eq('id', organizationId)
      .maybeSingle(),
    supabase
      .from('brands')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_demo', true)
      .limit(1),
  ]);
  if (profile.error || organization.error || demo.error) return false;
  if (!profile.data || !organization.data || !demo.data) return false;
  return (
    profile.data.role === 'admin' &&
    !PLANNED.has(String(organization.data.subscription_status ?? '')) &&
    demo.data.length === 0
  );
}
