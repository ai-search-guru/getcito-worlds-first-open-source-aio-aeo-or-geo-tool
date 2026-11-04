'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingDots } from '@/components/ui/loading-dots';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import { useUserRole } from '@/hooks/useUserRole';
import { useRouter } from '@/i18n/navigation';
import { PLANS, SUBSCRIBABLE_PLANS, firstMonthOfferOn, type PlanId } from '@/config/plans';
import {
  FIRST_MONTH_CODE,
  firstMonthPrice,
  periodPrice,
  type BillingInterval,
} from '@/lib/billing/planPurchase';
import { PLAN_STARTED_EVENT } from '@/lib/billing/planStarted';
import { formatNumber } from '@/lib/format';

/** The trial's subscription, as GET /api/stripe/subscription answers. */
interface TrialSubscription {
  planId: string;
  status: string;
  interval: string | null;
}

/** A price as Billing writes it: whole dollars bare, cents to two places. */
const money = (amount: number) =>
  Number.isInteger(amount) ? formatNumber(amount) : amount.toFixed(2);

/**
 * "Start my plan now" in a free trial (trial AI credit, 2026-10-29): the
 * trial ends today on its own plan and period, the card added for the trial
 * pays at once, as Billing's Buy now does, and the plan's full monthly AI
 * usage starts from 0. A dialog names the plan, what is charged today and
 * that the trial ends now; nothing to type, the card is on file. The
 * first-month offer goes with a monthly plan, as Billing fills it in. Buying
 * is an admin's, as the subscription route checks: nothing for other members.
 */
export function StartPlanNow({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const [open, setOpen] = useState(false);
  const { canAdmin } = useUserRole();
  if (!canAdmin) return null;
  return (
    <>
      <StartPlanNowButton variant={variant} onClick={() => setOpen(true)} />
      <StartPlanNowDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * The button alone, for a popover: the popover closes as the dialog opens,
 * so the dialog lives outside it (StartPlanNowDialog, beside the popover).
 */
export function StartPlanNowButton({
  variant = 'default',
  onClick,
}: {
  variant?: 'default' | 'outline';
  onClick: () => void;
}) {
  const t = useTranslations('aiUsage.startNow');
  return (
    <Button size="sm" variant={variant} onClick={onClick}>
      {t('button')}
    </Button>
  );
}

/** Start my plan now's dialog: it reads the trial's plan each time it opens. */
export function StartPlanNowDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('aiUsage.startNow');
  const tSettings = useTranslations('settings');
  const { refresh: refreshAiUsage } = useAiUsage();
  // The layout reads the plan again: the trial's notes go.
  const router = useRouter();
  // Undefined while it is read; null when it can't be.
  const [sub, setSub] = useState<TrialSubscription | null | undefined>(undefined);
  // The first-month offer, until Stripe turns its code down.
  const [offer, setOffer] = useState(firstMonthOfferOn());
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch('/api/stripe/subscription')
      .then((res) => (res.ok ? (res.json() as Promise<TrialSubscription>) : null))
      .then((read) => {
        if (!cancelled) setSub(read && !('error' in read) ? read : null);
      })
      .catch(() => {
        if (!cancelled) setSub(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);
  // Closed, the next opening reads the plan afresh.
  const setOpen = (next: boolean) => {
    onOpenChange(next);
    if (!next) setSub(undefined);
  };

  const planId = SUBSCRIBABLE_PLANS.find((id) => id === sub?.planId) as PlanId | undefined;
  const interval: BillingInterval = sub?.interval === 'year' ? 'year' : 'month';
  const price = planId ? periodPrice(planId, interval) : null;
  const withOffer = offer && interval === 'month';
  const today = price === null ? null : withOffer ? firstMonthPrice(price) : price;

  async function openPortal() {
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      window.location.href = body.url;
    } catch {
      toast.error(t('failed'));
    }
  }

  async function start() {
    if (!planId) return;
    setStarting(true);
    try {
      const res = await fetch('/api/stripe/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPlanId: planId,
          interval,
          buyNow: true,
          ...(withOffer ? { promoCode: FIRST_MONTH_CODE } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A declined card, or one its bank wants confirmed: the trial carries
        // on, and Stripe's billing page is where the card is changed.
        if (body.code === 'payment_failed') {
          toast.error(body.error || tSettings('paymentFailed'), {
            description: tSettings('paymentFailedHint'),
            action: { label: tSettings('updateCard'), onClick: () => void openPortal() },
          });
          return;
        }
        // The offer's code is off in Stripe: the dialog shows the full price
        // to confirm again, rather than charge it unasked.
        if (body.code === 'invalid_promo_code') {
          setOffer(false);
          toast.error(t('offerGone'));
          return;
        }
        throw new Error(body.error);
      }
      setOpen(false);
      window.dispatchEvent(new CustomEvent(PLAN_STARTED_EVENT, { detail: body }));
      router.refresh();
      refreshAiUsage();
      toast.success(tSettings('planBought', { plan: PLANS[planId].name }));
    } catch {
      toast.error(t('failed'));
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !starting && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {planId ? t('title', { plan: PLANS[planId].name }) : t('titleNoPlan')}
            </DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          {sub === undefined ? (
            <p className="py-2 text-sm text-muted-foreground">
              <LoadingDots />
            </p>
          ) : sub === null || !planId || price === null || today === null ? (
            <p className="text-sm text-muted-foreground">{t('unreadable')}</p>
          ) : sub.status !== 'trialing' ? (
            <p className="text-sm text-muted-foreground">{t('notTrialing')}</p>
          ) : (
            <dl className="divide-y rounded-lg border text-sm">
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">{t('plan')}</dt>
                <dd className="font-medium">
                  {t('planValue', { plan: PLANS[planId].name, interval })}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">{t('today')}</dt>
                <dd className="text-right">
                  <span className="font-medium tabular-nums">${money(today)}</span>
                  {withOffer && (
                    <span className="block text-xs text-muted-foreground">
                      {t('thenMonthly', { price: money(price) })}
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">{t('trial')}</dt>
                <dd className="font-medium">{t('endsNow')}</dd>
              </div>
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={starting}>
              {t('notNow')}
            </Button>
            <Button
              onClick={() => void start()}
              disabled={starting || !planId || today === null || sub?.status !== 'trialing'}
            >
              {starting ? tSettings('processing') : t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
