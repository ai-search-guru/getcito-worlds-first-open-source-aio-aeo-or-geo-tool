'use client';

import { useTranslations } from 'next-intl';
import { Flag } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The Actions page's first summary card while Getting started runs: steps
 * done out of all, and a bar. Like the other cards, it filters the table to
 * what it counts.
 */
export function GettingStartedSummaryCard({
  done,
  total,
  isActive,
  onClick,
}: {
  done: number;
  total: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const t = useTranslations('actionCenter.gettingStarted');
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'cursor-pointer transition-colors hover:border-foreground/30',
        isActive && 'border-foreground/60 bg-muted/40',
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border bg-muted/40">
            <Flag className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-xs font-medium text-muted-foreground">{t('card.title')}</p>
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums">{t('card.value', { done, total })}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('card.sub')}</p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-[width]"
            style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
