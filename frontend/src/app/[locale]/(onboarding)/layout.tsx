import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SessionProvider } from '@/components/context/SessionProvider';
import { OnboardingSignOutButton } from '@/components/auth/OnboardingSignOutButton';
import { isCloud } from '@/config/plans';
import { evaluateSubscriptionAccess } from '@/lib/billing/subscriptionAccess';
import type { TeamRole } from '@/components/context/RoleProvider';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in');
  }

  // An already-onboarded member whose org subscription has lapsed must not
  // re-enter the wizard (they could re-create the brand / competitors on the
  // org's existing setup): the dashboard opens read-only for them, and admins
  // choose a plan in Billing. Only an admin of a new account that never had a
  // subscription keeps the plan step; not-yet-onboarded users (new org
  // creators) pass through.
  if (isCloud()) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, onboarding_completed, role')
      .eq('id', user.id)
      .single();

    if (profile?.onboarding_completed && profile.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('subscription_status, stripe_subscription_id')
        .eq('id', profile.organization_id)
        .single();
      const access = await evaluateSubscriptionAccess(
        supabase,
        profile.organization_id,
        (profile.role ?? 'analyst') as TeamRole,
        (org?.subscription_status as string | null) ?? null,
        Boolean(org?.stripe_subscription_id),
      );
      if (access.state === 'read_only') {
        redirect('/dashboard');
      }
    }
  }

  return (
    <>
      <SessionProvider user={user} />
      <OnboardingSignOutButton />
      {children}
    </>
  );
}
