'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Download, FileText, PenLine } from 'lucide-react';
import { useGetMore } from '@/components/ai-usage/getMoreContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/i18n/navigation';
import type { ChatFileList } from '@/lib/chat/fileList';
import {
  FILE_FILTERS,
  ZIP_MAX_FILES,
  gbLabel,
  knownFormats,
  storageTone,
  type ChatFileFilter,
  type ChatFileItem,
  type ChatStorage,
} from '@/lib/chat/files';
import { stampParts } from '@/lib/chat/stamp';
import { saveBlob } from '@/lib/download';
import { cn } from '@/lib/utils';
import { DELIVERABLE_ICONS } from './run/DeliverableCard';

/**
 * Files (CHAT-06 items 12, 16–19, 26–29; mockup `#s-files`): everything
 * Chat finished, for the workspace, newest first. Filter chips and "Filter
 * by name…" narrow the list; each row has Copy, Open (its Content draft)
 * and Download in the formats it offers; picked rows download as one .zip.
 * The storage meter sits top right: amber from 80%, and a line under the
 * header once storage is full (Get more storage waits for the plan rules).
 */

/** The formats a row downloads in, in Download's order (as the output card). */
const FORMAT_ORDER = ['html', 'md', 'docx', 'pdf', 'csv', 'xlsx'] as const;
/** "Filter by name…" asks once the typing stops. */
const SEARCH_DELAY_MS = 250;

/** The table's columns (mockup `.files`): select · name · made by · from chat · updated · actions. */
const COLS =
  'grid grid-cols-[24px_minmax(0,2fr)_minmax(0,.6fr)_minmax(0,.8fr)_140px_244px] items-center gap-3 px-3.5 max-[900px]:grid-cols-[24px_minmax(0,1fr)_244px]';
const HIDE_NARROW = 'max-[900px]:hidden';
const ACTION =
  'flex h-7 items-center gap-1.5 rounded-lg border bg-card px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** The file name a download came with (Content-Disposition), else one of our own. */
function fileNameOf(res: Response, fallback: string): string {
  const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  return named?.[1] ?? fallback;
}

const FILL = { ok: 'bg-foreground', warning: 'bg-amber-500', full: 'bg-red-500' } as const;

/**
 * "Storage 2.1 of 25 GB" with a thin bar; its tooltip says how long files
 * are kept (item 27). With a limit, clicking it opens the Get more window on
 * Storage (CHAT-18 §B item 6).
 */
function StorageMeter({ storage }: { storage: ChatStorage }) {
  const t = useTranslations('chatFiles');
  const openGetMore = useGetMore();
  const tone = storageTone(storage);
  const used = gbLabel(storage.usedBytes);
  const limit = storage.limitBytes;
  const width = limit ? `${Math.min(100, (storage.usedBytes / limit) * 100)}%` : '0%';
  const className = cn(
    'flex items-center gap-2 rounded-lg text-[12.5px] text-muted-foreground tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
    tone === 'warning' && 'text-amber-700 dark:text-amber-400',
    tone === 'full' && 'text-red-700 dark:text-red-400',
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          openGetMore && limit !== null ? (
            <button
              type="button"
              data-slot="storage-meter"
              data-action="files.getMoreStorage"
              data-tone={tone}
              onClick={() => openGetMore('storage')}
              className={cn(className, 'hover:text-foreground')}
            />
          ) : (
            <span tabIndex={0} data-slot="storage-meter" data-tone={tone} className={className} />
          )
        }
      >
        {limit === null
          ? t('storageNoLimit', { used })
          : t('storage', { used, limit: gbLabel(limit) })}
        {limit !== null && (
          <span aria-hidden className="block h-1.5 w-11 overflow-hidden rounded-full bg-muted">
            <span className={cn('block h-full rounded-full', FILL[tone])} style={{ width }} />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{t('storageTip')}</TooltipContent>
    </Tooltip>
  );
}

/** A page of Files, or null when it couldn't be read. */
async function readFiles(
  filter: ChatFileFilter,
  q: string,
  offset: number,
): Promise<ChatFileList | null> {
  const params = new URLSearchParams({ filter, q, offset: String(offset) });
  const res = await fetch(`/api/chat/files?${params}`, { cache: 'no-store' }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as ({ ok: true } & ChatFileList) | null;
  return res?.ok && body?.ok ? body : null;
}

export function ChatFiles() {
  const t = useTranslations('chatFiles');
  const openGetMore = useGetMore();
  const tFormats = useTranslations('chatAnswer.formats');
  const tTypes = useTranslations('chatDeliverable.types');
  const [filter, setFilter] = useState<ChatFileFilter>('all');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState<{
    status: 'loading' | 'ready' | 'error';
    files: ChatFileItem[];
    hasMore: boolean;
    storage: ChatStorage | null;
  }>({ status: 'loading', files: [], hasMore: false, storage: null });
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  // Only the newest read lands: a slower, older one is dropped.
  const asked = useRef(0);

  const load = useCallback(async (nextFilter: ChatFileFilter, nextQ: string) => {
    const ask = ++asked.current;
    setList((was) => ({ ...was, status: 'loading' }));
    const read = await readFiles(nextFilter, nextQ, 0);
    if (ask !== asked.current) return;
    setList((was) =>
      read
        ? { status: 'ready', files: read.files, hasMore: read.hasMore, storage: read.storage }
        : { ...was, status: 'error' },
    );
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQ(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void load(filter, q);
  }, [load, filter, q]);

  const showMore = async () => {
    if (more) return;
    setMore(true);
    const ask = asked.current;
    const read = await readFiles(filter, q, list.files.length);
    setMore(false);
    if (ask !== asked.current) return;
    if (!read) {
      toast.error(t('loadFailed'));
      return;
    }
    setList((was) => ({
      ...was,
      files: [...was.files, ...read.files.filter((f) => !was.files.some((w) => w.id === f.id))],
      hasMore: read.hasMore,
      storage: read.storage,
    }));
  };

  const toggle = (id: string) =>
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function copy(file: ChatFileItem) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      // Safari copies only within the click: the item is written at once, its text to come.
      const text = fetch(`/api/chat/files/${file.id}?format=md`).then((res) => {
        if (!res.ok) throw new Error('Not read');
        return res.text();
      });
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      toast(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  async function download(file: ChatFileItem, format: string) {
    const res = await fetch(`/api/chat/files/${file.id}?format=${format}`).catch(() => null);
    if (!res?.ok) {
      toast.error(t('downloadFailed'));
      return;
    }
    const name = fileNameOf(res, `file.${format}`);
    saveBlob(await res.blob(), name);
    toast(t('downloaded', { name }));
  }

  async function downloadSelected() {
    if (zipping || selected.size === 0) return;
    if (selected.size > ZIP_MAX_FILES) {
      toast.error(t('zipTooBig'));
      return;
    }
    setZipping(true);
    const res = await fetch('/api/chat/files/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    }).catch(() => null);
    setZipping(false);
    if (res?.status === 413) {
      toast.error(t('zipTooBig'));
      return;
    }
    if (!res?.ok) {
      toast.error(t('zipFailed'));
      return;
    }
    const count = Number(res.headers.get('X-File-Count')) || selected.size;
    saveBlob(await res.blob(), fileNameOf(res, 'files.zip'));
    toast(t('zipped', { count }));
    setSelected(new Set());
  }

  const maker = (file: ChatFileItem) => {
    const by = file.madeBy;
    if (by.kind === 'member') return by.name ?? t('madeBy.formerMember');
    return t(`madeBy.${by.kind}`);
  };
  const when = (file: ChatFileItem) => {
    const zone = file.timezone ?? undefined;
    const at = stampParts(file.generatedAt, zone);
    const asOf = file.dataAsOf ? stampParts(file.dataAsOf, zone) : null;
    return {
      line: t('generated', { date: at.date, time: at.time }),
      tip: t('generatedTip', { date: at.date, time: at.time, offset: at.offset }),
      asOf: asOf ? t('dataAsOf', { day: asOf.day, time: asOf.time }) : null,
    };
  };

  const filtered = filter !== 'all' || q !== '';
  const loading = list.status === 'loading' && list.files.length === 0;
  const tone = list.storage ? storageTone(list.storage) : 'ok';

  return (
    <div className="max-w-[1100px]">
      <div className="mb-3.5 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
          <p className="text-[13px] text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {list.storage && <StorageMeter storage={list.storage} />}
          <Button
            variant="outline"
            data-action="files.downloadSelected"
            disabled={selected.size === 0 || zipping}
            title={selected.size === 0 ? t('selectFirst') : undefined}
            onClick={() => void downloadSelected()}
          >
            {t('downloadSelected')}
          </Button>
        </div>
      </div>

      {tone === 'full' && (
        <p
          role="status"
          data-slot="storage-full"
          className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <span className="min-w-0 flex-1">
            {openGetMore ? t('storageFullGetMore') : t('storageFull')}
          </span>
          {openGetMore && (
            <Button
              size="sm"
              data-action="files.getMoreStorage"
              onClick={() => openGetMore('storage')}
            >
              {t('getMoreStorage')}
            </Button>
          )}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <input
          type="search"
          data-action="files.search"
          aria-label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-7 min-w-[200px] rounded-lg border bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground focus:border-foreground/30"
        />
        {FILE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            data-action="files.filter"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setSelected(new Set());
            }}
            className={cn(
              'h-7 rounded-full border bg-card px-2.5 text-[12.5px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
              filter === f && 'border-foreground/40 bg-muted font-medium text-foreground',
            )}
          >
            {t(`filters.${f}`)}
            {f === 'all' && list.storage && list.storage.fileCount > 0 && (
              <i className="ml-1 rounded-md bg-foreground/10 px-[5px] text-[11px] font-medium not-italic text-foreground/80 tabular-nums">
                {list.storage.fileCount.toLocaleString('en-US')}
              </i>
            )}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-[14px] border">
        <div
          className={cn(
            COLS,
            'bg-muted/50 py-2.5 text-[11px] tracking-[.3px] text-muted-foreground uppercase max-[900px]:hidden',
          )}
        >
          <span />
          <span>{t('columns.name')}</span>
          <span>{t('columns.madeBy')}</span>
          <span>{t('columns.fromChat')}</span>
          <span>{t('columns.updated')}</span>
          <span />
        </div>
        {loading && (
          <div aria-hidden className="flex flex-col gap-2 border-t p-3.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}
        {list.status === 'error' && (
          <p className="border-t px-3.5 py-7 text-center text-[13px] text-muted-foreground">
            {t('loadFailed')}{' '}
            <button
              type="button"
              data-action="files.retry"
              onClick={() => void load(filter, q)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t('retry')}
            </button>
          </p>
        )}
        {!loading &&
          list.status !== 'error' &&
          list.files.map((file) => {
            const Icon = DELIVERABLE_ICONS[file.type] ?? FileText;
            const formats = FORMAT_ORDER.filter((format) => file.formats.includes(format));
            const stamp = when(file);
            const line = knownFormats(file.formats)
              .map((format) => t(`formatNames.${format}`))
              .join(' · ');
            return (
              <div
                key={file.id}
                data-slot="files-row"
                className={cn(COLS, 'min-h-[58px] border-t py-2.5 text-sm')}
              >
                <span>
                  <input
                    type="checkbox"
                    data-action="files.select"
                    aria-label={t('select', { name: file.title })}
                    checked={selected.has(file.id)}
                    onChange={() => toggle(file.id)}
                    className="size-3.5 accent-foreground"
                  />
                </span>
                <span className="flex min-w-0 items-start gap-2">
                  <span
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted/40"
                    title={tTypes(file.type)}
                  >
                    <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <b className="block truncate font-medium" title={file.title}>
                      {file.title}
                    </b>
                    <em className="block truncate text-xs not-italic text-muted-foreground">
                      {line}
                    </em>
                    {/* Its own line, so a narrow table (1024px) never cuts it off. */}
                    {file.draftHref && (
                      <em className="block truncate text-xs not-italic text-muted-foreground">
                        {t('usedInDraft')}
                      </em>
                    )}
                  </span>
                </span>
                <span className={cn('truncate text-[13px]', HIDE_NARROW)}>{maker(file)}</span>
                <span className={cn('min-w-0 truncate text-[13px]', HIDE_NARROW)}>
                  {file.chat ? (
                    <Link
                      href={file.chat.href}
                      data-action="files.openSourceChat"
                      className="underline-offset-2 hover:underline"
                    >
                      {file.chat.title ?? t('untitledChat')}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t('noChat')}</span>
                  )}
                </span>
                <span className={cn('min-w-0 text-[13px]', HIDE_NARROW)} title={stamp.tip}>
                  <span className="block truncate">{stamp.line}</span>
                  {stamp.asOf && (
                    <em className="block truncate text-xs not-italic text-muted-foreground">
                      {stamp.asOf}
                    </em>
                  )}
                </span>
                <span className="flex items-center justify-end gap-1">
                  {file.formats.includes('md') && (
                    <button
                      type="button"
                      data-action="files.copy"
                      onClick={() => void copy(file)}
                      className={ACTION}
                    >
                      <Copy className="size-3.5" aria-hidden />
                      {t('copy')}
                    </button>
                  )}
                  {file.draftHref && (
                    <Link
                      href={file.draftHref}
                      data-action="files.open"
                      title={t('openTip')}
                      className={ACTION}
                    >
                      <PenLine className="size-3.5" aria-hidden />
                      {t('open')}
                    </Link>
                  )}
                  {formats.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger data-action="files.download" className={ACTION}>
                        <Download className="size-3.5" aria-hidden />
                        {t('download')}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        {formats.map((format) => (
                          <DropdownMenuItem
                            key={format}
                            data-action="files.downloadAs"
                            data-format={format}
                            onClick={() => void download(file, format)}
                            className="text-[13px]"
                          >
                            {tFormats(format)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </span>
              </div>
            );
          })}
        {!loading && list.status === 'ready' && list.files.length === 0 && (
          <p className="border-t px-3.5 py-7 text-center text-[13px] text-muted-foreground">
            {filtered ? t('noMatch') : t('empty')}
            {filtered && (
              <>
                {' '}
                <button
                  type="button"
                  data-action="emptyState.clearFilters"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t('clearFilters')}
                </button>
              </>
            )}
          </p>
        )}
        {list.hasMore && list.status === 'ready' && (
          <button
            type="button"
            data-action="files.showMore"
            disabled={more}
            onClick={() => void showMore()}
            className="block w-full border-t py-2.5 text-[13px] text-muted-foreground outline-none hover:bg-muted/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-60"
          >
            {t('showMore')}
          </button>
        )}
      </div>
    </div>
  );
}
