'use client';

import { useFormatter, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  Clock,
  CloudOff,
  ExternalLink,
  FileText,
  MoreHorizontal,
  Send,
  Trash2,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ExportFormatIcon } from '@/components/content/ExportFormatIcon';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AgentStateBadge,
  AgentStateLine,
  DraftMethodBadge,
  DraftStatusBadge,
} from '@/components/content/DraftBadges';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';
import { assigneeLabel, labelInitials } from '@/lib/action-center/display';
import {
  DRAFT_STATUSES,
  contentEditorPath,
  isPageType,
  type ContentDraftListItem,
  type DraftStatus,
  type LibraryTab,
} from '@/lib/content/drafts';
import type { CmsStatus } from '@/lib/content/cmsSendClient';
import type { DraftShopping } from '@/lib/content/shoppingCheck';
import { DRAFT_EXPORT_FORMATS, type DraftExportFormat } from '@/lib/content/draftExport';
import { formatDate, formatMonthDay } from '@/lib/format';

/** A date this year as "Oct 16", an older one with its year, so the table fits at 1024 px. */
function tableDate(iso: string): string {
  return new Date(iso).getFullYear() === new Date().getFullYear()
    ? formatMonthDay(iso)
    : formatDate(iso);
}

export interface LibraryRowActions {
  /** Admins and managers: archive, restore and delete too. */
  canManage: boolean;
  onStatus: (draft: ContentDraftListItem, status: DraftStatus) => void;
  onArchive: (draft: ContentDraftListItem, archived: boolean) => void;
  onDelete: (draft: ContentDraftListItem) => void;
  /** The draft's page as Word, HTML or Markdown, as the editor's Export. */
  onExport: (draft: ContentDraftListItem, format: DraftExportFormat) => void;
  /** Send to CMS (#1331), for admins and managers. */
  onSend: (draft: ContentDraftListItem) => void;
  /** Take down a page published through GetCito (AUTONOMOUS-GO-LIVE PR 10), for admins and managers. */
  onTakeDown: (draft: ContentDraftListItem, sent: CmsStatus) => void;
}

/** Where a page published through GetCito can be taken down from its row. */
const TAKE_DOWN_TARGETS: readonly CmsStatus['target'][] = ['webflow', 'wordpress', 'wix'];

/** The rows picked for a bulk Send to CMS (#1331): admins and managers, drafts not archived. */
export interface LibrarySelection {
  selected: ReadonlySet<string>;
  onToggle: (ids: string[], on: boolean) => void;
}

/**
 * The Library's list (CE-002): one row per draft, the latest changed first.
 * Columns: Content · Type · Method (Create / Optimize) · By (a person or the
 * Content Agent) · Status · Created · Updated. A row opens the draft in the
 * editor; its menu sets the status and, for admins and managers, sends it
 * to the CMS (#1331), archives or deletes it (00233). Beside its status, its
 * last send to the CMS; with a selection, a box to pick rows to send together.
 * An online shop's Library has a Shopping path column too (00352).
 */
export function LibraryTable({
  drafts,
  tab,
  actions,
  cms,
  selection,
  shopping = false,
}: {
  drafts: ContentDraftListItem[];
  tab: LibraryTab;
  actions: LibraryRowActions;
  /** Each draft's last send to the CMS; none for a draft never sent. */
  cms: ReadonlyMap<string, CmsStatus>;
  selection?: LibrarySelection;
  /** Whether to show the Shopping path column: the brand sells online. */
  shopping?: boolean;
}) {
  const t = useTranslations('contentEditor.library');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const chatOn = useChatAgentic();

  if (drafts.length === 0) {
    return tab === 'all' ? (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <FileText className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-sm font-medium">{t('empty.title')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t('empty.body')}</p>
      </div>
    ) : (
      <p className="px-6 py-12 text-center text-sm text-muted-foreground">{t(`emptyTab.${tab}`)}</p>
    );
  }

  const ids = drafts.map((draft) => draft.id);
  const picked = selection ? ids.filter((id) => selection.selected.has(id)).length : 0;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selection && (
            <TableHead className="w-10 pl-4 pr-0">
              <Checkbox
                aria-label={t('bulk.selectAll')}
                checked={picked === 0 ? false : picked === ids.length ? true : 'indeterminate'}
                onCheckedChange={(checked) => selection.onToggle(ids, checked === true)}
              />
            </TableHead>
          )}
          <TableHead className={selection ? 'pl-2' : 'pl-6'}>{t('columns.content')}</TableHead>
          <TableHead>{t('columns.type')}</TableHead>
          <TableHead>{t('columns.method')}</TableHead>
          <TableHead>{t('columns.by')}</TableHead>
          {/* Its own column where it fits; under By below xl, so 1024px keeps its columns. */}
          <TableHead className="hidden xl:table-cell">{t('columns.madeIn')}</TableHead>
          <TableHead>{t('columns.status')}</TableHead>
          {shopping && <TableHead>{t('columns.shopping')}</TableHead>}
          <TableHead>{t('columns.created')}</TableHead>
          <TableHead>{t('columns.updated')}</TableHead>
          <TableHead className="w-8 pl-0 pr-4">
            <span className="sr-only">{t('columns.menu')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {drafts.map((draft) => {
          const sent = cms.get(draft.id);
          return (
            <TableRow key={draft.id}>
              {selection && (
                <TableCell className="w-10 pl-4 pr-0">
                  <Checkbox
                    aria-label={t('bulk.selectRow', { title: draft.title.trim() || t('untitled') })}
                    checked={selection.selected.has(draft.id)}
                    onCheckedChange={(checked) => selection.onToggle([draft.id], checked === true)}
                  />
                </TableCell>
              )}
              <TableCell
                className={`max-w-[180px] xl:max-w-[320px] ${selection ? 'pl-2' : 'pl-6'}`}
              >
                <Link
                  href={contentEditorPath(draft.id)}
                  className="block truncate font-medium hover:underline"
                >
                  {draft.title.trim() || t('untitled')}
                </Link>
              </TableCell>
              <TableCell>
                {isPageType(draft.pageType) ? (
                  <Badge variant="outline" className="font-normal">
                    {tTypes(draft.pageType)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <DraftMethodBadge method={draft.method} />
              </TableCell>
              <TableCell>
                <DraftAuthorCell draft={draft} />
                {draft.origin !== 'editor' && (
                  <span className="mt-0.5 block xl:hidden">
                    <MadeInCell draft={draft} chatOn={chatOn} compact />
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden xl:table-cell">
                <MadeInCell draft={draft} chatOn={chatOn} />
              </TableCell>
              <TableCell>
                {/* The agent works on drafts only: its state says more than "Draft".
                    One marked ready by hand since reads Ready. With the new Chat on,
                    it reads as Chat lists a run: its dot and the line. */}
                <span className="flex items-center gap-1.5">
                  {draft.agentState &&
                  (draft.status === 'draft' || draft.status === 'in_review') ? (
                    chatOn ? (
                      <AgentStateLine state={draft.agentState} />
                    ) : (
                      <AgentStateBadge state={draft.agentState} />
                    )
                  ) : (
                    <DraftStatusBadge status={draft.status} />
                  )}
                  {sent && <CmsStatusMark status={sent} />}
                </span>
              </TableCell>
              {shopping && (
                <TableCell>
                  <ShoppingPathMark shopping={draft.shopping} />
                </TableCell>
              )}
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                <time dateTime={draft.createdAt} title={formatDate(draft.createdAt)}>
                  {tableDate(draft.createdAt)}
                </time>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                <time dateTime={draft.updatedAt} title={formatDate(draft.updatedAt)}>
                  {tableDate(draft.updatedAt)}
                </time>
              </TableCell>
              <TableCell className="pl-0 pr-4">
                <RowMenu draft={draft} sent={sent} actions={actions} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * A row's menu: its status, then archive or restore, and delete (admins and
 * managers); Take down too while its last send is live in Webflow, WordPress
 * or Wix.
 */
function RowMenu({
  draft,
  sent,
  actions,
}: {
  draft: ContentDraftListItem;
  sent: CmsStatus | undefined;
  actions: LibraryRowActions;
}) {
  const t = useTranslations('contentEditor.library.rowMenu');
  const tStatus = useTranslations('contentEditor.status');
  const tExport = useTranslations('contentEditor.editor.export');
  const title = draft.title.trim() || null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded p-1 text-muted-foreground hover:bg-muted"
        aria-label={t('label', { title: title ?? '—' })}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('status')}</DropdownMenuLabel>
          {DRAFT_STATUSES.map((status) => (
            <DropdownMenuItem
              key={status}
              // An archived page is restored before it's marked live (CE-013).
              disabled={status === draft.status || (status === 'published' && !!draft.archivedAt)}
              onClick={() => actions.onStatus(draft, status)}
            >
              <Check
                aria-hidden="true"
                className={status === draft.status ? 'h-4 w-4' : 'h-4 w-4 opacity-0'}
              />
              {tStatus(status)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {DRAFT_EXPORT_FORMATS.map((format) => (
          <DropdownMenuItem key={format} onClick={() => actions.onExport(draft, format)}>
            <ExportFormatIcon format={format} className="h-4 w-4" />
            {tExport(format)}
          </DropdownMenuItem>
        ))}
        {actions.canManage && (
          <>
            {/* An archived draft isn't sent: restored, it is. */}
            {!draft.archivedAt && (
              <DropdownMenuItem onClick={() => actions.onSend(draft)}>
                <Send className="h-4 w-4" />
                {t('sendToCms')}
              </DropdownMenuItem>
            )}
            {sent?.status === 'published' && TAKE_DOWN_TARGETS.includes(sent.target) && (
              <DropdownMenuItem
                variant="destructive"
                data-action="library.takeDown"
                onClick={() => actions.onTakeDown(draft, sent)}
              >
                <CloudOff className="h-4 w-4" />
                {t('takeDown')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {draft.archivedAt ? (
              <DropdownMenuItem onClick={() => actions.onArchive(draft, false)}>
                <ArchiveRestore className="h-4 w-4" />
                {t('restore')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => actions.onArchive(draft, true)}>
                <Archive className="h-4 w-4" />
                {t('archive')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete(draft)}>
              <Trash2 className="h-4 w-4" />
              {t('delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SHOPPING_BADGE = {
  ok: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  attention: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
} as const;

/**
 * A draft's shopping path (00352): OK, or how many of the products it links
 * no longer sell; its tip says what it links, which ones and why, and where
 * and when it was checked. None, or not checked yet, in grey.
 */
function ShoppingPathMark({ shopping }: { shopping: DraftShopping | undefined }) {
  const t = useTranslations('contentEditor.library.shopping');
  const format = useFormatter();
  if (!shopping || shopping.state === 'none') {
    return <span className="text-xs text-muted-foreground">{t('none')}</span>;
  }
  const label =
    shopping.state === 'unchecked'
      ? t('unchecked')
      : shopping.state === 'ok'
        ? t('ok')
        : shopping.bad.every((link) => link.state === 'sold_out')
          ? t('soldOut', { count: shopping.bad.length })
          : t('notForSale', { count: shopping.bad.length });
  return (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        closeDelay={0}
        render={
          <button
            type="button"
            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={label}
          />
        }
      >
        {shopping.state === 'unchecked' ? (
          <span className="text-xs text-muted-foreground">{label}</span>
        ) : (
          <Badge
            variant="outline"
            className={`whitespace-nowrap ${SHOPPING_BADGE[shopping.state]}`}
          >
            {label}
          </Badge>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-1">
        {shopping.state === 'unchecked' ? (
          <p>{t('uncheckedHint')}</p>
        ) : (
          <>
            <p>
              {t('linked', {
                categoriesLinked: shopping.categoriesLinked,
                categories: shopping.categories,
                productsLinked: shopping.productsLinked,
                products: shopping.products,
              })}
            </p>
            {shopping.bad.map((link) => (
              <p key={link.id} className="[overflow-wrap:anywhere]">
                {t(`states.${link.state}`, { title: link.title })}
              </p>
            ))}
            <p className="opacity-80">
              {t(shopping.readFrom === 'page' ? 'checkedPage' : 'checkedDraft', {
                when: format.dateTime(new Date(shopping.checkedAt), { dateStyle: 'medium' }),
              })}
            </p>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A draft's last send to the CMS, as an icon whose tip says when and how it
 * went, and on wide screens its word: "In Webflow · draft", "Live"…
 */
function CmsStatusMark({ status }: { status: CmsStatus }) {
  const t = useTranslations('contentEditor.library.cms');
  const tShort = useTranslations('contentEditor.editor.sentChip');
  const format = useFormatter();
  const when = format.dateTime(new Date(status.at), { dateStyle: 'medium', timeStyle: 'short' });
  const live = status.status === 'published' ? status.publishedUrl : null;
  // A send to a CMS (#1331, phase 2) says so: sent, it's a draft item or post there.
  const label = t(
    status.target === 'webflow' ||
      status.target === 'wordpress' ||
      status.target === 'framer' ||
      status.target === 'wix'
      ? `${status.target}.${status.status}`
      : status.status,
    { when },
  );
  const icon = {
    queued: <Clock className="h-3.5 w-3.5" />,
    sent: <Send className="h-3.5 w-3.5" />,
    failed: <AlertTriangle className="h-3.5 w-3.5" />,
    published: <ExternalLink className="h-3.5 w-3.5" />,
    taken_down: <CloudOff className="h-3.5 w-3.5" />,
  }[status.status];
  const tone =
    status.status === 'failed'
      ? 'text-red-600 dark:text-red-400'
      : status.status === 'published'
        ? 'text-blue-600 dark:text-blue-400'
        : 'text-muted-foreground';
  const className = `inline-flex items-center gap-1 rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${tone}`;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        closeDelay={0}
        render={
          // Published: the live page, a click away, in a new tab.
          live ? (
            <a
              href={live}
              target="_blank"
              rel="noreferrer noopener"
              className={className}
              aria-label={t('openLive', { when })}
            />
          ) : (
            <button type="button" className={className} aria-label={label} />
          )
        }
      >
        {icon}
        <span aria-hidden className="hidden whitespace-nowrap text-xs font-medium xl:inline">
          {status.status === 'taken_down'
            ? tShort('takenDown')
            : tShort(`${status.target}.${status.status}`)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-1">
        <p>{label}</p>
        {/* Sent by an agent without a click (AUTONOMOUS-GO-LIVE §6.4). */}
        {status.agent && (
          <p data-slot="cms-sent-on-its-own" className="opacity-80">
            {status.agent.name ? t('onItsOwn', { agent: status.agent.name }) : t('onItsOwnUnnamed')}
          </p>
        )}
        {live && <p className="opacity-80 [overflow-wrap:anywhere]">{live}</p>}
        {status.status === 'failed' && (status.httpStatus || status.error) && (
          <p className="opacity-80 [overflow-wrap:anywhere]">
            {/* What the webhook answered when it refused the page; else the
                reason (not reached, or the workflow's callback after a 2xx). */}
            {status.httpStatus && (status.httpStatus < 200 || status.httpStatus > 299)
              ? t('answered', { status: status.httpStatus })
              : status.error}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** Who wrote it: the Content Agent, "You", or the member by name. */
/**
 * Where the draft was made (00463, W4-10): the Content Editor, Chat, an
 * Action Center task, an agent or an MCP client. One made in a chat the
 * member may open has Open chat, with the new Chat on. `compact`: the line
 * under By below xl, "in Chat · Open chat".
 */
function MadeInCell({
  draft,
  chatOn,
  compact = false,
}: {
  draft: ContentDraftListItem;
  chatOn: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('contentEditor.library.madeIn');
  return (
    <span
      className={`flex whitespace-nowrap text-xs text-muted-foreground ${compact ? 'items-center gap-1' : 'flex-col'}`}
    >
      <span data-slot={compact ? 'made-in-short' : 'made-in'} data-origin={draft.origin}>
        {compact ? t('in', { place: t(draft.origin) }) : t(draft.origin)}
      </span>
      {chatOn && draft.origin !== 'editor' && draft.conversation && (
        <Link
          href={`/dashboard/chat/${draft.conversation.id}`}
          data-action="library.openChat"
          title={draft.conversation.title || undefined}
          className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
        >
          {t('openChat')}
        </Link>
      )}
    </span>
  );
}

function DraftAuthorCell({ draft }: { draft: ContentDraftListItem }) {
  const t = useTranslations('contentEditor.library');
  if (draft.author === 'agent') {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-muted">
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        {t('contentAgent')}
      </span>
    );
  }
  const label = draft.isMine
    ? t('you')
    : ((draft.createdBy && assigneeLabel(draft.createdBy)) ?? t('formerMember'));
  const named = draft.createdBy && assigneeLabel(draft.createdBy);
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <Avatar className="h-5 w-5">
        {draft.createdBy?.avatarUrl && <AvatarImage src={draft.createdBy.avatarUrl} alt="" />}
        <AvatarFallback className="text-[9px]">
          {(named && labelInitials(named)) || '?'}
        </AvatarFallback>
      </Avatar>
      {label}
    </span>
  );
}
