'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { AskAdminButton } from '@/components/chat-access/AskAdminButton';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { CONTACT_SALES_URL } from '@/config/plans';
import { Link } from '@/i18n/navigation';
import { setBrandGaProperty, setBrandGscProperty } from '@/lib/actions/integrations';
import type { ConnectionCategory, ConnectionRecord } from '@/lib/chat/connections';
import { disconnectFramer } from '@/lib/framerClient';
import { disconnectWebflow } from '@/lib/webflowClient';
import { disconnectWix } from '@/lib/wixClient';
import { disconnectWordPress } from '@/lib/wordpressClient';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';
import { ConnectionDot } from './ConnectionsMenu';
import { refreshConnections, useConnections } from './useConnections';

/**
 * Connections (agentic plan §6, CHAT-01 item 175; mockup `#s-conns`;
 * W4-25): the brand open now's tools, built like Skills. Tabs All ·
 * Connected · Not connected with their counts, a search and the category
 * chips; one card per tool with its status, the account, who connected it
 * and when and its access, what uses it ("Used by") or what it would
 * unlock, and up to two Suggested. Admins connect (the tool's card in
 * Settings › Integrations) and disconnect (asks first and lists the
 * agents that would stop); the others ask their Admin. Soon cards have
 * nothing to click. "Request a connection" goes to GetCito's contact page.
 */

/** connections.ts's CONNECTION_CATEGORIES, kept here: that module is the server's. */
export const CATEGORIES: readonly ConnectionCategory[] = [
  'search',
  'cms',
  'ecommerce',
  'crm',
  'team',
];

type Tab = 'all' | 'connected' | 'not_connected';
const TABS: readonly Tab[] = ['all', 'connected', 'not_connected'];

const inTab = (row: ConnectionRecord, tab: Tab) =>
  tab === 'all' ||
  (tab === 'connected'
    ? row.status === 'connected' || row.status === 'failing'
    : row.status === 'not_connected' || row.status === 'soon');

const CARD =
  'flex min-w-0 flex-col gap-2 rounded-[14px] border bg-card p-4 shadow-[0_1px_2px_rgba(10,10,10,.04)]';

/** A CMS site's Disconnect, by its tool: the same calls as its Settings card. */
const CMS_DISCONNECT: Record<string, (brandId: string) => Promise<{ ok: boolean }>> = {
  webflow: disconnectWebflow,
  wordpress: disconnectWordPress,
  framer: disconnectFramer,
  wix: disconnectWix,
};

/** Lets go of a tool for the brand; false when it couldn't. */
async function disconnect(row: ConnectionRecord, brandId: string): Promise<boolean> {
  try {
    if (row.disconnect === 'cms') {
      const call = CMS_DISCONNECT[row.key];
      return call ? (await call(brandId)).ok : false;
    }
    if (row.disconnect === 'property') {
      if (row.key === 'google_search_console') await setBrandGscProperty(brandId, null);
      else if (row.key === 'google_analytics') await setBrandGaProperty(brandId, null);
      else return false;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function ChatConnections() {
  const t = useTranslations('chatConnections');
  const brand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId) ?? null);
  const read = useConnections();
  const [tab, setTab] = useState<Tab>('all');
  const [category, setCategory] = useState<ConnectionCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [leaving, setLeaving] = useState<ConnectionRecord | null>(null);

  const needle = query.trim().toLowerCase();
  const rows = read.connections.filter(
    (row) =>
      inTab(row, tab) &&
      (category === 'all' || row.category === category) &&
      (!needle ||
        t(`tools.${row.key}.name`).toLowerCase().includes(needle) ||
        t(`categories.${row.category}`).toLowerCase().includes(needle)),
  );
  const filtered = category !== 'all' || needle !== '';

  return (
    <div className="max-w-[1100px]">
      <div className="mb-3.5 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-[-.6px]">{t('page.title')}</h1>
          <p className="text-[13px] text-muted-foreground">
            {brand ? t('page.subtitle', { brand: brand.name }) : t('page.subtitleNoBrand')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a
            href={CONTACT_SALES_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-action="integrations.request"
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            {t('page.request')}
            <ExternalLink aria-hidden />
          </a>
        </div>
      </div>

      {read.status === 'loading' && read.connections.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[150px] rounded-[14px]" />
          ))}
        </div>
      ) : read.status === 'error' ? (
        <div className="rounded-[14px] border bg-card p-6 text-center text-sm">
          <p className="text-muted-foreground">{t('page.loadFailed')}</p>
          <Button
            variant="outline"
            className="mt-3"
            data-action="integrations.retry"
            onClick={read.retry}
          >
            {t('page.retry')}
          </Button>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label={t('page.title')} className="mb-3 flex gap-1 border-b">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                data-action="integrations.tab"
                data-tab={key}
                onClick={() => setTab(key)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  tab === key
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`page.tabs.${key}`)}{' '}
                <span className="text-muted-foreground tabular-nums">
                  {read.connections.filter((row) => inTab(row, key)).length}
                </span>
              </button>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-[260px]">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('page.search')}
                aria-label={t('page.search')}
                data-action="integrations.search"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            {(['all', ...CATEGORIES] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={category === key}
                data-action="integrations.filter"
                data-filter={key}
                onClick={() => setCategory(key)}
                className={cn(
                  'h-8 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  category === key
                    ? 'border-foreground bg-foreground text-background'
                    : 'bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {key === 'all' ? t('page.all') : t(`categories.${key}`)}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="rounded-[14px] border bg-card p-6 text-center text-sm text-muted-foreground">
              {t('page.noMatch')}{' '}
              {filtered && (
                <button
                  type="button"
                  data-action="emptyState.clearFilters"
                  onClick={() => {
                    setQuery('');
                    setCategory('all');
                  }}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t('page.clearFilters')}
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <ConnectionCard
                  key={row.key}
                  row={row}
                  canConnect={read.canConnect}
                  onDisconnect={() => setLeaving(row)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <DisconnectDialog
        row={leaving}
        brand={brand}
        onClose={() => setLeaving(null)}
        onDone={() => {
          setLeaving(null);
          refreshConnections();
        }}
      />
    </div>
  );
}

/** "Oct 2", or "Oct 2, 2025" for another year. */
function dayOf(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
}

function ConnectionCard({
  row,
  canConnect,
  onDisconnect,
}: {
  row: ConnectionRecord;
  canConnect: boolean;
  onDisconnect: () => void;
}) {
  const t = useTranslations('chatConnections');
  const name = t(`tools.${row.key}.name`);
  const on = row.status === 'connected' || row.status === 'failing';
  const facts = on
    ? [
        row.account,
        row.connectedBy ? t('card.by', { name: row.connectedBy }) : null,
        row.connectedAt ? dayOf(row.connectedAt) : null,
        row.access ? t(`access.${row.access}`) : null,
      ].filter(Boolean)
    : [];
  return (
    <article
      data-connection={row.key}
      data-status={row.status}
      aria-label={name}
      className={cn(CARD, row.status === 'soon' && 'bg-muted/40')}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted/50 text-[13px] font-semibold text-muted-foreground"
        >
          {name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13.5px] font-semibold">{name}</b>
          <span className="text-xs text-muted-foreground">{t(`categories.${row.category}`)}</span>
        </div>
        <StatusBadge row={row} />
      </div>

      <p className="text-[12.5px] leading-[1.45] text-muted-foreground">
        {on && facts.length > 0 ? facts.join(' · ') : t(`tools.${row.key}.description`)}
      </p>
      {row.status === 'failing' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {t('card.failing')}
        </p>
      )}
      {row.uses.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t(on ? 'card.usedBy' : 'card.wouldUnlock', { list: row.uses.join(' · ') })}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {row.status === 'soon' ? (
          <span className="text-xs text-muted-foreground">{t('card.soonNote')}</span>
        ) : on ? (
          <>
            {canConnect && row.status === 'failing' && row.settingsHref && (
              <Link
                href={row.settingsHref}
                data-action="integrations.connect"
                className={cn(buttonVariants({ size: 'sm' }))}
              >
                {t('reconnect')}
              </Link>
            )}
            {canConnect && row.disconnect && (
              <Button
                variant="outline"
                size="sm"
                data-action="integrations.disconnect"
                onClick={onDisconnect}
              >
                {t('card.disconnect')}
              </Button>
            )}
            {row.settingsHref && (
              <Link
                href={row.settingsHref}
                data-action="integrations.settings"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                {t('card.settings')}
              </Link>
            )}
          </>
        ) : canConnect && row.settingsHref ? (
          <Link
            href={row.settingsHref}
            data-action="integrations.connect"
            aria-label={t('connectLabel', { name })}
            className={cn(
              buttonVariants({
                variant: row.suggested ? 'default' : 'outline',
                size: 'sm',
              }),
            )}
          >
            {t('connect')}
          </Link>
        ) : (
          <AskAdminButton
            asked={t('askAdmin.asked', { name })}
            ruleKind="role"
            ruleDetail={t('askAdmin.rule')}
            label={t('askAdmin.button')}
          />
        )}
      </div>
    </article>
  );
}

function StatusBadge({ row }: { row: ConnectionRecord }) {
  const t = useTranslations('chatConnections');
  if (row.status === 'connected') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-px text-[11px] font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400">
        <ConnectionDot status="connected" />
        {t('status.connected')}
      </span>
    );
  }
  if (row.status === 'failing') {
    return (
      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-px text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        {t('status.failing')}
      </span>
    );
  }
  if (row.status === 'soon') {
    return (
      <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[11px] font-medium text-foreground/70">
        {t('status.soon')}
      </span>
    );
  }
  return row.suggested ? (
    <span className="shrink-0 rounded-full border px-2 py-px text-[11px] font-medium text-foreground/80">
      {t('status.suggested')}
    </span>
  ) : null;
}

/**
 * Disconnect asks first (agentic plan §6): what stops working for the
 * brand, and the agents that need the tool and would pause.
 */
function DisconnectDialog({
  row,
  brand,
  onClose,
  onDone,
}: {
  row: ConnectionRecord | null;
  brand: { id: string; name: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('chatConnections.disconnect');
  const tTools = useTranslations('chatConnections.tools');
  const [busy, setBusy] = useState(false);
  const name = row ? tTools(`${row.key}.name`) : '';
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent data-slot="disconnect-connection">
        <DialogHeader>
          <DialogTitle>{t('title', { name, brand: brand?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {row?.disconnect === 'property' ? t('property', { name }) : t('cms', { name })}
          </DialogDescription>
        </DialogHeader>
        {row && row.stops.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-medium">{t('stops', { count: row.stops.length })}</p>
            <ul className="mt-1 list-disc pl-5">
              {row.stops.map((agent) => (
                <li key={agent}>{agent}</li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            data-action="integrations.confirmDisconnect"
            disabled={busy || !brand}
            onClick={async () => {
              if (!row || !brand) return;
              setBusy(true);
              const ok = await disconnect(row, brand.id);
              setBusy(false);
              if (ok) {
                toast.success(t('done', { name }));
                onDone();
              } else {
                toast.error(t('failed', { name }));
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
