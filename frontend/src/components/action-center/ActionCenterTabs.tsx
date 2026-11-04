'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useBrandStore } from '@/state/useBrandStore';
import { useUserRole } from '@/hooks/useUserRole';
import { getNewSignalCount } from '@/lib/actions/signals';
import { getTaskReviewCount } from '@/lib/actions/actionTaskReviews';
import { cn } from '@/lib/utils';
import { ACTION_CENTER_TABS, REVIEW_TAB, TASK_REVIEWS_CHANGED } from '@/lib/action-center/tabs';
import { FirstRunNote } from './FirstRunNote';

/**
 * The Action Center's section nav: Actions | Signals | KPIs | History, and
 * Needs review for admins and managers (AC-010). Route-backed rather than
 * state-backed tabs so each section is linkable and the browser back button
 * works across them. The first run's note sits under it while a new brand's
 * first analysis goes on.
 */
export function ActionCenterTabs() {
  const pathname = usePathname();
  const t = useTranslations('actionCenter.tabs');

  // Untriaged-signal count on the Signals tab: information ("something new
  // is waiting"), not decoration. Best-effort — a failed count shows nothing.
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [newSignals, setNewSignals] = useState(0);
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    getNewSignalCount(brandId)
      .then((count) => {
        if (!cancelled) setNewSignals(count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brandId, pathname]);

  // Tasks waiting for review, on their own tab: admins and managers fill and approve them.
  const { canManage } = useUserRole();
  // Kept with its brand: another brand's count isn't shown while this one's loads.
  const [reviewCount, setReviewCount] = useState<{ brandId: string; count: number } | null>(null);
  const reviews = reviewCount && reviewCount.brandId === brandId ? reviewCount.count : 0;
  useEffect(() => {
    if (!brandId || !canManage) return;
    let cancelled = false;
    const load = () => {
      getTaskReviewCount(brandId)
        .then((count) => {
          if (!cancelled) setReviewCount({ brandId, count });
        })
        .catch(() => {});
    };
    load();
    // Approved or dismissed on the review page itself.
    window.addEventListener(TASK_REVIEWS_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(TASK_REVIEWS_CHANGED, load);
    };
  }, [brandId, canManage, pathname]);
  const tabs = canManage ? [...ACTION_CENTER_TABS, REVIEW_TAB] : ACTION_CENTER_TABS;

  return (
    <>
      <nav className="flex gap-6 border-b" aria-label={t('label')}>
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 pb-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(tab.key)}
              {tab.key === 'signals' && newSignals > 0 && (
                <span className="ml-1.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                  {newSignals}
                </span>
              )}
              {tab.key === 'review' && reviews > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                  {reviews}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {/* Under the tabs on every section: they all fill in from the first run. */}
      <FirstRunNote />
    </>
  );
}
