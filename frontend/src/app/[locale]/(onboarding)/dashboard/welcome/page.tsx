import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyMenu } from '@/lib/actions/menuAccess';
import { OnboardingFrame } from '@/components/onboarding/OnboardingFrame';
import { DASHBOARD_HOME } from '@/config/home';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { ChatAgenticProvider } from '@/components/context/ChatAgenticProvider';
import type { TeamRole } from '@/components/context/RoleProvider';
import { WelcomeView } from './_WelcomeView';

/**
 * "What do you work on?" for someone who wasn't asked in onboarding: an
 * invited person on their first sign-in, or a self-hosted admin (no plan
 * step to ask before). The dashboard sends them here once (menu access);
 * anyone already asked goes on to the dashboard.
 */
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, organization_id, onboarding_completed, work_areas_asked_at')
    .eq('id', user.id)
    .single();
  if (!profile?.organization_id || !profile.onboarding_completed) redirect('/dashboard/onboarding');
  if (profile.work_areas_asked_at) redirect(DASHBOARD_HOME);

  const [menu, { data: brands }, { data: org }] = await Promise.all([
    getMyMenu().catch(() => null),
    supabase.from('brands').select('name').eq('organization_id', profile.organization_id).limit(2),
    supabase.from('organizations').select('name').eq('id', profile.organization_id).single(),
  ]);
  // The brand's name, or the organization's when it has several brands.
  const workspace =
    (brands?.length === 1 ? brands[0].name : (org?.name ?? brands?.[0]?.name)) ?? '';
  const fullName = profile.full_name || (user.user_metadata?.full_name as string | undefined) || '';

  return (
    <OnboardingFrame width="wide" preview={null}>
      {/* The menu it shows has Agent Center only with the new Chat on. */}
      <ChatAgenticProvider enabled={chatAgenticEnabled(profile.organization_id)}>
        <WelcomeView
          role={profile.role as TeamRole}
          workspace={workspace}
          firstName={fullName.trim().split(/\s+/)[0] ?? ''}
          hiddenByAdmin={menu?.hiddenByAdmin ?? []}
        />
      </ChatAgenticProvider>
    </OnboardingFrame>
  );
}
