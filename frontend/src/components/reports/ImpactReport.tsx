'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { readImpactReport, type ImpactRange, type ImpactReport } from '@/lib/actions/impactReport';
import { saveBlob } from '@/lib/download';
import {
  CHECKPOINT_DAYS,
  baselineDays,
  OUTCOMES,
  impactCsv,
  localDay,
  outcomeCounts,
  type CheckpointMark,
  type ImpactOutcome,
  type ImpactRow,
} from '@/lib/impact/report';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';

/** Each outcome's pill, in both themes (the Action Center's colors). */
const OUTCOME_PILL: Record<ImpactOutcome, string> = {
  improved:
    'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300',
  pending: 'text-muted-foreground',
  no_meaningful_change: 'text-foreground/80',
  declined:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  not_measurable:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
};

const PILL =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap';
const CHIP = 'inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-xs';

/** A month the page shows: its year and month (0–11), in the browser's time. */
interface Month {
  year: number;
  month: number;
}

const monthStart = ({ year, month }: Month, shift = 0) => new Date(year, month + shift, 1);

/** The month for the read: its start and end and the month before's start, as instants and days. */
function rangeOf(month: Month): ImpactRange {
  const [start, end, before] = [monthStart(month), monthStart(month, 1), monthStart(month, -1)];
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    previousFrom: before.toISOString(),
    days: { from: localDay(start), to: localDay(end), previousFrom: localDay(before) },
  };
}

const monthName = (month: Month, shift = 0, style: 'long' | 'short' = 'long') =>
  monthStart(month, shift).toLocaleDateString('en-US', {
    month: style,
    ...(style === 'long' ? { year: 'numeric' } : {}),
  });
const dayOf = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

/** A signed number as the table shows it: "+12", "−3", and "0" with no sign. */
const signed = (value: number) =>
  value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';

/**
 * Reports › "What GetCito did for you" (CHAT-22 feature 2 item 5, mockup
 * signature #f-impact): the month's shipped changes on the brand on screen,
 * each against untouched similar prompts. The headline counts only Medium
 * and High confidence verdicts; the table lists every change, with its
 * checkpoints (7, 14, 30, 90 days); a row opens its evidence. Export ▾
 * downloads the month as CSV. Every number is the measuring job's, read as
 * it kept it; nothing here says a change caused anything.
 */
export function ImpactReportView() {
  const t = useTranslations('reports.impact');
  const brandId = useBrandStore((s) => s.activeBrandId);
  const brands = useBrandStore((s) => s.brands);
  const brandName = brands.find((b) => b.id === brandId)?.name ?? null;
  const [month, setMonth] = useState<Month>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [filter, setFilter] = useState<'all' | ImpactOutcome>('all');
  const [opened, setOpened] = useState<ImpactRow | null>(null);
  const [attempt, setAttempt] = useState(0);
  // What the read for a brand, month and attempt answered: another one loads until it does.
  const readKey = `${brandId}|${month.year}-${month.month}|${attempt}`;
  const [answer, setAnswer] = useState<{ key: string; report: ImpactReport | null } | null>(null);
  const state: { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; report: ImpactReport } =
    answer?.key !== readKey
      ? { kind: 'loading' }
      : answer.report
        ? { kind: 'ready', report: answer.report }
        : { kind: 'failed' };

  const now = new Date();
  const atCurrent = month.year === now.getFullYear() && month.month === now.getMonth();

  useEffect(() => {
    if (!brandId) return;
    let current = true;
    const key = `${brandId}|${month.year}-${month.month}|${attempt}`;
    readImpactReport(brandId, rangeOf(month))
      .then((result) => {
        if (current) setAnswer({ key, report: result.ok ? result.report : null });
      })
      .catch(() => {
        if (current) setAnswer({ key, report: null });
      });
    return () => {
      current = false;
    };
  }, [brandId, month, attempt]);

  const report = state.kind === 'ready' ? state.report : null;
  const counts = useMemo(() => (report ? outcomeCounts(report.rows) : null), [report]);
  const rows = useMemo(
    () => (report?.rows ?? []).filter((row) => filter === 'all' || row.outcome === filter),
    [report, filter],
  );

  const tOutcome = (outcome: ImpactOutcome) => t(`outcome.${outcome}`);
  const exportCsv = useCallback(() => {
    if (!report) return;
    const csv = impactCsv(report.rows, {
      headers: [
        t('csv.change'),
        t('csv.shipped'),
        t('csv.source'),
        t('csv.action'),
        t('csv.prompts'),
        t('csv.metric'),
        t('csv.before'),
        t('csv.after'),
        t('csv.controlBefore'),
        t('csv.controlAfter'),
        t('csv.lift'),
        t('csv.checkpoint'),
        t('csv.outcome'),
        t('csv.confidence'),
      ],
      outcome: (outcome) => t(`outcome.${outcome}`),
      confidence: (confidence) => t(`confidence.${confidence}`),
      source: (source) => t(`source.${source}`),
    });
    const name = `getcito-impact-${month.year}-${String(month.month + 1).padStart(2, '0')}.csv`;
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
    toast(t('exported', { name }));
  }, [report, month, t]);

  if (!brandId) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('noBrand')}</p>;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">
            {brandName ? t('subtitle', { brand: brandName }) : t('subtitleNoBrand')}
          </p>
          {report && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('generated', {
                date: dayOf(report.generatedAt),
                time: timeOf(report.generatedAt),
              })}
              {report.dataAsOf &&
                ` · ${t('dataAsOf', { date: dayOf(report.dataAsOf), time: timeOf(report.dataAsOf) })}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border">
            <Button
              variant="ghost"
              size="icon-sm"
              data-action="impact.changeMonth"
              aria-label={t('previousMonth')}
              onClick={() => setMonth((m) => normalize(m, -1))}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span data-slot="month" className="min-w-[120px] px-1 text-center text-sm">
              {monthName(month)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              data-action="impact.changeMonth"
              aria-label={t('nextMonth')}
              disabled={atCurrent}
              onClick={() => setMonth((m) => normalize(m, 1))}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              data-action="impact.export"
              disabled={!report || report.rows.length === 0}
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('export')} ▾
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem data-action="impact.exportCsv" onClick={exportCsv}>
                <Download aria-hidden />
                {t('exportCsv')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {state.kind === 'loading' && (
        <div className="space-y-3" data-slot="impact-loading">
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-48" />
        </div>
      )}

      {state.kind === 'failed' && (
        <div className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
          <span>{t('loadFailed')}</span>
          <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            {t('retry')}
          </Button>
        </div>
      )}

      {report && counts && (
        <>
          <Kpis report={report} month={month} />
          {report.capped && (
            <p data-slot="impact-capped" className="text-xs text-muted-foreground">
              {t('capped', { count: report.rows.length, month: monthName(month) })}
            </p>
          )}
          <div role="group" aria-label={t('method.label')} className="flex flex-wrap gap-1.5">
            <span className={CHIP}>{t('method.baseline')}</span>
            <span className={CHIP} title={t('method.checkpointsTip')}>
              {t('method.checkpoints')}
            </span>
            <span className={CHIP}>{t('method.control')}</span>
            <span className={CHIP}>{t('method.minChange')}</span>
            <span className={CHIP}>{t('method.noCost')}</span>
            <span className={CHIP}>{t('method.correlation')}</span>
          </div>
          <div role="group" aria-label={t('filterLabel')} className="flex flex-wrap gap-1.5">
            {(['all', ...OUTCOMES] as const).map((key) => (
              <button
                key={key}
                type="button"
                data-action="impact.filterOutcome"
                data-outcome={key}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  filter === key
                    ? 'border-foreground bg-foreground text-background'
                    : 'hover:bg-muted',
                )}
              >
                {key === 'all' ? t('filters.all') : tOutcome(key)}
                <span className="tabular-nums opacity-70">{counts[key]}</span>
              </button>
            ))}
          </div>
          <ImpactTable
            rows={rows}
            empty={
              report.rows.length === 0
                ? t('empty', { month: monthName(month) })
                : t('emptyFilter', { month: monthName(month) })
            }
            onOpen={setOpened}
          />
        </>
      )}

      <Sheet open={!!opened} onOpenChange={(open) => !open && setOpened(null)}>
        <SheetContent side="right" className="w-full sm:max-w-[440px]">
          {opened && <Evidence row={opened} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The month before or after. */
function normalize(month: Month, shift: number): Month {
  const at = monthStart(month, shift);
  return { year: at.getFullYear(), month: at.getMonth() };
}

/** The headline (item 5): changes shipped, Improved X of Y (Medium and High only), AI traffic. */
function Kpis({ report, month }: { report: ImpactReport; month: Month }) {
  const t = useTranslations('reports.impact');
  const { summary, traffic } = report;
  const card = 'rounded-xl border bg-card p-3.5';
  const label = 'text-xs text-muted-foreground';
  const value = 'mt-1 block text-2xl font-semibold tabular-nums';
  const sub = 'mt-0.5 block text-xs text-muted-foreground';
  const change =
    traffic && traffic.previous > 0
      ? Math.round(((traffic.current - traffic.previous) / traffic.previous) * 100)
      : null;
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-slot="impact-kpis">
      <div className={card}>
        <small className={label}>{t('kpi.shipped')}</small>
        <b className={value}>{summary.shipped}</b>
        {summary.previous !== null && (
          <em className={cn(sub, 'not-italic')}>
            {t('kpi.shippedBefore', {
              month: monthName(month, -1, 'short'),
              count: summary.previous,
            })}
          </em>
        )}
      </div>
      <div className={card}>
        <small className={label}>{t('kpi.improved')}</small>
        <b className={value}>
          {t('kpi.improvedValue', { improved: summary.improved, judged: summary.judged })}
        </b>
        <em className={cn(sub, 'not-italic')}>
          {t('kpi.improvedSub', { pending: summary.pending })}
        </em>
      </div>
      <div className={card}>
        <small className={label}>{t('kpi.traffic')}</small>
        {traffic ? (
          <>
            <b className={value}>
              {change === null
                ? traffic.current > 0
                  ? t('kpi.trafficNew')
                  : '–'
                : `${signed(change)}%`}
            </b>
            <em className={cn(sub, 'not-italic')}>
              {t('kpi.trafficSub', { month: monthName(month, -1, 'long').split(' ')[0] })}
            </em>
          </>
        ) : (
          <span className={cn(sub, 'mt-2')}>
            {t('kpi.trafficConnect')}{' '}
            <Link
              href="/dashboard/settings/integrations"
              data-action="integrations.connect"
              className="text-foreground underline underline-offset-2"
            >
              {t('kpi.trafficConnectLink')}
            </Link>
          </span>
        )}
      </div>
    </div>
  );
}

/** The month's changes, a row each: what, before → after, control, lift, checkpoints, outcome, confidence. */
function ImpactTable({
  rows,
  empty,
  onOpen,
}: {
  rows: readonly ImpactRow[];
  empty: string;
  onOpen: (row: ImpactRow) => void;
}) {
  const t = useTranslations('reports.impact');
  const head = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground';
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[880px] text-sm">
        <thead className="border-b bg-muted/30">
          <tr>
            <th className={head}>{t('columns.action')}</th>
            <th className={head}>{t('columns.beforeAfter')}</th>
            <th className={head}>{t('columns.control')}</th>
            <th className={head}>{t('columns.lift')}</th>
            <th className={head}>
              <span className="sr-only">{t('columns.checkpoints')}</span>
              <span aria-hidden className="grid grid-cols-[repeat(4,38px)] gap-1 text-center">
                <span>{t('checkpoint.d7')}</span>
                <span>{t('checkpoint.d14')}</span>
                <span>{t('checkpoint.d30')}</span>
                <span>{t('checkpoint.d90')}</span>
              </span>
            </th>
            <th className={head}>{t('columns.outcome')}</th>
            <th className={head}>{t('columns.confidence')}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => <ImpactTableRow key={row.key} row={row} onOpen={onOpen} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

function ImpactTableRow({ row, onOpen }: { row: ImpactRow; onOpen: (row: ImpactRow) => void }) {
  const t = useTranslations('reports.impact');
  const percent = (value: number | null) => (value === null ? '–' : t('percent', { value }));
  const measured = row.before !== null && row.after !== null;
  return (
    <tr data-row={row.key} data-outcome={row.outcome} className="align-top">
      <td className="px-3 py-2.5">
        <button
          type="button"
          data-action="impact.openEvidence"
          onClick={() => onOpen(row)}
          className="text-left font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {row.title}
        </button>
        <span className="block text-xs text-muted-foreground">{sourceLine(row, t)}</span>
        <span className="block text-xs text-muted-foreground">
          {t('shipped', { date: dayOf(row.shippedAt) })} ·{' '}
          {t('prompts', { count: row.targetPrompts })}
        </span>
      </td>
      <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
        {measured ? `${percent(row.before)} → ${percent(row.after)}` : '–'}
      </td>
      <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
        {row.controlBefore !== null && row.controlAfter !== null
          ? `${percent(row.controlBefore)} → ${percent(row.controlAfter)}`
          : '–'}
      </td>
      <td
        className={cn(
          'px-3 py-2.5 tabular-nums whitespace-nowrap',
          row.effect !== null && row.effect > 0 && 'text-green-700 dark:text-green-400',
          row.effect !== null && row.effect < 0 && 'text-red-700 dark:text-red-400',
        )}
      >
        {row.effect !== null ? (
          t('lift', { value: signed(row.effect) })
        ) : row.direction ? (
          <span title={t(`direction.${row.direction}`)}>
            <span aria-hidden>{ARROW[row.direction]}</span>
            <span className="sr-only">{t(`direction.${row.direction}`)}</span>
          </span>
        ) : (
          '–'
        )}
      </td>
      <td className="px-3 py-2.5">
        <CheckpointStrip marks={row.checkpoints} />
      </td>
      <td className="px-3 py-2.5">
        <span className={cn(PILL, OUTCOME_PILL[row.outcome])}>{outcomeLabel(row, t)}</span>
      </td>
      <td className="px-3 py-2.5 text-xs">
        {row.confidence ? t(`confidence.${row.confidence}`) : '–'}
      </td>
    </tr>
  );
}

type T = ReturnType<typeof useTranslations<'reports.impact'>>;

/** "Pending · early signal" once day 7 is in; else the outcome's word. */
function outcomeLabel(row: ImpactRow, t: T): string {
  if (row.outcome === 'pending' && row.checkpoint === 'd7') return t('outcome.pendingEarly');
  return t(`outcome.${row.outcome}`);
}

/** "AC-1241 · Action Center · published to your CMS by you" */
function sourceLine(row: ImpactRow, t: T): string {
  const by =
    row.by.who === 'you'
      ? t('by.you')
      : row.by.who === 'automation'
        ? t('by.automation')
        : row.by.name
          ? t('by.teammate', { name: row.by.name })
          : t('by.teammateUnnamed');
  return [
    row.actionNo !== null ? `AC-${row.actionNo}` : null,
    t(`source.${row.source}`),
    `${t(`kind.${row.kind}`)} ${by}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Day 7's direction, its only reading (an early signal, no points). */
const ARROW = { up: '▲', flat: '–', down: '▼' } as const;

/** One checkpoint's box, as wide as "Nov 30" (the mockup's 38px). */
const CHECKPOINT =
  'flex h-7 items-center justify-center rounded-md text-[10.5px] whitespace-nowrap tabular-nums';

/** The 7d · 14d · 30d · 90d strip: each checkpoint's effect, its due day, or none. */
function CheckpointStrip({ marks }: { marks: readonly CheckpointMark[] }) {
  const t = useTranslations('reports.impact');
  return (
    <span
      role="group"
      aria-label={t('columns.checkpoints')}
      className="grid grid-cols-[repeat(4,38px)] gap-1"
    >
      {marks.map((mark) => {
        const day = CHECKPOINT_DAYS[mark.checkpoint];
        if (mark.state === 'due') {
          const label = t('checkpoint.due', { day, date: dayOf(mark.dueOn) });
          return (
            <span
              key={mark.checkpoint}
              data-checkpoint={mark.checkpoint}
              data-state="due"
              title={label}
              role="img"
              aria-label={label}
              className={cn(CHECKPOINT, 'border border-dashed text-muted-foreground')}
            >
              {dayOf(mark.dueOn)}
            </span>
          );
        }
        if (mark.state === 'none') {
          const label = t('checkpoint.none', { day });
          return (
            <span
              key={mark.checkpoint}
              data-checkpoint={mark.checkpoint}
              data-state="none"
              title={label}
              role="img"
              aria-label={label}
              className={cn(CHECKPOINT, 'text-muted-foreground')}
            >
              –
            </span>
          );
        }
        const label = mark.lasting
          ? t('checkpoint.measuredLasting', {
              day,
              outcome: t(`outcome.${mark.outcome}`),
              lasting: t(`lasting.${mark.lasting}`),
            })
          : t('checkpoint.measured', { day, outcome: t(`outcome.${mark.outcome}`) });
        return (
          <span
            key={mark.checkpoint}
            data-checkpoint={mark.checkpoint}
            data-state="measured"
            title={label}
            role="img"
            aria-label={label}
            className={cn(CHECKPOINT, 'border', OUTCOME_PILL[mark.outcome])}
          >
            {mark.checkpoint === 'd7' && mark.direction
              ? ARROW[mark.direction]
              : mark.effect !== null
                ? signed(mark.effect)
                : '–'}
          </span>
        );
      })}
    </span>
  );
}

/** A row's evidence (item 5's row detail): its windows, numbers, outcome, other changes and checkpoints. */
function Evidence({ row }: { row: ImpactRow }) {
  const t = useTranslations('reports.impact');
  const percent = (value: number | null) => (value === null ? '–' : t('percent', { value }));
  const baseline = row.window
    ? { from: row.window.preStart, to: row.window.preEnd }
    : baselineDays(row.shippedAt);
  const items: [string, string][] = [
    [
      t('drawer.baseline'),
      t('drawer.baselineValue', { from: dayOf(baseline.from), to: dayOf(baseline.to) }),
    ],
    [t('drawer.targets'), t('drawer.targetsValue', { count: row.targetPrompts })],
    ...(row.pages.length
      ? ([[t('drawer.pages'), row.pages.join(', ')]] as [string, string][])
      : []),
    ...(row.outcome === 'not_measurable'
      ? ([
          [
            t('drawer.why'),
            t(
              `reasons.${REASONS.has(row.notMeasurableReason ?? '') ? row.notMeasurableReason : 'other'}`,
            ),
          ],
        ] as [string, string][])
      : ([
          [t('drawer.before'), percent(row.before)],
          [t('drawer.latest'), percent(row.after)],
          [
            t('drawer.controlValue'),
            row.controlBefore !== null && row.controlAfter !== null
              ? `${percent(row.controlBefore)} → ${percent(row.controlAfter)}`
              : '–',
          ],
          [
            t('drawer.lift'),
            row.effect !== null
              ? t('lift', { value: signed(row.effect) })
              : row.direction
                ? t(`direction.${row.direction}`)
                : '–',
          ],
        ] as [string, string][])),
    [
      t('drawer.outcome'),
      row.confidence
        ? t('drawer.outcomeWithConfidence', {
            outcome: outcomeLabel(row, t),
            confidence: t(`confidence.${row.confidence}`),
          })
        : outcomeLabel(row, t),
    ],
    [
      t('drawer.sameWindow'),
      row.concurrent.length
        ? row.concurrent
            .map((c) => t('drawer.sameWindowRow', { title: c.title, count: c.sharedTargets }))
            .join('; ')
        : t('drawer.sameWindowNone'),
    ],
    [t('drawer.who'), sourceLine(row, t)],
  ];
  return (
    <div className="flex h-full flex-col overflow-y-auto" data-slot="impact-evidence">
      <SheetHeader className="pr-12">
        <SheetTitle>{row.title}</SheetTitle>
        <p className="text-xs text-muted-foreground">
          {t('shipped', { date: dayOf(row.shippedAt) })}
        </p>
      </SheetHeader>
      <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 text-sm">
        {items.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="m-0 [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mx-4 mt-5 mb-2 text-xs font-medium text-muted-foreground">
        {t('drawer.checkpoints')}
      </h3>
      <ol className="mx-4 mb-4 list-none divide-y rounded-lg border p-0 text-sm">
        {row.checkpoints.map((mark) => (
          <li
            key={mark.checkpoint}
            className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2"
          >
            <span className="text-muted-foreground">
              {t('drawer.day', { day: CHECKPOINT_DAYS[mark.checkpoint] })}
            </span>
            <span>{t(`drawer.checkpointRow.${mark.checkpoint}`)}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {mark.state === 'due'
                ? t('drawer.dueOn', { date: dayOf(mark.dueOn) })
                : mark.state === 'none'
                  ? '–'
                  : [
                      t(`outcome.${mark.outcome}`),
                      mark.effect !== null
                        ? t('lift', { value: signed(mark.effect) })
                        : mark.checkpoint === 'd7' && mark.direction
                          ? t(`direction.${mark.direction}`)
                          : null,
                      mark.lasting ? t(`lasting.${mark.lasting}`) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const REASONS = new Set([
  'too_few_runs',
  'too_few_controls',
  'too_few_prompts',
  'targets_removed',
  'engine_not_on_plan',
  'overlapping_change',
  'no_targets',
  'plan_inactive',
]);
