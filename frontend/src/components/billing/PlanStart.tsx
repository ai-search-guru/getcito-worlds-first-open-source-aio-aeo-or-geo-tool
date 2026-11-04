'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, CircleAlert, Loader2, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePlanFeatures } from '@/components/settings/planFeatures';
import {
  FIRST_MONTH_OFFER,
  PLANS,
  SUBSCRIBABLE_PLANS,
  firstMonthOfferOn,
  type PlanId,
} from '@/config/plans';
import {
  FIRST_MONTH_CODE,
  annualSaving,
  choiceMode,
  choicePeriod,
  dueToday,
  periodPrice,
  type BillingInterval,
  type CheckoutMode,
  type StartChoice,
} from '@/lib/billing/planPurchase';
import { discountedPrice, type PromoOffer } from '@/lib/billing/promoCode';
import { TRIAL_DAYS, trialEndDate } from '@/lib/billing/trial';
import { formatMonthDay, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * How a plan starts, the same on the plan dialog (ChoosePlanDialog), on
 * Settings › Billing while no plan is active, and on onboarding's plan step:
 * one choice above the cards (the free trial, monthly with the first-month
 * offer, or a year up front), then on each card what is due today and one
 * button to Stripe Checkout, with a card either way. Buying now gives the
 * full plan from day one; the free trial, for a workspace that never had a
 * plan, comes with limited AI usage and no offer.
 */

/** Dollars as the cards show them: whole dollars bare, anything else to the cent. */
export function money(value: number): string {
  return `$${
    Number.isInteger(value)
      ? formatNumber(value)
      : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }`;
}

/** What a code takes off, for its texts: "50%" or "$10". */
function discountOf(offer: PromoOffer): string {
  return offer.percentOff != null ? `${offer.percentOff}%` : money(offer.amountOff ?? 0);
}

/** The values every promo text reads. */
export function offerValues(offer: PromoOffer) {
  return {
    code: offer.code,
    discount: discountOf(offer),
    duration: offer.duration,
    months: offer.durationInMonths ?? 1,
  };
}

/**
 * A promotion code as Stripe has it now (POST /api/stripe/promo-code): what
 * it takes off, 'invalid' when it can't be redeemed, 'failed' when it
 * couldn't be checked.
 */
export async function checkPromoCode(code: string): Promise<PromoOffer | 'invalid' | 'failed'> {
  try {
    const res = await fetch('/api/stripe/promo-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return 'failed';
    if (!data.valid) return 'invalid';
    return {
      code: data.code,
      percentOff: data.percentOff ?? null,
      amountOff: data.amountOff ?? null,
      duration: data.duration,
      durationInMonths: data.durationInMonths ?? null,
    };
  } catch {
    return 'failed';
  }
}

/** The first-month offer as configured (FIRST_MONTH_OFFER), before Stripe has said anything of it. */
export const CONFIGURED_FIRST_MONTH_OFFER: PromoOffer = {
  code: FIRST_MONTH_CODE,
  percentOff: FIRST_MONTH_OFFER.percentOff,
  amountOff: null,
  duration: 'once',
  durationInMonths: null,
};

/**
 * The code a page's plan prices are shown with, and a way to change it (a
 * code typed, or taken off). For an admin while the first-month offer is on
 * (`applies`), the offer as configured from the first frame, so no price
 * jumps from $49 to $24.50 once Stripe answers. Its code is checked once,
 * the first time `check` holds too: Stripe's own terms replace the
 * configured ones, and a code that can't be redeemed takes the offer away.
 * One that couldn't be checked (Stripe unreachable, or not set up on a local
 * server) keeps it as configured; Checkout applies the code and says so if
 * Stripe turns it down. A code typed or taken off meanwhile stays as it is.
 */
export function useFirstMonthOffer(applies: boolean, check: boolean = applies) {
  // Undefined until something decided: the configured offer while it applies.
  const [decided, setDecided] = useState<PromoOffer | null | undefined>(undefined);
  const tried = useRef(false);
  useEffect(() => {
    if (!applies || !check || tried.current) return;
    tried.current = true;
    void checkPromoCode(FIRST_MONTH_CODE).then((found) => {
      if (found === 'failed') return;
      setDecided((current) =>
        current === undefined ? (found === 'invalid' ? null : found) : current,
      );
    });
  }, [applies, check]);
  const setOffer = useCallback((next: PromoOffer | null) => setDecided(next), []);
  const offer = decided === undefined ? (applies ? CONFIGURED_FIRST_MONTH_OFFER : null) : decided;
  return [offer, setOffer] as const;
}

/**
 * The start selector's choice: Monthly at first, where the first-month
 * offer is. A trial picked falls back to Monthly once the trial isn't
 * offered (a workspace found to have used it).
 */
export function useStartChoice(trialOffered: boolean) {
  const [picked, setPicked] = useState<StartChoice>('month');
  const choice: StartChoice = picked === 'trial' && !trialOffered ? 'month' : picked;
  return [choice, setPicked] as const;
}

/** How long Checkout may take to open before the button gives up and says so. */
const CHECKOUT_TIMEOUT_MS = 30_000;

/**
 * Opens Stripe Checkout for a new subscription: a plan, in `period`, bought
 * now (with `promotionCode`, if any) or as the free trial. A canceled
 * Checkout comes back to Billing, or, without `returnTo`, to onboarding's
 * plan step. A code Stripe turned down since it was applied goes to
 * `onCodeRefused`, so the page can say so by its field; a trial found used
 * goes to `onTrialUsed`. Any failure, or no answer in time, ends the wait:
 * `failed` says why, by the plan's button. `checkout` is the plan whose
 * Checkout is opening, and how it starts.
 */
export function useStartCheckout({
  organizationId,
  period,
  returnTo = 'billing',
  onCodeRefused,
  onTrialUsed,
}: {
  organizationId: string | null;
  period: BillingInterval;
  returnTo?: 'billing' | null;
  onCodeRefused?: (code: string) => void;
  onTrialUsed?: () => void;
}) {
  const tSettings = useTranslations('settings');
  const tOffer = useTranslations('planOffer');
  const [checkout, setCheckout] = useState<{ planId: PlanId; mode: CheckoutMode } | null>(null);
  const [failed, setFailed] = useState<{ planId: PlanId; message: string } | null>(null);

  async function start(planId: PlanId, mode: CheckoutMode, promotionCode?: string) {
    if (!organizationId || checkout) return;
    setCheckout({ planId, mode });
    setFailed(null);
    // Why it didn't open, in words for the person buying: a refusal the
    // route named (a trial used, a subscription there already), or that it
    // couldn't open at all (Stripe down or not set up, no answer in time).
    let message = tSettings('checkoutFailed');
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          organizationId,
          interval: period,
          ...(returnTo ? { returnTo } : {}),
          mode,
          ...(promotionCode ? { promotionCode } : {}),
        }),
        signal:
          typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(CHECKOUT_TIMEOUT_MS)
            : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        // No reset: the page is leaving for Stripe.
        return;
      }
      if (data.code === 'invalid_promo_code' && promotionCode && onCodeRefused) {
        onCodeRefused(promotionCode);
        setCheckout(null);
        return;
      }
      if (data.code === 'trial_unavailable') {
        onTrialUsed?.();
        message = tOffer('trialUsed');
      } else if (res.status < 500 && data.code && data.error) {
        message = data.error;
      }
    } catch {
      // Offline, or no answer in time: the plain message.
    }
    setFailed({ planId, message });
    setCheckout(null);
  }

  return { checkout, failed, start };
}

/**
 * The one choice above the plan cards: the free trial (when `trialOffered`),
 * monthly with what the code takes off (`offer`), or a year up front with
 * its saving. The cards' prices and buttons follow it.
 */
export function StartChoicePicker({
  choice,
  onChange,
  trialOffered,
  offer,
  centered = false,
}: {
  choice: StartChoice;
  onChange: (choice: StartChoice) => void;
  trialOffered: boolean;
  /** The code a monthly plan is bought with, if any. */
  offer: PromoOffer | null;
  /** Centered in its row (onboarding), not at its start. */
  centered?: boolean;
}) {
  const tSettings = useTranslations('settings');
  const tOffer = useTranslations('planOffer');
  const saving = Math.max(0, ...SUBSCRIBABLE_PLANS.map((id) => annualSaving(id) ?? 0));
  const choices: StartChoice[] = trialOffered ? ['trial', 'month', 'year'] : ['month', 'year'];
  const pill = (selected: boolean) =>
    cn(
      'rounded-full bg-emerald-100 px-1.5 text-xs font-medium whitespace-nowrap text-emerald-700 @max-lg:text-[11px] dark:bg-emerald-950/50 dark:text-emerald-400',
      // On the chosen one's light fill (dark theme), a solid ground keeps it legible.
      selected && 'dark:bg-emerald-950',
    );

  // In a narrow space (Billing beside the settings menu) the choices keep one
  // row, each with its word under its name, rather than wrapping.
  return (
    <div className={cn('@container min-w-0 flex-1', centered && 'text-center')}>
      <div
        role="group"
        aria-label={tOffer('choice.label')}
        data-slot="start-choice"
        className="inline-flex rounded-lg border bg-muted/40 p-0.5 @max-lg:grid @max-lg:w-full @max-lg:auto-cols-fr @max-lg:grid-flow-col"
      >
        {choices.map((value) => (
          <button
            key={value}
            type="button"
            data-choice={value}
            aria-pressed={choice === value}
            onClick={() => onChange(value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 @max-lg:flex-col @max-lg:gap-0.5 @max-lg:px-1.5',
              // The chosen one filled, as the site's other toggles (date range,
              // market): dark on light, light on dark.
              choice === value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {value === 'trial'
              ? tOffer('choice.trial', { days: TRIAL_DAYS })
              : value === 'month'
                ? tOffer('choice.month')
                : tOffer('choice.year')}
            {value === 'month' && offer && (
              <span className={pill(choice === value)}>
                {tOffer('choice.monthOffer', offerValues(offer))}
              </span>
            )}
            {value === 'year' && saving > 0 && (
              <span className={pill(choice === value)}>
                {tSettings('savePercent', { percent: saving })}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A plan's price on its card: a year up front against twelve months; with a
 * code on a monthly plan (`discounted`), the first month's price, marked
 * Limited offer for the first-month offer's code; otherwise its monthly price.
 */
export function PlanPrice({
  planId,
  period,
  discounted,
}: {
  planId: PlanId;
  period: BillingInterval;
  /** The code that lowers this period's price: a monthly plan, for an admin. */
  discounted: PromoOffer | null;
}) {
  const tSettings = useTranslations('settings');
  const tPlans = useTranslations('readOnly.plans');
  const tOffer = useTranslations('planOffer');
  const monthly = periodPrice(planId, 'month');
  const price = periodPrice(planId, period);
  const firstPrice = discounted && monthly != null ? discountedPrice(monthly, discounted) : null;

  return (
    <div
      data-slot="plan-price"
      className="flex flex-wrap content-end items-baseline gap-x-1.5 lg:min-h-20"
    >
      {period === 'year' && price != null && monthly != null ? (
        <>
          <span className="text-sm text-muted-foreground line-through">
            <span className="sr-only">{tSettings('regularPrice')} </span>
            {money(monthly * 12)}
          </span>
          <span className="text-3xl font-bold tracking-tight">{money(price)}</span>
          <span className="text-sm text-muted-foreground">/{tSettings('year')}</span>
          <span className="w-full text-xs text-muted-foreground">
            {tPlans('perMonthBilledYearly', {
              price: money(Math.round((price / 12) * 100) / 100),
            })}
          </span>
        </>
      ) : discounted && firstPrice != null && monthly != null ? (
        <>
          <span className="inline-flex w-full flex-wrap items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            {firstMonthOfferOn() && discounted.code.toUpperCase() === FIRST_MONTH_CODE ? (
              <Badge
                data-slot="limited-offer"
                variant="outline"
                className="h-5 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-400"
              >
                {tOffer('limitedOffer')}
              </Badge>
            ) : (
              <Check className="size-3" aria-hidden />
            )}
            {tPlans('promo.deal', offerValues(discounted))}
          </span>
          <span className="text-sm text-muted-foreground line-through">
            <span className="sr-only">{tSettings('regularPrice')} </span>
            {money(monthly)}
          </span>
          <span className="text-3xl font-bold tracking-tight">{money(firstPrice)}</span>
          <span className="text-sm text-muted-foreground">
            {tPlans('promo.per', offerValues(discounted))}
          </span>
          {discounted.duration !== 'forever' && (
            <span className="w-full text-xs text-muted-foreground">
              {tPlans('promo.then', { price: money(monthly) })}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="text-3xl font-bold tracking-tight">
            {price != null ? money(price) : '—'}
          </span>
          <span className="text-sm text-muted-foreground">/{tSettings('month')}</span>
        </>
      )}
    </div>
  );
}

/**
 * How a plan starts with the choice made above the cards, for an admin: what
 * is due today (nothing for the free trial, which says when it ends and what
 * it costs then; the first month with the code on a monthly plan), one
 * button to Stripe Checkout, and a word on that checkout beside it — or,
 * once Checkout didn't open, why.
 */
export function PlanStart({
  planId,
  choice,
  offer,
  trialOffered,
  opening,
  disabled,
  error = null,
  onStart,
}: {
  planId: PlanId;
  choice: StartChoice;
  /** The code a monthly plan is bought with, if any. */
  offer: PromoOffer | null;
  /** The workspace never had a plan: buying now says it's the full plan. */
  trialOffered: boolean;
  /** How this plan's Checkout is opening, if it is. */
  opening: CheckoutMode | null;
  disabled: boolean;
  /** Why this plan's Checkout didn't open, the last time it was tried. */
  error?: string | null;
  onStart: (mode: CheckoutMode) => void;
}) {
  const tSettings = useTranslations('settings');
  const tPlans = useTranslations('readOnly.plans');
  const tOffer = useTranslations('planOffer');
  const plan = PLANS[planId];
  const mode = choiceMode(choice);
  const due = dueToday(planId, choice, offer);
  const monthly = periodPrice(planId, 'month');

  return (
    <div className="space-y-2">
      {/* Tall enough for the trial's terms, so a choice never moves the button. */}
      <div
        data-slot="due-today"
        className="min-h-[4.25rem] rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
      >
        <p className="flex items-baseline justify-between gap-2">
          <span>{tOffer('dueToday')}</span>
          <span data-slot="due-amount" className="text-sm font-semibold text-foreground">
            {due != null ? money(due) : '—'}
          </span>
        </p>
        {choice === 'trial' ? (
          <p data-slot="start-terms" className="mt-0.5">
            {tOffer('freeUntil', {
              date: formatMonthDay(trialEndDate().toISOString()),
              price: monthly != null ? money(monthly) : '—',
            })}
            <span className="block">{tOffer('limitedAi', { days: TRIAL_DAYS })}</span>
          </p>
        ) : (
          trialOffered && (
            <p data-slot="start-terms" className="mt-0.5">
              {tOffer('fullPlan')}
            </p>
          )
        )}
      </div>
      <Button
        data-mode={mode}
        className="h-9 w-full"
        variant={plan.highlighted ? 'default' : 'outline'}
        disabled={disabled}
        onClick={() => onStart(mode)}
      >
        {opening ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {tPlans('openingCheckout')}
          </>
        ) : mode === 'trial' ? (
          tOffer('startTrial', { days: TRIAL_DAYS })
        ) : offer && choice === 'month' ? (
          tOffer('buyNow')
        ) : (
          tSettings('choosePlanFor', { plan: plan.name })
        )}
      </Button>
      {error ? (
        <p
          role="alert"
          data-slot="checkout-error"
          className="flex items-start justify-center gap-1 text-center text-xs text-destructive"
        >
          <CircleAlert className="mt-px size-3 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        <p data-slot="trust-line" className="text-center text-xs text-muted-foreground">
          <Lock className="-mt-0.5 mr-1 inline size-3" aria-hidden />
          {/* It breaks between its two parts, never inside one. */}
          {tOffer.rich('trustLine', {
            part: (chunks) => <span className="whitespace-nowrap">{chunks}</span>,
          })}
        </p>
      )}
    </div>
  );
}

/** "Show plan details" under the plan cards: what each plan is for and includes, in the cards. */
export function PlanDetailsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const tOffer = useTranslations('planOffer');
  return (
    <button
      type="button"
      data-slot="plan-details-toggle"
      aria-expanded={open}
      onClick={onToggle}
      className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {open ? tOffer('hideDetails') : tOffer('showDetails')}
      <ChevronDown
        className={cn('size-3.5 transition-transform', open && 'rotate-180')}
        aria-hidden
      />
    </button>
  );
}

/**
 * A plan card's body with its details in the same place: the price and the
 * way to start (`children`), or, with `details`, what the plan is for and
 * includes (`info`). Both share one grid cell, the one not shown invisible,
 * so the card is as tall either way and nothing around it moves.
 */
export function PlanDetailsStack({
  details,
  info,
  children,
}: {
  details: boolean;
  info: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid flex-1">
      <div className={cn('col-start-1 row-start-1 flex flex-col gap-3', details && 'invisible')}>
        {children}
      </div>
      <div
        data-slot="plan-details"
        className={cn('col-start-1 row-start-1', !details && 'invisible')}
      >
        {info}
      </div>
    </div>
  );
}

/** What a plan is for and its points, small, as a card's details show them. */
export function PlanDetailsList({
  tagline,
  points,
}: {
  tagline: string;
  points: { text: string; hint?: string }[];
}) {
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">{tagline}</p>
      <ul className="space-y-1">
        {points.map((point) => (
          <li key={point.text} className="flex items-start gap-1.5">
            <Check className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span
              title={point.hint}
              className={
                point.hint
                  ? 'cursor-help underline decoration-dotted underline-offset-4'
                  : undefined
              }
            >
              {point.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A plan's card where a plan starts (the plan dialog, Billing with no plan
 * active, onboarding's plan step): its name, then its price for the choice
 * made and how it starts (`children`: PlanStart for an admin, a word for
 * another member) — or, with `details`, what it is for and the features
 * Billing lists, in the same space.
 */
export function PlanStartCard({
  planId,
  choice,
  offer,
  details,
  children,
}: {
  planId: PlanId;
  choice: StartChoice;
  /** The code a monthly plan is bought with, if any. */
  offer: PromoOffer | null;
  /** The plan's details in place of its price and button. */
  details: boolean;
  children: ReactNode;
}) {
  const tSettings = useTranslations('settings');
  const tCards = useTranslations('settings.planCards');
  const planFeatures = usePlanFeatures();
  const headingId = useId();
  const plan = PLANS[planId];

  return (
    <section
      data-plan={planId}
      aria-labelledby={headingId}
      className={cn(
        'relative flex flex-col gap-3 rounded-xl border bg-card p-4',
        plan.highlighted && 'border-primary ring-1 ring-primary',
      )}
    >
      {plan.highlighted && (
        <Badge className="absolute -top-2.5 left-4">{tSettings('popular')}</Badge>
      )}
      <h3 id={headingId} className="text-base font-semibold">
        {plan.name}
      </h3>
      <PlanDetailsStack
        details={details}
        info={
          <PlanDetailsList tagline={tCards(`${planId}.tagline`)} points={planFeatures(planId)} />
        }
      >
        <PlanPrice
          planId={planId}
          period={choicePeriod(choice)}
          discounted={choice === 'month' ? offer : null}
        />
        {children}
      </PlanDetailsStack>
    </section>
  );
}
