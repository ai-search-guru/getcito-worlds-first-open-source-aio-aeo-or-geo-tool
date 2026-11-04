'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { usePathname } from '@/i18n/navigation';
import { onFirstRunFinished, useFirstRun } from '@/hooks/useFirstRun';
import { loadTrackingJob } from '@/lib/trackingJobStore';
import { useBrandStore } from '@/state/useBrandStore';

/**
 * "Your first results are ready", on whatever page someone is on when the
 * brand's first tracking run finishes. The Action Center, Brand Visibility
 * and Prompts watch the run anyway; on the other pages it is watched while
 * this browser holds the run's job (TrackingJobHandoff keeps it after the
 * payment), so no other brand costs a read. The pages that show the run
 * read their data again themselves.
 */
export function FirstRunReady() {
  const t = useTranslations('firstRun');
  const brandId = useBrandStore((s) => s.activeBrandId);
  // Read on every page (the path re-renders it): the job is saved after the
  // page it came with has drawn.
  usePathname();
  const held = brandId !== null && loadTrackingJob()?.brandId === brandId;
  useFirstRun({ enabled: held });

  useEffect(
    () =>
      onFirstRunFinished((finished) => {
        // Another brand's run, finished after a switch: not this one's news.
        if (finished === useBrandStore.getState().activeBrandId) toast.success(t('ready'));
      }),
    [t],
  );

  return null;
}
