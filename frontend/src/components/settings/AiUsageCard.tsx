'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StartPlanNow } from '@/components/ai-usage/StartPlanNow';
import { useUserRole } from '@/hooks/useUserRole';
import { getAiUsage } from '@/lib/actions/aiUsage';
import {
  aiUsageTone,
  featurePercentLabel,
  percentLabel,
  type AiUsage,
} from '@/lib/billing/aiUsage';
import type { UsageTone } from '@/lib/contentUsage';
import { cn } from '@/lib/utils';

const BAR_CLASS: Record<UsageTone, string> = {
  normal: 'bg-emerald-500',
  warning: 'bg-amber-500',
  exhausted: 'bg-red-500',
  unlimited: 'bg-muted-foreground/30',
};

/**
 * This period's AI usage on the Billing page: how much of the plan's
 * monthly AI allowance the workspace has used, what used it, and when it
 * renews. With Chat on for the workspace (`chatMetered`), Chat draws on it
 * too and has its row; off, Agent Chat runs on the workspace's own AI key,
 * so it is a line of text, not a share. Renders nothing for a plan without
 * an allowance, or a workspace without an active plan. In the free trial it
 * shows no shares, only how far the trial credit is (as the header meter),
 * and an admin can start the plan from 80% on.
 */
export function AiUsageCard() {
  const t = useTranslations('settings.aiUsageMeter');
  const tUsage = useTranslations('aiUsage');
  const { canAdmin } = useUserRole();
  // Undefined while it is read; null when there is no allowance to meter.
  const [usage, setUsage] = useState<AiUsage | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getAiUsage()
      .then((read) => {
        if (!cancelled) setUsage(read);
      })
      .catch((err) => {
        console.error('Failed to read AI usage:', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The header meter's "See details" (#ai-usage) lands here: the card shows
  // only once Billing has read the plan, after the browser looked for it.
  useEffect(() => {
    if (usage && window.location.hash === '#ai-usage') {
      card.current?.scrollIntoView({ block: 'start' });
    }
  }, [usage]);

  if (usage === null || usage?.unlimited) return null;

  const tone = usage ? aiUsageTone(usage) : 'normal';
  const trial = !!usage?.trial && tone !== 'unlimited';
  // As the plan card's "Renews on" above reads its date.
  const resets = usage?.periodEnd
    ? new Date(usage.periodEnd).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  const used = t('used', { percent: percentLabel(usage?.percentUsed ?? 0) });

  return (
    <Card id="ai-usage" ref={card} className="scroll-mt-6">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t(usage?.chatMetered ? 'descriptionChat' : 'description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {failed ? (
          <p className="text-sm text-muted-foreground">{t('failed')}</p>
        ) : !usage ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            {trial ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span
                    className={cn(
                      'text-lg font-semibold',
                      tone === 'warning' && 'text-amber-700 dark:text-amber-400',
                      tone === 'exhausted' && 'text-red-600 dark:text-red-400',
                    )}
                  >
                    {t(`trialState.${tone}`)}
                  </span>
                  {resets && (
                    <span className="text-sm text-muted-foreground">
                      {t('trialEnds', { date: resets })}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {tone === 'exhausted'
                    ? t('exhaustedTrial')
                    : tone === 'warning'
                      ? t('trialWarning')
                      : t('trialNote')}
                </p>
                {tone !== 'normal' &&
                  (canAdmin ? (
                    <StartPlanNow />
                  ) : (
                    <p className="text-sm text-muted-foreground">{tUsage('askAdminStart')}</p>
                  ))}
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-lg font-semibold tabular-nums">{used}</span>
                  {resets && (
                    <span className="text-sm text-muted-foreground">
                      {t('resets', { date: resets })}
                    </span>
                  )}
                </div>
                <div
                  role="progressbar"
                  aria-label={t('title')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.floor(usage.percentUsed ?? 0)}
                  aria-valuetext={used}
                  className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className={cn('h-full rounded-full', BAR_CLASS[tone])}
                    style={{ width: `${Math.min(100, usage.percentUsed ?? 0)}%` }}
                  />
                </div>
                {tone === 'exhausted' && (
                  <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                    {resets ? t('exhausted', { date: resets }) : t('exhaustedNoDate')}
                    {/* Enterprise has no bigger plan to move to. */}
                    {usage.plan !== 'enterprise' && <> {t('morePlans')}</>}
                  </p>
                )}
              </div>
            )}
            {/* Only what used some is listed: none yet, a line says so. The
                trial's shares aren't shown. */}
            {trial ? null : usage.features.length > 0 ? (
              <ul className="divide-y rounded-lg border text-sm">
                {usage.features.map(({ feature, percent }) => (
                  <li key={feature} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>{t(`features.${feature}`)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {featurePercentLabel(percent)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('none')}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t(usage.chatMetered ? 'chatMetered' : 'chat')}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
