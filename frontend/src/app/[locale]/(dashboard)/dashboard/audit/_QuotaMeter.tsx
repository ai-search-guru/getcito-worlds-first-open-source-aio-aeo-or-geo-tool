'use client';

import { useTranslations } from 'next-intl';
import type { AuditAutoStatus, AuditQuota } from '@/lib/actions/audits';
import { autoRunStates } from '@/lib/auditAutoRuns';
import { isNoPlan } from '@/lib/billing/noPlan';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { formatMonthDay, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Auto-audit's runs a month (days 1, 7, 14, 21 and 28). */
const RUNS_A_MONTH = 5;

/**
 * The month's audits as the quota card splits them (SA-019): what the
 * auto-audit runs used (done or running), what they keep for the runs still
 * to come, what the user used, and what's free. They add up to the limit.
 * `left` is the big number: everything not used yet, the runs' share
 * included. Null for a plan without a monthly limit.
 */
export function quotaShares(quota: AuditQuota) {
  if (quota.limit === -1) return null;
  const running = quota.running ?? 0;
  const autoUsed = (quota.auto?.used ?? 0) + (quota.auto?.running ?? 0);
  const autoScheduled = quota.auto?.reserved ?? 0;
  return {
    autoUsed,
    autoScheduled,
    youUsed: Math.max(0, quota.used + running - autoUsed),
    free: quota.remaining,
    left: Math.max(0, quota.limit - quota.used - running),
  };
}

/** Auto-audit's share of the quota in percent: 5 runs of 5%, so 25 for most plans. */
export function autoSharePct(auto: AuditAutoStatus, limit: number): number {
  return limit > 0 ? Math.round(((auto.perRun * RUNS_A_MONTH) / limit) * 100) : 0;
}

/** The thin bar of the quota card: auto used · auto scheduled · you used · free. */
export function QuotaSegments({ quota }: { quota: AuditQuota }) {
  const t = useTranslations('audit.quota');
  const shares = quotaShares(quota);
  if (!shares) return null;
  const width = (n: number) => `${Math.min(100, (n / quota.limit) * 100)}%`;
  const label = t('bar', {
    autoUsed: formatNumber(shares.autoUsed),
    autoScheduled: formatNumber(shares.autoScheduled),
    youUsed: formatNumber(shares.youUsed),
    free: formatNumber(shares.free),
  });
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className="my-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <i className="block h-full bg-foreground" style={{ width: width(shares.autoUsed) }} />
      <i
        className="block h-full bg-muted-foreground/60"
        style={{ width: width(shares.autoScheduled) }}
      />
      <i className="block h-full bg-muted-foreground/30" style={{ width: width(shares.youUsed) }} />
    </div>
  );
}

/**
 * The five runs on one line, by date (days 1, 7, 14, 21 and 28 of the
 * billing month): done filled, the next one outlined and bold, one whose turn
 * passed without a run dashed, the rest empty.
 */
export function RunDots({ auto, now }: { auto: AuditAutoStatus; now: Date }) {
  const t = useTranslations('audit.quota');
  return (
    <ol aria-label={t('runs')} className="flex items-start">
      {autoRunStates(auto, now).map(({ day, at, state }) => {
        // Run days are UTC days (autoAudit.js), so their dates are too.
        const date = formatMonthDay(at, 'UTC');
        return (
          <li
            key={day}
            title={t('runTitle', { day, date })}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-[3px] text-[11px] leading-none whitespace-nowrap',
              // The line to the next run.
              "after:absolute after:top-1.5 after:right-[calc(-50%+8px)] after:left-[calc(50%+8px)] after:h-px after:bg-border after:content-[''] last:after:hidden",
              state === 'next' ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'block h-3 w-3 rounded-full border-[1.5px]',
                state === 'done' && 'border-foreground bg-foreground',
                state === 'next' && 'border-foreground bg-card',
                state === 'upcoming' && 'border-muted-foreground/40 bg-card',
                state === 'missed' && 'border-dashed border-muted-foreground/40 bg-transparent',
              )}
            />
            {date}
            <span className="sr-only">{t(`run_${state}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * When the user's share is used up but runs are still to come (spec §4.4):
 * "You've used your 375 audits. 25 auto audits are still scheduled. Turn off
 * auto-audit to use them now, or upgrade." Null otherwise.
 */
export function EmptyPoolMessage({
  quota,
  onOpenSettings,
  className,
}: {
  quota: AuditQuota | null;
  onOpenSettings?: () => void;
  className?: string;
}) {
  const t = useTranslations('audit.quota');
  const { isLocked } = useUpgradeGate();
  // Without an active plan nothing is used up (and no run is scheduled).
  const shares = quota && !isNoPlan(quota, isLocked) ? quotaShares(quota) : null;
  if (!quota || !shares || quota.remaining > 0 || shares.autoScheduled === 0) return null;
  return (
    <p className={cn('text-xs text-destructive', className)}>
      {t.rich('emptyPool', {
        yours: formatNumber(shares.youUsed),
        scheduled: formatNumber(shares.autoScheduled),
        off: (chunks) =>
          onOpenSettings ? (
            <button type="button" className="underline underline-offset-2" onClick={onOpenSettings}>
              {chunks}
            </button>
          ) : (
            chunks
          ),
      })}
    </p>
  );
}
