'use client';

import { useTranslations } from 'next-intl';
import { ChevronDown, Settings } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { badgeVariants } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isPageType, type PageType } from '@/lib/content/drafts';
import { pagePath } from '@/lib/content/overlap';
import { SITE_PAGE_TYPES, SITE_TYPES, isSiteType, type SiteType } from '@/lib/content/pageTypes';
import { cn } from '@/lib/utils';

/**
 * The draft's page type in the editor's header (CE-023): detected from the
 * page until the person picks one from the types their kind of site writes.
 * A type from another kind of site, picked before the site type changed,
 * stays on the list so the menu still shows it. With `onPickSite` (Quality
 * CE-056: admins and managers once phase 2 is live), the brand's business
 * type is picked here too, for the whole brand as in Brand settings.
 */
export function PageTypeMenu({
  brandId,
  siteType,
  pageType,
  detected,
  isNew,
  sourceUrl,
  onPick,
  onPickSite,
  sitePending = false,
  siteGuessed = false,
  open,
  onOpenChange,
}: {
  brandId: string;
  siteType: SiteType;
  pageType: string | null;
  /** Whether the type is detected (not picked). */
  detected: boolean;
  /** A new page: the tag says so after the type. */
  isNew: boolean;
  /** The existing page an optimize draft is for: the tag shows its path. */
  sourceUrl: string | null;
  onPick: (type: PageType) => void;
  onPickSite?: (site: SiteType) => void;
  /** A site type pick is being saved: one at a time. */
  sitePending?: boolean;
  /** The brand has no site type picked yet: the one shown is guessed, as Brand settings says. */
  siteGuessed?: boolean;
  /** Opened from elsewhere too: Quality's Change (CE-052). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations('contentEditor.editor');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const tSites = useTranslations('brands.siteTypes');
  const current = isPageType(pageType) ? pageType : null;
  const offered = SITE_PAGE_TYPES[siteType];
  const types = current && !offered.includes(current) ? [...offered, current] : offered;
  const label = current ? tTypes(current) : t('pageType.none');

  return (
    <DropdownMenu open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <DropdownMenuTrigger
        aria-label={t('pageType.change', { type: label })}
        title={detected ? t('pageType.detectedHint') : (sourceUrl ?? undefined)}
        className={cn(
          badgeVariants({ variant: 'outline' }),
          'cursor-pointer gap-1 font-normal hover:bg-muted',
          !current && 'border-dashed text-muted-foreground',
        )}
      >
        {[label, isNew ? t('newPage') : sourceUrl ? pagePath(sourceUrl) : null]
          .filter(Boolean)
          .join(' · ')}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {onPickSite && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('pageType.siteTitle')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={siteType}
                onValueChange={(value) => {
                  if (isSiteType(value)) onPickSite(value);
                }}
              >
                {SITE_TYPES.map((site) => (
                  <DropdownMenuRadioItem
                    key={site}
                    value={site}
                    disabled={sitePending}
                    closeOnClick
                  >
                    {tSites(site)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <p className="px-1.5 pb-1 text-xs text-muted-foreground">
                {t('pageType.siteHint')}
                {siteGuessed && ` ${t('pageType.siteGuessed')}`}
              </p>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('pageType.title', { site: tSites(siteType) })}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current ?? ''}
            onValueChange={(value) => {
              if (isPageType(value)) onPick(value);
            }}
          >
            {types.map((type) => (
              <DropdownMenuRadioItem key={type} value={type} closeOnClick>
                {tTypes(type)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-xs text-muted-foreground">
          {detected ? t('pageType.detectedHint') : t('pageType.pickedHint')}
        </p>
        <DropdownMenuItem
          render={<Link href={`/dashboard/brands/${brandId}/settings`} />}
          className="text-xs"
        >
          <Settings className="h-3.5 w-3.5" />
          {t('pageType.siteSettings')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
