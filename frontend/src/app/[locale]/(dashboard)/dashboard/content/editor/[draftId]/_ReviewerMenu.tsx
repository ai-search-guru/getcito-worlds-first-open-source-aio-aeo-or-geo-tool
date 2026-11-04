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
import { MANAGE_AUTHORS_PATH } from './_AuthorMenu';

/** No reviewer in the menu. */
const NONE = 'none';

/**
 * Who reviewed a page that advises on health, finance or law (Quality spec
 * §4b, CE-049): "Reviewed by {name} ▾", a qualified person from Authors
 * (their title is the credential), or none. Page metadata beside the
 * author: the page's text never names them.
 */
export function ReviewerMenu({
  authors,
  reviewerId,
  onPick,
  open,
  onOpenChange,
}: {
  authors: ContentAuthor[];
  reviewerId: string | null;
  onPick: (reviewerId: string | null) => void;
  /** Open from outside too: Quality's Pick reviewer. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations('contentEditor.editor.reviewer');
  const reviewer = authors.find((a) => a.id === reviewerId) ?? null;

  return (
    <DropdownMenu open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <DropdownMenuTrigger
        aria-label={reviewer ? t('change', { name: reviewer.name }) : t('add')}
        title={t('hint')}
        className={cn(
          badgeVariants({ variant: 'outline' }),
          'max-w-56 cursor-pointer gap-1 font-normal hover:bg-muted',
          !reviewer &&
            'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900',
        )}
      >
        <span className="truncate">{reviewer ? t('by', { name: reviewer.name }) : t('add')}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('title')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={reviewer?.id ?? NONE}
            onValueChange={(value) => onPick(value === NONE ? null : value)}
          >
            {authors.map((a) => (
              <DropdownMenuRadioItem key={a.id} value={a.id} closeOnClick>
                <span className="min-w-0">
                  <span className="block truncate">{a.name}</span>
                  {a.title && (
                    <span className="block truncate text-xs text-muted-foreground">{a.title}</span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value={NONE} closeOnClick>
              {t('none')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-xs text-muted-foreground">{t('qualified')}</p>
        <DropdownMenuItem render={<Link href={MANAGE_AUTHORS_PATH} />} className="text-xs">
          <Settings className="h-3.5 w-3.5" />
          {t('manage')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
