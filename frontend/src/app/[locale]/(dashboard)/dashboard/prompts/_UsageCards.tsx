'use client';

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { ChevronDown, RotateCw } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CONTACT_SALES_URL, PLANS, type PlanId } from '@/config/plans';
import type { LocationQuota } from '@/lib/actions/prompt';
import { getPromptUsage } from '@/lib/promptUsage';
import type { PromptUsageSummary } from '@/lib/promptUsageSummary';
import { cn } from '@/lib/utils';

/**
 * Tracked Prompts usage cards (PROMPT-012): the brand's active and total
 * prompts, and the account's active prompts, prompt locations and slots left,
 * above the table. The brand cards filter the table; the account cards lead
 * to Plan & usage. They load on their own (GET /api/prompts/usage), so the
 * table never waits for them.
 *
 * The cards fold under the title, as the sidebar's Prompts item does: closed
 * whenever the page opens, so the table sits right under the controls, and
 * open only when the reader asks. Closed, the title still says when the plan's
 * prompt locations are nearly or fully used.
 */

/** How long a tracked prompt reads as New after it is added. */
export const NEW_PROMPT_MS = 24 * 60 * 60 * 1000;

/** A row's Status: paused, new (tracked and added within the last day) or active. */
export type PromptStatus = 'active' | 'new' | 'paused';

/**
 * Which rows the table shows; set by the This brand cards or the Status
 * filter. It opens on Tracked: every prompt being tracked, Active and New.
 */
export type PromptStatusFilter = 'tracked' | PromptStatus | 'all';

export function promptStatus(
  prompt: { isActive: boolean; createdAt: string },
  now: number,
): PromptStatus {
  if (!prompt.isActive) return 'paused';
  return now - Date.parse(prompt.createdAt) < NEW_PROMPT_MS ? 'new' : 'active';
}

export function matchesStatusFilter(
  prompt: { isActive: boolean; createdAt: string },
  filter: PromptStatusFilter,
  now: number,
): boolean {
  if (filter === 'all') return true;
  const status = promptStatus(prompt, now);
  return filter === 'tracked' ? status !== 'paused' : status === filter;
}

/**
 * The table's default order: prompts added within the last day lead, newest
 * first, then the rest as sorted. New prompts have no answers yet, so a
 * performance sort alone would sink them to the bottom.
 */
export function newFirst<T extends { isActive: boolean; createdAt: string }>(
  sorted: T[],
  now: number,
): T[] {
  const isNew = (p: T) => promptStatus(p, now) === 'new';
  const added = (p: T) => Date.parse(p.createdAt);
  return [
    ...sorted.filter(isNew).sort((a, b) => added(b) - added(a)),
    ...sorted.filter((p) => !isNew(p)),
  ];
}

/** How many rows each filter shows, for the table's title. */
export function countByStatus(
  prompts: { isActive: boolean; createdAt: string }[],
  now: number,
): Record<PromptStatusFilter, number> {
  const counts: Record<PromptStatusFilter, number> = {
    tracked: 0,
    active: 0,
    new: 0,
    paused: 0,
    all: prompts.length,
  };
  for (const p of prompts) counts[promptStatus(p, now)] += 1;
  counts.tracked = counts.active + counts.new;
  return counts;
}

/** Plan keys this bundle has labels for; any other shows the server's name. */
function isKnownPlan(key: string): key is PlanId {
  return Object.hasOwn(PLANS, key);
}

type UsageLoad =
  | { brandId: string; status: 'ready'; usage: PromptUsageSummary }
  | { brandId: string; status: 'error' };

export type PromptUsageState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; usage: PromptUsageSummary };

const PLAN_PAGE = '/dashboard/settings?tab=billing';

/**
 * The cards' data for a brand. Bump `version` after a change to the brand's
 * prompts or locations to refetch; the cards keep their numbers meanwhile.
 */
export function usePromptUsage(
  brandId: string | null,
  version: number,
): { state: PromptUsageState; retry: () => void } {
  const [load, setLoad] = useState<UsageLoad | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!brandId) return;
    const controller = new AbortController();
    fetch(`/api/prompts/usage?brandId=${encodeURIComponent(brandId)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`usage ${res.status}`);
        return (await res.json()) as PromptUsageSummary;
      })
      .then((usage) => setLoad({ brandId, status: 'ready', usage }))
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ brandId, status: 'error' });
      });
    return () => controller.abort();
  }, [brandId, version, attempt]);

  // Back to the skeletons while retrying, so the click visibly does something.
  const retry = useCallback(() => {
    setLoad(null);
    setAttempt((a) => a + 1);
  }, []);
  // Another brand's numbers never show while the new brand's load.
  const state: PromptUsageState =
    !load || load.brandId !== brandId
      ? { status: 'loading' }
      : load.status === 'ready'
        ? { status: 'ready', usage: load.usage }
        : { status: 'error' };
  return { state, retry };
}

/** The plan-limit numbers the Add Prompt dialog and bulk import bound themselves by. */
export function locationQuotaFromUsage(usage: PromptUsageSummary): LocationQuota {
  const used = usage.account.locationsUsed;
  return {
    // An ended plan takes nothing new until a plan is chosen again: the quota
    // reads as full, as the Slots left card's 0 does.
    maxPrompts: usage.plan.ended ? used : (usage.plan.locationLimit ?? -1),
    used,
    planId: usage.plan.key,
    planName: isKnownPlan(usage.plan.key) ? PLANS[usage.plan.key].name : usage.plan.name,
  };
}

type Tone = 'normal' | 'warning' | 'full';

const TONE_TEXT: Record<Tone, string> = {
  normal: '',
  warning: 'text-amber-600 dark:text-amber-500',
  full: 'text-red-600 dark:text-red-500',
};

const TONE_BAR: Record<Tone, string> = {
  normal: 'bg-foreground',
  warning: 'bg-amber-500 dark:bg-amber-400',
  full: 'bg-red-500 dark:bg-red-400',
};

export function PromptUsageCards({
  state,
  brandName,
  readOnly,
  prompts,
  filter,
  onFilter,
  onRetry,
}: {
  state: PromptUsageState;
  brandName: string | undefined;
  /** Member role: the subtitle says the table is read-only. */
  readOnly: boolean;
  /** The brand's prompts, for the New ones the Active card also counts. */
  prompts: { isActive: boolean; createdAt: string }[];
  filter: PromptStatusFilter;
  onFilter: (filter: PromptStatusFilter) => void;
  onRetry: () => void;
}) {
  const t = useTranslations('prompts.usage');
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const n = (value: number) => format.number(value);
  const newCount = countByStatus(prompts, now.getTime()).new;

  const usage = state.status === 'ready' ? state.usage : null;
  const plan = usage?.plan;
  const planShort = !plan ? '' : isKnownPlan(plan.key) ? t(`planLabel.${plan.key}`) : plan.name;
  const planPill = plan?.ended
    ? t('planPillEnded', { plan: planShort })
    : plan && isKnownPlan(plan.key)
      ? t('planPill', { plan: planShort })
      : (plan?.name ?? '');
  // Self-hosted has no plan page to go to.
  const planHref = plan?.cta ? PLAN_PAGE : undefined;

  const limit = plan?.locationLimit ?? null;
  const used = usage?.account.locationsUsed ?? 0;
  const meter = usage && limit !== null ? getPromptUsage(used, limit) : null;
  const tone: Tone =
    meter?.state === 'warning'
      ? 'warning'
      : meter?.state === 'full' || meter?.state === 'over'
        ? 'full'
        : 'normal';

  const value = (content: ReactNode, className?: string) =>
    usage ? (
      <div className={cn('mt-1 text-2xl font-bold tabular-nums', className)}>{content}</div>
    ) : state.status === 'error' ? (
      <div className="mt-1 text-2xl font-bold text-muted-foreground">–</div>
    ) : (
      <Skeleton className="mt-1.5 mb-1 h-7 w-16" />
    );
  const sub = (content: ReactNode) =>
    // Sub-lines wrap rather than cut off, so the plan CTA stays reachable on
    // narrow cards; the labels above them stay on one line.
    usage ? (
      <div className="text-xs leading-snug text-muted-foreground">{content}</div>
    ) : state.status === 'error' ? null : (
      <Skeleton className="mt-1 h-3 w-24" />
    );

  const cta =
    plan?.cta === 'contact' ? (
      <a
        href={CONTACT_SALES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'relative z-10 underline underline-offset-2',
          tone === 'full' ? 'font-semibold text-red-600 dark:text-red-500' : 'text-foreground',
        )}
      >
        {t('cta.contact')}
      </a>
    ) : plan?.cta ? (
      <Link
        href={PLAN_PAGE}
        className={cn(
          'relative z-10 underline underline-offset-2',
          tone === 'full' ? 'font-semibold text-red-600 dark:text-red-500' : 'text-foreground',
        )}
      >
        {t(`cta.${plan.cta}`)}
      </Link>
    ) : null;

  const updatedAt = usage ? new Date(usage.updatedAt) : null;
  const updatedLabel =
    updatedAt && now.getTime() - updatedAt.getTime() >= 60_000
      ? t('updated', { when: format.relativeTime(updatedAt, now) })
      : t('updatedJustNow');

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      {/* The whole bar opens it, as the Content plan's "What AI cites": "Show"
          and a chevron on the right say so. Plan & usage keeps its own page,
          so while the pointer is on that link the bar doesn't look clickable. */}
      <div
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'group flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/50 has-[a:hover]:bg-transparent',
          open && 'border-b',
        )}
      >
        <h2 className="text-[15px] font-semibold">{t('title')}</h2>
        <span className="text-xs text-muted-foreground">
          {readOnly ? t('subtitleReadOnly') : t('subtitle')}
        </span>
        {!open && usage && limit !== null && tone !== 'normal' && (
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums',
              tone === 'full'
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
            )}
          >
            {t('collapsedLocations', { used: n(used), limit: n(limit) })}
          </span>
        )}
        {planHref && (
          <Link
            href={planHref}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'ml-auto h-7 text-xs',
            )}
          >
            {t('planAndUsage')}
          </Link>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className={cn(
            'flex items-center gap-1 rounded text-xs font-medium text-foreground group-hover:underline group-has-[a:hover]:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            !planHref && 'ml-auto',
          )}
        >
          <span className="sr-only">{t('title')}: </span>
          {open ? t('hide') : t('show')}
          <ChevronDown
            aria-hidden
            className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </div>

      {/* Kept mounted while closed, so opening shows the counts at once. */}
      <div
        id={bodyId}
        className={cn('grid grid-cols-1 min-[900px]:grid-cols-[2fr_3fr]', !open && 'hidden')}
      >
        <div className="min-w-0 border-b min-[900px]:border-r min-[900px]:border-b-0">
          <GroupHeader name={t('thisBrand')}>
            <span className="truncate text-xs text-muted-foreground">{brandName}</span>
          </GroupHeader>
          <div className="grid auto-cols-fr grid-flow-col">
            <UsageCard
              label={t('activePrompts')}
              selected={filter === 'tracked'}
              onSelect={() => onFilter('tracked')}
            >
              {value(usage && n(usage.brand.active))}
              {sub(
                usage && (
                  <>
                    {newCount > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => onFilter('new')}
                          title={t('showNew')}
                          aria-pressed={filter === 'new'}
                          className={cn(
                            'relative z-10 underline-offset-2 hover:underline',
                            filter === 'new' && 'font-medium text-foreground underline',
                          )}
                        >
                          {t('new', { count: n(newCount) })}
                        </button>{' '}
                        ·{' '}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onFilter('paused')}
                      title={t('showPaused')}
                      aria-pressed={filter === 'paused'}
                      className={cn(
                        'relative z-10 underline-offset-2 hover:underline',
                        filter === 'paused' && 'font-medium text-foreground underline',
                      )}
                    >
                      {t('paused', { count: n(usage.brand.paused) })}
                    </button>{' '}
                    · {t('beingTracked')}
                  </>
                ),
              )}
            </UsageCard>
            <UsageCard
              label={t('totalPrompts')}
              selected={filter === 'all'}
              onSelect={() => onFilter('all')}
            >
              {value(usage && n(usage.brand.total))}
              {sub(t('activePlusPaused'))}
            </UsageCard>
          </div>
        </div>

        <div className="min-w-0">
          <GroupHeader name={t('account')}>
            {plan ? (
              <span className="rounded-md border bg-background px-2 text-xs leading-5 font-medium">
                {planPill}
              </span>
            ) : state.status === 'loading' ? (
              <Skeleton className="h-5 w-24" />
            ) : null}
          </GroupHeader>
          <div className="grid auto-cols-fr grid-flow-col">
            <UsageCard label={t('activePrompts')} href={planHref}>
              {value(usage && n(usage.account.activePrompts))}
              {sub(usage && t('acrossBrands', { count: usage.account.brands }))}
            </UsageCard>
            <UsageCard label={t('promptLocations')} href={planHref}>
              {value(
                <>
                  {n(used)}
                  {limit !== null && (
                    <span className="text-[15px] font-medium text-muted-foreground">
                      {' '}
                      / {n(limit)}
                    </span>
                  )}
                </>,
                TONE_TEXT[tone],
              )}
              {usage && limit !== null && (
                <div
                  className="my-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={t('promptLocations')}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={Math.min(used, limit)}
                >
                  <div
                    className={cn('h-full rounded-full', TONE_BAR[tone])}
                    style={{ width: `${meter?.percent ?? 0}%` }}
                  />
                </div>
              )}
              {sub(
                limit === null ? (
                  `${t('unlimited')} · ${t('locationPairs')}`
                ) : meter?.state === 'over' ? (
                  <>
                    {t('locationPairs')} · <span className={TONE_TEXT.full}>{t('overLimit')}</span>
                  </>
                ) : (
                  t('locationPairs')
                ),
              )}
            </UsageCard>
            <UsageCard label={t('slotsLeft')} href={planHref}>
              {/* Nothing can be added until a plan is chosen again. */}
              {value(
                plan?.ended ? n(0) : limit === null ? t('unlimited') : n(meter?.remaining ?? 0),
                TONE_TEXT[tone],
              )}
              {sub(
                <>
                  {plan?.ended
                    ? t('ended', { plan: planShort })
                    : limit === null
                      ? t('onPlan', { plan: planShort })
                      : t('ofLimit', { limit: n(limit), plan: planShort })}
                  {cta && <> · {cta}</>}
                </>,
              )}
            </UsageCard>
          </div>
        </div>
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground',
          !open && 'hidden',
        )}
      >
        <span>{t('footer')}</span>
        {state.status === 'error' ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 text-foreground hover:underline"
          >
            <RotateCw className="h-3 w-3" />
            {t('loadFailed')} · {t('retry')}
          </button>
        ) : usage ? (
          <span>{updatedLabel}</span>
        ) : null}
      </div>
    </section>
  );
}

function GroupHeader({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <div className="flex h-[38px] items-center gap-2 border-b bg-muted/40 px-4 whitespace-nowrap">
      <span className="text-[11px] font-semibold tracking-wider text-foreground/80 uppercase">
        {name}
      </span>
      {children}
    </div>
  );
}

/**
 * One card. Its label is the card's control — a button that filters the
 * table, or a link to Plan & usage — stretched over the whole card, so links
 * inside the card (the paused count, the plan CTA) sit above it.
 */
function UsageCard({
  label,
  selected = false,
  onSelect,
  href,
  children,
}: {
  label: string;
  selected?: boolean;
  onSelect?: () => void;
  href?: string;
  children: ReactNode;
}) {
  const labelClass =
    'block h-4 truncate text-left text-[11px] tracking-wide text-muted-foreground uppercase ' +
    "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none";
  return (
    <div
      className={cn(
        'relative min-w-0 border-r px-4 py-3.5 last:border-r-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-inset',
        (onSelect || href) && 'hover:bg-muted/40',
        selected && 'shadow-[inset_0_-2px_0_var(--foreground)]',
      )}
    >
      {onSelect ? (
        <button type="button" onClick={onSelect} aria-pressed={selected} className={labelClass}>
          {label}
        </button>
      ) : href ? (
        <Link href={href} className={labelClass}>
          {label}
        </Link>
      ) : (
        <div className="block h-4 truncate text-[11px] tracking-wide text-muted-foreground uppercase">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
