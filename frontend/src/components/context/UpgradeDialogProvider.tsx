'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePlanContext } from '@/components/context/PlanProvider';
import { useDemoBrand } from '@/components/context/DemoBrandProvider';
import { useUserRole } from '@/hooks/useUserRole';
import { isSubscriptionInactive } from '@/lib/apiFailure';
import {
  readOnlyReason,
  type ReadOnlyReason,
  type UpgradeReason,
} from '@/lib/billing/subscriptionAccess';
import { openBillingPortal } from '@/lib/billing/portalClient';
import { demoActionName, type DemoOffer } from '@/lib/demo/demoBrand';
import { useBrandStore } from '@/state/useBrandStore';
import { ChoosePlanDialog } from '@/components/billing/ChoosePlanDialog';
import { CHOOSE_PLAN_HREF, UpgradeDialogContext } from './upgradeGate';

// The context and its hooks live in ./upgrade-gate, free of this file's UI,
// so a component that only gates an action doesn't load the dialog.
export { CHOOSE_PLAN_HREF, useUpgradeDialog, useUpgradeGate } from './upgradeGate';

/**
 * GetCito Cloud's read-only mode: a workspace whose trial ended or whose
 * plan was canceled can still open every page, but an action (anything that
 * writes, runs or spends) opens "Choose a plan to keep going" instead. The dialog
 * closes with its ×, Escape or a click outside, and opens again on the next
 * action, until a plan is bought. Admins choose a plan there and pay on
 * Stripe's Checkout; other members are asked to turn to an admin. A payment
 * being retried asks for the payment method instead. Self-hosted is never
 * locked.
 *
 * The demo brand (sample data) is locked the same way, whatever the plan:
 * its dialog makes the demo's offer (the free trial for a workspace that
 * never subscribed, 50% off the first month for one whose plan ended), or,
 * with a plan active, points back to the workspace's own brand.
 *
 * A server action the server refused (assertWritable: read-only, or the demo
 * brand) that no caller caught opens the dialog too: the plan can end while
 * a page is open, before its buttons know.
 */
export function UpgradeDialogProvider({
  adminName = null,
  organizationId = null,
  children,
}: {
  adminName?: string | null;
  /** The workspace's organization, which a plan chosen in the dialog is for. */
  organizationId?: string | null;
  children: ReactNode;
}) {
  const { subscriptionActive, subscriptionStatus } = usePlanContext();
  const { isDemo, offer, neverSubscribed } = useDemoBrand();
  const [open, setOpen] = useState(false);
  // What was clicked, for the dialog's label; none when it wasn't said.
  const [action, setAction] = useState<string | null>(null);
  const openUpgrade = useCallback((label?: string) => {
    // Only a label given: a handler passing its click event gives none.
    setAction(typeof label === 'string' && label ? label : null);
    setOpen(true);
  }, []);
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isSubscriptionInactive(event.reason)) return;
      event.preventDefault();
      openUpgrade();
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, [openUpgrade]);
  const value = useMemo(() => {
    const lapsed = readOnlyReason(subscriptionStatus);
    // A payment being retried is fixed in Billing, demo brand or not: a plan
    // bought from the demo's offer would be a second subscription. A
    // workspace that never subscribed is offered its free trial.
    const reason: UpgradeReason =
      isDemo && (subscriptionActive || lapsed !== 'payment_failed')
        ? 'demo'
        : lapsed === 'ended' && neverSubscribed
          ? 'trial'
          : lapsed;
    return {
      isLocked: !subscriptionActive || isDemo,
      isDemo,
      reason,
      adminName,
      openUpgrade,
    };
  }, [subscriptionActive, subscriptionStatus, isDemo, neverSubscribed, adminName, openUpgrade]);

  return (
    <UpgradeDialogContext.Provider value={value}>
      {children}
      <UpgradeDialog
        open={open}
        onOpenChange={setOpen}
        reason={value.reason}
        adminName={adminName}
        action={action}
        organizationId={organizationId}
        offer={offer}
        subscriptionActive={subscriptionActive}
      />
    </UpgradeDialogContext.Provider>
  );
}

/**
 * What a member who isn't an admin is asked to do: have an admin choose a
 * plan, or update the payment method; by the admin's name when known.
 */
export function useAskAdmin(reason: UpgradeReason, adminName: string | null): string {
  const t = useTranslations('readOnly.ask');
  return adminName ? t(`${reason}Named`, { name: adminName }) : t(reason);
}

/**
 * An admin's way out: Choose a plan in Billing once the plan ended; Update
 * payment method (Stripe's billing page) while a payment is being retried,
 * since a second plan would mean a second subscription.
 */
export function ReadOnlyAction({
  reason,
  variant = 'default',
  size = 'default',
  onChoose,
}: {
  reason: ReadOnlyReason;
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm';
  /** Called as the admin leaves for Billing: the dialog closes. */
  onChoose?: () => void;
}) {
  const t = useTranslations('readOnly');
  const [opening, setOpening] = useState(false);
  if (reason === 'payment_failed') {
    return (
      <Button
        variant={variant}
        size={size}
        disabled={opening}
        onClick={() => {
          setOpening(true);
          openBillingPortal().catch(() => {
            toast.error(t('portalFailed'));
            setOpening(false);
          });
        }}
      >
        {t('updatePayment')}
      </Button>
    );
  }
  return (
    <Link href={CHOOSE_PLAN_HREF} className={buttonVariants({ variant, size })} onClick={onChoose}>
      {t('choosePlan')}
    </Link>
  );
}

/**
 * The workspace is read-only: once the plan ended, "Choose a plan to keep
 * going" with the plans (ChoosePlanDialog); while a payment is being
 * retried, what was clicked when the caller said and the one thing to do,
 * update the payment method. On the demo brand, the plans with the demo's
 * offer, its label naming what was clicked as something that "works on your
 * own brand"; with a plan already active, the way back to that brand.
 */
function UpgradeDialog({
  open,
  onOpenChange,
  reason,
  adminName,
  action,
  organizationId,
  offer,
  subscriptionActive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: UpgradeReason;
  adminName: string | null;
  action: string | null;
  organizationId: string | null;
  offer: DemoOffer;
  subscriptionActive: boolean;
}) {
  const t = useTranslations('readOnly');
  const { canAdmin } = useUserRole();
  const ask = useAskAdmin(reason, adminName);

  if (reason === 'demo') {
    const label = action
      ? t('demo.dialog.action', { action: demoActionName(action) })
      : t('demo.dialog.label');
    return subscriptionActive ? (
      <DemoOwnBrandDialog open={open} onOpenChange={onOpenChange} label={label} />
    ) : (
      <ChoosePlanDialog
        open={open}
        onOpenChange={onOpenChange}
        action={label}
        askAdmin={ask}
        organizationId={organizationId}
        pitch={{ from: 'demo', offer }}
      />
    );
  }

  if (reason === 'trial') {
    return (
      <ChoosePlanDialog
        open={open}
        onOpenChange={onOpenChange}
        action={action ?? t('trialOffer.label')}
        askAdmin={ask}
        organizationId={organizationId}
        pitch={{ from: 'own_brand', offer: 'trial' }}
      />
    );
  }

  if (reason === 'ended') {
    return (
      <ChoosePlanDialog
        open={open}
        onOpenChange={onOpenChange}
        action={action}
        askAdmin={ask}
        organizationId={organizationId}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          {action && (
            <Badge variant="secondary" className="w-fit" data-slot="upgrade-action">
              {action}
            </Badge>
          )}
          <DialogTitle>{t(`dialog.title.${reason}`)}</DialogTitle>
          <DialogDescription>{t(`dialog.body.${reason}`)}</DialogDescription>
        </DialogHeader>
        {!canAdmin && <p className="text-sm">{ask}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('dialog.notNow')}</DialogClose>
          {canAdmin && <ReadOnlyAction reason={reason} onChoose={() => onOpenChange(false)} />}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The demo brand while the workspace's plan is active: nothing runs on its
 * sample data, and the same action works on the workspace's own brand,
 * one click away.
 */
function DemoOwnBrandDialog({
  open,
  onOpenChange,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
}) {
  const t = useTranslations('readOnly');
  const ownBrandId = useBrandStore((s) => s.brands.find((b) => !b.isDemo)?.id ?? null);
  const setActiveBrand = useBrandStore((s) => s.setActiveBrand);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <Badge variant="secondary" className="w-fit" data-slot="upgrade-action">
            {label}
          </Badge>
          <DialogTitle>{t('demo.ownBrand.title')}</DialogTitle>
          <DialogDescription>{t('demo.ownBrand.body')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('dialog.notNow')}</DialogClose>
          {ownBrandId && (
            <Button
              onClick={() => {
                setActiveBrand(ownBrandId);
                onOpenChange(false);
              }}
            >
              {t('demo.switchToOwnBrand')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
