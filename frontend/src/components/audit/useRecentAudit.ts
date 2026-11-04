'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import type { RecentAudit } from '@/lib/actions/audits';

/** The API's RECENT_AUDIT_MINUTES (routes/audits.js): a page audited since asks first. */
export const RECENT_AUDIT_MINUTES = 10;

/** Whole minutes since an audit finished, at least 1. */
export function minutesSince(finishedAt: string, now = Date.now()): number {
  const ms = now - Date.parse(finishedAt);
  return Number.isFinite(ms) ? Math.max(1, Math.round(ms / 60_000)) : 1;
}

/**
 * What a start says when the page was audited a few minutes ago (00431): the
 * API didn't start it, so the person picks. One page asks "Open it or audit
 * again?"; several say which weren't started, with Audit again.
 */
export function useRecentAudit() {
  const t = useTranslations('audit.recent');
  const router = useRouter();

  const askOne = useCallback(
    (recent: RecentAudit, auditAgain: () => void) => {
      toast(t('question', { minutes: minutesSince(recent.finishedAt) }), {
        duration: 15_000,
        cancel: {
          label: t('open'),
          onClick: () => router.push(`/dashboard/audit/${recent.auditId}`),
        },
        action: { label: t('again'), onClick: auditAgain },
      });
    },
    [router, t],
  );

  const saySkipped = useCallback(
    (recent: RecentAudit[], auditAgain: () => void) => {
      if (recent.length === 0) return;
      toast(t('skipped', { count: recent.length, minutes: RECENT_AUDIT_MINUTES }), {
        duration: 15_000,
        action: { label: t('again'), onClick: auditAgain },
      });
    },
    [t],
  );

  return { askOne, saySkipped };
}
