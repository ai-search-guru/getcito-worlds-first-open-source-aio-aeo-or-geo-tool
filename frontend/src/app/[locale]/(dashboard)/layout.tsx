import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/sidebar';
import { SidebarErrorBoundary } from '@/components/layout/SidebarErrorBoundary';
import { MobileNav } from '@/components/layout/MobileNav';
import { SessionProvider } from '@/components/context/SessionProvider';
import { PlanProvider } from '@/components/context/PlanProvider';
import { AiUsageProvider } from '@/components/context/AiUsageProvider';
import { GetMoreProvider } from '@/components/ai-usage/GetMore';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import { MenuAccessProvider } from '@/components/context/MenuAccessProvider';
import { ChatAgenticProvider } from '@/components/context/ChatAgenticProvider';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { firstNameOf } from '@/lib/chat/home';
import { importLegacyChats } from '@/lib/chat/legacyImport';
import { panelSizeOf } from '@/lib/chat/panel';
import { planFactsFromOrgRow } from '@/lib/chat/planFacts';
import { DEFAULT_CHAT_SETTINGS, parseTeamRole } from '@/lib/chat/precedence';
import { composerSetupOf } from '@/lib/chat/composerSetup';
import { chatRunsOnOwnKey } from '@/lib/chat/key';
import { failingKeyFor } from '@/lib/chat/keyHealth';
import { skillMenuFor } from '@/lib/chat/skills/store';
import { ChatPanelPage, ChatPanelProvider } from '@/components/chat/panel/ChatPanelProvider';
import { ChatSidePanelSlot } from '@/components/chat/panel/ChatSidePanelSlot';
import { BrandLoader } from '@/components/context/BrandLoader';
import { BrandGuard } from '@/components/context/BrandGuard';
import { GettingStartedPageOpened } from '@/components/getting-started/PageOpened';
import { getBrands } from '@/lib/actions/brand';
import { menuOfProfile, menuSectionsFor, readRoleHidden } from '@/lib/menuAccess';
import { getPlan, isCloud, toPlanId } from '@/config/plans';
import { evaluateSubscriptionAccess } from '@/lib/billing/subscriptionAccess';
import { UpgradeDialogProvider } from '@/components/context/UpgradeDialogProvider';
import { DemoBrandProvider } from '@/components/context/DemoBrandProvider';
import { ReadOnlyBanner } from '@/components/billing/ReadOnlyBanner';
import { DemoBanner } from '@/components/billing/DemoBanner';
import { PlanEndsBanner } from '@/components/billing/PlanEndsBanner';
import { TrackingJobHandoff } from '@/components/layout/TrackingJobHandoff';
import { FirstRunReady } from '@/components/layout/FirstRunReady';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'organization_id, onboarding_completed, role, full_name, work_areas, work_areas_asked_at, menu_shown, menu_hidden, can_manage_menus',
    )
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id || !profile?.onboarding_completed) {
    redirect('/dashboard/onboarding');
  }

  const role = (profile.role ?? 'analyst') as TeamRole;
  const chatOn = chatAgenticEnabled(profile.organization_id);

  const [
    { data: org, error: orgError },
    brands,
    roleHidden,
    chatPrefsRead,
    chatSettingsRead,
    chatOnOwnKey,
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select(
        'plan, subscription_status, plan_overrides, stripe_subscription_id, subscription_ends_at, cancel_at_period_end',
      )
      .eq('id', profile.organization_id)
      .single(),
    getBrands(profile.organization_id),
    // The sections the viewer's role leaves out (menu access); no read for admins.
    readRoleHidden(supabase, profile.organization_id, role),
    // Chat's side panel on every page (CHAT-01 items 13–24): the person's choices for it.
    chatOn
      ? supabase
          .from('chat_user_prefs')
          .select(
            'panel_on_pages, panel_size, default_mode, usage_notice_period, legacy_imported_at',
          )
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // The panel's composer is set up as Chat's pages set theirs up
    // (chatComposerSetup): the Admin's "Full auto for members" (CHAT-23), so
    // Full auto shows open only where the server runs it, and whether Chat
    // runs on the workspace's own key, so the AI limit doesn't pause it there.
    chatOn
      ? supabase
          .from('chat_settings')
          .select('full_auto_for_members')
          .eq('organization_id', profile.organization_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    chatOn ? chatRunsOnOwnKey(profile.organization_id).catch(() => false) : false,
  ]);
  const chatPrefs = chatPrefsRead.data;
  // The side panel is Chat too: the person's Agent Chat conversations come
  // over on their first visit with it, as they do on Chat's pages (W1-02).
  if (chatOn && !chatPrefsRead.error && !chatPrefs?.legacy_imported_at) {
    await importLegacyChats({
      userId: user.id,
      email: user.email ?? null,
      organizationId: profile.organization_id,
    });
  }
  // Of the sections the workspace has: Agent Center only with the new Chat on.
  const menu = menuOfProfile({ ...profile, role }, roleHidden, menuSectionsFor(chatOn));

  // The organization's demo brand (sample data, 00380), shown or hidden: the
  // dialog's offer reads whether the organization ever subscribed. Hidden
  // (after a plan was bought), it is out of every brand list until it is
  // shown again from the brand switcher.
  const demoBrand = brands.find((b) => b.isDemo) ?? null;
  const listedBrands = brands.filter((b) => !(b.isDemo && b.demoHiddenAt));

  // Cloud mode: when the subscription isn't active/trialing, the dashboard is
  // read-only — every page opens (Billing included, to choose a plan), and an
  // action opens the upgrade dialog instead of running. Only an admin of a
  // new account that never had a subscription goes back to onboarding's plan
  // step, where its trial starts — unless the organization has a demo brand
  // to explore (onboarding's "Explore the demo"). An org row that couldn't be
  // read decides nothing: no redirect and no lock (the API still refuses a
  // lapsed plan's changes with 402).
  const subscriptionStatus = (org?.subscription_status as string | null) ?? null;
  let subscriptionActive = true;
  let adminName: string | null = null;
  if (isCloud() && !orgError) {
    const access = await evaluateSubscriptionAccess(
      supabase,
      profile.organization_id,
      role,
      subscriptionStatus,
      Boolean(org?.stripe_subscription_id),
      { hasDemoBrand: demoBrand !== null },
    );
    if (access.state === 'choose_plan') {
      redirect('/dashboard/onboarding');
    }
    if (access.state === 'read_only') {
      subscriptionActive = false;
      adminName = access.adminName;
    }
  }

  // "What do you work on?", asked once (menu access): an invited person on
  // their first visit, a self-hosted admin after onboarding.
  if (!menu.workAreasAsked) {
    redirect('/dashboard/welcome');
  }

  const planId = toPlanId(org?.plan);

  // Effective API-model allowlist for the client (null = all allowed).
  // Enterprise orgs can be switched on per customer via
  // organizations.plan_overrides — same merge getOrgPlan applies.
  let allowedModelIds: string[] | null = null;
  if (isCloud()) {
    const overrides =
      planId === 'enterprise' && org?.plan_overrides
        ? (org.plan_overrides as { allowedModels?: string[] })
        : null;
    const effective = overrides?.allowedModels ?? getPlan(planId).limits.allowedModels;
    allowedModelIds = effective ? [...effective] : null;
  }

  // The facts chatComposerSetup reads: the live role, the plan and the
  // members switch; any of them unread, the careful setup.
  const teamRole = parseTeamRole(profile.role);
  const composerModes = composerSetupOf(
    chatPrefs?.default_mode,
    org && !chatSettingsRead.error && teamRole
      ? {
          role: teamRole,
          plan: planFactsFromOrgRow(org),
          settings: {
            ...DEFAULT_CHAT_SETTINGS,
            fullAutoForMembers:
              chatSettingsRead.data?.full_auto_for_members ??
              DEFAULT_CHAT_SETTINGS.fullAutoForMembers,
          },
        }
      : null,
  );
  const metadataName = (user.user_metadata as { full_name?: unknown } | null)?.full_name;
  const chatPanel = {
    enabled: chatOn && chatPrefs?.panel_on_pages !== false,
    size: panelSizeOf(chatPrefs?.panel_size),
    firstName: firstNameOf(
      profile.full_name ?? (typeof metadataName === 'string' ? metadataName : null),
    ),
    ...composerModes,
    usageNoticeSeen: chatPrefs?.usage_notice_period ?? null,
    onOwnKey: chatOnOwnKey,
    // Read only where Chat runs on the own key (AGENT-OWN-KEY §5.2 item 5).
    keyFailure: chatOnOwnKey ? await failingKeyFor(profile.organization_id) : null,
    skills: await skillMenuFor(profile.organization_id, user.id),
  };

  return (
    <>
      <SessionProvider user={user} />
      <BrandLoader brands={listedBrands} />
      <PlanProvider
        planId={planId}
        allowedModelIds={allowedModelIds}
        subscriptionActive={subscriptionActive}
        subscriptionStatus={subscriptionStatus}
        planEndsAt={org?.cancel_at_period_end ? (org.subscription_ends_at as string | null) : null}
      >
        <RoleProvider role={role}>
          <ChatAgenticProvider enabled={chatOn}>
            <DemoBrandProvider
              demoBrand={
                demoBrand ? { id: demoBrand.id, hidden: Boolean(demoBrand.demoHiddenAt) } : null
              }
              everSubscribed={Boolean(org?.stripe_subscription_id)}
            >
              <UpgradeDialogProvider adminName={adminName} organizationId={profile.organization_id}>
                {/* Inside the provider: it records nothing while the workspace is read-only. */}
                <GettingStartedPageOpened />
                <MenuAccessProvider hidden={menu.hidden} canManageMenus={menu.canManageMenus}>
                  <AiUsageProvider>
                    {/* The Get more window, for every limit on the page (CHAT-18 §B item 6). */}
                    <GetMoreProvider>
                      <ChatPanelProvider setup={chatPanel}>
                        <div className="flex h-screen overflow-hidden">
                          {/* Desktop sidebar */}
                          <div className="relative hidden md:flex md:flex-shrink-0">
                            <SidebarErrorBoundary>
                              <Sidebar />
                            </SidebarErrorBoundary>
                          </div>

                          {/* Main area, beside Chat's side panel when it is open */}
                          <ChatPanelPage className="flex flex-1 flex-col overflow-hidden">
                            <div className="flex h-16 items-center border-b bg-card px-4 gap-3 md:hidden">
                              <MobileNav />
                            </div>
                            <ReadOnlyBanner />
                            <PlanEndsBanner />
                            <DemoBanner />
                            <main className="flex-1 overflow-y-auto bg-background p-6">
                              <BrandGuard>{children}</BrandGuard>
                            </main>
                            <TrackingJobHandoff />
                            <FirstRunReady />
                          </ChatPanelPage>
                        </div>
                        {chatPanel.enabled && <ChatSidePanelSlot />}
                      </ChatPanelProvider>
                    </GetMoreProvider>
                  </AiUsageProvider>
                </MenuAccessProvider>
              </UpgradeDialogProvider>
            </DemoBrandProvider>
          </ChatAgenticProvider>
        </RoleProvider>
      </PlanProvider>
    </>
  );
}
