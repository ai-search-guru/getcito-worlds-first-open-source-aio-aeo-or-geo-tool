'use client';

import { useTranslations } from 'next-intl';

/**
 * Under the visit list, when Google Analytics filled any day of the range
 * (AT-004): the list holds the tracking snippet's visits only — Analytics
 * reports totals, not single visits — so its count can be lower than the
 * KPI's, and this says why. Nothing otherwise.
 */
export function VisitListSourceNote({ analyticsDays }: { analyticsDays: number }) {
  const t = useTranslations('traffic.visits');
  if (analyticsDays <= 0) return null;
  return (
    <p className="px-6 pb-1 text-xs text-muted-foreground">
      {t('listAnalyticsNote', { days: analyticsDays })}
    </p>
  );
}
