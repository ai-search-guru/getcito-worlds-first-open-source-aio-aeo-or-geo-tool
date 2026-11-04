'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { actionGoal, actionTexts } from '@/lib/action-center/display';
import { FINAL_READING_DAY, type ActionHistoryItem } from '@/lib/action-center/history';
import { UNCOUNTED_TASK_STATUSES } from '@/lib/action-center/registry';
import { ActionIcon, PriorityBadge } from './ActionTable';
import { HistoryStatusBadge } from './HistoryTable';
import { ImproveOutcomeCard } from './ImproveOutcomeCard';
import { useActionStory } from './useActionStory';
import { Skeleton } from '@/components/ui/skeleton';
import { getActionSignals } from '@/lib/actions/actionCenter';
import type { Signal } from '@/lib/signals/map';
import { improvePlatformLabels } from '@/lib/improveOutcome';
import { cn } from '@/lib/utils';

/**
 * One metric an action moved, as before → after.
 *
 * Both halves are shown rather than only the delta: a jump of seven means
 * something different at a base of ten than at a base of a thousand, and the
 * reader deciding whether the work paid off needs the base.
 */
function ResultMetricCard({
  label,
  before,
  after,
  delta,
  unit,
}: {
  label: string;
  before: number;
  after: number;
  delta: number;
  unit: string;
}) {
  const suffix = unit === 'percent' ? '%' : '';
  const rose = delta > 0;
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg font-semibold tabular-nums',
          rose ? 'text-emerald-600 dark:text-emerald-400' : delta < 0 ? 'text-red-500' : '',
        )}
      >
        {rose ? '↑' : delta < 0 ? '↓' : ''}
        {Math.abs(delta)}
        {suffix}
      </p>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {before}
        {suffix} → {after}
        {suffix}
      </p>
    </div>
  );
}

/**
 * What an action was, what opened it, what was carried out, and what it
 * achieved — in that order, because the last one is the question the tab is
 * for and the rest is the evidence behind it.
 */
export function HistoryDrawer({
  brandId,
  item,
  onOpenChange,
}: {
  brandId: string;
  item: ActionHistoryItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('actionCenter.historyPage');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tTypes = useTranslations('actionCenter.actionCategories');
  const tTasks = useTranslations('actionCenter.actionTasks');
  const tTaskStatus = useTranslations('actionCenter.taskStatus');
  const tSources = useTranslations('actionCenter.signalsPage.sources');
  const tRegistry = useTranslations('actionCenter.registry');
  const tDismiss = useTranslations('actionCenter.dismissReason');
  const tOutcome = useTranslations('actionCenter.actionOutcome');
  const tAffected = useTranslations('actionCenter.historyPage.affected');
  const router = useRouter();

  // The signals the action took as evidence, read once it opens as the Actions
  // drawer reads them, so its goal and what happened are told from its own
  // data (AC-003). A failed read leaves the general sentences.
  const itemId = item?.id ?? null;
  const [read, setRead] = useState<{ id: string; signals: Signal[] } | null>(null);
  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    getActionSignals(brandId, itemId).then(
      (signals) => {
        if (!cancelled) setRead({ id: itemId, signals });
      },
      () => {
        if (!cancelled) setRead({ id: itemId, signals: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [brandId, itemId]);
  const storyAction = useMemo(
    () =>
      item
        ? { id: item.id, payload: item.payload, createdAt: item.createdAt, dueDate: item.dueDate }
        : null,
    [item],
  );
  const { story, ready } = useActionStory(
    brandId,
    storyAction,
    read && read.id === itemId ? read.signals : null,
  );

  if (!item) return null;

  const texts = actionTexts(
    { kind: item.kind, payload: item.payload } as Parameters<typeof actionTexts>[0],
    tTexts,
  );
  const date = item.completedAt ?? item.createdAt;
  const measured = item.results.length > 0;
  // Its net of the brand's prompts it didn't touch (learning B2), in the metrics it can name.
  const controlNet = item.controlNet?.net.filter((m) => tRegistry.has(`${m.metric}.name`)) ?? [];
  const completedTasks = item.tasks.filter((task) => task.status === 'completed').length;
  const countedTasks = item.tasks.filter(
    (task) => !UNCOUNTED_TASK_STATUSES.includes(task.status),
  ).length;

  return (
    <Sheet open={Boolean(item)} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-4 pr-12">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="text-[10px]">
              {tTypes(item.type)}
            </Badge>
            {item.priorityScore !== null && (
              <PriorityBadge score={item.priorityScore} level={item.priorityLevel} />
            )}
            <HistoryStatusBadge status={item.status} />
            <span className="ml-auto text-muted-foreground">AC-{item.actionNo}</span>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
              <ActionIcon
                kind={item.kind}
                category={item.type}
                className="h-4 w-4 text-muted-foreground"
              />
            </div>
            <div className="min-w-0">
              <SheetTitle>{texts.title}</SheetTitle>
              <SheetDescription>
                {new Date(date).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {item.sources.length > 0 && (
                  <> · {item.sources.map((source) => tSources(source)).join(' · ')}</>
                )}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4 text-sm">
          <section aria-busy={!ready}>
            <p className="text-xs font-medium text-muted-foreground">{t('drawer.goal')}</p>
            {ready ? (
              <p className="mt-1">{story?.goal ?? actionGoal(item.kind, tTexts, item.payload)}</p>
            ) : (
              <Skeleton className="mt-1.5 h-4 w-3/4" />
            )}
          </section>

          <Separator />

          <section aria-busy={!ready}>
            <p className="text-xs font-medium text-muted-foreground">{t('drawer.whatHappened')}</p>
            {ready ? (
              <p className="mt-1">{story?.why ?? texts.description}</p>
            ) : (
              <Skeleton className="mt-1.5 h-4 w-full" />
            )}
            {item.triggerSignals.length > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('drawer.triggeredBy', { count: item.triggerSignals.length })}
              </p>
            )}
          </section>

          <Separator />

          <section>
            <p className="text-xs font-medium text-muted-foreground">{t('drawer.result')}</p>
            {item.status === 'dismissed' && item.dismissReason && (
              <p className="mt-1 text-xs">
                {t('drawer.dismissedBecause', {
                  reason: tDismiss(`${item.dismissReason}.label`),
                })}
              </p>
            )}
            {!!item.readings?.length && (
              <p className="mt-1 text-xs">
                {t('drawer.readings', {
                  list: item.readings
                    .map((r) => t('drawer.reading', { day: r.day, outcome: tOutcome(r.outcome) }))
                    .join(' · '),
                })}
                {!item.outcomeFinal && (
                  <span className="text-muted-foreground">
                    {' '}
                    {t('drawer.finalOn', { day: FINAL_READING_DAY })}
                  </span>
                )}
              </p>
            )}
            {item.primaryMetric && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('drawer.primary', { metric: tRegistry(`${item.primaryMetric}.name`) })}
              </p>
            )}
            {item.measuredOn && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('drawer.measuredOn', { ...item.measuredOn })}
              </p>
            )}
            {item.dataGaps && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                {t(item.dataGaps.tooMany ? 'drawer.gapsTooMany' : 'drawer.gaps', {
                  before: item.dataGaps.before,
                  after: item.dataGaps.after,
                })}
              </p>
            )}
            {item.auditAfter && (
              // A fix's own aim: does the page pass when audited again?
              <p className="mt-1 text-xs">
                {item.auditAfter.audited
                  ? t('drawer.auditAfter', { ...item.auditAfter })
                  : t('drawer.auditNotYet', { pages: item.auditAfter.pages })}
              </p>
            )}
            {item.signalsAfter && (
              // The closest measure to the action's own aim: did what raised it end?
              <p className="mt-1 text-xs">{t('drawer.signalsAfter', { ...item.signalsAfter })}</p>
            )}
            {!measured && (
              // The honest state, and the reason for it. Everything above this
              // line is recorded; the effect is not, because nothing re-reads
              // these metrics after an action closes.
              <p className="mt-1 text-xs text-muted-foreground">
                {item.status === 'dismissed'
                  ? t('dismissedResult.explain')
                  : t(`outcomeExplain.${item.outcome}`)}
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {item.results.map((metric) => (
                <ResultMetricCard
                  key={metric.id}
                  label={tRegistry(`${metric.metric}.name`)}
                  before={metric.before ?? 0}
                  after={metric.after ?? 0}
                  delta={metric.delta ?? 0}
                  unit={metric.unit}
                />
              ))}
              <div className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">{t('drawer.timeToClose')}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {item.timeToCloseDays != null
                    ? t('drawer.days', { n: item.timeToCloseDays })
                    : '—'}
                </p>
                <p className="text-[11px] text-muted-foreground">{t('drawer.fromStart')}</p>
              </div>
            </div>
            {!!item.brandWideResults?.length && (
              // The second line: the whole brand over the same windows.
              <p className="mt-2 text-xs text-muted-foreground">
                {t('drawer.brandWide', {
                  list: item.brandWideResults
                    .map((m) => `${tRegistry(`${m.metric}.name`)} ${m.before} → ${m.after}`)
                    .join(' · '),
                })}
              </p>
            )}
            {item.controlNet && controlNet.length > 0 && (
              // Net of the brand's prompts it didn't touch (learning B2).
              <p className="mt-1 text-xs text-muted-foreground">
                {t('drawer.controlNet', {
                  basis: item.controlNet.basis,
                  prompts: item.controlNet.prompts,
                  list: controlNet
                    .map((m) =>
                      t(m.unit === 'points' ? 'drawer.netPoints' : 'drawer.netPercent', {
                        metric: tRegistry(`${m.metric}.name`),
                        value: `${m.net > 0 ? '+' : m.net < 0 ? '−' : ''}${Math.abs(m.net)}`,
                      }),
                    )
                    .join(' · '),
                })}
              </p>
            )}
          </section>

          <Separator />

          {item.positionOutcome && (
            <>
              <ImproveOutcomeCard
                outcome={item.positionOutcome}
                labels={improvePlatformLabels(item.payload)}
              />
              <Separator />
            </>
          )}

          <section>
            <p className="text-xs font-medium text-muted-foreground">{t('drawer.affected')}</p>
            {item.affected.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.affected.map((entity) => (
                  <Badge key={entity.id} variant="outline" className="text-[10px]">
                    {entity.count != null
                      ? tAffected(entity.type, { count: entity.count })
                      : entity.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t('drawer.noAffected')}</p>
            )}
          </section>

          <Separator />

          <section>
            <p className="text-xs font-medium text-muted-foreground">
              {t('drawer.tasks', { completed: completedTasks, total: countedTasks })}
            </p>
            {item.tasks.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {item.tasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        task.status === 'completed' ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                      )}
                    />
                    <span
                      className={cn(
                        'min-w-0 flex-1',
                        (task.status === 'completed' ||
                          UNCOUNTED_TASK_STATUSES.includes(task.status)) &&
                          'text-muted-foreground line-through',
                      )}
                    >
                      {/* A user-written title arrives verbatim; a generated task
                          arrives as its template key and is resolved here. */}
                      {tTasks.has(task.title) ? tTasks(task.title) : task.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {tTaskStatus(task.status)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t('drawer.noTasks')}</p>
            )}
          </section>
        </div>

        <div className="border-t px-6 py-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => router.push(`/dashboard/action-center/actions?action=${item.id}`)}
          >
            {t('drawer.viewAction')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
