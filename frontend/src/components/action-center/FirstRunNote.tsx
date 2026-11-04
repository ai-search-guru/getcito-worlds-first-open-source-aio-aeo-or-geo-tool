'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, ChevronDown, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useFirstRun } from '@/hooks/useFirstRun';
import { cn } from '@/lib/utils';

/**
 * "First tracking running" on the Action Center (#1238's review): after the
 * payment, a new brand or onboarding, people land on Actions while the first
 * tracking run is still going. One thin line under the tabs: the run, its
 * checks done and the time left, and Details, which unfolds what it means
 * and the way to Brand Visibility. Gone once the brand has a completed run.
 */
export function FirstRunNote() {
  const t = useTranslations('actionCenter.firstRun');
  const run = useFirstRun();
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  if (!run) return null;
  const { progress, left } = run;

  return (
    <div role="status" className="rounded-md border border-primary/20 bg-primary/5 text-xs">
      <div className="flex h-9 items-center gap-2 px-3">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
        <p className="min-w-0 flex-1 truncate">
          <span className="font-medium">{run.queued ? t('queued') : t('running')}</span>
          {progress && progress.total > 0 && (
            <span className="text-muted-foreground tabular-nums">
              {' · '}
              {t('progress', { current: progress.current, total: progress.total })}
              {left && ` · ${'hours' in left ? t('hoursLeft', left) : t('minutesLeft', left)}`}
            </span>
          )}
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((was) => !was)}
          className="inline-flex shrink-0 items-center gap-0.5 font-medium text-primary hover:underline"
        >
          {t('details')}
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      </div>
      {open && (
        <div
          id={detailsId}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-primary/20 px-3 py-2"
        >
          <p className="min-w-0 flex-1 text-muted-foreground">
            {run.queued ? t('queuedBody') : t('runningBody')}
          </p>
          <Link
            href="/dashboard/insights"
            className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
          >
            {t('link')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}
