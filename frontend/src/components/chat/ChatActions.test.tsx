import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import type { ChatListItem } from '@/lib/chat/conversations';

/**
 * A chat's ⋯ menus (CHAT-23 G9, P5, P6): the author gets Pin, Rename,
 * Share with team, Archive and Delete; a teammate's shared chat only opens,
 * and an Admin may delete it. Each change shows at once and is sent; Delete
 * asks first, leaves the chat it was on, and its toast's Undo brings it back.
 */

const nav = vi.hoisted(() => ({ pathname: '/dashboard/chat', push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));
const toasts = vi.hoisted(() => ({ calls: [] as { text: string; options?: unknown }[] }));
vi.mock('sonner', () => {
  const toast = (text: string, options?: unknown) => toasts.calls.push({ text, options });
  toast.error = (text: string) => toasts.calls.push({ text: `error: ${text}` });
  return { toast };
});
const list = vi.hoisted(() => ({
  chats: [] as ChatListItem[],
  refresh: vi.fn(async () => undefined),
}));
vi.mock('./ChatListProvider', () => ({
  useChatList: () => ({
    status: 'ready',
    chats: list.chats,
    total: list.chats.length,
    archived: 0,
    refresh: list.refresh,
    update: (change: (chats: ChatListItem[]) => ChatListItem[]) => {
      list.chats = change(list.chats);
    },
  }),
}));

const { ChatActionsProvider, useChatActions } = await import('./ChatActions');
const { ChatRowMenu } = await import('./ChatMenus');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ID = 'cccccccc-0000-4000-8000-000000000001';
const chat = (row: Partial<ChatListItem> = {}): ChatListItem => ({
  id: ID,
  title: 'Board update',
  brand: null,
  pinned: false,
  archived: false,
  shared: false,
  mine: true,
  ownerInitials: null,
  lastMessageAt: '2026-10-30T09:00:00Z',
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
  finishedAt: null,
  ...row,
});

let root: Root;
let host: HTMLDivElement;
let calls: { url: string; method: string; body: unknown }[];
let answer: (url: string, method: string) => { status: number; body: unknown };

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  nav.pathname = '/dashboard/chat';
  nav.push.mockClear();
  toasts.calls = [];
  list.chats = [chat()];
  list.refresh.mockClear();
  calls = [];
  answer = (url, method) =>
    method === 'PATCH'
      ? { status: 200, body: { ok: true, chat: { ...list.chats[0], pinned: true } } }
      : { status: 200, body: { ok: true } };
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const { status, body } = answer(url, method);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

let actions: ReturnType<typeof useChatActions> = null;
function Grab() {
  const value = useChatActions();
  useEffect(() => {
    actions = value;
  });
  return null;
}

const heard = { updated: vi.fn(), gone: vi.fn() };

async function render(node: ReactNode, role: TeamRole = 'manager') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <ChatActionsProvider onUpdated={heard.updated} onGone={heard.gone}>
            <Grab />
            {node}
          </ChatActionsProvider>
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

async function openMenu() {
  const trigger = host.querySelector<HTMLElement>('[data-action="chatMenu.rowMore"]')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trigger.click();
  });
}
const item = (name: string) => document.querySelector<HTMLElement>(`[data-action="${name}"]`);

describe('ChatRowMenu', () => {
  it("gives the author every change, in the mockup's order", async () => {
    await render(<ChatRowMenu chat={chat()} />);
    await openMenu();
    const order = [...document.querySelectorAll('[data-action^="chat."]')].map(
      (el) => (el as HTMLElement).dataset.action,
    );
    expect(order).toEqual([
      'chat.open',
      'chat.openNewWindow',
      'chat.pin',
      'chat.rename',
      'chat.share',
      'chat.archive',
      'chat.delete',
    ]);
  });

  it("only opens a teammate's shared chat; an Admin may delete it", async () => {
    const theirs = chat({ mine: false, shared: true, ownerInitials: 'SL' });
    await render(<ChatRowMenu chat={theirs} />);
    await openMenu();
    expect(item('chat.pin')).toBeNull();
    expect(item('chat.delete')).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    document.body.appendChild(host);
    await render(<ChatRowMenu chat={theirs} />, 'admin');
    await openMenu();
    expect(item('chat.delete')).not.toBeNull();
  });
});

describe('chat actions', () => {
  it('pins at once and sends it, then says so', async () => {
    await render(null);
    await act(async () => actions!.togglePin(chat()));
    expect(calls).toEqual([
      { url: `/api/chat/conversations/${ID}`, method: 'PATCH', body: { pinned: true } },
    ]);
    expect(list.chats[0].pinned).toBe(true);
    expect(toasts.calls.map((c) => c.text)).toEqual(['Pinned']);
  });

  it('puts a refused change back and says it failed', async () => {
    answer = () => ({ status: 404, body: { ok: false } });
    await render(null);
    await act(async () => actions!.toggleShare(chat()));
    expect(toasts.calls.map((c) => c.text)).toEqual(["error: Couldn't save that. Try again."]);
    expect(list.refresh).toHaveBeenCalled();
  });

  it('renames with a trimmed title, and does nothing for an unchanged one', async () => {
    await render(null);
    await act(async () => actions!.rename(chat(), '  Board update  '));
    expect(calls).toEqual([]);
    await act(async () => actions!.rename(chat(), ' Q4 plan '));
    expect(calls[0].body).toEqual({ title: 'Q4 plan' });
  });

  it('archives, and says where to find it again', async () => {
    await render(null);
    await act(async () => actions!.archive(chat()));
    expect(list.chats).toEqual([]);
    expect(calls.map((c) => c.body)).toEqual([{ archived: true }]);
    const archived = toasts.calls.find((c) => c.text.startsWith('Archived'))!;
    expect(archived.text).toBe('Archived · find it in All chats › Archived');
    // Unarchive is in All chats › Archived, not in the toast.
    expect(archived.options).not.toHaveProperty('action');
  });

  it('tells the page outside the shell of a new row, and of a chat gone (the side panel)', async () => {
    heard.updated.mockClear();
    heard.gone.mockClear();
    await render(null);
    await act(async () => actions!.togglePin(chat()));
    expect(heard.updated).toHaveBeenCalledWith(expect.objectContaining({ id: ID }));
    await act(async () => actions!.archive(chat()));
    expect(heard.gone).toHaveBeenCalledWith(expect.objectContaining({ id: ID }));
    answer = () => ({ status: 404, body: { ok: false } });
    heard.gone.mockClear();
    await act(async () => actions!.archive(chat()));
    expect(heard.gone).not.toHaveBeenCalled();
  });

  it('asks before Delete, leaves the open chat for Home, and Undo restores it', async () => {
    nav.pathname = `/dashboard/chat/${ID}`;
    await render(null);
    await act(async () => actions!.askDelete(chat()));
    expect(document.body.textContent).toContain('Delete this chat?');
    expect(document.body.textContent).toContain('“Board update” will be deleted for everyone.');
    // Focus starts on Cancel (CHAT-23 P5), once the dialog has opened.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement?.getAttribute('data-action')).toBe('modal.cancel');
    await act(async () => item('confirm.ok')!.click());
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: `/api/chat/conversations/${ID}` });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat');
    const deleted = toasts.calls.find((c) => c.text === 'Chat deleted')!;
    expect(deleted.options).toMatchObject({ duration: 10_000 });
    await act(async () =>
      (deleted.options as { action: { onClick: () => void } }).action.onClick(),
    );
    await act(async () => undefined);
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: `/api/chat/conversations/${ID}/restore`,
    });
    expect(toasts.calls.map((c) => c.text)).toContain('Undone');
  });

  it('says when Undo comes too late', async () => {
    answer = (url, method) =>
      method === 'POST'
        ? { status: 410, body: { ok: false } }
        : { status: 200, body: { ok: true } };
    await render(null);
    await act(async () => actions!.askDelete(chat()));
    await act(async () => item('confirm.ok')!.click());
    const deleted = toasts.calls.find((c) => c.text === 'Chat deleted')!;
    await act(async () =>
      (deleted.options as { action: { onClick: () => void } }).action.onClick(),
    );
    await act(async () => undefined);
    expect(toasts.calls.map((c) => c.text)).toContain("error: It's too late to undo.");
  });
});
