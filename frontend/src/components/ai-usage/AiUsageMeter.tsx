'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import { AiUsageBanner } from './AiUsageBanner';
import { AiUsageGetMore, ownKeyOffered } from './AiUsageGetMore';
import { StartPlanNowDialog } from './StartPlanNow';
import { AskChatButton } from '@/components/chat/panel/AskChatButton';
import { buttonVariants } from '@/components/ui/button-variants';
import { LoadingDots } from '@/components/ui/loading-dots';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { useUserRole } from '@/hooks/useUserRole';
import {
  aiUsageTone,
  featurePercentLabel,
  percentLabel,
  type UsageCount,
  type UsageLimits,
} from '@/lib/billing/aiUsage';
import { readDraftAiUsage, readUsageLimits } from '@/lib/billing/aiUsageClient';
import type { UsageTone } from '@/lib/contentUsage';
import { formatMonthDay, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';

/** Black under 80%, amber from 80%, red once used up (AI usage spec §4). */
const METER_CLASS: Record<UsageTone, string> = {
  normal: 'border-border text-foreground',
  warning: 'border-amber-500/70 text-amber-700 dark:border-amber-400/60 dark:text-amber-400',
  exhausted: 'border-red-500/70 text-red-700 dark:border-red-400/60 dark:text-red-400',
  unlimited: 'border-border text-muted-foreground',
};

const FILL_CLASS: Record<UsageTone, string> = {
  normal: 'bg-foreground',
  warning: 'bg-amber-500',
  exhausted: 'bg-red-500',
  unlimited: 'bg-muted-foreground/30',
};

const LABEL_KEY = {
  normal: 'meter.label',
  warning: 'meter.labelWarning',
  exhausted: 'meter.labelExhausted',
  unlimited: 'meter.label',
} as const satisfies Record<UsageTone, string>;

const ALIGN_CLASS = { start: 'sm:items-start', end: 'sm:items-end' } as const;

/**
 * A page's header row with the AI usage meter at its far right, on the
 * title's line (AI usage spec §3.1): the same place on every page, however
 * the row's own buttons wrap beside it. On a phone it goes under the row, on
 * the right, so the row keeps the whole width for its buttons. From 80% of
 * the month's allowance the banner follows the row (spec §4), spaced as the
 * page spaces its parts; `banner={false}` leaves it to the page, for a row
 * with more of its header under it. Chat's "Ask Chat" follows the meter, at
 * the top right of the page (CHAT-01 item 13); `askChat={false}` leaves it
 * out, for a row in a drawer. Both are a default button's height, so the
 * page's own header buttons line up with them when they are one too and sit
 * where `align` puts them: at the top, on the title's line (most pages), or
 * at the bottom, beside controls with a label above them (a date range).
 */
export function HeaderWithAiUsage({
  children,
  banner = true,
  askChat = true,
  align = 'start',
  className,
}: {
  children: ReactNode;
  banner?: boolean;
  askChat?: boolean;
  align?: 'start' | 'end';
  /** On the header row: room for a drawer's close button, for one. */
  className?: string;
}) {
  return (
    <>
      <div
        className={cn('flex flex-col gap-2 sm:flex-row sm:gap-3', ALIGN_CLASS[align], className)}
      >
        <div className="min-w-0 sm:flex-1">{children}</div>
        <AiUsageMeter className="self-end sm:self-auto" />
        {askChat && <AskChatButton className="self-end sm:self-auto" />}
      </div>
      {banner && <AiUsageBanner />}
    </>
  );
}

/**
 * "AI 21%" at the far right of a page's header row (AI usage spec §3.1): the
 * share of the workspace's monthly AI allowance used, with a small bar. In
 * the free trial it shows no share (one page read as a big piece of a small
 * trial credit): "Trial credit", "Almost used" from 80%, then "Used up". A
 * click opens what used it, what doesn't count, the limits that aren't AI,
 * and where to get more: getting more and an own key are an admin's to
 * change, so other members are told to ask one. Nothing on a plan without an
 * allowance; while the first read runs, an empty box of its size keeps the
 * header row from shifting. In the Content Editor's header (Next step spec
 * §3b) it is `compact`, the header's button height, and the percent alone
 * narrower than 1280px, as the Next button's label goes; with the page's
 * `draftId` the popover adds the page's own share of the month.
 */
export function AiUsageMeter({
  className,
  compact = false,
  draftId,
}: {
  className?: string;
  compact?: boolean;
  draftId?: string;
}) {
  const t = useTranslations('aiUsage');
  const tFeature = useTranslations('settings.aiUsageMeter.features');
  const tCommon = useTranslations('common');
  const { usage, refresh } = useAiUsage();
  const { canAdmin } = useUserRole();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [open, setOpen] = useState(false);
  // Start my plan now's dialog, outside the popover: the popover closes as it opens.
  const [starting, setStarting] = useState(false);
  // Undefined until the popover first opens, null while that first read runs;
  // a later opening keeps what it shows until the new read lands.
  const [limits, setLimits] = useState<UsageLimits | null | undefined>(undefined);
  // The latest read, so an earlier one landing late can't replace it.
  const limitsRead = useRef(0);
  // The page's share, as the limits read on each opening: 'none' when it
  // can't be read.
  const [page, setPage] = useState<number | 'loading' | 'none' | undefined>(undefined);
  const pageRead = useRef(0);

  if (usage === undefined) {
    return (
      <span
        aria-hidden
        className={cn(
          'hidden shrink-0 sm:inline-block',
          compact ? 'h-7 w-[3.625rem] xl:w-[8.25rem]' : 'h-8 w-[8.5rem]',
          className,
        )}
      />
    );
  }
  if (usage === null || usage.unlimited) return null;

  const tone = aiUsageTone(usage);
  const trial = !!usage.trial && tone !== 'unlimited';
  const percent = usage.percentUsed ?? 0;
  const used = percentLabel(percent);
  const width = `${Math.min(100, percent)}%`;
  const resets = usage.periodEnd ? formatMonthDay(usage.periodEnd) : null;
  // A warning or a used-up allowance makes Get more the primary button (spec §4).
  const pressing = tone === 'warning' || tone === 'exhausted';

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    refresh();
    setLimits((shown) => shown ?? null);
    const id = ++limitsRead.current;
    void readUsageLimits(brandId).then((read) => {
      if (id === limitsRead.current) setLimits(read);
    });
    if (draftId && !trial) {
      setPage((shown) => (typeof shown === 'number' ? shown : 'loading'));
      const pageId = ++pageRead.current;
      void readDraftAiUsage(draftId).then((read) => {
        if (pageId === pageRead.current) setPage(read ?? 'none');
      });
    }
  };
  const close = () => setOpen(false);

  const count = ({ used: n, limit }: UsageCount) =>
    t('popover.ofLimit', { used: formatNumber(n), limit: formatNumber(limit) });

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          aria-label={trial ? t(`meter.trialLabel.${tone}`) : t(LABEL_KEY[tone], { percent: used })}
          // The percent alone says little: its name on hover, as the header's title has.
          title={compact && !trial ? t(LABEL_KEY[tone], { percent: used }) : undefined}
          className={cn(
            'inline-flex shrink-0 items-center gap-2 rounded-full border bg-background text-xs font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted',
            compact ? 'h-7 px-2.5' : 'h-8 px-3',
            METER_CLASS[tone],
            className,
          )}
        >
          <span aria-hidden className={cn(compact && 'hidden xl:inline')}>
            {t('meter.ai')}
          </span>
          {trial ? (
            <span aria-hidden>{t(`meter.trial.${tone}`)}</span>
          ) : (
            <>
              <span
                aria-hidden
                className={cn(
                  'block h-1.5 w-11 overflow-hidden rounded-full bg-muted',
                  compact && 'hidden xl:block',
                )}
              >
                <span
                  className={cn('block h-full rounded-full', FILL_CLASS[tone])}
                  style={{ width }}
                />
              </span>
              {/* As wide as "99.9%": the button keeps its width as the tenths move. */}
              <span aria-hidden className="inline-block min-w-9 text-right tabular-nums">
                {used}
              </span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] text-sm">
          <PopoverTitle className="text-xs font-normal text-muted-foreground">
            {usage.planName
              ? t(usage.trial ? 'popover.titleTrial' : 'popover.title', { plan: usage.planName })
              : t('popover.titleNoPlan')}
          </PopoverTitle>
          {trial ? (
            <>
              <p
                className={cn(
                  'mt-0.5 text-base font-semibold',
                  tone === 'warning' && 'text-amber-700 dark:text-amber-400',
                  tone === 'exhausted' && 'text-red-700 dark:text-red-400',
                )}
              >
                {t(`popover.trialState.${tone}`)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t('popover.trialNote')}</p>
            </>
          ) : (
            <>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums">{used}</p>
              <div
                role="progressbar"
                aria-label={t('popover.titleNoPlan')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.floor(percent)}
                aria-valuetext={used}
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
              >
                <div className={cn('h-full rounded-full', FILL_CLASS[tone])} style={{ width }} />
              </div>
            </>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {resets
              ? t(trial ? 'popover.trialEnds' : 'popover.shared', { date: resets })
              : t('popover.sharedNoDate')}
          </p>
          {/* The page's own share: left out when it can't be read. */}
          {draftId && page !== undefined && page !== 'none' && (
            <p className="mt-2 flex items-center justify-between gap-3 rounded-md bg-muted px-2.5 py-1.5 text-[13px]">
              <span>{t('popover.page')}</span>
              {page === 'loading' ? (
                <span className="text-muted-foreground">
                  <LoadingDots />
                  <span className="sr-only">{tCommon('loading')}</span>
                </span>
              ) : (
                <span className="font-medium tabular-nums">{percentLabel(page)}</span>
              )}
            </p>
          )}
          {/* With the new Chat on (chatMetered), an own key runs it only on
            Enterprise or for a key kept from before it (ownKeyAllowed), so
            the line says where Chat keeps working. */}
          {tone === 'exhausted' && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-400">
              {usage.trial
                ? t(usage.chatMetered ? 'popover.exhaustedTrialChat' : 'popover.exhaustedTrial')
                : resets
                  ? t(usage.chatMetered ? 'popover.exhaustedChat' : 'popover.exhausted', {
                      date: resets,
                    })
                  : t(
                      usage.chatMetered ? 'popover.exhaustedNoDateChat' : 'popover.exhaustedNoDate',
                    )}
            </p>
          )}

          {/* Only what used some is listed: none yet, a line says so. The
            trial's shares aren't shown. */}
          {trial ? null : usage.features.length > 0 ? (
            <ul className="mt-3 divide-y border-t text-[13px]">
              {usage.features.map(({ feature, percent: share }) => (
                <li key={feature} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-muted-foreground">{tFeature(feature)}</span>
                  <span className="font-medium tabular-nums">{featurePercentLabel(share)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 border-t py-1.5 text-[13px] text-muted-foreground">
              {t('popover.none')}
            </p>
          )}

          <ul className="mt-1 border-t text-[13px]">
            <li className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-muted-foreground">{t('popover.ownKey')}</span>
              <span className="font-medium">{t('popover.notCounted')}</span>
            </li>
          </ul>

          {limits !== undefined &&
            (limits === null || limits.auditPages || limits.promptLocations) && (
              <>
                <p className="mt-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {t('popover.otherLimits')}
                </p>
                {limits === null ? (
                  <p className="mt-1 border-t py-1.5 text-muted-foreground">
                    <LoadingDots />
                    <span className="sr-only">{tCommon('loading')}</span>
                  </p>
                ) : (
                  <ul className="mt-1 divide-y border-t text-[13px]">
                    {limits.auditPages && (
                      <li className="flex items-center justify-between gap-3 py-1.5">
                        <span className="text-muted-foreground">{t('popover.auditPages')}</span>
                        <span className="font-medium tabular-nums">{count(limits.auditPages)}</span>
                      </li>
                    )}
                    {limits.promptLocations && (
                      <li className="flex items-center justify-between gap-3 py-1.5">
                        <span className="text-muted-foreground">
                          {t('popover.promptLocations')}
                        </span>
                        <span className="font-medium tabular-nums">
                          {count(limits.promptLocations)}
                        </span>
                      </li>
                    )}
                  </ul>
                )}
              </>
            )}

          {!canAdmin && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t(trial ? 'askAdminStart' : ownKeyOffered(usage) ? 'askAdmin' : 'askAdminNoKey')}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-1.5">
            <AiUsageGetMore
              plan={usage.plan}
              trial={usage.trial}
              chatMetered={usage.chatMetered}
              primary={pressing}
              onFollow={close}
              onStartPlan={() => {
                close();
                setStarting(true);
              }}
            />
            <Link
              href="/dashboard/settings/billing#ai-usage"
              onClick={close}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              {t('popover.details')}
            </Link>
          </div>
        </PopoverContent>
      </Popover>
      {trial && canAdmin && <StartPlanNowDialog open={starting} onOpenChange={setStarting} />}
    </>
  );
}
