'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Bot, TriangleAlert } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { formatRelative } from '@/lib/formatRelative';
import { botName } from '@/lib/aiBotNames';
import { botReportState, logsPausedUntil, rowsPausedUntil, sampleBotTypes } from '@/lib/aiBots';
import { type BotConnections } from '@/lib/actions/aiBots';
import { type BotTypeRow, type TrafficBots, type TrafficDateWindow } from '@/lib/actions/traffic';
import { formatTrafficBucketDate } from './_charts';
import { BotsDialog } from './_BotsConnect';
import { getBotConnections, getTrafficBots } from '@/lib/trafficReads';
import { useRangeReady } from './_RangeReady';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { usePlanContext } from '@/components/context/PlanProvider';

/** Where Upgrade goes, as on the Prompts page's usage cards. */
const PLAN_PAGE = '/dashboard/settings?tab=billing';

/** Training, search index, user fetch: hits, pages read and when last seen (spec §3.7). */
function TypesTable({ types }: { types: BotTypeRow[] }) {
  const t = useTranslations('traffic.botReport');
  const tCommon = useTranslations('common');
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">{t('columns.type')}</TableHead>
          <TableHead className="text-right">{t('columns.hits')}</TableHead>
          <TableHead className="text-right">{t('columns.pages')}</TableHead>
          <TableHead className="pr-6 text-right">{t('columns.lastSeen')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {types.map((row) => (
          <TableRow key={row.type}>
            <TableCell className="pl-6 text-sm whitespace-normal">
              <span className="font-medium">{t(`types.${row.type}`)}</span>
              {row.bots.length > 0 && (
                <span className="text-muted-foreground">
                  {` (${row.bots.map(botName).join(', ')})`}
                </span>
              )}
            </TableCell>
            <TableCell className="text-right text-sm font-semibold tabular-nums">
              {formatNumber(row.hits)}
            </TableCell>
            <TableCell className="text-right text-sm tabular-nums">
              {formatNumber(row.pages)}
            </TableCell>
            <TableCell className="pr-6 text-right text-sm text-muted-foreground">
              {row.lastSeen ? formatRelative(row.lastSeen, tCommon) : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The most read pages, with when each type last read them (the per-page last crawl). */
function PagesTable({ report }: { report: TrafficBots }) {
  const t = useTranslations('traffic.botReport');
  const tCommon = useTranslations('common');
  const when = (iso: string | null) => (iso ? formatRelative(iso, tCommon) : '—');
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">{t('columns.page')}</TableHead>
            <TableHead className="text-right">{t('columns.hits')}</TableHead>
            <TableHead className="text-right">{t('types.training')}</TableHead>
            <TableHead className="text-right">{t('types.search')}</TableHead>
            <TableHead className="pr-6 text-right">{t('types.user')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.pages.map((row) => (
            <TableRow key={row.page}>
              <TableCell className="pl-6 max-w-[180px] xl:max-w-[320px]">
                <span
                  className="font-mono text-xs text-muted-foreground line-clamp-1"
                  title={row.page}
                >
                  {row.page}
                </span>
              </TableCell>
              <TableCell className="text-right text-sm font-semibold tabular-nums">
                {formatNumber(row.hits)}
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {when(row.trainingLast)}
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {when(row.searchLast)}
              </TableCell>
              <TableCell className="pr-6 text-right text-sm text-muted-foreground">
                {when(row.userLast)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {report.pageCount > report.pages.length && (
        <p className="px-6 pt-3 text-xs text-muted-foreground">
          {t('morePages', {
            shown: formatNumber(report.pages.length),
            count: formatNumber(report.pageCount),
          })}
        </p>
      )}
    </>
  );
}

/** "Cited pages not read by any search bot in 30 days" (spec §3.7). */
function UncrawledAlert({ report }: { report: TrafficBots }) {
  const t = useTranslations('traffic.botReport');
  if (report.alertState === 'stale') {
    return <p className="px-6 py-3 text-xs text-muted-foreground">{t('alertStale')}</p>;
  }
  if (report.uncrawledCount === null) {
    return report.alertFrom ? (
      <p className="px-6 py-3 text-xs text-muted-foreground">
        {t('alertStarts', { day: formatTrafficBucketDate(report.alertFrom) })}
      </p>
    ) : null;
  }
  if (report.uncrawledCount === 0) {
    return <p className="px-6 py-3 text-xs text-muted-foreground">{t('allCrawled')}</p>;
  }
  return (
    <div className="mx-6 my-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
      <p className="flex items-center gap-1.5 font-medium">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
        {t('uncrawled', { count: report.uncrawledCount })}
      </p>
      <ul className="mt-1 space-y-0.5 pl-5">
        {(report.uncrawled ?? []).map((row) => (
          <li key={row.page} className="flex justify-between gap-3">
            <span className="min-w-0 truncate font-mono" title={row.page}>
              {row.page}
            </span>
            <span className="shrink-0">{t('cited', { count: row.citations })}</span>
          </li>
        ))}
      </ul>
      {report.uncrawledCount > (report.uncrawled?.length ?? 0) && (
        <p className="mt-1 pl-5">
          {t('moreUncrawled', {
            count: report.uncrawledCount - (report.uncrawled?.length ?? 0),
          })}
        </p>
      )}
    </div>
  );
}

/** Sample data under a note: locked (Upgrade) or not connected (Connect, or preview it). */
function Overlay({ body, actions }: { body: string; actions: ReactNode }) {
  const t = useTranslations('traffic.botReport');
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/70 px-6 text-center backdrop-blur-[1px]">
      <p className="text-sm font-semibold">{t('overlayTitle')}</p>
      <p className="max-w-[420px] text-xs text-muted-foreground">{body}</p>
      <div className="flex flex-wrap justify-center gap-2">{actions}</div>
    </div>
  );
}

/**
 * AI bots reading your site (AT-011, spec §3.7, §7): the verified AI-bot
 * requests the brand's Cloudflare or Vercel sends, by type — training,
 * search index, user fetch — with the most read pages, when each type last
 * read them, and the cited pages no search bot read in 30 days.
 *
 * Starter sees it locked with sample data and Upgrade; a plan with the
 * report but nothing connected sees sample data under Connect, or can
 * preview it; once connected it waits for the first request.
 */
export function BotsReportSection({
  brandId,
  dateWindow,
  rangeLabel,
  canConnect,
  revision = 0,
  onChanged,
  typesActions,
  pagesActions,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  /** The page's own words for the range, e.g. "last 7 days". */
  rangeLabel: string;
  canConnect: boolean;
  /** Bumped when a connection is made or revoked anywhere on the page. */
  revision?: number;
  /** A connection was made or revoked here. */
  onChanged?: () => void;
  /** Each card's Excel / CSV buttons (AT-015). */
  typesActions?: ReactNode;
  pagesActions?: ReactNode;
}) {
  const t = useTranslations('traffic.botReport');
  const tBots = useTranslations('traffic.bots');
  const key = `${brandId}|${dateWindow.dateFrom ?? ''}|${dateWindow.dateTo ?? ''}|${revision}`;
  // The connections don't depend on the range: read again only on a change.
  const infoKey = `${brandId}|${revision}`;
  const [loaded, setLoaded] = useState<{ key: string; report: TrafficBots | null } | null>(null);
  const [connections, setConnections] = useState<{
    key: string;
    info: BotConnections | null;
    /** The last connections read without an error, for the dialog. */
    lastInfo: BotConnections | null;
  } | null>(null);
  const [preview, setPreview] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  // Without an active plan the caps read 0: the plan it was on decides the lock.
  const { isLocked } = useUpgradeGate();
  const { planId } = usePlanContext();
  const plan = { isLocked, planId };

  useEffect(() => {
    let cancelled = false;
    getBotConnections(brandId)
      .catch(() => ({ error: 'failed' }))
      .then((result) => {
        if (cancelled) return;
        const info = 'error' in result ? null : result;
        setConnections((prev) => ({
          key: infoKey,
          info,
          lastInfo: info ?? prev?.lastInfo ?? null,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, infoKey]);

  useEffect(() => {
    let cancelled = false;
    getTrafficBots(brandId, dateWindow)
      .catch((err) => {
        // Best effort: the rest of the page doesn't depend on this section.
        console.error('Failed to load the AI bot report:', err);
        return null;
      })
      .then((report) => {
        if (!cancelled) setLoaded({ key, report });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, key]);

  const ready = loaded?.key === key && connections?.key === infoKey;
  useRangeReady('botsReport', ready);
  const info = ready ? (connections?.info ?? null) : null;
  const report = ready ? (loaded?.report ?? null) : null;
  // The dialog keeps the connections it was opened with while the section
  // reads again after a change it made (the page bumps `revision`), and when
  // that read fails: taken down, it would lose the new connection's secret
  // and settings.
  const dialogInfo = info ?? connections?.lastInfo ?? null;
  const state = info ? botReportState(info, report, plan) : null;
  const pausedUntil = info ? rowsPausedUntil(info.usage) : null;
  // Past the raw cap log files aren't read: the report stops mid-month.
  const logsPaused = info ? logsPausedUntil(info) : null;

  const sample = (
    <div className="relative min-h-[220px]">
      <div aria-hidden className="pointer-events-none select-none opacity-50">
        <TypesTable types={sampleBotTypes()} />
      </div>
      {state === 'locked' ? (
        <Overlay
          body={t('lockedBody')}
          actions={
            <Link href={PLAN_PAGE} className={cn(buttonVariants({ size: 'sm' }), 'h-7 text-xs')}>
              {t('upgrade')}
            </Link>
          }
        />
      ) : (
        !preview && (
          <Overlay
            body={t('connectBody')}
            actions={
              <>
                <span title={canConnect ? undefined : tBots('notAllowed')}>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!canConnect}
                    onClick={() => setConnectOpen(true)}
                  >
                    {t('connect')}
                  </Button>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setPreview(true)}
                >
                  {t('preview')}
                </Button>
              </>
            }
          />
        )
      )}
    </div>
  );

  const body = !ready ? (
    <div className="px-6 py-4">
      <Skeleton className="h-4 w-56" />
    </div>
  ) : !info || (!report && state !== 'locked' && state !== 'off') ? (
    <p className="px-6 py-4 text-sm text-muted-foreground">{t('failed')}</p>
  ) : state === 'locked' || state === 'off' ? (
    sample
  ) : state === 'waiting' ? (
    <p className="px-6 py-4 text-sm text-muted-foreground">{t('waiting')}</p>
  ) : report!.types.length === 0 ? (
    <p className="px-6 py-4 text-sm text-muted-foreground">{t('emptyRange')}</p>
  ) : (
    <TypesTable types={report!.types} />
  );

  return (
    <section className="space-y-3" aria-labelledby="ai-bots-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="ai-bots-title" className="flex items-center gap-2 text-base font-semibold">
          <Bot className="h-4 w-4 text-muted-foreground" />
          {t('title')}
        </h2>
        <span className="max-w-full rounded-md border px-1.5 text-[11px] font-medium leading-4 text-muted-foreground sm:whitespace-nowrap">
          {t('needs')}
        </span>
        {preview && state === 'off' && (
          <span className="text-xs text-muted-foreground">{t('sampleNote')}</span>
        )}
        <Badge variant="outline" className="ml-auto text-xs">
          {/* "All time" covers the last 90 days here (00185). */}
          {dateWindow.dateFrom ? rangeLabel : t('allTimeCapped')}
        </Badge>
      </div>

      <div className={cn('grid grid-cols-1 gap-4', state === 'data' && 'xl:grid-cols-2')}>
        <Card className={cn(!ready && 'opacity-80')} aria-busy={!ready}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium">{t('typesTitle')}</CardTitle>
              {state === 'data' && typesActions}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {body}
            {state === 'data' && report && <UncrawledAlert report={report} />}
            {state === 'data' && pausedUntil && (
              <p className="px-6 pb-3 text-xs text-muted-foreground">
                {tBots('paused', {
                  day: formatTrafficBucketDate(pausedUntil),
                })}
              </p>
            )}
            {state === 'data' && logsPaused && (
              <p className="px-6 pb-3 text-xs text-muted-foreground">
                {tBots('logsPaused', { day: formatTrafficBucketDate(logsPaused) })}
              </p>
            )}
          </CardContent>
        </Card>

        {state === 'data' && report && report.pages.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium">{t('pagesTitle')}</CardTitle>
                {pagesActions}
              </div>
            </CardHeader>
            <CardContent className="p-0 pb-3">
              <PagesTable report={report} />
            </CardContent>
          </Card>
        )}
      </div>

      {dialogInfo && botReportState(dialogInfo, null, plan) !== 'locked' && (
        <BotsDialog
          brandId={brandId}
          open={connectOpen}
          info={dialogInfo}
          canConnect={canConnect}
          onOpenChange={setConnectOpen}
          onChanged={() => onChanged?.()}
        />
      )}
    </section>
  );
}
