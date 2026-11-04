'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, Lock, MoreHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFirstRun } from '@/hooks/useFirstRun';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getLocationQuota,
  getPromptLocationMatrix,
  type LocationQuota,
} from '@/lib/actions/prompt';
import { formatNumber } from '@/lib/format';
import { createLimiter } from '@/lib/limiter';
import { HEAT_SHADES } from '@/lib/insightsTopics';
import {
  LOCATION_METRICS,
  MATRIX_REGIONS,
  cellShade,
  locationAverages,
  matrixInsights,
  matrixLocations,
  metricValue,
  rowGap,
  type LocationMetric,
  type PromptLocationCell,
  type PromptLocationMatrix,
  awaitsFirstAnswers,
  reachesToday,
} from '@/lib/promptLocationMatrix';
import { parseLocation, regionFlag, regionLabel } from '@/lib/region';
import { answersFrom } from '@/lib/trackingCountries';
import { useTrackingCountries } from '@/lib/useTrackingCountries';
import { cn } from '@/lib/utils';
import type { Prompt } from '@/types';

/**
 * Each location's figures read in the last minute, by brand, window and
 * location: switching views reads nothing again, and a location column
 * added to the table reads only its own location.
 */
const MATRIX_CACHE_MS = 60_000;
const regionCache = new Map<
  string,
  { at: number; read: Promise<Record<string, PromptLocationCell>> }
>();
/**
 * One matrix read from the page at a time, read-ahead included: the server
 * runs MATRIX_READS_AT_ONCE of a read's database reads at once, so the page
 * never runs more than that.
 */
const serverReads = createLimiter(1);

export function matrixKey(
  brandId: string,
  window: { from: string; to?: string },
  regions: string[],
) {
  return `${brandId}:${window.from}:${window.to ?? ''}:${regions.join(',')}`;
}

/**
 * The matrix for these locations: each location read in the last minute
 * as it was, the others in one new read (getPromptLocationMatrix). Also how
 * the view's Locations button reads ahead on hover, so the view opens on
 * data already there.
 */
export function loadLocationMatrix(
  brandId: string,
  window: { from: string; to?: string },
  regions: string[],
): Promise<PromptLocationMatrix> {
  const now = Date.now();
  const keyOf = (region: string) => matrixKey(brandId, window, [region]);
  const missing = regions.filter((r) => {
    const kept = regionCache.get(keyOf(r));
    return !kept || now - kept.at >= MATRIX_CACHE_MS;
  });
  if (missing.length) {
    const read = serverReads(() =>
      getPromptLocationMatrix(brandId, { from: window.from, to: window.to, regions: missing }),
    );
    for (const region of missing) {
      const key = keyOf(region);
      const one = read.then((matrix) => {
        const cells: Record<string, PromptLocationCell> = {};
        for (const [promptId, byRegion] of Object.entries(matrix)) {
          if (byRegion[region]) cells[promptId] = byRegion[region];
        }
        return cells;
      });
      regionCache.set(key, { at: now, read: one });
      one.catch(() => {
        if (regionCache.get(key)?.read === one) regionCache.delete(key);
      });
    }
  }
  return Promise.all(regions.map((r) => regionCache.get(keyOf(r))!.read)).then((reads) => {
    const matrix: PromptLocationMatrix = {};
    reads.forEach((cells, i) => {
      for (const [promptId, cell] of Object.entries(cells)) {
        (matrix[promptId] ??= {})[regions[i]] = cell;
      }
    });
    return matrix;
  });
}

/** After prompts or their locations change: the next read is a new one. */
export function clearLocationMatrixCache() {
  regionCache.clear();
}

/**
 * A location a prompt is tracked in that has no answers yet, and why: a
 * paused prompt; none of its engines answering from there; or, usually,
 * just added: the next daily run asks it, within 24 hours. While the
 * brand's first run goes on, that run is asking it now ("Arriving now").
 * Without a location, the same for the prompt in the Table view
 * (pendingColumn).
 */
export function LocationPending({
  prompt,
  region,
  window,
  awaiting,
  className,
}: {
  prompt: Pick<Prompt, 'isActive' | 'platforms' | 'models'>;
  /** Undefined for the prompt across every location it's tracked in. */
  region?: string;
  /** The table's window: one that ended before today just had no answers there. */
  window: { to?: string };
  /**
   * Whether its first answers can still be on their way (awaitsFirstAnswers).
   * If not, an active prompt just had none there in this window: a dash.
   */
  awaiting: boolean;
  className?: string;
}) {
  const t = useTranslations('prompts.locations');
  const countries = useTrackingCountries();
  const firstRun = useFirstRun();
  const tipId = useId();
  const parsed = region ? parseLocation(region) : null;
  const state = !reachesToday(window)
    ? null
    : !prompt.isActive
      ? 'paused'
      : parsed && !answersFrom(prompt, parsed, countries)
        ? 'noEngine'
        : awaiting
          ? 'pending'
          : null;
  if (!state) {
    return (
      <span
        className={cn('text-xs text-muted-foreground', className)}
        title={region ? t('noAnswers') : undefined}
      >
        —
      </span>
    );
  }
  // A new prompt in the brand's first run: asked now, not by the next daily run.
  const arriving = state === 'pending' && firstRun !== null;
  const tip = arriving
    ? t('arrivingTip')
    : !region && state === 'pending'
      ? t('promptPendingTip')
      : t(`${state}Tip`, { location: region ? regionLabel(region) : '' });
  // Why, on hover and on keyboard focus; and for a screen reader, as the
  // label's description.
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          delay={300}
          closeDelay={0}
          render={
            <button
              type="button"
              aria-describedby={tipId}
              className={cn(
                'inline-flex cursor-help items-center justify-center gap-1 rounded-md text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                state === 'noEngine'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-muted-foreground',
                className,
              )}
            />
          }
        >
          {state === 'pending' && <Clock className="h-3 w-3" aria-hidden />}
          {arriving ? t('arriving') : t(state)}
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{tip}</TooltipContent>
      </Tooltip>
      <span id={tipId} className="sr-only">
        {tip}
      </span>
    </>
  );
}

/** A location's kind, for its column's second line. */
function locationKind(code: string): 'country' | 'state' | 'city' {
  const parsed = parseLocation(code);
  return parsed?.city ? 'city' : parsed?.state ? 'state' : 'country';
}

/**
 * Tracked Prompts' Locations view (PROMPT-015b): each prompt in each
 * location the brand tracks, side by side, for one metric at a time, in
 * Brand Visibility's Topics vs competitors shades. A cell opens the
 * prompt's Positions panel for that location; one the prompt isn't tracked
 * in offers + Track, one it is (and not only there) offers Stop tracking
 * here, and a location's column menu stops it for the prompts shown.
 */
export function LocationMatrix({
  brandId,
  rows,
  pageRows,
  window,
  onOpenCell,
  onTrack,
  onStopTracking,
  onAddLocations,
}: {
  brandId: string;
  /** Every row the filters keep, for the averages and the cards. */
  rows: Prompt[];
  /** The rows on this page of the table. */
  pageRows: Prompt[];
  /** The table's window. */
  window: { from: string; to?: string };
  onOpenCell: (promptId: string, region: string) => void;
  /** Adds the location to the prompt; undefined for members who can't edit. */
  onTrack?: (prompt: Prompt, region: string) => void;
  /**
   * Opens stop tracking for the location, for one prompt or (null) the
   * prompts shown; undefined for members who can't edit.
   */
  onStopTracking?: (prompt: Prompt | null, region: string) => void;
  /** Opens Track in more locations; undefined for members who can't edit. */
  onAddLocations?: () => void;
}) {
  const t = useTranslations('prompts.locations');
  const tAdd = useTranslations('prompts.addLocations');
  const [metric, setMetric] = useState<LocationMetric>('visibility');
  const allRegions = matrixLocations(rows);
  const regions = allRegions.slice(0, MATRIX_REGIONS);
  const key = matrixKey(brandId, window, regions);
  // The plan's prompt locations, so + Track says when they're used up.
  const [quota, setQuota] = useState<LocationQuota | null>(null);
  // Read again when the brand's tracked locations change, not on every render.
  const canTrack = Boolean(onTrack);
  const tracked = rows.reduce((n, p) => n + (p.isActive ? p.regions.length : 0), 0);
  useEffect(() => {
    if (!canTrack) return;
    let cancelled = false;
    getLocationQuota(brandId)
      .then((q) => {
        if (!cancelled) setQuota(q);
      })
      .catch((err) => console.error('Failed to read the plan usage:', err));
    return () => {
      cancelled = true;
    };
  }, [brandId, canTrack, tracked]);
  const limitReached = quota !== null && quota.maxPrompts !== -1 && quota.used >= quota.maxPrompts;
  const [read, setRead] = useState<{ key: string; matrix: PromptLocationMatrix | 'failed' } | null>(
    null,
  );

  useEffect(() => {
    if (!regions.length) return;
    let cancelled = false;
    loadLocationMatrix(brandId, window, regions)
      .then((matrix) => {
        if (!cancelled) setRead({ key, matrix });
      })
      .catch((err) => {
        console.error('Failed to read the locations view:', err);
        if (!cancelled) setRead({ key, matrix: 'failed' });
      });
    return () => {
      cancelled = true;
    };
    // `regions` is in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const addButton = onAddLocations && (
    <Button size="sm" className="h-8 text-xs" onClick={onAddLocations}>
      {tAdd('button')}
    </Button>
  );
  if (!regions.length) {
    return (
      <div className="space-y-3 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">{t('none')}</p>
        {addButton}
      </div>
    );
  }
  const matrix = read?.key === key ? read.matrix : undefined;
  if (matrix === undefined) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }
  if (matrix === 'failed') {
    return <p className="px-6 py-10 text-center text-sm text-muted-foreground">{t('failed')}</p>;
  }

  const valuesOf = (p: Prompt) => regions.map((r) => metricValue(matrix[p.id]?.[r], metric));
  const inView = pageRows.flatMap((p) => valuesOf(p).filter((v): v is number => v !== null));
  const averages = locationAverages(
    matrix,
    rows.map((p) => p.id),
    regions,
    metric,
  );
  const insights = matrixInsights(matrix, rows, regions);
  const shown = (v: number) =>
    metric === 'position' ? `#${v.toFixed(1)}` : formatNumber(Math.round(v));
  const label = (r: string) => `${regionFlag(r)} ${regionLabel(r)}`.trim();

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-wrap items-center gap-3 px-6">
        <div
          role="group"
          aria-label={t('metric')}
          className="inline-flex gap-0.5 rounded-full border bg-background p-0.5"
        >
          {LOCATION_METRICS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
              className={cn(
                'h-7 rounded-full px-3 text-xs transition-colors',
                metric === m
                  ? 'bg-foreground font-medium text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`metrics.${m}`)}
            </button>
          ))}
        </div>
        {allRegions.length > regions.length && (
          <span className="text-xs text-muted-foreground">
            {t('capped', { count: MATRIX_REGIONS })}
          </span>
        )}
        <span className="flex-1" />
        {addButton}
      </div>

      <div className="grid gap-3 px-6 sm:grid-cols-3">
        {insights.weakest && (
          <div className="space-y-0.5 rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{t('weakest')}</p>
            <p className="text-base font-semibold">
              {label(insights.weakest.region)} · {insights.weakest.average}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('weakestBody', {
                overall: insights.overall ?? 0,
                untracked: insights.weakest.untracked,
              })}
            </p>
          </div>
        )}
        {insights.strongest && (
          <div className="space-y-0.5 rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{t('strongest')}</p>
            <p className="text-base font-semibold">
              {label(insights.strongest.region)} · {insights.strongest.average}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('strongestBody', { tracked: insights.strongest.tracked })}
            </p>
          </div>
        )}
        {insights.widest && (
          <div className="min-w-0 space-y-0.5 rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{t('widest')}</p>
            <p className="truncate text-base font-semibold" title={insights.widest.text}>
              “{insights.widest.text}”
            </p>
            <p className="text-xs text-muted-foreground">
              {t('widestBody', {
                low: insights.widest.low,
                lowAt: regionLabel(insights.widest.lowAt),
                high: insights.widest.high,
                highAt: regionLabel(insights.widest.highAt),
              })}
            </p>
          </div>
        )}
      </div>

      <Table stickyHeader stickyFirstColumn>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">{t('prompt')}</TableHead>
            <TableHead>{t('topic')}</TableHead>
            {regions.map((r) => (
              <TableHead key={r} className="min-w-[96px] text-center">
                <span className="flex items-center justify-center gap-0.5 text-xs font-medium text-foreground">
                  {label(r)}
                  {onStopTracking && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        aria-label={t('columnMenu', { location: regionLabel(r) })}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => onStopTracking(null, r)}>
                          {t('stopColumn', { location: regionLabel(r) })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </span>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {t(`kind.${locationKind(r)}`)}
                </span>
                {locationKind(r) === 'city' && (
                  <span
                    className="mt-0.5 inline-block rounded-full bg-muted px-1.5 text-[10px] font-normal text-muted-foreground"
                    title={t('cityEnginesTip')}
                  >
                    {t('cityEngines')}
                  </span>
                )}
              </TableHead>
            ))}
            <TableHead className="pr-6 text-right" title={t('gapTip')}>
              {t('gap')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell className="pl-6 text-sm font-medium">{t('average')}</TableCell>
            <TableCell className="text-xs text-muted-foreground">—</TableCell>
            {averages.map((v, i) => (
              <TableCell key={regions[i]} className="px-1 py-1.5">
                <div
                  className={cn(
                    'rounded-md py-1.5 text-center text-sm font-semibold tabular-nums',
                    HEAT_SHADES[cellShade(v, inView, metric)],
                  )}
                >
                  {v === null ? '—' : shown(v)}
                </div>
              </TableCell>
            ))}
            <TableCell className="pr-6 text-right text-xs text-muted-foreground">—</TableCell>
          </TableRow>
          {pageRows.map((p) => {
            const values = valuesOf(p);
            const gap = rowGap(values);
            // Its empty locations wait for their first answers only while it's
            // new, or answered elsewhere (a location just added).
            const awaiting = awaitsFirstAnswers(
              p,
              Object.values(matrix[p.id] ?? {}).some((c) => c.runs > 0),
            );
            return (
              <TableRow key={p.id}>
                <TableCell className="max-w-[320px] pl-6 text-sm font-medium">
                  <span className="line-clamp-2" title={p.text}>
                    {p.text}
                  </span>
                </TableCell>
                <TableCell className="max-w-[140px]">
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.category?.trim() || '—'}
                  </span>
                </TableCell>
                {regions.map((r, i) => {
                  const cell = matrix[p.id]?.[r];
                  const v = values[i];
                  const where = regionLabel(r);
                  if (!p.regions.includes(r)) {
                    return (
                      <TableCell key={r} className="px-1 py-1.5">
                        {onTrack && limitReached ? (
                          // The plan's locations are used up: the dialog says how to get more.
                          <button
                            type="button"
                            aria-label={t('limitLabel', {
                              prompt: p.text,
                              location: where,
                              used: quota!.used,
                              max: quota!.maxPrompts,
                            })}
                            title={t('limitTip', { used: quota!.used, max: quota!.maxPrompts })}
                            onClick={() => onTrack(p, r)}
                            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-1.5 text-[11px] text-amber-700 transition-colors hover:border-amber-500/60 dark:text-amber-400"
                          >
                            <Lock className="h-3 w-3" aria-hidden />
                            {t('limit')}
                          </button>
                        ) : onTrack ? (
                          <button
                            type="button"
                            aria-label={t('trackLabel', { prompt: p.text, location: where })}
                            onClick={() => onTrack(p, r)}
                            className="block w-full rounded-md border border-dashed py-1.5 text-center text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                          >
                            {t('track')}
                          </button>
                        ) : (
                          <span className="block text-center text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  }
                  // The counterpart of + Track, on hover or keyboard focus; never
                  // clickable unseen (a touch screen has no hover), and not on a
                  // prompt's last location, which it keeps.
                  const stop = onStopTracking && p.regions.some((code) => code !== r) && (
                    <button
                      type="button"
                      aria-label={t('stopLabel', { prompt: p.text, location: where })}
                      title={t('stop')}
                      onClick={() => onStopTracking(p, r)}
                      className="pointer-events-none absolute right-1.5 top-2 inline-flex h-4 w-4 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover/cell:pointer-events-auto group-hover/cell:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" aria-hidden />
                    </button>
                  );
                  if (!cell || cell.runs === 0) {
                    return (
                      <TableCell key={r} className="group/cell relative px-1 py-1.5 text-center">
                        <LocationPending
                          prompt={p}
                          region={r}
                          window={window}
                          awaiting={awaiting}
                          className="w-full py-1.5"
                        />
                        {stop}
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={r} className="group/cell relative px-1 py-1.5">
                      <button
                        type="button"
                        aria-label={t('open', { prompt: p.text, location: where })}
                        onClick={() => onOpenCell(p.id, r)}
                        className={cn(
                          'block w-full rounded-md py-1.5 text-center text-sm font-semibold tabular-nums transition-shadow hover:ring-1 hover:ring-foreground/30',
                          HEAT_SHADES[cellShade(v, inView, metric)],
                        )}
                      >
                        {v === null ? t('notNamed') : shown(v)}
                      </button>
                      {stop}
                    </TableCell>
                  );
                })}
                <TableCell className="pr-6 text-right text-sm font-semibold tabular-nums">
                  {gap === null ? (
                    <span className="text-xs font-normal text-muted-foreground">—</span>
                  ) : metric === 'position' ? (
                    gap.toFixed(1)
                  ) : (
                    formatNumber(Math.round(gap))
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center gap-4 px-6 pb-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {metric === 'position' ? t('late') : t('low')}
          <span aria-hidden className="inline-flex overflow-hidden rounded border">
            {HEAT_SHADES.map((shade) => (
              <span key={shade} className={cn('h-2.5 w-4', shade)} />
            ))}
          </span>
          {metric === 'position' ? t('first') : t('high')}
        </span>
        <span>{t('gapTip')}</span>
        <span>{t('legend')}</span>
      </div>
    </div>
  );
}
