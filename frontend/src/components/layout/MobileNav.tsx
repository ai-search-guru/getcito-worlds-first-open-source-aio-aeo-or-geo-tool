'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, Link } from '@/i18n/navigation';
import { dashboardNav } from '@/config/dashboard';
import { BrandSwitcher } from '@/components/layout/BrandSwitcher';
import {
  activeChildHref,
  childLinkHref,
  dashboardNavBadge,
  getDashboardNavLabel,
  navItemHref,
  shouldShowDashboardNavItem,
} from '@/lib/dashboardNavigation';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';
import { useFeatureGate } from '@/hooks/useFeatureGate';
import { useAgentKeyStatus } from '@/hooks/useAgentKeyStatus';
import { siteConfig } from '@/config/site';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { UserProfileNavItem } from '@/components/layout/UserProfileNavItem';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useHiddenMenuSections } from '@/components/context/MenuAccessProvider';
import { useBrandStore } from '@/state/useBrandStore';
import { Crown, ExternalLink, Menu, MessageSquareHeart, MessageSquareText } from 'lucide-react';
import Image from 'next/image';
import { useTheme } from 'next-themes';

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { canUse, requiredPlanFor, isCloud } = useFeatureGate();
  const chatAgentic = useChatAgentic();
  // Probe once per session — shares the module-level cache with sidebar.tsx
  // so at most one network request is made even when both components mount.
  // None with the new Chat on: that one runs on the plan's AI limit.
  const agentKeyStatus = useAgentKeyStatus(isCloud && !chatAgentic);
  const agentKeyMissing = isCloud && !chatAgentic && agentKeyStatus === 'missing';
  const chatSetUp = agentKeyMissing ? t('chatSetUp') : null;
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId) ?? null);
  const brandPrefs = { shoppingModeEnabled: !!activeBrand?.shoppingModeEnabled };
  const hiddenSections = useHiddenMenuSections();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Hydration guard — see sidebar.tsx for the rationale; the two
  // components mirror each other and can't share a hook without breaking
  // their independent layout contexts.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const logoSrc =
    mounted && resolvedTheme === 'dark'
      ? '/brand/icons/getcito-icon-dark-512.png'
      : '/brand/icons/getcito-icon-512.png';

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('toggleMenu')} />
        }
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">{t('toggleMenu')}</span>
      </SheetTrigger>
      <SheetContent side="left" className="getcito-sidebar flex w-64 flex-col bg-sidebar p-0">
        <div className="flex gap-2 h-16 items-center border-b px-4">
          <Image
            src={logoSrc}
            alt={siteConfig.name}
            width={24}
            height={24}
            className="h-6 w-6 shrink-0"
            priority
          />
          <span className="font-semibold">{siteConfig.name}</span>
          {/* Left of the sheet's close button, which sits at its top right. */}
          <ThemeToggle className="ml-auto mr-8" />
        </div>
        {/* The brand switcher, as the sidebar has it: the brands page and the
            brand's settings are reached from it. */}
        <div className="border-b px-3 py-2">
          <BrandSwitcher onNavigate={() => setOpen(false)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <nav className="space-y-0.5 p-3">
            {/* The brand's prompts: the Prompts section, off the menu with it. */}
            {activeBrandId && !hiddenSections.has('prompts') && (
              <Link
                href={`/dashboard/brands/${activeBrandId}/prompts`}
                onClick={() => setOpen(false)}
              >
                <span
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    pathname.includes(`/brands/${activeBrandId}/prompts`)
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <MessageSquareText className="h-4 w-4 shrink-0" />
                  {t('prompts')}
                </span>
              </Link>
            )}
            {dashboardNav.flatMap((group) =>
              group.items.map((item) => {
                if (!shouldShowDashboardNavItem(item, brandPrefs, hiddenSections, chatAgentic)) {
                  return null;
                }

                const href = navItemHref(item, chatAgentic);
                const isActive =
                  item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname.startsWith(href);
                const label = getDashboardNavLabel(item.title, t);

                // Chat's own badge: "Set up" when the org has no provider key for
                // it (cloud only, never with the new Chat on).
                const effectiveBadge = dashboardNavBadge(item, { chatAgentic, chatSetUp });

                const isLocked =
                  isCloud && item.requiredFeature != null && !canUse(item.requiredFeature);

                if (isLocked) {
                  return (
                    <span
                      key={item.href}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/50 cursor-not-allowed"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{label}</span>
                      <Badge
                        variant="outline"
                        className="h-5 gap-0.5 px-1.5 text-[10px] font-normal"
                      >
                        <Crown className="h-2.5 w-2.5" />
                        {requiredPlanFor(item.requiredFeature!)}
                      </Badge>
                    </span>
                  );
                }

                const link = (
                  <Link key={item.href} href={href} onClick={() => setOpen(false)}>
                    <span
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{label}</span>
                      {effectiveBadge && (
                        <Badge
                          variant="secondary"
                          className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
                        >
                          {effectiveBadge}
                        </Badge>
                      )}
                    </span>
                  </Link>
                );
                if (!item.children?.length) return link;
                // A submenu (Prompts, Content), always shown on mobile.
                const currentChild = activeChildHref(item.children, pathname);
                return (
                  <div key={item.href}>
                    {link}
                    <div className="ml-7 border-l pl-2">
                      {item.children.map((child) => (
                        <Link
                          key={child.href}
                          href={childLinkHref(child, pathname)}
                          onClick={() => setOpen(false)}
                        >
                          <span
                            className={cn(
                              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                              child.href === currentChild
                                ? 'font-medium text-primary'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                            )}
                          >
                            {getDashboardNavLabel(child.title, t)}
                            {child.badge && (
                              <Badge
                                variant="secondary"
                                className="h-4 px-1.5 text-[10px] font-normal"
                              >
                                {child.badge}
                              </Badge>
                            )}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              }),
            )}
          </nav>
        </div>
        <div className="border-t p-2">
          <a
            href={siteConfig.links.feedback}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="mb-1 flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <MessageSquareHeart className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{t('feedback')}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
          </a>
          <UserProfileNavItem onClick={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
