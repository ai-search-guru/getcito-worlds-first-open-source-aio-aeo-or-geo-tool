'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChatListItem } from '@/lib/chat/conversations';
import { saveBlob } from '@/lib/download';
import { cn } from '@/lib/utils';
import { useChatActions } from './ChatActions';
import { useChatDebug } from './ChatDebug';

/** The menus' look (mockup `.pop2`, `.mi2`): opaque, 14px corners, soft shadow. */
const MENU =
  'w-[230px] rounded-[14px] border border-border p-1.5 shadow-[0_12px_32px_rgba(10,10,10,.12)] ring-0';
const ITEM = 'gap-2 rounded-[9px] px-2 py-[7px] text-[13px]';

/** One item: its glyph in a 14px column (↗ ⧉ ⌖ ✎ ⇪ ▤ ✕), its label, a muted line under it. */
function Item({
  glyph,
  action,
  onClick,
  danger,
  disabled,
  note,
  children,
}: {
  glyph: string;
  action: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  note?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenuItem
      data-action={action}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        ITEM,
        danger && 'text-red-700 focus:text-red-700 dark:text-red-400 dark:focus:text-red-400',
      )}
    >
      <span aria-hidden className="w-3.5 shrink-0 text-center text-foreground">
        {glyph}
      </span>
      <span className="flex-1">
        {children}
        {note && <span className="block text-[11.5px] text-muted-foreground">{note}</span>}
      </span>
    </DropdownMenuItem>
  );
}

/** Pin, Rename, Share with team, Archive: the author's changes, in the mockup's order. */
function EditItems({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('chatShell.actions');
  const actions = useChatActions();
  if (!actions?.canEdit(chat)) return null;
  return (
    <>
      <Item glyph="⌖" action="chat.pin" onClick={() => void actions.togglePin(chat)}>
        {t(chat.pinned ? 'unpin' : 'pin')}
      </Item>
      <Item glyph="✎" action="chat.rename" onClick={() => actions.startRename(chat, 'row')}>
        {t('rename')}
      </Item>
      <Item glyph="⇪" action="chat.share" onClick={() => void actions.toggleShare(chat)}>
        {t(chat.shared ? 'unshare' : 'share')}
      </Item>
    </>
  );
}

/**
 * A chat row's ⋯ (CHAT-23 `chatMenu.rowMore`, G9): shown on the row's hover
 * and focus. Open, Open in new window; then, for the author, Pin, Rename,
 * Share with team, Archive; Delete for the author, or an Admin on a shared
 * chat. Split view and run controls come later.
 */
export function ChatRowMenu({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('chatShell.actions');
  const router = useRouter();
  const actions = useChatActions();
  if (!actions) return null;
  const editable = actions.canEdit(chat);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-action="chatMenu.rowMore"
        aria-label={t('more', { name: chat.title ?? t('untitled') })}
        className="absolute top-[5px] right-1 hidden h-[22px] w-6 items-center justify-center rounded-md bg-foreground/10 text-[15px] leading-none text-muted-foreground outline-none group-focus-within/row:flex group-hover/row:flex hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[popup-open]:flex"
      >
        ⋯
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={MENU}>
        <Item
          glyph="↗"
          action="chat.open"
          onClick={() => router.push(`/dashboard/chat/${chat.id}`)}
        >
          {t('open')}
        </Item>
        <Item glyph="⧉" action="chat.openNewWindow" onClick={() => actions.openNewWindow(chat)}>
          {t('openNewWindow')}
        </Item>
        <EditItems chat={chat} />
        {editable && (
          <Item glyph="▤" action="chat.archive" onClick={() => void actions.archive(chat)}>
            {t('archive')}
          </Item>
        )}
        {actions.canDelete(chat) && (
          <Item glyph="✕" action="chat.delete" danger onClick={() => actions.askDelete(chat)}>
            {t('delete')}
          </Item>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The open chat's ⋯ in the header (CHAT-23 `header.more`, G10): Chat
 * settings (Chat's Settings page, CHAT-01 owner update), Open in new window; for the author Pin, Rename (in the title),
 * Share with team; Export chat; Activity log; for GetCito staff only, the
 * Debug switch (CHAT-03 item 25, W1-15); Archive and Delete. Split view,
 * Schedule this and Save as agent come later.
 */
export function ChatHeaderMenu({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('chatShell.actions');
  const router = useRouter();
  const actions = useChatActions();
  if (!actions) return null;
  const editable = actions.canEdit(chat);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-action="header.more"
        aria-label={t('headerMore')}
        title={t('headerMore')}
        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        ⋯
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={MENU}>
        <Item
          glyph="⚙"
          action="chatMenu.openSettings"
          onClick={() => router.push('/dashboard/chat/settings')}
        >
          {t('settings')}
        </Item>
        <Item glyph="⧉" action="chat.openNewWindow" onClick={() => actions.openNewWindow(chat)}>
          {t('openNewWindow')}
        </Item>
        {editable && (
          <>
            <Item glyph="⌖" action="chat.pin" onClick={() => void actions.togglePin(chat)}>
              {t(chat.pinned ? 'unpin' : 'pin')}
            </Item>
            <Item
              glyph="✎"
              action="chat.rename"
              onClick={() => actions.startRename(chat, 'header')}
            >
              {t('rename')}
            </Item>
            <Item glyph="⇪" action="chat.share" onClick={() => void actions.toggleShare(chat)}>
              {t(chat.shared ? 'unshare' : 'share')}
            </Item>
          </>
        )}
        <ExportChatItem chat={chat} />
        <Item
          glyph="☰"
          action="activity.open"
          onClick={() => router.push('/dashboard/chat/activity')}
        >
          {t('activity')}
        </Item>
        <DebugItem />
        {(editable || actions.canDelete(chat)) && <DropdownMenuSeparator />}
        {editable && (
          <Item glyph="▤" action="chat.archive" onClick={() => void actions.archive(chat)}>
            {t('archive')}
          </Item>
        )}
        {actions.canDelete(chat) && (
          <Item glyph="✕" action="chat.delete" danger onClick={() => actions.askDelete(chat)}>
            {t('delete')}
          </Item>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Debug (CHAT-03 item 25): GetCito staff only, never rendered for anyone
 * else. On, each answer shows its steps' tools, inputs, outputs and cost.
 */
function DebugItem() {
  const t = useTranslations('chatShell.actions');
  const debug = useChatDebug();
  if (!debug?.staff) return null;
  return (
    <DropdownMenuCheckboxItem
      data-action="chat.debug"
      checked={debug.on}
      onCheckedChange={debug.toggle}
      className={cn(ITEM, 'pr-8')}
    >
      <span aria-hidden className="w-3.5 shrink-0 text-center text-foreground">
        ⚙
      </span>
      <span className="flex-1">
        {t('debug')}
        <span className="block text-[11.5px] text-muted-foreground">{t('debugNote')}</span>
      </span>
    </DropdownMenuCheckboxItem>
  );
}

const CHAT_EXPORT_FORMATS = ['md', 'docx', 'pdf'] as const;

/**
 * ⤓ Export chat (CHAT-23 `chat.export`): the whole chat as Markdown, Word
 * or PDF, rendered on the server from what is stored, nothing kept.
 */
function ExportChatItem({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('chatShell.actions');
  async function download(format: (typeof CHAT_EXPORT_FORMATS)[number]) {
    const res = await fetch(`/api/chat/conversations/${chat.id}/export?format=${format}`).catch(
      () => null,
    );
    if (!res?.ok) {
      toast.error(t('exportFailed'));
      return;
    }
    const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
    const name = named?.[1] ?? `chat.${format}`;
    saveBlob(await res.blob(), name);
    toast(t('exported', { name }));
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-action="chat.export" className={ITEM}>
        <span aria-hidden className="w-3.5 shrink-0 text-center text-foreground">
          ⤓
        </span>
        <span className="flex-1">{t('export')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-40 rounded-[14px] p-1.5">
        {CHAT_EXPORT_FORMATS.map((format) => (
          <DropdownMenuItem
            key={format}
            data-action="chat.exportAs"
            data-format={format}
            onClick={() => void download(format)}
            className={ITEM}
          >
            {t(`exportAs.${format}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * The side panel's ⋯ (CHAT-23 `panel.more`, CHAT-01 item 24): Open as full
 * page, Open in new window; for the author, Pin, Rename, Share with team,
 * Archive; Delete for the author, or an Admin on a shared chat.
 */
export function ChatPanelMenu({
  chat,
  onOpenFullPage,
}: {
  chat: ChatListItem;
  onOpenFullPage: () => void;
}) {
  const t = useTranslations('chatShell.actions');
  const tPanel = useTranslations('chatPanel');
  const actions = useChatActions();
  if (!actions) return null;
  const editable = actions.canEdit(chat);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-action="panel.more"
        aria-label={tPanel('more')}
        title={tPanel('more')}
        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        ⋯
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={MENU}>
        <Item glyph="⤢" action="panel.openFullPage" onClick={onOpenFullPage}>
          {tPanel('openFullPage')}
        </Item>
        <Item glyph="⧉" action="chat.openNewWindow" onClick={() => actions.openNewWindow(chat)}>
          {t('openNewWindow')}
        </Item>
        <EditItems chat={chat} />
        {(editable || actions.canDelete(chat)) && <DropdownMenuSeparator />}
        {editable && (
          <Item glyph="▤" action="chat.archive" onClick={() => void actions.archive(chat)}>
            {t('archive')}
          </Item>
        )}
        {actions.canDelete(chat) && (
          <Item glyph="✕" action="chat.delete" danger onClick={() => actions.askDelete(chat)}>
            {t('delete')}
          </Item>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A chat's name, edited in place (CHAT-23 `chat.rename`): Enter or clicking
 * away saves, Esc cancels.
 */
export function RenameField({ chat, className }: { chat: ChatListItem; className?: string }) {
  const t = useTranslations('chatShell.actions');
  const actions = useChatActions();
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  if (!actions) return null;
  const save = () => {
    if (done.current) return;
    done.current = true;
    void actions.rename(chat, input.current?.value ?? '');
  };
  return (
    <input
      ref={input}
      aria-label={t('renameLabel')}
      defaultValue={chat.title ?? ''}
      maxLength={200}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          done.current = true;
          actions.cancelRename();
        }
      }}
      className={cn(
        'w-full min-w-0 rounded-[5px] bg-card px-1 text-[13px] text-foreground outline outline-1 outline-foreground',
        className,
      )}
    />
  );
}
