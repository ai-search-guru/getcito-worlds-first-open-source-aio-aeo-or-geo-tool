'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { PLANS } from '@/config/plans';
import { aiUsageTone, percentLabel } from '@/lib/billing/aiUsage';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import type { PlanCard, PlanChip } from '@/lib/chat/access';
import { cn } from '@/lib/utils';
import { AskAdminButton } from './AskAdminButton';

const BILLING = '/dashboard/settings/billing';

/**
 * "Your plan" (CHAT-20 §7a, mockup .planstrip): the plan and its price,
 * what it includes, AI usage as a percentage, and what the next plan would
 * add. No upsell on Enterprise. Admins get Upgrade; the others Ask your
 * Admin in its place.
 */
export function YourPlanCard({ plan, isAdmin }: { plan: PlanCard; isAdmin: boolean }) {
  const t = useTranslations('chatAccess.plan');
  const tUsage = useTranslations('aiUsage');
  const tAsk = useTranslations('chatAccess.askAdmin');
  const format = useFormatter();
  const { usage } = useAiUsage();
  const money = (value: number) =>
    format.number(value, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const planName = (id: keyof typeof PLANS) => PLANS[id].name;

  const chipLabel = (chip: PlanChip) => {
    switch (chip.key) {
      case 'platforms':
        return t('chips.platforms', { count: chip.count });
      case 'mcp':
        return t('chips.mcp', { access: chip.access });
      default:
        return t(`chips.${chip.key}`);
    }
  };
  const lockText = (chip: PlanChip) =>
    chip.locked
      ? plan.isTrial && chip.key === 'mcp'
        ? t('lockedTrial', { plan: planName(chip.locked) })
        : t('locked', { plan: planName(chip.locked), current: plan.planName })
      : undefined;

  const next = plan.next;
  return (
    <section
      aria-label={t('yourPlan')}
      className="overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-center">
        <div>
          <p className="text-xs text-muted-foreground">{t('yourPlan')}</p>
          <p className="text-base font-semibold">
            {plan.isTrial ? `${t('trial')} · ${plan.planName}` : plan.planName}
            {!plan.isTrial && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {plan.priceMonthly !== null
                  ? t('perMonth', { price: money(plan.priceMonthly) })
                  : t('custom')}
              </span>
            )}
          </p>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {plan.chips.map((chip) => (
            <li
              key={chip.key}
              title={lockText(chip)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                chip.locked ? 'text-muted-foreground' : 'bg-muted/50',
              )}
            >
              {chip.locked && <Lock className="h-3 w-3" aria-hidden />}
              {chipLabel(chip)}
              {chip.locked && <span className="sr-only">{lockText(chip)}</span>}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4">
          {usage?.percentUsed !== null && usage?.percentUsed !== undefined && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{t('aiLimit')}</p>
              <p className="text-sm font-medium tabular-nums">
                {/* The trial credit names no share (trial AI credit, 2026-10-29). */}
                {usage.trial && aiUsageTone(usage) !== 'unlimited'
                  ? tUsage(`popover.trialState.${aiUsageTone(usage)}`)
                  : t('aiUsed', { percent: percentLabel(usage.percentUsed) })}
              </p>
            </div>
          )}
          <Link href={BILLING} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('comparePlans')}
          </Link>
        </div>
      </div>
      {next && (
        <div className="flex flex-col gap-2 border-t bg-muted/30 px-4 py-3 text-xs sm:flex-row sm:items-center sm:gap-4">
          <p className="shrink-0 font-medium">
            {next.afterTrial ? t('afterTrial') : t('next', { plan: next.planName })}
          </p>
          <ul className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
            {next.benefits.map((benefit) => (
              <li key={benefit.key}>
                {benefit.key === 'morePlatforms'
                  ? t('benefits.morePlatforms', { count: benefit.count })
                  : benefit.key === 'aiLimit'
                    ? t('benefits.aiLimit', { times: benefit.times })
                    : t(`benefits.${benefit.key}`)}
              </li>
            ))}
          </ul>
          <span className="shrink-0 font-medium tabular-nums">
            {next.afterTrial
              ? next.priceMonthly !== null
                ? t('afterTrialPrice', { plan: next.planName, price: money(next.priceMonthly) })
                : null
              : next.priceDiff !== null
                ? t('priceDiff', { price: money(next.priceDiff) })
                : t('customPrice')}
          </span>
          {isAdmin ? (
            <Link href={BILLING} className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}>
              {next.afterTrial ? t('choosePlan') : t('upgrade')}
            </Link>
          ) : (
            <AskAdminButton
              asked={tAsk('defaults.plan', { plan: next.planName })}
              ruleKind="plan"
              ruleDetail={tAsk('planDetail', { plan: next.planName, current: plan.planName })}
            />
          )}
        </div>
      )}
    </section>
  );
}
