'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { usePlanContext } from '@/components/context/PlanProvider';
import { BillingSection } from '@/components/settings/BillingSection';
import { TeamSection } from '@/components/settings/TeamSection';
import { AuthorsSection } from '@/components/settings/AuthorsSection';
import { ContentSection } from '@/components/settings/ContentSection';
import { ApiKeysSection } from '@/components/settings/ApiKeysSection';
import { AiProvidersSection } from '@/components/settings/AiProvidersSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { IntegrationsSection } from '@/components/settings/IntegrationsSection';
import { OrganizationSection } from '@/components/settings/OrganizationSection';
import { WhiteLabelSection } from '@/components/settings/WhiteLabelSection';
import { MenuAccessSection } from '@/components/settings/MenuAccessSection';
import { WorkAreasCard } from '@/components/settings/WorkAreasCard';
import { useCanManageMenus } from '@/components/context/MenuAccessProvider';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';
import { RolesAccessSection } from '@/components/chat-access/RolesAccessSection';
import { YourAccessSlot } from '@/components/chat-access/YourAccessCard';
import { ChatSettingsSection } from '@/components/chat-access/ChatSettingsSection';
import { countPendingAccessRequests } from '@/lib/actions/chatAccessRequests';
import { Badge } from '@/components/ui/badge';
import { updateAccountName } from '@/lib/actions/organization';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  SETTINGS_SECTIONS,
  hasSettingsSection,
  settingsSectionPath,
  type SettingsSection,
} from './_sections';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

/**
 * Settings, opened on `section`: from its own address (/dashboard/settings/
 * ai-providers) or the older ?tab= one, which e-mails and the integrations'
 * OAuth return still use. Picking a section moves the address to it.
 */
export function SettingsView({ section }: { section: SettingsSection }) {
  const t = useTranslations('settings');
  const tAuth = useTranslations('auth');
  const router = useRouter();
  const { isCloud } = usePlanContext();
  const canManageMenus = useCanManageMenus();
  const chatAgentic = useChatAgentic();
  // Ask your Admin requests waiting for an Admin: the count on Roles & access.
  const [pendingRequests, setPendingRequests] = useState(0);
  const [requestsRead, setRequestsRead] = useState(0);
  useEffect(() => {
    if (!chatAgentic) return;
    let live = true;
    countPendingAccessRequests()
      .then((read) => {
        // A failed count shows none: the list itself says it couldn't load.
        if (live) setPendingRequests(read.ok ? read.count : 0);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [chatAgentic, requestsRead]);
  // Roles & access and Chat are the new Chat's: with it off, their addresses open Account.
  const [active, setActive] = useState<SettingsSection>(
    (section === 'roles-access' || section === 'chat') && !chatAgentic ? 'account' : section,
  );

  const show = (next: SettingsSection) => {
    setActive(next);
    window.history.replaceState(null, '', settingsSectionPath(window.location.pathname, next));
  };
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setDisplayName(u?.user_metadata?.full_name ?? '');
      setEmail(u?.email ?? '');
    });
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/sign-in');
    router.refresh();
  }

  async function handleSaveAccount() {
    setSavingName(true);
    try {
      await updateAccountName(displayName);
      toast.success(t('saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('accountSaveFailed'));
    } finally {
      setSavingName(false);
    }
  }

  const labels: Record<SettingsSection, string> = {
    account: t('account'),
    organization: t('organization'),
    'white-label': t('whiteLabel.title'),
    team: t('team'),
    'roles-access': t('rolesAccess'),
    'menu-access': t('menuAccess.title'),
    authors: t('authors.title'),
    content: t('content.title'),
    notifications: t('notifications'),
    integrations: t('integrations'),
    'api-keys': t('apiKeys'),
    'ai-providers': t('aiProviders'),
    billing: t('billing'),
    chat: t('chatSettings'),
  };
  // AI Providers (bring your own key) and Billing are cloud-only: self-host
  // operators set ANTHROPIC_API_KEY in their own env.
  // Menu access is listed for admins and the managers they let change menus,
  // Roles & access and Chat for everyone while the new Chat is on.
  const navItems = SETTINGS_SECTIONS.filter(
    (id) =>
      hasSettingsSection(id, { isCloud }) &&
      (id !== 'menu-access' || canManageMenus) &&
      ((id !== 'roles-access' && id !== 'chat') || chatAgentic),
  ).map((id) => ({ id, label: labels[id] }));

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
      </HeaderWithAiUsage>

      <Separator />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sidebar nav */}
        <nav className="space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => show(item.id)}
              className={cn(
                'w-full text-left rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active === item.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {item.label}
              {item.id === 'roles-access' && pendingRequests > 0 && (
                <Badge className="ml-2 px-1.5 py-0 text-[10px] tabular-nums">
                  {pendingRequests}
                </Badge>
              )}
              {item.id === 'menu-access' && (
                <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">
                  {t('menuAccess.new')}
                </Badge>
              )}
            </button>
          ))}
        </nav>

        {/* Main content — only active section shown */}
        <div className="lg:col-span-2">
          {/* Account */}
          {active === 'account' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('account')}</CardTitle>
                <CardDescription>{t('accountDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t('displayName')}</Label>
                  <Input
                    id="name"
                    placeholder="Your name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">{t('email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={() => {}}
                    disabled
                  />
                </div>
                <Button onClick={handleSaveAccount} disabled={savingName || !displayName.trim()}>
                  {savingName && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('save')}
                </Button>
                <Separator className="my-2" />
                <Button
                  variant="outline"
                  onClick={handleSignOut}
                  className="text-destructive hover:text-destructive"
                >
                  {tAuth('signOut')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* What the person may do, in the app and through Chat (CHAT-20 §4b). */}
          {active === 'account' && chatAgentic && <YourAccessSlot className="mt-6" />}

          {/* What the person works on or leads: it narrows their own menu. */}
          {active === 'account' && (
            <div className="mt-6">
              <WorkAreasCard />
            </div>
          )}

          {/* Organization */}
          {active === 'organization' && <OrganizationSection />}

          {active === 'white-label' && hasSettingsSection('white-label', { isCloud }) && (
            <WhiteLabelSection />
          )}

          {/* Team */}
          {active === 'team' && <TeamSection />}

          {active === 'roles-access' && chatAgentic && (
            <RolesAccessSection onRequestsChanged={() => setRequestsRead((n) => n + 1)} />
          )}

          {active === 'menu-access' && <MenuAccessSection />}

          {active === 'authors' && hasSettingsSection('authors', { isCloud }) && <AuthorsSection />}

          {active === 'content' && hasSettingsSection('content', { isCloud }) && <ContentSection />}

          {active === 'notifications' && <NotificationsSection />}

          {active === 'integrations' && <IntegrationsSection />}

          {/* MCP & API Keys */}
          {active === 'api-keys' && <ApiKeysSection />}

          {/* AI Providers (cloud BYOK) */}
          {active === 'ai-providers' && isCloud && <AiProvidersSection />}

          {active === 'chat' && chatAgentic && <ChatSettingsSection />}

          {/* Billing */}
          {active === 'billing' && isCloud && <BillingSection />}
        </div>
      </div>
    </div>
  );
}
