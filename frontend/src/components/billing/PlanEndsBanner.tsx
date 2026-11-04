'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePlanContext } from '@/components/context/PlanProvider';
import { useUserRole } from '@/hooks/useUserRole';
import { useRouter } from '@/i18n/navigation';
import { isDemoSelected } from '@/lib/demo/demoBrand';
import { useBrandStore } from '@/state/useBrandStore';

/** sessionStorage: the end date of the band closed in this browser session. */
export const PLAN_ENDS_CLOSED_KEY = 'aeo:plan-ends-closed';

/** As Billing writes a plan's dates: "November 20, 2026". */
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * A thin band across the top of the dashboard while a canceled plan runs to
 * the end of its paid period (00386): when it ends, and Keep my plan for an
 * admin, which resumes it as Billing's Reactivate does (the subscription
 * route lets admins only); other members are told to ask one. It closes for
 * the browser session, until the plan is canceled to another date. Once the
 * plan has ended the workspace is read-only, with its own band; the demo
 * brand has its own band too, so nothing on it.
 */
export function PlanEndsBanner() {
  const t = useTranslations('planEnds');
  const tSettings = useTranslations('settings');
  const { planEndsAt, subscriptionActive, subscriptionStatus } = usePlanContext();
  const { canAdmin } = useUserRole();
  const router = useRouter();
  const brandsLoaded = useBrandStore((s) => s.loaded);
  const demoSelected = useBrandStore(isDemoSelected);
  // Read in the browser only: the date in its own time zone, and whether it
  // was closed this session. Nothing on the server's render.
  const [closed, setClosed] = useState<boolean | null>(null);
  const [keeping, setKeeping] = useState(false);

  useEffect(() => {
    let shut = false;
    try {
      shut = planEndsAt !== null && sessionStorage.getItem(PLAN_ENDS_CLOSED_KEY) === planEndsAt;
    } catch {
      // Storage blocked: the band shows, and closing it lasts this page.
    }
    setClosed(shut);
  }, [planEndsAt]);

  if (closed !== false || !planEndsAt || !subscriptionActive || !brandsLoaded || demoSelected) {
    return null;
  }
  // Past its end, the read-only band takes over once the webhook ends it.
  if (new Date(planEndsAt).getTime() <= Date.now()) return null;

  const close = () => {
    setClosed(true);
    try {
      sessionStorage.setItem(PLAN_ENDS_CLOSED_KEY, planEndsAt);
    } catch {
      // As above.
    }
  };

  async function keep() {
    setKeeping(true);
    try {
      const res = await fetch('/api/stripe/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactivate: true }),
      });
      if (!res.ok) throw new Error();
      setClosed(true);
      toast.success(tSettings('subscriptionReactivated'));
      // The layout reads the plan again: the band is gone on every page.
      router.refresh();
    } catch {
      toast.error(t('failed'));
    } finally {
      setKeeping(false);
    }
  }

  const date = longDate(planEndsAt);
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
    >
      <CalendarClock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <p className="min-w-0 flex-1 text-amber-900 dark:text-amber-200">
        {subscriptionStatus === 'trialing' ? t('bannerTrial', { date }) : t('banner', { date })}
        {!canAdmin && <> {t('askAdmin')}</>}
      </p>
      {canAdmin && (
        <Button variant="outline" size="sm" onClick={() => void keep()} disabled={keeping}>
          {keeping ? tSettings('processing') : t('keep')}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={close}
        aria-label={t('close')}
        className="text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
