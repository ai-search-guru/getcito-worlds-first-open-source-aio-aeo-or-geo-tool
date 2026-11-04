'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AskAdminButton } from '@/components/chat-access/AskAdminButton';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import type { ConnectionRecord } from '@/lib/chat/connections';
import { cn } from '@/lib/utils';
import { MENU_SEARCH_FROM, menuOrder, useConnections } from './useConnections';

/** A connection's dot: green connected, amber failing, grey otherwise. */
export function ConnectionDot({ status }: { status: ConnectionRecord['status'] }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-[7px] shrink-0 rounded-full',
        status === 'connected'
          ? 'bg-green-600 dark:bg-green-400'
          : status === 'failing'
            ? 'bg-amber-600 dark:bg-amber-400'
            : 'bg-foreground/20',
      )}
    />
  );
}

const ROW_ACTION =
  'h-5 shrink-0 rounded-md border bg-card px-1.5 text-[11px] leading-[18px] font-medium text-foreground/80 outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * The chat menu's Connections row (agentic plan §6, CHAT-01 item 169;
 * W4-25): "Connections", Manage (the Connections page) and an arrow-only
 * ▾/▴ that opens the brand's tools under the row: connected first (green
 * dot and ✓), then the ones to connect (grey dot and Connect, which opens
 * the tool's card in Settings › Integrations; others than Admins ask their
 * Admin), then Soon. The list scrolls inside about six rows, and over 20
 * tools a search box shows. Closed by default; the menu keeps it as it was
 * left (its sections' storage). The list is read only while open.
 */
export function ConnectionsMenu({
  open,
  onToggle,
  active,
  onNavigate,
}: {
  open: boolean;
  onToggle: () => void;
  /** The Connections page is the one shown. */
  active: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations('chatConnections');
  const read = useConnections(open);
  const [query, setQuery] = useState('');
  const rows = menuOrder(read.connections);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => t(`tools.${row.key}.name`).toLowerCase().includes(needle))
    : rows;

  return (
    <div>
      <div
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px] leading-[18px] text-foreground/80',
          active && 'bg-sidebar-accent font-medium text-foreground',
        )}
      >
        <span className="min-w-0 truncate">{t('menu.label')}</span>
        <Link
          href="/dashboard/chat/connections"
          data-action="chatMenu.manageConnections"
          aria-current={active ? 'page' : undefined}
          onClick={onNavigate}
          className="ml-auto rounded-md px-1 text-[11.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {t('menu.manage')}
        </Link>
        <button
          type="button"
          data-action="chatMenu.toggleConnections"
          aria-label={t(open ? 'menu.hide' : 'menu.show')}
          title={t(open ? 'menu.hide' : 'menu.show')}
          aria-expanded={open}
          aria-controls="chat-menu-connections"
          onClick={onToggle}
          className="flex size-[22px] items-center justify-center rounded-md text-[13px] text-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {open ? '▴' : '▾'}
        </button>
      </div>
      {open && (
        <div id="chat-menu-connections" className="pb-1">
          {read.connections.length > MENU_SEARCH_FROM && (
            <input
              type="search"
              data-action="chatMenu.searchConnections"
              aria-label={t('menu.search')}
              placeholder={t('menu.search')}
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="mt-0.5 mb-1 ml-2 block w-[calc(100%-8px)] rounded-lg border bg-background px-2.5 py-1 text-[12px] outline-none placeholder:text-muted-foreground focus:border-foreground/30 [&::-webkit-search-cancel-button]:hidden"
            />
          )}
          {read.status === 'loading' && read.connections.length === 0 ? (
            <div className="flex flex-col gap-1.5 py-1 pl-2" aria-hidden>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : read.status === 'error' ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {t('menu.failed')}{' '}
              <button
                type="button"
                onClick={read.retry}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t('menu.retry')}
              </button>
            </p>
          ) : (
            <ul
              aria-label={t('menu.listLabel')}
              className="chat-scroll max-h-[172px] overflow-y-auto"
            >
              {shown.map((row) => (
                <MenuRow
                  key={row.key}
                  row={row}
                  canConnect={read.canConnect}
                  onNavigate={onNavigate}
                />
              ))}
              {shown.length === 0 && (
                <li className="px-2 py-1 text-xs text-muted-foreground">{t('menu.noMatch')}</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MenuRow({
  row,
  canConnect,
  onNavigate,
}: {
  row: ConnectionRecord;
  canConnect: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations('chatConnections');
  const name = t(`tools.${row.key}.name`);
  return (
    <li
      data-connection={row.key}
      data-status={row.status}
      className="flex h-7 items-center gap-2 rounded-lg pr-1 pl-2 text-[12.5px] text-foreground/80"
    >
      <ConnectionDot status={row.status} />
      <span className="min-w-0 flex-1 truncate" title={name}>
        {name}
      </span>
      {row.status === 'connected' ? (
        <em
          className="text-xs text-green-700 not-italic dark:text-green-400"
          title={t('status.connected')}
        >
          <span aria-hidden>✓</span>
          <span className="sr-only">{t('status.connected')}</span>
        </em>
      ) : row.status === 'soon' ? (
        <span className="rounded-full bg-muted px-1.5 text-[10.5px] font-medium text-foreground/70">
          {t('status.soon')}
        </span>
      ) : canConnect && row.settingsHref ? (
        <Link
          href={row.settingsHref}
          data-action="integrations.connect"
          aria-label={t(row.status === 'failing' ? 'reconnectLabel' : 'connectLabel', { name })}
          onClick={onNavigate}
          className={ROW_ACTION}
        >
          {t(row.status === 'failing' ? 'reconnect' : 'connect')}
        </Link>
      ) : (
        <AskAdminButton
          asked={t('askAdmin.asked', { name })}
          ruleKind="role"
          ruleDetail={t('askAdmin.rule')}
          label={t('askAdmin.short')}
          title={t('askAdmin.button')}
          className={ROW_ACTION}
        />
      )}
    </li>
  );
}
