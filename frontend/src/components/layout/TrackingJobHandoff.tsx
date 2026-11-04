'use client';

import { useEffect } from 'react';
import { usePathname } from '@/i18n/navigation';
import { useBrandStore } from '@/state/useBrandStore';
import { saveTrackingJob } from '@/lib/trackingJobStore';
import { readUrlParam, writeUrlParams } from '@/lib/urlState';

/**
 * The first tracking run starts with the payment, and the Stripe success
 * route lands on the Action Center (DASHBOARD_HOME) with ?jobId=. Visibility
 * shows a run's progress from the saved job, so the id is kept for it here
 * and taken out of the address. Visibility reads ?jobId= itself, so it is
 * left alone there.
 */
export function TrackingJobHandoff() {
  const pathname = usePathname();
  const brandId = useBrandStore((s) => s.activeBrandId);

  useEffect(() => {
    if (!brandId || pathname.startsWith('/dashboard/insights')) return;
    const jobId = readUrlParam('jobId');
    if (!jobId) return;
    saveTrackingJob({ jobId, brandId, startedAt: Date.now() });
    writeUrlParams({ jobId: null });
  }, [pathname, brandId]);

  return null;
}
