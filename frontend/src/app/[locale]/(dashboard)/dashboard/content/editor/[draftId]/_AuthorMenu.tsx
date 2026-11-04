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
import type { ContentAuthor } from '@/lib/content/authors';
import { cn } from '@/lib/utils';

/** The organization byline in the menu: no author. */
const ORGANIZATION = 'organization';

/** The address of Settings › Authors. */
export const MANAGE_AUTHORS_PATH = '/dashboard/settings/authors';

/**
 * Who the page is by, in the editor's header (Quality spec §9, CE-038):
 * "By {name} ▾", one of the workspace's real authors or the organization
 * byline. Page metadata: the CMS author field gets it, the page's text
 * never does. New pages get the brand's default; the Content Agent never
 * picks one.
 */
export function AuthorMenu({
  brandId,
  brandName,
  authors,
  authorId,
  onPick,
  open,
  onOpenChange,
  inContent = false,
}: {
  brandId: string;
  brandName: string;
  authors: ContentAuthor[];
  authorId: string | null;
  onPick: (authorId: string | null) => void;
  /** Open from outside too: Quality's Pick author. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The brand adds the byline to content (CE-057): exports carry it. */
  inContent?: boolean;
}) {
  const t = useTranslations('contentEditor.editor.author');
  const author = authors.find((a) => a.id === authorId) ?? null;
  const name = author?.name ?? t('organization', { brand: brandName });

  return (
    <DropdownMenu open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <DropdownMenuTrigger
        aria-label={t('change', { name })}
        title={inContent ? t('hintInContent') : t('hint')}
        className={cn(
          badgeVariants({ variant: 'outline' }),
          'max-w-56 cursor-pointer gap-1 font-normal hover:bg-muted',
        )}
      >
        <span className="truncate">{t('by', { name })}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('title')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={author?.id ?? ORGANIZATION}
            onValueChange={(value) => onPick(value === ORGANIZATION ? null : value)}
          >
            {authors.map((a) => (
              <DropdownMenuRadioItem key={a.id} value={a.id} closeOnClick>
                <span className="min-w-0">
                  <span className="block truncate">{a.name}</span>
                  {(a.title || a.defaultFor.includes(brandId)) && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {[a.title, a.defaultFor.includes(brandId) ? t('default') : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value={ORGANIZATION} closeOnClick>
              <span className="min-w-0">
                <span className="block truncate">{t('organization', { brand: brandName })}</span>
                <span className="block text-xs text-muted-foreground">{t('organizationHint')}</span>
              </span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-xs text-muted-foreground">{t('realPeople')}</p>
        <DropdownMenuItem render={<Link href={MANAGE_AUTHORS_PATH} />} className="text-xs">
          <Settings className="h-3.5 w-3.5" />
          {t('manage')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
