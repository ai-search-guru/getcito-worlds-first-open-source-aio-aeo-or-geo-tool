'use client';

import { AlertCircle, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import { buttonVariants } from '@/components/ui/button-variants';
import { useUserRole } from '@/hooks/useUserRole';
import { aiUsageTone, percentLabel } from '@/lib/billing/aiUsage';
import { formatMonthDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AiUsageGetMore, ownKeyOffered } from './AiUsageGetMore';
import { StartPlanNow } from './StartPlanNow';

/**
 * The month's AI usage once it needs attention, under a page's header row
 * (AI usage spec §4): amber from 80%, with where to see it; red once used up,
 * saying until when AI features stop, with where to get more (other members
 * are told to ask an admin). Nothing below 80%. In the free trial it names
 * no share, and an admin can start the plan here (Start my plan now). With
 * the new Chat on, it says Chat goes on only on the workspace's own key.
 */
export function AiUsageBanner({ className }: { className?: string }) {
  const t = useTranslations('aiUsage');
  const { usage } = useAiUsage();
  const { canAdmin } = useUserRole();
  if (!usage || usage.unlimited) return null;

  const tone = aiUsageTone(usage);
  const resets = usage.periodEnd ? formatMonthDay(usage.periodEnd) : null;

  if (tone === 'warning') {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30',
          className,
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <p className="min-w-0 flex-1 text-amber-900 dark:text-amber-200">
          {usage.trial
            ? t('banner.warningTrial')
            : t('banner.warning', { percent: percentLabel(usage.percentUsed ?? 0) })}
          {usage.trial && !canAdmin && <> {t('askAdminStart')}</>}
        </p>
        {usage.trial && canAdmin ? (
          <StartPlanNow variant="outline" />
        ) : (
          <Link
            href="/dashboard/settings/billing#ai-usage"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('banner.seeUsage')}
          </Link>
        )}
      </div>
    );
  }

  if (tone !== 'exhausted') return null;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-900/50 dark:bg-red-950/30',
        className,
      )}
    >
      <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-500" />
      <p className="min-w-0 flex-1 text-red-900 dark:text-red-200">
        {/* With the new Chat on (chatMetered), an own key runs it only on
          Enterprise or for a key kept from before it (ownKeyAllowed). */}
        {usage.trial
          ? t(usage.chatMetered ? 'banner.exhaustedTrialChat' : 'banner.exhaustedTrial')
          : resets
            ? t(usage.chatMetered ? 'banner.exhaustedChat' : 'banner.exhausted', { date: resets })
            : t(usage.chatMetered ? 'banner.exhaustedNoDateChat' : 'banner.exhaustedNoDate')}
        {!canAdmin && (
          <>
            {' '}
            {t(usage.trial ? 'askAdminStart' : ownKeyOffered(usage) ? 'askAdmin' : 'askAdminNoKey')}
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-1.5 empty:hidden">
        <AiUsageGetMore
          plan={usage.plan}
          trial={usage.trial}
          chatMetered={usage.chatMetered}
          primary
        />
      </div>
    </div>
  );
}
