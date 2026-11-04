'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, CreditCard, Lock, Mail, Play, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { aiUsageMultiple, usePlanCardsChatMetered } from '@/components/settings/planFeatures';
import {
  CONTACT_SALES_URL,
  CUSTOM_PLAN_STARTING_PRICE,
  PRICING_URL,
  SUBSCRIBABLE_PLANS,
  firstMonthOfferOn,
} from '@/config/plans';
import { useUserRole } from '@/hooks/useUserRole';
import { FIRST_MONTH_CODE, choicePeriod, periodPrice } from '@/lib/billing/planPurchase';
import { ownBrandOf, type DemoOffer } from '@/lib/demo/demoBrand';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';
import {
  PlanDetailsList,
  PlanDetailsStack,
  PlanDetailsToggle,
  PlanStart,
  PlanStartCard,
  StartChoicePicker,
  checkPromoCode,
  money,
  offerValues,
  useFirstMonthOffer,
  useStartChoice,
  useStartCheckout,
} from './PlanStart';

type CodeError = { kind: 'invalid'; code: string } | { kind: 'failed' };

/**
 * The offer the dialog makes with its plans: from the demo brand (the free
 * trial for a workspace that never subscribed, 50% off the first month once
 * a plan ended), or the free trial for a workspace's own brand, never
 * tracked yet. Each comes with the first-month code.
 */
export type PlanPitch = { from: 'demo'; offer: DemoOffer } | { from: 'own_brand'; offer: 'trial' };

const PROMO_INPUT_ID = 'upgrade-promo-code';
const PROMO_NOTE_ID = 'upgrade-promo-note';

/**
 * "Choose a plan to keep going", for a workspace whose plan ended: Starter
 * and Growth with Billing's own features and prices, and Custom through
 * sales. One choice above the cards says how the plan starts, and each card
 * then shows what is due today and one button to Stripe Checkout, from a
 * card. An admin can apply a promotion code behind "Have a code?" (checked
 * with Stripe, monthly plans only); another member is asked to turn to an
 * admin and sees the plain prices. ×, Escape or a click outside close it.
 *
 * The ways to start, each with a card. Monthly or a year up front: the full
 * plan from day one, with the first-month offer on a monthly plan
 * (FIRST_MONTH_OFFER), applied for an admin from the first frame; without it
 * (the offer off, a year, a code Stripe refused) the button is the plain
 * Choose {plan}. And, for a workspace that never had a subscription
 * (`pitch.offer` 'trial'), the free trial, with no offer and limited AI
 * usage. A `pitch` also says where the dialog was opened from: the demo
 * brand, or a brand never tracked; either names the workspace's own brand
 * once it has one.
 */
export function ChoosePlanDialog({
  open,
  onOpenChange,
  action,
  askAdmin,
  organizationId,
  pitch = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What was clicked ("Adding prompts needs a plan"); none from the banner. */
  action: string | null;
  /** What a member who isn't an admin is asked to do. */
  askAdmin: string;
  /** The organization the new subscription is for. */
  organizationId: string | null;
  /** The offer its title and buttons make, besides the plans. */
  pitch?: PlanPitch | null;
}) {
  const t = useTranslations('readOnly');
  const tPlans = useTranslations('readOnly.plans');
  const tSettings = useTranslations('settings');
  const chatMetered = usePlanCardsChatMetered();
  const tOffer = useTranslations('planOffer');
  const { canAdmin } = useUserRole();
  // The workspace's own brand, named in the demo's and a new brand's pitch.
  const ownBrand = useBrandStore((s) => ownBrandOf(s)?.name ?? null);

  const [codeInput, setCodeInput] = useState('');
  // The code field, behind "Have a code?" until asked for.
  const [codeOpen, setCodeOpen] = useState(false);
  // A code the admin typed (not the first-month offer applied for them):
  // its note says what it does.
  const [codeTyped, setCodeTyped] = useState(false);
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<CodeError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const demo = pitch?.from === 'demo';
  // The free trial: for a workspace that never had a subscription.
  const trialOffered = pitch?.offer === 'trial';

  // The code the prices are shown with: for an admin, the first-month offer
  // from the first frame, its code tried once the first time the dialog opens.
  const [shownOffer, setOffer] = useFirstMonthOffer(firstMonthOfferOn() && canAdmin, open);
  // Only an admin buys, so only an admin's prices take a code.
  const offer = canAdmin ? shownOffer : null;
  const [choice, setChoice] = useStartChoice(trialOffered && canAdmin);
  const period = choicePeriod(choice);
  // The plans' details (what each is for and includes), in the cards.
  const [details, setDetails] = useState(false);
  const { checkout, failed, start } = useStartCheckout({
    organizationId,
    period,
    // The code stopped working since it was applied: say so by the field.
    onCodeRefused: (code) => {
      setOffer(null);
      setCodeInput(code);
      setCodeOpen(true);
      setCodeError({ kind: 'invalid', code: code.toUpperCase() });
    },
  });

  async function applyCode(event: FormEvent) {
    event.preventDefault();
    const typed = codeInput.trim();
    if (!typed) {
      inputRef.current?.focus();
      return;
    }
    setChecking(true);
    setCodeError(null);
    const found = await checkPromoCode(typed);
    if (found === 'invalid') setCodeError({ kind: 'invalid', code: typed.toUpperCase() });
    else if (found === 'failed') setCodeError({ kind: 'failed' });
    else {
      setOffer(found);
      setCodeTyped(true);
    }
    setChecking(false);
  }

  /** "Have a code?": the field, ready to type in. */
  function openCode() {
    setCodeOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function removeCode() {
    setOffer(null);
    setCodeTyped(false);
    setCodeInput('');
    // The field is back once the chip is gone.
    openCode();
  }

  // The line under the controls, for a code typed: what it does with the
  // choice made, or why it was refused. The first-month offer applied for
  // the admin says so on the choice itself.
  const note =
    offer && codeTyped && choice !== 'month' ? (
      <p className="flex flex-wrap items-center gap-x-1.5 text-amber-700 dark:text-amber-400">
        {tPlans('promo.monthlyOnly', offerValues(offer))}
        <button
          type="button"
          onClick={() => setChoice('month')}
          className="rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {tPlans('promo.switchToMonthly')}
        </button>
      </p>
    ) : offer && codeTyped ? (
      <p className="text-emerald-700 dark:text-emerald-400">
        {tPlans('promo.appliedNote', offerValues(offer))}
      </p>
    ) : codeError ? (
      <p className="text-destructive">
        {codeError.kind === 'invalid'
          ? tPlans('promo.invalid', { code: codeError.code })
          : tPlans('promo.failed')}
      </p>
    ) : null;

  const aiMultiple = aiUsageMultiple('enterprise');
  const customPoints = tSettings.raw('customPlanPoints') as string[];
  // With the new Chat on, its points follow the AI usage they draw on.
  const customChatPoints = chatMetered ? (tSettings.raw('customPlanPointsChat') as string[]) : [];
  // Custom's list as the pricing page has it: its AI usage after the data points.
  const customFeatures = aiMultiple
    ? [
        ...customPoints.slice(0, 4),
        tPlans('customAiUsage', { count: aiMultiple }),
        ...customChatPoints,
        ...customPoints.slice(4),
      ]
    : [...customChatPoints, ...customPoints];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Sized to show everything at once on a laptop (1024×768 and up): the
          plans' details open inside the cards, never below them. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-5 sm:max-w-[min(62.5rem,calc(100%-2rem))] sm:p-6">
        <DialogHeader className="gap-1 pr-8">
          <span
            data-slot="upgrade-action"
            className="mb-1.5 inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground"
          >
            {demo ? (
              <Play className="size-3" aria-hidden />
            ) : (
              <Lock className="size-3" aria-hidden />
            )}
            {action ?? t('dialog.readOnlyLabel')}
          </span>
          <DialogTitle className="text-xl leading-tight font-bold tracking-tight">
            {pitch?.from === 'demo'
              ? ownBrand
                ? t('demo.dialog.titleFor', { brand: ownBrand })
                : t('demo.dialog.title')
              : pitch?.from === 'own_brand'
                ? t('trialOffer.title')
                : t('dialog.title.ended')}
          </DialogTitle>
          <DialogDescription className="max-w-2xl">
            {demo
              ? ownBrand
                ? t('demo.dialog.bodyFor', { brand: ownBrand })
                : t('demo.dialog.body')
              : pitch?.from === 'own_brand'
                ? ownBrand
                  ? t('trialOffer.bodyFor', { brand: ownBrand })
                  : t('trialOffer.body')
                : t('dialog.body.ended')}
          </DialogDescription>
        </DialogHeader>

        {!canAdmin && (
          <p
            data-slot="member-note"
            className="mt-4 flex items-start gap-2 rounded-lg border bg-muted/30 px-3.5 py-2.5 text-sm"
          >
            <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              {t('dialog.memberNote')} {askAdmin}
            </span>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {/* How the plan starts: the trial, monthly with the offer, or a year */}
          <StartChoicePicker
            choice={choice}
            onChange={setChoice}
            trialOffered={trialOffered && canAdmin}
            offer={offer}
          />

          {canAdmin &&
            (offer ? (
              <span
                data-slot="promo-applied"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 pr-1 pl-2.5 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400"
              >
                <Tag className="size-3.5" aria-hidden />
                {tPlans('promo.applied', offerValues(offer))}
                <button
                  type="button"
                  aria-label={tPlans('promo.remove')}
                  onClick={removeCode}
                  className="grid size-6 place-items-center rounded-full outline-none hover:bg-emerald-100 focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-emerald-900/40"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ) : !codeOpen ? (
              <button
                type="button"
                data-slot="have-code"
                onClick={openCode}
                className="rounded-sm text-xs text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {tOffer('haveCode')}
              </button>
            ) : (
              <form onSubmit={applyCode} autoComplete="off" className="flex items-center gap-2">
                <label htmlFor={PROMO_INPUT_ID} className="text-xs text-muted-foreground">
                  {tSettings('promoCode')}
                </label>
                <Input
                  ref={inputRef}
                  id={PROMO_INPUT_ID}
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value);
                    if (codeError) setCodeError(null);
                  }}
                  placeholder={FIRST_MONTH_CODE}
                  spellCheck={false}
                  aria-invalid={codeError?.kind === 'invalid' || undefined}
                  aria-describedby={PROMO_NOTE_ID}
                  className="w-32 uppercase"
                />
                <Button type="submit" variant="outline" disabled={checking}>
                  {checking ? tPlans('promo.checking') : tPlans('promo.apply')}
                </Button>
              </form>
            ))}
        </div>
        {/* Always there, so a screen reader hears what the code did. */}
        {canAdmin && (
          <div id={PROMO_NOTE_ID} role="status" aria-live="polite" className="text-xs">
            {note && <div className="mt-2">{note}</div>}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {SUBSCRIBABLE_PLANS.map((planId) => (
            <PlanStartCard
              key={planId}
              planId={planId}
              choice={choice}
              offer={offer}
              details={details}
            >
              {canAdmin ? (
                <PlanStart
                  planId={planId}
                  choice={choice}
                  offer={offer}
                  trialOffered={trialOffered}
                  opening={checkout?.planId === planId ? checkout.mode : null}
                  disabled={
                    periodPrice(planId, period) == null || !organizationId || checkout != null
                  }
                  error={failed?.planId === planId ? failed.message : null}
                  // A code goes with buying monthly only: the trial comes without an offer.
                  onStart={(mode) =>
                    void start(
                      planId,
                      mode,
                      mode === 'buy' && choice === 'month' ? offer?.code : undefined,
                    )
                  }
                />
              ) : (
                <p
                  data-slot="ask-admin"
                  className="flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-center text-xs text-muted-foreground"
                >
                  <Lock className="size-3.5 shrink-0" aria-hidden />
                  {tPlans('askAdmin')}
                </p>
              )}
            </PlanStartCard>
          ))}

          {/* Custom: priced with sales, from the pricing page's points */}
          <section
            data-plan="custom"
            aria-labelledby="upgrade-plan-custom"
            className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4"
          >
            <h3 id="upgrade-plan-custom" className="text-base font-semibold">
              {tPlans('customName')}
            </h3>
            <PlanDetailsStack
              details={details}
              info={
                <PlanDetailsList
                  tagline={tPlans('customTagline')}
                  points={customFeatures.map((text) => ({ text }))}
                />
              }
            >
              <div className="flex flex-wrap content-end items-baseline gap-x-1.5 lg:min-h-20">
                <span className="w-full text-sm text-muted-foreground">{tPlans('startingAt')}</span>
                <span className="text-3xl font-bold tracking-tight">
                  {money(CUSTOM_PLAN_STARTING_PRICE)}
                </span>
                <span className="text-sm text-muted-foreground">/{tSettings('month')}</span>
              </div>
              <p className="text-xs text-muted-foreground">{tPlans('customTagline')}</p>
              <a
                href={CONTACT_SALES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: 'outline' }), 'h-9 w-full')}
              >
                <Mail aria-hidden />
                {tPlans('contactUs')}
              </a>
            </PlanDetailsStack>
          </section>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {canAdmin && (
              <span data-slot="card-note" className="inline-flex items-center gap-1.5">
                <CreditCard className="size-3.5" aria-hidden />
                {tOffer('cardNote', { both: trialOffered ? 'yes' : 'no' })}
              </span>
            )}
            {tPlans('pricesInUsd')}
          </span>
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
            <PlanDetailsToggle open={details} onToggle={() => setDetails((open) => !open)} />
            <a
              href={PRICING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
            >
              {tSettings('seeAllPlanFeatures')}
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
