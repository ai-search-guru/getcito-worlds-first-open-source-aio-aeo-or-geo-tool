'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowUpRight, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { TakeDownDialog } from '@/components/content/TakeDownDialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { exportActivityCsv, listActivity, undoActivity } from '@/lib/actions/chatActivity';
import { approvalLabel, type ActivityFilters, type ActivityRow } from '@/lib/chat/activityView';
import type { ToolArea } from '@/lib/chat/registry/defineTool';
import { cn } from '@/lib/utils';
import { ClassBadge } from './ClassBadge';

const SELECT =
  'h-8 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

interface Page {
  isAdmin: boolean;
  rows: ActivityRow[];
  hasMore: boolean;
  people: { id: string; name: string }[];
}

/**
 * The Activity log (CHAT-20 §10a): newest first, filtered by person (an
 * Admin's), area, class and "Auto changes only", with Undo on a change while
 * its window is open and CSV for Admins. Each row says what happened in
 * words (chatActivity.summary), never a tool's name.
 */
export function ActivityLogView({ areas }: { areas: ToolArea[] }) {
  const t = useTranslations('chatAccess.activity');
  const tTakeDown = useTranslations('contentEditor.takeDown');
  const tAreas = useTranslations('chatAccess.capabilities.areaNames');
  const tSummary = useTranslations('chatActivity.summary');
  const tTools = useTranslations('chatTools');
  const format = useFormatter();
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [page, setPage] = useState<Page | 'failed' | null>(null);
  const [version, setVersion] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Where to undo by hand a change that changed since, by row.
  const [conflicts, setConflicts] = useState<Record<string, string | null>>({});
  // Take down open on a row's page (PR 10), and the rows whose page went down here.
  const [takingDown, setTakingDown] = useState<ActivityRow | null>(null);
  const [takenDown, setTakenDown] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let live = true;
    listActivity(filters)
      .then((read) => {
        if (!live) return;
        setPage(read.ok ? read : 'failed');
      })
      .catch(() => {
        if (live) setPage('failed');
      });
    return () => {
      live = false;
    };
  }, [filters, version]);

  if (page === null) return <Skeleton className="h-96 w-full" />;
  if (page === 'failed') {
    return (
      <div role="status" className="space-y-2 text-sm text-muted-foreground">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p>{t('loadError')}</p>
        <Button size="sm" variant="outline" onClick={() => setVersion((n) => n + 1)}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const filtered = !!(filters.userId || filters.area || filters.kind || filters.autoOnly);
  const set = (next: Partial<ActivityFilters>) => setFilters((f) => ({ ...f, ...next }));

  async function loadMore(current: Page) {
    const last = current.rows.at(-1);
    if (!last) return;
    setMore(true);
    try {
      const read = await listActivity({ ...filters, before: last.at });
      if (read.ok) {
        setPage({ ...current, rows: [...current.rows, ...read.rows], hasMore: read.hasMore });
      } else {
        toast.error(t('loadError'));
      }
    } finally {
      setMore(false);
    }
  }

  async function undo(row: ActivityRow) {
    setBusy(row.id);
    try {
      const result = await undoActivity(row.id);
      if (!result.ok) {
        toast.error(t('loadError'));
        return;
      }
      if (result.code === 'ok') toast.success(result.message);
      else toast.info(result.message);
      if (result.code === 'conflict') setConflicts((c) => ({ ...c, [row.id]: result.href }));
      setVersion((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const result = await exportActivityCsv({ ...filters, before: undefined });
      if (!result.ok) {
        toast.error(t('exportFailed'));
        return;
      }
      const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('exported'));
    } finally {
      setExporting(false);
    }
  }

  const event = (row: ActivityRow) => {
    const name =
      row.toolKey && tTools.has(`${row.toolKey}.name`) ? tTools(`${row.toolKey}.name`) : '';
    if (row.summaryKey && tSummary.has(row.summaryKey)) {
      return tSummary(row.summaryKey, row.summaryParams);
    }
    return name;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('lead')}</p>
        </div>
        {page.isAdmin && (
          <Button size="sm" variant="outline" disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t('export')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {page.isAdmin && (
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t('filters.person')}</span>
            <select
              className={SELECT}
              value={filters.userId ?? ''}
              onChange={(e) => set({ userId: e.target.value || null })}
            >
              <option value="">{t('filters.everyone')}</option>
              {page.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{t('filters.area')}</span>
          <select
            className={SELECT}
            value={filters.area ?? ''}
            onChange={(e) => set({ area: (e.target.value || null) as ToolArea | null })}
          >
            <option value="">{t('filters.allAreas')}</option>
            {areas.map((area) => (
              <option key={area} value={area}>
                {tAreas(area)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{t('filters.kind')}</span>
          <select
            className={SELECT}
            value={filters.kind ?? ''}
            onChange={(e) => set({ kind: (e.target.value || null) as ActivityFilters['kind'] })}
          >
            <option value="">{t('filters.allKinds')}</option>
            {(['write', 'execute', 'denied'] as const).map((kind) => (
              <option key={kind} value={kind}>
                {t(`filters.kinds.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={!!filters.autoOnly}
            onChange={(e) => set({ autoOnly: e.target.checked })}
          />
          {t('autoOnly')}
        </label>
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setFilters({})}
          >
            {t('clear')}
          </Button>
        )}
      </div>

      {page.rows.length === 0 ? (
        <p className="rounded-xl border px-3.5 py-6 text-center text-sm text-muted-foreground">
          {filtered ? t('emptyFiltered') : t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.when')}</TableHead>
                <TableHead>{t('columns.who')}</TableHead>
                <TableHead>{t('columns.event')}</TableHead>
                <TableHead>{t('columns.class')}</TableHead>
                <TableHead>{t('columns.approval')}</TableHead>
                <TableHead>{t('columns.undo')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((row) => {
                const conflictHref = conflicts[row.id];
                return (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {format.dateTime(new Date(row.at), {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-medium">{row.isYou ? t('you') : row.person}</span>
                      <span className="block text-muted-foreground">
                        {t.has(`surfaces.${row.surface}`)
                          ? t(`surfaces.${row.surface}`)
                          : row.surface}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <span className={cn(row.status === 'undone' && 'line-through')}>
                        {event(row)}
                      </span>
                      {(row.area || row.denialCode) && (
                        <span className="block text-xs text-muted-foreground">
                          {[
                            row.area && tAreas(row.area),
                            row.denialCode &&
                              t.has(`denials.${row.denialCode}`) &&
                              t(`denials.${row.denialCode}`),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ClassBadge cls={row.kind === 'access.denied' ? 'never' : row.class} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t(`approval.${approvalLabel(row)}`)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.canUndo ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={busy === row.id}
                          onClick={() => void undo(row)}
                        >
                          {t('undo')}
                        </Button>
                      ) : row.takeDown && takenDown.has(row.id) ? (
                        <span className="text-muted-foreground">{tTakeDown('doneShort')}</span>
                      ) : row.takeDown ? (
                        // A page it published, still live: no Undo, but Take down (§6.4).
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                          data-action="activity.takeDown"
                          onClick={() => setTakingDown(row)}
                        >
                          {tTakeDown('action')}
                        </Button>
                      ) : row.kind === 'change' && row.status !== 'done' ? (
                        <span className="text-muted-foreground">
                          {t(`status.${row.status}`)}
                          {row.status === 'undo_conflict' && conflictHref && (
                            <Link
                              href={conflictHref}
                              className="ml-1 inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:underline"
                            >
                              {t('openToUndo')}
                              <ArrowUpRight className="h-3 w-3" />
                            </Link>
                          )}
                        </span>
                      ) : (
                        <span aria-hidden className="text-muted-foreground">
                          –
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {takingDown?.takeDown && (
            <TakeDownDialog
              page={takingDown.takeDown}
              onClose={() => setTakingDown(null)}
              onDone={() => setTakenDown((done) => new Set(done).add(takingDown.id))}
            />
          )}
        </div>
      )}

      {page.hasMore && (
        <div className="flex justify-center">
          <Button size="sm" variant="outline" disabled={more} onClick={() => void loadMore(page)}>
            {more && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
