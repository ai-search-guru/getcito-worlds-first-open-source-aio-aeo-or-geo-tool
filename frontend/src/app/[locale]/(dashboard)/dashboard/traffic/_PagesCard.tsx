'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileSearch, Lightbulb, ListPlus, Loader2, MoreHorizontal, Send } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useRecentAudit } from '@/components/audit/useRecentAudit';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { getPlatformName } from '@/lib/trafficPlatforms';
import { citationState, pageStatuses, pageUrl } from '@/lib/trafficPages';
import {
  type TrafficBrokenLink,
  type TrafficDateWindow,
  type TrafficPageRow,
  type TrafficPages,
  type TrafficPagesReason,
  type TrafficPagesTab,
} from '@/lib/actions/traffic';
import { runAudit } from '@/lib/actions/audits';
import { PAGE_ACTION_MAX, auditBlock, usePageActions } from './_usePageActions';
import { PagePromptsDialog } from './_PagePromptsDialog';
import { getTrafficPages } from '@/lib/trafficReads';
import { useRangeReady } from './_RangeReady';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useUserRole } from '@/hooks/useUserRole';

/**
 * Pages: which answers send visitors (AT-006, spec §3.5, "the
 * differentiator"). The brand's pages in the page's range, with their AI
 * visits, how often tracked answers cite them and the prompts pointing to
 * them, in three work lists and the full list:
 *
 *   - No AI traffic: pages with traffic in Google Analytics or in the
 *     sitemap that got no AI visit, ranked by value, with why (replaces
 *     "Pages AI engines aren't sending traffic to", in the same window).
 *   - Cited, not clicked: answers cite them at least 20 times, nobody clicks.
 *   - Traffic, no prompt: AI visitors arrive from questions no tracked
 *     prompt's answer covers.
 *   - Broken AI links: AI visitors landed on a page that doesn't exist, with
 *     the working page to redirect it to (AT-012); its Excel / CSV is the
 *     redirect list.
 *
 * A row's action is the next step for it: audit the page, or track prompts
 * suggested for it that point to it; its menu sends it to the Action Center. Under the two
 * lists Action Center works from, the pages shown go as one action, and
 * their cited pages can be audited at once (AT-006 part B).
 */

const TABS: TrafficPagesTab[] = [
  'noAiTraffic',
  'citedNotClicked',
  'trafficNoPrompt',
  'brokenAiLinks',
  'all',
];
const PAGE_SIZE = 10;

/** Which figure ranks No AI traffic, in the words of what the property reports. */
type ValueSignal = 'revenue' | 'transactions' | 'key_events' | 'engagement';

function valueSignal(rows: TrafficPageRow[]): ValueSignal {
  if (rows.some((r) => r.revenue > 0)) return 'revenue';
  if (rows.some((r) => r.transactions > 0)) return 'transactions';
  if (rows.some((r) => r.keyEvents > 0)) return 'key_events';
  return 'engagement';
}

function TabCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {formatNumber(count)}
    </span>
  );
}

function PageCell({ page }: { page: string }) {
  return (
    <TableCell className="pl-6 max-w-[180px] xl:max-w-[280px]">
      <span className="font-mono text-xs text-muted-foreground line-clamp-1" title={page}>
        {page}
      </span>
    </TableCell>
  );
}

const num = (n: number) => <span className="tabular-nums">{formatNumber(n)}</span>;

/** Broken AI links (AT-012): each missing page, what the visitor got and where to send it. */
function BrokenLinksTable({ rows }: { rows: TrafficBrokenLink[] }) {
  const t = useTranslations('traffic.pageList');
  const tCommon = useTranslations('common');
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">{t('columns.page')}</TableHead>
          <TableHead className="whitespace-normal text-right">{t('columns.aiVisits')}</TableHead>
          <TableHead className="whitespace-normal">{t('columns.platforms')}</TableHead>
          <TableHead className="whitespace-normal text-right">{t('columns.citations')}</TableHead>
          <TableHead className="whitespace-normal">{t('columns.lastVisit')}</TableHead>
          <TableHead className="pr-6">{t('columns.redirectTo')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.page} className="hover:bg-muted/50">
            <TableCell className="pl-6 min-w-36 max-w-[180px] whitespace-normal xl:max-w-[280px]">
              <span className="font-mono text-xs break-all line-clamp-2" title={row.page}>
                {row.page}
              </span>
              <div className="text-[10px] text-muted-foreground">
                {t(`broken.status.${row.status}`)}
              </div>
            </TableCell>
            <TableCell className="text-right font-semibold text-sm">{num(row.visits)}</TableCell>
            <TableCell className="min-w-24 whitespace-normal text-sm text-muted-foreground">
              {row.platforms.length ? row.platforms.map(getPlatformName).join(', ') : '—'}
            </TableCell>
            <TableCell className="text-right text-sm">{num(row.citations)}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatRelative(row.lastVisit, tCommon)}
            </TableCell>
            <TableCell className="pr-6 min-w-36 max-w-[200px] whitespace-normal xl:max-w-[360px]">
              {row.target ? (
                <>
                  <span
                    className="font-mono text-xs text-muted-foreground break-all line-clamp-2"
                    title={row.target}
                  >
                    → {row.target}
                  </span>
                  {row.targetReason && (
                    <div className="text-[10px] text-muted-foreground">
                      {t(`broken.reason.${row.targetReason}`)}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <span className="text-sm text-muted-foreground">—</span>
                  {row.targetReason === 'query' && (
                    <div className="text-[10px] text-muted-foreground">
                      {t('broken.reason.query')}
                    </div>
                  )}
                </>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PagesCard({
  brandId,
  dateWindow,
  rangeLabel,
  domain,
  analyticsMissing,
  actions,
  brokenActions,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  /** The page's own words for the range, e.g. "last 7 days". */
  rangeLabel: string;
  /** The brand's primary domain, for auditing a page. */
  domain: string | undefined;
  /** Google Analytics has no data for the brand: key events and No AI traffic are partial (§3.8b). */
  analyticsMissing: boolean;
  /** The section's Excel / CSV buttons (AT-015). */
  actions?: ReactNode;
  /** Broken AI links' own Excel / CSV: the redirect list (AT-012). */
  brokenActions?: ReactNode;
}) {
  const t = useTranslations('traffic.pageList');
  const tReason = useTranslations('traffic.pageOpportunities');
  const router = useRouter();
  const { askOne } = useRecentAudit();
  const [tab, setTab] = useState<TrafficPagesTab>('noAiTraffic');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [auditing, setAuditing] = useState<string | null>(null);
  const pageActions = usePageActions(brandId, dateWindow);
  // A read-only workspace (plan not active): Audit page, and Add prompts (its
  // dialog asks the AI as it opens), open the upgrade dialog instead.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Suggesting prompts or content for a page costs AI, and tracking adds
  // prompts: admins and managers do both.
  const { canManage } = useUserRole();
  const tManagers = useTranslations('managersOnly');
  // The page whose suggested prompts are open (part B2); each opening starts
  // afresh, and tracking some reads the list again for its prompt counts.
  const [promptsFor, setPromptsFor] = useState<string | null>(null);
  const [promptsOpened, setPromptsOpened] = useState(0);
  const [reloads, setReloads] = useState(0);

  const key = `${brandId}|${dateWindow.dateFrom ?? ''}|${dateWindow.dateTo ?? ''}|${tab}|${limit}|${reloads}`;
  // The loaded result carries the request it answers, as the KPI cards do:
  // no loading flag reset inside the effect, and the last list stays on
  // screen, faded, while another loads.
  const [loaded, setLoaded] = useState<{
    key: string;
    tab: TrafficPagesTab;
    result: TrafficPages | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTrafficPages(brandId, dateWindow, { tab, limit })
      .then((result) => {
        if (!cancelled) setLoaded({ key, tab, result });
      })
      .catch((err) => {
        // Best effort: the rest of the page doesn't depend on this list.
        console.error('Failed to load the Pages section:', err);
        if (!cancelled) setLoaded({ key, tab, result: null });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, tab, limit, key]);
  useRangeReady('pagesCard', loaded?.key === key);

  const result = loaded?.result ?? null;
  const stale = loaded !== null && loaded.key !== key;
  // Another tab's rows don't fit this tab's columns: wait for its own.
  const loading = !loaded || loaded.tab !== tab;
  const rows = loading ? [] : (result?.rows ?? []);
  const brokenRows = loading ? [] : (result?.brokenLinks ?? []);
  const shown = tab === 'brokenAiLinks' ? brokenRows.length : rows.length;
  const total = result?.counts[tab] ?? 0;
  const signal = valueSignal(rows);

  const changeTab = (next: TrafficPagesTab) => {
    setTab(next);
    setLimit(PAGE_SIZE);
  };

  const auditPage = async (page: string, force = false) => {
    if (!domain) return;
    setAuditing(page);
    try {
      // A running audit opens on its own page, which follows it to the end.
      // A page audited minutes ago asks first: Open it or Audit again.
      const url = pageUrl(domain, page);
      const started = force
        ? await runAudit(brandId, url, { force: true })
        : await runAudit(brandId, url);
      if (started.recent) {
        setAuditing(null);
        askOne(started.recent, () => void auditPage(page, true));
        return;
      }
      router.push(`/dashboard/audit/${started.audit.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('auditFailed'));
      setAuditing(null);
    }
  };

  const auditButton = (page: string) => (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-xs"
      disabled={!domain || auditing !== null}
      onClick={guard(() => void auditPage(page), { action: tActions('runAudit') })}
    >
      {auditing === page && <Loader2 className="h-3 w-3 animate-spin" />}
      {t('auditPage')}
    </Button>
  );

  const openPrompts = guard(
    (page: string) => {
      setPromptsFor(page);
      setPromptsOpened((n) => n + 1);
    },
    { action: tActions('suggestPrompts') },
  );

  const addPromptsButton = (page: string) =>
    canManage ? (
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openPrompts(page)}>
        {t('addPrompts')}
      </Button>
    ) : (
      <span className="text-xs text-muted-foreground">{tManagers('addPrompts')}</span>
    );

  /** A No AI traffic row's next step, by why AI engines skip it. */
  const reasonAction = (row: TrafficPageRow) =>
    citationState(row) === 'not_targeted' ? addPromptsButton(row.page) : auditButton(row.page);

  const platforms = (row: TrafficPageRow) =>
    row.aiPlatforms.length ? row.aiPlatforms.map(getPlatformName).join(', ') : '—';

  /**
   * A row's next step, with its menu: send the page to the Action Center,
   * suggest prompts for it when that isn't already its next step, and suggest
   * content for it (part B3).
   */
  const rowActions = (
    row: TrafficPageRow,
    next: ReactNode,
    reason: TrafficPagesReason,
    { addPrompts = true }: { addPrompts?: boolean } = {},
  ) => (
    <div className="flex items-center justify-end gap-1">
      {next}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={t('actions.menu', { page: row.page })}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            className="gap-2"
            disabled={pageActions.sending}
            onClick={() => void pageActions.send([row.page], reason)}
          >
            <Send className="h-3.5 w-3.5" />
            {t('actions.sendToActionCenter')}
          </DropdownMenuItem>
          {addPrompts && canManage && (
            <DropdownMenuItem className="gap-2" onClick={() => openPrompts(row.page)}>
              <ListPlus className="h-3.5 w-3.5" />
              {t('addPrompts')}
            </DropdownMenuItem>
          )}
          {canManage && (
            <DropdownMenuItem
              className="gap-2"
              disabled={pageActions.suggesting !== null}
              onClick={() => void pageActions.suggestContent(row.page, openPrompts)}
            >
              <Lightbulb className="h-3.5 w-3.5" />
              {t('actions.suggestContent')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  // The footer's actions, under the lists Action Center works from: the
  // pages shown as one action, and their cited pages audited at once.
  const listReason: TrafficPagesReason | null =
    tab === 'noAiTraffic'
      ? 'no_ai_traffic'
      : tab === 'citedNotClicked'
        ? 'cited_not_clicked'
        : null;
  const auditUrls =
    domain && listReason
      ? rows
          .filter((row) => tab === 'citedNotClicked' || citationState(row) === 'cited')
          .slice(0, PAGE_ACTION_MAX)
          .map((row) => pageUrl(domain, row.page))
      : [];
  const block = auditBlock(pageActions.quota, auditUrls.length, isLocked);

  return (
    <Card aria-busy={stale} className={cn('transition-opacity', stale && 'opacity-60')}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <FileSearch className="h-4 w-4 text-muted-foreground" />
            {t('title')}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {rangeLabel}
            </Badge>
            {tab === 'brokenAiLinks' ? brokenActions : actions}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        {analyticsMissing && <p className="text-xs text-muted-foreground">{t('needsAnalytics')}</p>}
      </CardHeader>
      <CardContent className="p-0">
        <Tabs value={tab} onValueChange={(v) => changeTab(v as TrafficPagesTab)}>
          <div className="px-6">
            <TabsList variant="line" aria-label={t('title')}>
              {TABS.map((id) => (
                <TabsTrigger key={id} value={id}>
                  {t(`tabs.${id}.label`)}
                  {result && <TabCount count={result.counts[id]} />}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <p className="px-6 pt-2 pb-1 text-xs text-muted-foreground">{t(`tabs.${tab}.explain`)}</p>

        {loading ? (
          <div className="px-6 py-4">
            <Skeleton className="h-4 w-64" />
          </div>
        ) : !result ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">{t('failed')}</p>
        ) : shown === 0 ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">{t(`tabs.${tab}.empty`)}</p>
        ) : tab === 'brokenAiLinks' ? (
          <BrokenLinksTable rows={brokenRows} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{t('columns.page')}</TableHead>
                {tab === 'noAiTraffic' && (
                  <>
                    <TableHead className="whitespace-normal">{t('columns.aiVisibility')}</TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.sessions')}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {tReason(`signals.${signal}.column`)}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {tReason('rank', { by: tReason(`signals.${signal}.by`) })}
                    </TableHead>
                  </>
                )}
                {tab === 'citedNotClicked' && (
                  <>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.citations')}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.prompts')}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.sessions')}
                    </TableHead>
                  </>
                )}
                {tab === 'trafficNoPrompt' && (
                  <>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.aiVisits')}
                    </TableHead>
                    <TableHead className="whitespace-normal">{t('columns.platforms')}</TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.keyEvents')}
                    </TableHead>
                  </>
                )}
                {tab === 'all' && (
                  <>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.aiVisits')}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.keyEvents')}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.citations')}
                    </TableHead>
                    <TableHead className="whitespace-normal">{t('columns.platforms')}</TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.prompts')}
                    </TableHead>
                    <TableHead className="pr-6">{t('columns.status')}</TableHead>
                  </>
                )}
                {tab !== 'all' && <TableHead className="pr-6" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.page} className="hover:bg-muted/50">
                  <PageCell page={row.page} />
                  {tab === 'noAiTraffic' && (
                    <>
                      <TableCell>
                        <div className="space-y-0.5">
                          <Badge
                            variant={citationState(row) === 'cited' ? 'secondary' : 'outline'}
                            className="text-xs"
                          >
                            {tReason(`citation.${citationState(row)}.label`)}
                          </Badge>
                          <div className="text-[10px] text-muted-foreground">
                            {tReason(`citation.${citationState(row)}.detail`, {
                              count:
                                citationState(row) === 'cited'
                                  ? row.citations
                                  : row.targetingPrompts,
                            })}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">{num(row.sessions)}</TableCell>
                      <TableCell className="text-right font-semibold text-sm">
                        {signal === 'revenue'
                          ? num(Math.round(row.revenue))
                          : signal === 'transactions'
                            ? num(row.transactions)
                            : signal === 'key_events'
                              ? num(row.keyEvents)
                              : tReason('minutes', {
                                  minutes: formatNumber(Math.round(row.engagementSeconds / 60)),
                                })}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                        {row.valueRank === null ? '—' : `#${row.valueRank}`}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        {rowActions(row, reasonAction(row), 'no_ai_traffic', {
                          addPrompts: citationState(row) !== 'not_targeted',
                        })}
                      </TableCell>
                    </>
                  )}
                  {tab === 'citedNotClicked' && (
                    <>
                      <TableCell className="text-right font-semibold text-sm">
                        {num(row.citations)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {num(row.targetingPrompts)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{num(row.sessions)}</TableCell>
                      <TableCell className="pr-6 text-right">
                        {rowActions(row, auditButton(row.page), 'cited_not_clicked')}
                      </TableCell>
                    </>
                  )}
                  {tab === 'trafficNoPrompt' && (
                    <>
                      <TableCell className="text-right font-semibold text-sm">
                        {num(row.aiVisits)}
                      </TableCell>
                      <TableCell className="min-w-24 whitespace-normal text-sm text-muted-foreground">
                        {platforms(row)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{num(row.aiKeyEvents)}</TableCell>
                      <TableCell className="pr-6 text-right">
                        {addPromptsButton(row.page)}
                      </TableCell>
                    </>
                  )}
                  {tab === 'all' && (
                    <>
                      <TableCell className="text-right font-semibold text-sm">
                        {num(row.aiVisits)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{num(row.aiKeyEvents)}</TableCell>
                      <TableCell className="text-right text-sm">{num(row.citations)}</TableCell>
                      <TableCell className="min-w-24 whitespace-normal text-sm text-muted-foreground">
                        {platforms(row)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {num(row.targetingPrompts)}
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex flex-wrap gap-1 text-sm text-muted-foreground">
                          {pageStatuses(row).map((status) => (
                            <Badge key={status} variant="outline" className="text-[10px]">
                              {t(`tabs.${status}.label`)}
                            </Badge>
                          ))}
                          {pageStatuses(row).length === 0 && '—'}
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!loading && result && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-xs text-muted-foreground">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {t('shown', { shown, total })} · {t('sameWindow')}
              </span>
              {shown < total && (
                <button
                  type="button"
                  disabled={stale}
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                  className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
                >
                  {t('showMore')}
                </button>
              )}
            </span>
            {listReason && rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {auditUrls.length > 0 && block && (
                  <span>
                    {block.reason === 'noneLeft'
                      ? t('actions.noneLeft')
                      : t('actions.overQuota', {
                          count: auditUrls.length,
                          remaining: block.remaining,
                        })}
                  </span>
                )}
                {auditUrls.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    disabled={stale || pageActions.auditing || block !== null}
                    onClick={() => void pageActions.auditMany(auditUrls)}
                  >
                    {pageActions.auditing && <Loader2 className="h-3 w-3 animate-spin" />}
                    {tab === 'noAiTraffic'
                      ? t('actions.auditCited', { count: auditUrls.length })
                      : t('actions.auditPages', { count: auditUrls.length })}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  disabled={stale || pageActions.sending}
                  onClick={() =>
                    void pageActions.send(
                      rows.map((row) => row.page),
                      listReason,
                    )
                  }
                >
                  {pageActions.sending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {t('actions.sendToActionCenter')}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
      <PagePromptsDialog
        key={promptsOpened}
        brandId={brandId}
        dateWindow={dateWindow}
        domain={domain}
        page={promptsFor}
        onClose={() => setPromptsFor(null)}
        onTracked={() => setReloads((n) => n + 1)}
      />
    </Card>
  );
}
