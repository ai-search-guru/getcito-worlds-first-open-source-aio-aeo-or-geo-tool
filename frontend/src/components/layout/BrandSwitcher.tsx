'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { brandPagePath } from '@/lib/brandPath';
import type { Brand } from '@/types';
import { useBrandStore } from '@/state/useBrandStore';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useDemoBrand } from '@/components/context/DemoBrandProvider';
import { usePlanContext } from '@/components/context/PlanProvider';
import { getBrandById } from '@/lib/actions/brand';
import { setDemoHidden } from '@/lib/demo/demoClient';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BrandIdentity } from '@/components/BrandIdentity';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Check, ChevronsUpDown, Eye, EyeOff, LayoutGrid, Plus, Settings } from 'lucide-react';

interface BrandSwitcherProps {
  collapsed?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called when it leaves for another page (the mobile menu closes then). */
  onNavigate?: () => void;
}

/**
 * The brand switcher at the top of the menu. Beside the selected brand, its
 * settings (a separate button, so the switcher still opens on the name and
 * the chevron); in the list, every brand to switch to, then all brands and a
 * new one. The brands page has no menu item of its own: this is its way in.
 * The demo brand (sample data) is listed as one; once an admin or a manager
 * hides it (after buying a plan), the menu's last item shows it again.
 */
export function BrandSwitcher({ collapsed = false, onOpenChange, onNavigate }: BrandSwitcherProps) {
  const t = useTranslations('brands');
  const router = useRouter();
  const pathname = usePathname();
  const {
    brands,
    loaded,
    activeBrandId,
    setActiveBrand,
    addBrand: addToList,
    removeBrand: removeFromList,
  } = useBrandStore();
  // Only admins and managers add a brand (brands: admin/manager insert).
  const { canManage } = useUserRole();

  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;

  const go = (href: string) => {
    onNavigate?.();
    router.push(href);
  };
  // A read-only workspace (plan not active): Add brand opens the upgrade
  // dialog instead of the new brand's page, the mobile menu closed first so
  // the dialog isn't left behind it.
  const { isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const addBrand = () => {
    if (isLocked) {
      onNavigate?.();
      openUpgrade(tActions('addBrands'));
    } else {
      go('/dashboard/brands/new');
    }
  };
  // The demo brand, hidden from the list or shown in it again: never deleted.
  const tDemo = useTranslations('demo.switcher');
  const { demoBrand } = useDemoBrand();
  const [togglingDemo, setTogglingDemo] = useState(false);
  const toggleDemo = async () => {
    if (!demoBrand || togglingDemo) return;
    const hide = !demoBrand.hidden;
    setTogglingDemo(true);
    const result = await setDemoHidden(hide);
    // Shown again: into the list now, and on screen, before the layout reads the brands.
    const shown = result.ok && !hide ? await getBrandById(demoBrand.id).catch(() => null) : null;
    setTogglingDemo(false);
    if (!result.ok) {
      toast.error(tDemo('failed'));
      return;
    }
    if (hide) {
      removeFromList(demoBrand.id);
    } else if (shown) {
      if (!brands.some((b) => b.id === shown.id)) addToList(shown);
      setActiveBrand(shown.id);
    }
    router.refresh();
  };
  // On a brand's own page (its settings, prompts or topics), the same page
  // of the brand picked; elsewhere the page stays.
  const select = (brandId: string) => {
    setActiveBrand(brandId);
    const next = brandPagePath(pathname, brandId);
    if (next) go(next);
  };

  if (brands.length === 0) {
    // Before the brands are loaded, none listed isn't none at all.
    if (!loaded || !canManage) return null;
    return (
      <button
        onClick={addBrand}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-dashed px-2 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary',
          collapsed && 'justify-center px-0',
        )}
        title={collapsed ? t('addBrand') : undefined}
      >
        <Plus className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate text-xs">{t('addBrand')}</span>}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-none',
            collapsed && 'justify-center px-0',
          )}
          aria-label={t('switchBrand')}
        >
          {activeBrand ? (
            <BrandIdentity
              logoUrl={activeBrand.logoUrl}
              name={activeBrand.name}
              domains={activeBrand.domains}
              className="h-6 w-6 shrink-0 rounded-md bg-zinc-50 dark:bg-zinc-100"
            />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">
              ?
            </span>
          )}

          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left text-sm font-medium">
                {activeBrand?.name ?? t('selectBrand')}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-56" align="start" side="bottom" sideOffset={4}>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('switchBrand')}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />

          <BrandSwitchItems brands={brands} currentId={activeBrandId} onSelect={select} />

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => go('/dashboard/brands')}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border">
              <LayoutGrid className="h-3 w-3" />
            </div>
            <span className="text-sm">{t('showAllBrands')}</span>
          </DropdownMenuItem>
          {canManage && (
            <DropdownMenuItem
              onClick={addBrand}
              className="flex items-center gap-2 text-muted-foreground"
            >
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border">
                <Plus className="h-3 w-3" />
              </div>
              <span className="text-sm">{t('addBrand')}</span>
            </DropdownMenuItem>
          )}
          {canManage && demoBrand && (
            <DropdownMenuItem
              onClick={() => void toggleDemo()}
              disabled={togglingDemo}
              className="flex items-center gap-2 text-muted-foreground"
            >
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border">
                {demoBrand.hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </div>
              <span className="text-sm">{demoBrand.hidden ? tDemo('show') : tDemo('hide')}</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The selected brand's settings; too narrow beside the logo when collapsed. */}
      {activeBrand && !collapsed && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={`/dashboard/brands/${activeBrand.id}/settings`}
                onClick={onNavigate}
                aria-label={t('visitBrandSettings')}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            }
          >
            <Settings className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="right">{t('visitBrandSettings')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * The brands to switch to, the current one checked; under each its domain,
 * or what it is: the demo brand's sample data, or a brand of a workspace that
 * never had a plan, not tracked yet.
 */
export function BrandSwitchItems({
  brands,
  currentId,
  onSelect,
}: {
  brands: Brand[];
  currentId: string | null;
  onSelect: (brandId: string) => void;
}) {
  const tDemo = useTranslations('demo.switcher');
  const { neverSubscribed } = useDemoBrand();
  const { subscriptionActive } = usePlanContext();
  const untracked = neverSubscribed && !subscriptionActive;
  return brands.map((brand) => {
    const isActive = brand.id === currentId;
    const subline = brand.isDemo
      ? tDemo('sampleData')
      : untracked
        ? tDemo('notTracked')
        : brand.domains.find((d) => d.isPrimary)?.domain;

    return (
      <DropdownMenuItem
        key={brand.id}
        onClick={() => onSelect(brand.id)}
        className="flex items-center gap-2"
      >
        <BrandIdentity
          logoUrl={brand.logoUrl}
          name={brand.name}
          domains={brand.domains}
          className="h-5 w-5 shrink-0 rounded-md bg-zinc-50 dark:bg-zinc-100"
          fallbackClassName="rounded-md bg-primary/10 text-primary text-xs font-semibold"
        />
        <div className="flex-1 overflow-hidden">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            <span className="truncate">{brand.name}</span>
            {!brand.isActive && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Paused
              </span>
            )}
          </p>
          {subline && <p className="truncate text-xs text-muted-foreground">{subline}</p>}
        </div>
        {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
      </DropdownMenuItem>
    );
  });
}
