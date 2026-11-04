'use client';

import { AlertTriangle, Loader2, PlayCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { DemoSetupDialog } from '@/components/demo/DemoSetupDialog';
import { Button } from '@/components/ui/button';
import {
  CHOOSE_PLAN_HREF,
  ReadOnlyAction,
  useAskAdmin,
  useUpgradeDialog,
} from '@/components/context/UpgradeDialogProvider';
import { useDemoBrand } from '@/components/context/DemoBrandProvider';
import { useUserRole } from '@/hooks/useUserRole';
import { useExploreDemo, usePreloadDemo } from '@/hooks/useExploreDemo';
import type { ReadOnlyReason } from '@/lib/billing/subscriptionAccess';
import { offerChoice } from '@/lib/billing/planPurchase';
import { TRIAL_DAYS } from '@/lib/billing/trial';
import { useBrandStore } from '@/state/useBrandStore';

/**
 * A thin band across the top of the dashboard while the workspace is
 * read-only: that it is, and the way out — See plans (the upgrade dialog; not
 * on Billing, which has them) or, for a payment being retried, Update payment
 * method for admins and an admin to ask for everyone else. A workspace that
 * never had a plan reads its brand isn't tracked yet, with the free trial
 * and the first-month offer behind See plans. Once the plan ended or before it started, See the demo opens the
 * demo brand (sample data) beside it, for an admin or a manager, or anyone
 * once the demo brand is listed. Nothing while the plan is active.
 */
export function ReadOnlyBanner() {
  const state = useUpgradeDialog();
  // The demo brand has its own band: one band at a time. Which brand is on
  // screen is known once the brands are loaded; nothing until then.
  const brandsLoaded = useBrandStore((s) => s.loaded);
  if (!brandsLoaded || !state?.isLocked || state.isDemo || state.reason === 'demo') return null;
  return <Band reason={state.reason} adminName={state.adminName} openUpgrade={state.openUpgrade} />;
}

function Band({
  reason,
  adminName,
  openUpgrade,
}: {
  reason: ReadOnlyReason | 'trial';
  adminName: string | null;
  openUpgrade: () => void;
}) {
  const t = useTranslations('readOnly');
  const tDemo = useTranslations('demo');
  const { canAdmin, canManage } = useUserRole();
  const pathname = usePathname();
  const ask = useAskAdmin(reason, adminName);
  const payment = reason === 'payment_failed';
  const { demoBrand } = useDemoBrand();
  const { explore, opening, setupDialog } = useExploreDemo();
  const seeTheDemo = !payment && (canManage || (demoBrand !== null && !demoBrand.hidden));
  // No demo brand yet: its setup starts as the band shows, for an admin or a manager.
  usePreloadDemo(seeTheDemo && canManage && demoBrand === null);

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <p className="min-w-0 flex-1 text-amber-900 dark:text-amber-200">
        {t(`banner.${reason}`, { days: TRIAL_DAYS, offer: offerChoice(true) })}
        {payment && !canAdmin && <> {ask}</>}
      </p>
      {payment ? (
        canAdmin && <ReadOnlyAction reason="payment_failed" variant="outline" size="sm" />
      ) : pathname.startsWith(CHOOSE_PLAN_HREF) ? null : (
        <Button variant="outline" size="sm" onClick={() => openUpgrade()}>
          {t('banner.seePlans')}
        </Button>
      )}
      {seeTheDemo && (
        <Button variant="outline" size="sm" onClick={() => void explore()} disabled={opening}>
          {opening ? <Loader2 className="animate-spin" aria-hidden /> : <PlayCircle aria-hidden />}
          {opening ? tDemo('settingUp') : tDemo('seeTheDemo')}
        </Button>
      )}
      <DemoSetupDialog {...setupDialog} />
    </div>
  );
}
