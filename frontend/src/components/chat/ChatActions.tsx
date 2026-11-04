'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { usePathname, useRouter } from '@/i18n/navigation';
import { RoleContext } from '@/components/context/RoleProvider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ChatListItem, UpdateInput } from '@/lib/chat/conversations';
import { useChatList } from './ChatListProvider';

/**
 * What a chat's ⋯ menus do (CHAT-23 G9, P5, P6): Pin, Rename in place,
 * Share with team, Archive (brought back from All chats › Archived), Delete
 * after a confirm with Undo, Open in a new window. Each change shows at
 * once in the menu and is then sent; a refused one is put back and says so.
 * The author changes their chat; a teammate's shared chat only opens, and
 * an Admin may delete it. Outside the shell (Chat's side panel), the page
 * hears of a chat's new row (`onUpdated`) and of one archived or deleted
 * (`onGone`).
 */

/** A toast with Undo stays this long (CHAT-23 P6). */
export const UNDO_TOAST_MS = 4_200;
/** Delete's Undo stays longer (CHAT-23 `chat.delete`: 10 s). */
export const DELETE_UNDO_TOAST_MS = 10_000;
/** A plain toast. */
const TOAST_MS = 2_200;

type RenameWhere = 'row' | 'header';

export interface ChatActions {
  /** The chat being renamed, and where: the menu's row or the header's title. */
  renaming: { id: string; where: RenameWhere } | null;
  startRename: (chat: ChatListItem, where: RenameWhere) => void;
  cancelRename: () => void;
  rename: (chat: ChatListItem, title: string) => Promise<void>;
  togglePin: (chat: ChatListItem) => Promise<void>;
  toggleShare: (chat: ChatListItem) => Promise<void>;
  archive: (chat: ChatListItem) => Promise<void>;
  askDelete: (chat: ChatListItem) => void;
  openNewWindow: (chat: ChatListItem) => void;
  /** Whether the person may change it: their own chat. */
  canEdit: (chat: ChatListItem) => boolean;
  /** Whether they may delete it: their own, or a shared one for an Admin. */
  canDelete: (chat: ChatListItem) => boolean;
}

const ChatActionsContext = createContext<ChatActions | null>(null);

const chatHref = (chat: Pick<ChatListItem, 'id'>) => `/dashboard/chat/${chat.id}`;

export function ChatActionsProvider({
  children,
  onUpdated,
  onGone,
}: {
  children: ReactNode;
  /** A change kept: the chat's row as it is now. */
  onUpdated?: (chat: ChatListItem) => void;
  /** Archived or deleted: no longer open. */
  onGone?: (chat: ChatListItem) => void;
}) {
  const t = useTranslations('chatShell.actions');
  const router = useRouter();
  const pathname = usePathname();
  const { role } = useContext(RoleContext);
  const { update, refresh } = useChatList();
  const [renaming, setRenaming] = useState<ChatActions['renaming']>(null);
  const [deleting, setDeleting] = useState<ChatListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const replace = useCallback(
    (id: string, change: Partial<ChatListItem>) =>
      update((chats) => chats.map((c) => (c.id === id ? { ...c, ...change } : c))),
    [update],
  );

  /** Sends a change; answers the chat's new row, or null after putting the list back. */
  const send = useCallback(
    async (chat: ChatListItem, patch: UpdateInput): Promise<ChatListItem | null> => {
      const res = await fetch(`/api/chat/conversations/${chat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as
        { ok: true; chat: ChatListItem } | { ok: false } | null;
      if (!res?.ok || !body?.ok) {
        toast.error(t('failed'));
        void refresh();
        return null;
      }
      replace(chat.id, body.chat);
      onUpdated?.(body.chat);
      return body.chat;
    },
    [refresh, replace, t, onUpdated],
  );

  const togglePin = useCallback(
    async (chat: ChatListItem) => {
      replace(chat.id, { pinned: !chat.pinned });
      if (await send(chat, { pinned: !chat.pinned })) {
        toast(t(chat.pinned ? 'unpinned' : 'pinned'), { duration: TOAST_MS });
      }
    },
    [replace, send, t],
  );

  const toggleShare = useCallback(
    async (chat: ChatListItem) => {
      replace(chat.id, { shared: !chat.shared });
      if (await send(chat, { shared: !chat.shared })) {
        toast(t(chat.shared ? 'unshared' : 'shared'), { duration: TOAST_MS });
      }
    },
    [replace, send, t],
  );

  // The toast says where the chat went (CHAT-23 `chat.archive`): Unarchive
  // is in All chats › Archived.
  const archive = useCallback(
    async (chat: ChatListItem) => {
      update((chats) => chats.filter((c) => c.id !== chat.id));
      if (!(await send(chat, { archived: true }))) return;
      onGone?.(chat);
      void refresh();
      toast(t('archived'), { duration: TOAST_MS });
    },
    [refresh, send, t, update, onGone],
  );

  const rename = useCallback(
    async (chat: ChatListItem, title: string) => {
      setRenaming(null);
      const next = title.trim();
      if (!next || next === chat.title) return;
      replace(chat.id, { title: next });
      if (await send(chat, { title: next })) toast(t('renamed'), { duration: TOAST_MS });
    },
    [replace, send, t],
  );

  const restore = useCallback(
    async (chat: ChatListItem) => {
      const res = await fetch(`/api/chat/conversations/${chat.id}/restore`, {
        method: 'POST',
      }).catch(() => null);
      if (!res?.ok) {
        toast.error(t(res?.status === 410 ? 'undoTooLate' : 'failed'));
        return;
      }
      toast(t('undone'), { duration: TOAST_MS });
      void refresh();
    },
    [refresh, t],
  );

  const confirmDelete = useCallback(async () => {
    const chat = deleting;
    if (!chat || busy) return;
    setBusy(true);
    const res = await fetch(`/api/chat/conversations/${chat.id}`, { method: 'DELETE' }).catch(
      () => null,
    );
    setBusy(false);
    setDeleting(null);
    if (!res?.ok) {
      toast.error(t('failed'));
      return;
    }
    update((chats) => chats.filter((c) => c.id !== chat.id));
    onGone?.(chat);
    // The chat that was open goes away: Chat Home instead.
    if (pathname === chatHref(chat)) router.push('/dashboard/chat');
    void refresh();
    toast(t('deleted'), {
      duration: DELETE_UNDO_TOAST_MS,
      action: { label: t('undo'), onClick: () => void restore(chat) },
    });
  }, [busy, deleting, pathname, refresh, restore, router, t, update, onGone]);

  const value = useMemo<ChatActions>(
    () => ({
      renaming,
      startRename: (chat, where) => setRenaming({ id: chat.id, where }),
      cancelRename: () => setRenaming(null),
      rename,
      togglePin,
      toggleShare,
      archive,
      askDelete: (chat) => setDeleting(chat),
      openNewWindow: (chat) => {
        window.open(chatHref(chat), '_blank', 'noopener');
      },
      canEdit: (chat) => chat.mine,
      canDelete: (chat) => chat.mine || (chat.shared && role === 'admin'),
    }),
    [archive, rename, renaming, role, toggleShare, togglePin],
  );

  return (
    <ChatActionsContext.Provider value={value}>
      {children}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent showCloseButton={false} initialFocus={cancelRef} className="sm:max-w-md">
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('deleteBody', { name: deleting?.title ?? t('untitled') })}
          </DialogDescription>
          <DialogFooter>
            <Button
              ref={cancelRef}
              variant="outline"
              data-action="modal.cancel"
              onClick={() => setDeleting(null)}
            >
              {t('cancel')}
            </Button>
            <Button
              data-action="confirm.ok"
              disabled={busy}
              onClick={() => void confirmDelete()}
              className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
            >
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ChatActionsContext.Provider>
  );
}

/** The chat actions; null outside the shell. */
export function useChatActions(): ChatActions | null {
  return useContext(ChatActionsContext);
}
