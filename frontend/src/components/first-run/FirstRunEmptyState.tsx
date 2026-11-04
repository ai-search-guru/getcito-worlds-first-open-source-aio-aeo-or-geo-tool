'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import type { FirstRun } from '@/hooks/useFirstRun';
import { cn } from '@/lib/utils';

/**
 * In place of an empty page, a 0 or a step's way to it while the brand's
 * first tracking run goes on: "Your first answers are arriving (18 of 40) ·
 * ~6 min. This fills in when tracking finishes." So a page with nothing in
 * it yet doesn't read as a product that doesn't work. The run comes from
 * useFirstRun, the same reading as the Action Center's line.
 */
export function FirstRunEmptyState({ run, className }: { run: FirstRun; className?: string }) {
  const t = useTranslations('firstRun');
  const { progress, left } = run;
  const count =
    progress && progress.total > 0
      ? ` ${t('count', { current: progress.current, total: progress.total })}`
      : '';
  const time = left ? ` · ${'hours' in left ? t('hoursLeft', left) : t('minutesLeft', left)}` : '';

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm',
        className,
      )}
    >
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
      <p>
        <span className="font-medium tabular-nums">
          {run.queued ? t('queued') : `${t('arriving')}${count}${time}`}.
        </span>{' '}
        <span className="text-muted-foreground">{t('fillsIn')}</span>
      </p>
    </div>
  );
}
