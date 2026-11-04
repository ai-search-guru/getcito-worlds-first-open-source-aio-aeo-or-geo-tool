'use client';

import { useTranslations } from 'next-intl';
import { ArrowUpRight, Compass } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import type { ChatHref } from '@/lib/chat/events';
import type { RouteFilter } from '@/lib/chat/routes';

/**
 * The navigation card (CHAT-19 §2): the page Chat opens and the filters it
 * set, with Go to page. A request the rules-based router answered
 * (lib/chat/routes.ts routeRequest) used no AI, and the card says so; one
 * the model routed did, and it doesn't.
 * In the side panel the page opens behind it; on the full page it opens
 * with the chat docked in the side panel.
 */
export function NavigationCard({
  title,
  section,
  href,
  filters,
  ruleRouted,
}: {
  title: string;
  section: string | null;
  href: ChatHref;
  filters: { key: RouteFilter['key']; value: string }[];
  /** Answered by the rules-based router, without the model. */
  ruleRouted: boolean;
}) {
  const t = useTranslations('chatNavigation');
  const label = (filter: { key: RouteFilter['key']; value: string }) =>
    filter.key === 'range'
      ? t.has(`ranges.${filter.value}`)
        ? t(`ranges.${filter.value}`)
        : filter.value
      : (PLATFORM_LABELS[filter.value] ?? filter.value);
  return (
    <div className="rounded-xl border bg-card p-3.5 text-sm shadow-sm">
      <div className="flex items-start gap-2.5">
        <Compass className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-medium">{section ? `${section} › ${title}` : title}</p>
          {filters.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {filters.map((filter) => (
                <li
                  key={filter.key}
                  className="rounded-full border bg-muted/50 px-2 py-0.5 text-xs"
                >
                  {label(filter)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {filters.length > 0 ? t('filtersSet') : t('noFilters')}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {ruleRouted ? t('navigationOnly') : null}
        </span>
        <Link href={href} className={buttonVariants({ size: 'sm' })}>
          {t('goToPage')}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
