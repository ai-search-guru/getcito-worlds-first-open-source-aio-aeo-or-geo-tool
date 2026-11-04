'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TablePager, usePagination } from '@/components/TablePager';
import { Download, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/hooks/useUserRole';
import { listMentions } from '@/lib/actions/mentions';
import { mentionsQuery, type MentionsFilters } from '@/lib/mentionsFilters';
import {
  DEFAULT_MENTIONS_TABLE,
  MENTIONS_PAGE_SIZE,
  NO_COMPETITOR,
  mentionsTableParams,
  readMentionsTable,
  type MentionRow,
  type MentionSentiment,
  type MentionsList,
  type MentionsTableState,
} from '@/lib/mentionsList';
import { writeUrlParams } from '@/lib/urlState';
import { cn } from '@/lib/utils';
import type { Competitor } from '@/types';
import { FilterSelect } from './_FilterBar';
import type { MentionNames } from './_MentionParts';
import { MentionsTable } from './_MentionsTable';
import { ResponseDrawer } from './_ResponseDrawer';
import { useMentionActions } from './_useMentionActions';
import type { useMentionsExport } from './_useMentionsExport';

/** Typing in the search box reads once it pauses, not on every key. */
const READ_DELAY_MS = 250;
const ANY = '__any__';

type Loaded =
  | { brandId: string; key: string; status: 'ok'; list: MentionsList | null }
  | { brandId: string; key: string; status: 'error' };

function Message({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * The Mentions tab (MS-07): the answers naming the brand, a page of 100 at
 * a time, under the page's filters and the table's own (sentiment, a
 * competitor named in the same answer, grouping, sort), which live in the
 * URL too. A row opens the response drawer; ticked rows go to the Action
 * Center together, or into a CSV.
 */
export function MentionsListTab({
  brandId,
  filters,
  competitors,
  brandDomains,
  showCountry,
  exporter,
}: {
  brandId: string;
  filters: MentionsFilters;
  competitors: Competitor[];
  brandDomains: string[];
  showCountry: boolean;
  exporter: ReturnType<typeof useMentionsExport>;
}) {
  const t = useTranslations('mentions.table');
  const tActions = useTranslations('mentions.actions');
  const tExport = useTranslations('mentions.export');
  const tSentiment = useTranslations('mentions.overview.sentiment');
  const query = useMemo(() => mentionsQuery(filters), [filters]);

  // The table's controls, read from the URL once after mount.
  const [table, setTable] = useState<MentionsTableState>(DEFAULT_MENTIONS_TABLE);
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the URL after mount
    setTable(readMentionsTable(new URLSearchParams(window.location.search)));
    setUrlRead(true);
  }, []);
  useEffect(() => {
    if (urlRead) writeUrlParams(mentionsTableParams(table));
  }, [urlRead, table]);
  const patch = (next: Partial<MentionsTableState>) => setTable((prev) => ({ ...prev, ...next }));

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The last read's total: a failed read keeps it, so the pager stays on its page.
  const [total, setTotal] = useState(0);
  // Back to the first page whenever the filters or the controls change.
  const pager = usePagination(total, JSON.stringify([brandId, query, table]), MENTIONS_PAGE_SIZE);
  // Bumped to read the page again, e.g. after a correction moves a row out of
  // a sentiment filter.
  const [version, setVersion] = useState(0);
  const key =
    query && urlRead ? JSON.stringify([brandId, query, table, pager.page, version]) : null;

  useEffect(() => {
    if (!key || !query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      listMentions(brandId, query, table, pager.page)
        .then((list) => {
          if (cancelled) return;
          setLoaded({ brandId, key, status: 'ok', list });
          setTotal(list?.total ?? 0);
        })
        .catch(() => {
          if (!cancelled) setLoaded({ brandId, key, status: 'error' });
        });
    }, READ_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [brandId, key, query, table, pager.page]);

  const [open, setOpen] = useState<MentionRow | null>(null);
  const actions = useMentionActions(brandId);
  const { canManage } = useUserRole();

  // A corrected sentiment shows in the drawer and its row at once.
  const correctSentiment = (id: string, sentiment: MentionSentiment) => {
    setOpen((row) => (row && row.id === id ? { ...row, sentiment } : row));
    // Filtered by another sentiment, the row no longer belongs: read the page again.
    if (table.sentiment && table.sentiment !== sentiment) setVersion((v) => v + 1);
    setLoaded((prev) =>
      prev?.status === 'ok' && prev.list
        ? {
            ...prev,
            list: {
              ...prev.list,
              rows: prev.list.rows.map((r) => (r.id === id ? { ...r, sentiment } : r)),
            },
          }
        : prev,
    );
  };

  // Answers ticked for a bulk action, on the page shown; a new page or
  // filter starts with none.
  const shownRows = useMemo(
    () => (loaded?.status === 'ok' ? (loaded.list?.rows ?? []) : []),
    [loaded],
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [selectionKey, setSelectionKey] = useState<string | null>(null);
  const shownKey = loaded?.status === 'ok' ? loaded.key : null;
  if (selectionKey !== shownKey) {
    setSelectionKey(shownKey);
    setSelected(new Set());
  }
  const select = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const selectedRows = shownRows.filter((r) => selected.has(r.id));
  const sendSelected = async () => {
    if (await actions.send(selectedRows)) setSelected(new Set());
  };
  const exportSelected = () => {
    if (loaded?.status !== 'ok' || !loaded.list) return;
    void exporter.exportCsv(table, {
      total: loaded.list.total,
      prompts: loaded.list.prompts,
      rows: selectedRows,
    });
  };

  // A new page starts at its first row: the table scrolls inside its own box.
  const tableBox = useRef<HTMLDivElement>(null);
  const shownPage = loaded?.status === 'ok' ? loaded.key : null;
  useEffect(() => {
    const box = tableBox.current?.querySelector<HTMLElement>('[data-slot="table-container"]');
    if (box) box.scrollTop = 0;
  }, [shownPage]);

  // Each read returns the brand's names afresh; only a change in them re-marks the text.
  const brandKey = loaded?.status === 'ok' ? (loaded.list?.brandTerms ?? []).join('\n') : '';
  const names = useMemo<MentionNames>(
    () => ({
      brand: brandKey ? brandKey.split('\n') : [],
      competitors: competitors.flatMap((c) => [c.name, c.domain].filter(Boolean)),
    }),
    [brandKey, competitors],
  );

  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <FilterSelect
        label={t('sentiment')}
        value={table.sentiment || ANY}
        items={[
          { value: ANY, label: t('allSentiments') },
          { value: 'positive', label: tSentiment('positive') },
          { value: 'neutral', label: tSentiment('neutral') },
          { value: 'negative', label: tSentiment('negative') },
        ]}
        onChange={(v) =>
          patch({ sentiment: !v || v === ANY ? '' : (v as MentionsTableState['sentiment']) })
        }
        className="w-36"
      />
      <FilterSelect
        label={t('coMentioned')}
        value={table.competitor || ANY}
        items={[
          { value: ANY, label: t('anyCompetitor') },
          { value: NO_COMPETITOR, label: t('noCompetitor') },
          ...competitors.map((c) => ({ value: c.id, label: c.name })),
        ]}
        onChange={(v) => patch({ competitor: !v || v === ANY ? '' : v })}
        className="w-44"
      />
      <FilterSelect
        label={t('groupBy')}
        value={table.group || ANY}
        items={[
          { value: ANY, label: t('noGrouping') },
          { value: 'prompt', label: t('groupPrompt') },
          { value: 'platform', label: t('groupPlatform') },
        ]}
        onChange={(v) =>
          patch({ group: !v || v === ANY ? '' : (v as MentionsTableState['group']) })
        }
        className="w-32"
      />
      <FilterSelect
        label={t('sort')}
        value={table.sort}
        items={[
          { value: 'newest', label: t('sortNewest') },
          { value: 'oldest', label: t('sortOldest') },
          { value: 'co_mentions', label: t('sortCoMentions') },
          { value: 'negative', label: t('sortNegative') },
        ]}
        onChange={(v) => patch({ sort: (v as MentionsTableState['sort']) || 'newest' })}
        className="w-40"
      />
      {loaded?.status === 'ok' && loaded.list && (
        <span className="ml-auto pb-1.5 text-xs text-muted-foreground tabular-nums">
          {t('summary', { responses: loaded.list.total, prompts: loaded.list.prompts })}
        </span>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (!query) body = <Message>{t('pickDates')}</Message>;
  else if (!loaded || loaded.brandId !== brandId) body = <TableSkeleton />;
  else if (loaded.status === 'error')
    body = loaded.key === key ? <Message>{t('loadError')}</Message> : <TableSkeleton />;
  else if (!loaded.list) body = <Message>{t('unavailable')}</Message>;
  else if (loaded.list.rows.length === 0) body = <Message>{t('empty')}</Message>;
  else {
    // The last page stays on screen, dimmed, while a newer one is on its way.
    const stale = loaded.key !== key;
    body = (
      <Card
        ref={tableBox}
        className={cn('gap-0 overflow-hidden py-0 transition-opacity', stale && 'opacity-60')}
      >
        <MentionsTable
          rows={loaded.list.rows}
          names={names}
          group={table.group}
          showCountry={showCountry}
          selected={selected}
          onSelect={select}
          onOpen={setOpen}
        />
        <TablePager
          page={pager.page}
          totalPages={pager.totalPages}
          total={total}
          start={pager.start}
          end={pager.end}
          onPage={pager.setPage}
        />
      </Card>
    );
  }

  return (
    <section aria-label={t('sectionLabel')} className="flex flex-col gap-3">
      {controls}
      {selectedRows.length > 0 && (
        <div
          role="region"
          aria-label={tActions('selected', { count: selectedRows.length })}
          className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2 text-sm"
        >
          <span className="font-medium">
            {tActions('selected', { count: selectedRows.length })}
          </span>
          <Button size="sm" onClick={sendSelected} disabled={actions.sending}>
            <Send className="h-3.5 w-3.5" />
            {tActions('sendToActionCenter')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportSelected}
            disabled={exporter.busy !== null}
          >
            <Download className="h-3.5 w-3.5" />
            {tExport('exportSelected')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {tActions('clearSelection')}
          </Button>
        </div>
      )}
      {body}
      <ResponseDrawer
        brandId={brandId}
        row={open}
        names={names}
        domains={{
          brand: brandDomains,
          competitors: competitors.map((c) => c.domain).filter(Boolean),
        }}
        actions={actions}
        canCorrect={canManage}
        onSentimentChanged={correctSentiment}
        onClose={() => setOpen(null)}
      />
    </section>
  );
}

function TableSkeleton() {
  return (
    <Card className="gap-2 p-4" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </Card>
  );
}
