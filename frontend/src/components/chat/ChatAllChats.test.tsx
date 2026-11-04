import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatListItem } from '@/lib/chat/conversations';

/**
 * All chats (mockup #s-allchats; CHAT-23 `allChats.*`): Active and Archived
 * with their counts, the filters with Running and Needs you counted, the
 * person's own chats selectable for Archive selected (Unarchive selected
 * under Archived) with one toast, "No chats match." with Clear filters, and
 * a row that opens its chat.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/dashboard/chat/all',
  useRouter: () => ({ push: nav.push }),
}));
const toasts = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('sonner', () => {
  const toast = (text: string) => toasts.calls.push(text);
  toast.error = (text: string) => toasts.calls.push(`error: ${text}`);
  return { toast };
});
const menu = vi.hoisted(() => ({ refresh: vi.fn(async () => undefined) }));
vi.mock('./ChatListProvider', () => ({
  useChatList: () => ({
    status: 'ready',
    chats: [],
    total: 0,
    archived: 0,
    refresh: menu.refresh,
    update: () => undefined,
  }),
}));

// The page's clock; null keeps the real one.
const clock = vi.hoisted(() => ({ now: null as Date | null }));
vi.mock('./ChatInbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ChatInbox')>();
  return {
    ...actual,
    useNow: () => {
      const real = actual.useNow();
      return clock.now ?? real;
    },
  };
});

const { ChatAllChats, passesFilter } = await import('./ChatAllChats');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const chat = (id: string, row: Partial<ChatListItem> = {}): ChatListItem => ({
  id,
  title: `Chat ${id}`,
  brand: 'GetCito',
  pinned: false,
  archived: false,
  shared: false,
  mine: true,
  ownerInitials: null,
  lastMessageAt: '2026-10-28T09:00:00',
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
  finishedAt: null,
  ...row,
});

let active: ChatListItem[];
let archived: ChatListItem[];
let patches: { id: string; body: unknown }[];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  active = [
    chat('a', { state: 'needsYou', progress: { done: 3, total: 6 } }),
    chat('b', { state: 'running', progress: { done: 1, total: 5 } }),
    chat('c', { mine: false, shared: true, ownerInitials: 'SL' }),
    chat('d'),
  ];
  archived = [chat('z', { archived: true, title: 'Q3 content plan' })];
  patches = [];
  nav.push.mockClear();
  menu.refresh.mockClear();
  toasts.calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const id = url.split('/').pop()!;
        const body = JSON.parse(String(init.body)) as { archived: boolean };
        patches.push({ id, body });
        const from = body.archived ? active : archived;
        const moved = from.find((c) => c.id === id)!;
        active = active.filter((c) => c.id !== id);
        archived = archived.filter((c) => c.id !== id);
        (body.archived ? archived : active).push({ ...moved, archived: body.archived });
        return { ok: true, json: async () => ({ ok: true, chat: moved }) };
      }
      const view = url.includes('view=archived') ? archived : active;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          chats: view,
          total: active.length,
          archived: archived.length,
        }),
      };
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  clock.now = null;
  host.remove();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const action = (name: string) => host.querySelectorAll<HTMLElement>(`[data-action="${name}"]`);
const text = () => host.textContent ?? '';
const rows = () => [...action('allChats.openChat')].map((r) => r.querySelector('b')?.textContent);

describe('ChatAllChats', () => {
  it('lists the active chats with their counts, owners and filters', async () => {
    await render(<ChatAllChats ownInitials="JP" />);
    const tabs = action('allChats.tab');
    expect(tabs[0].textContent).toBe('Active4');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].textContent).toBe('Archived1');
    expect(rows()).toEqual(['Chat a', 'Chat b', 'Chat c', 'Chat d']);
    expect(text()).toContain('Needs your OK · step 4 of 6');
    expect(text()).toContain('SL');
    expect(text()).toContain('JP');
    // Only the person's own chats can be selected.
    expect(action('allChats.select')).toHaveLength(3);

    const filters = [...action('allChats.filter')];
    expect(filters.map((f) => f.textContent)).toEqual([
      'All',
      'Running1',
      'Needs you1',
      'Done',
      'Mine',
      'Team',
    ]);
    await act(async () => filters[1].click());
    expect(rows()).toEqual(['Chat b']);
    await act(async () => filters[5].click());
    expect(rows()).toEqual(['Chat c']);
    await act(async () => filters[2].click());
    await act(async () => filters[1].click());
    expect(filters[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('archives the selected chats with one toast, and Unarchive selected brings them back', async () => {
    await render(<ChatAllChats ownInitials="JP" />);
    const archive = action('allChats.archiveSelected')[0] as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    const boxes = action('allChats.select');
    await act(async () => boxes[0].click());
    await act(async () => boxes[2].click());
    expect(archive.disabled).toBe(false);
    // Checking a box doesn't open the chat.
    expect(nav.push).not.toHaveBeenCalled();
    await act(async () => archive.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(patches).toEqual([
      { id: 'a', body: { archived: true } },
      { id: 'd', body: { archived: true } },
    ]);
    expect(toasts.calls).toEqual(['2 archived · find them under Archived']);
    expect(rows()).toEqual(['Chat b', 'Chat c']);
    expect(menu.refresh).toHaveBeenCalled();

    await act(async () => action('allChats.tab')[1].click());
    expect(rows()).toEqual(['Q3 content plan', 'Chat a', 'Chat d']);
    const unarchive = action('allChats.unarchiveSelected')[0] as HTMLButtonElement;
    expect(unarchive.textContent).toBe('Unarchive selected');
    await act(async () => action('allChats.select')[0].click());
    await act(async () => unarchive.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(toasts.calls[1]).toBe('1 unarchived · back in Chats');
  });

  it('opens the Archived tab from its address, and a row opens its chat', async () => {
    await render(<ChatAllChats initialTab="archived" ownInitials={null} />);
    expect(rows()).toEqual(['Q3 content plan']);
    await act(async () => action('allChats.openChat')[0].click());
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/z');
  });

  it("tells a row's time by the page's clock, as the Updated column does", async () => {
    // The page's day is 30 October; the system clock is whatever today is.
    clock.now = new Date('2026-10-30T12:00:00');
    active = [chat('a', { state: 'done', finishedAt: '2026-10-30T08:02:00' })];
    await render(<ChatAllChats ownInitials="JP" />);
    expect(text()).toContain('Done · 08:02');
  });

  it('says when nothing matches, and Clear filters shows every chat again', async () => {
    active = [chat('d')];
    await render(<ChatAllChats ownInitials="JP" />);
    await act(async () => action('allChats.filter')[1].click());
    expect(text()).toContain('No chats match.');
    await act(async () => action('emptyState.clearFilters')[0].click());
    expect(rows()).toEqual(['Chat d']);
  });
});

describe('passesFilter', () => {
  it('sorts each chat into the filters', () => {
    expect(passesFilter(chat('x', { state: 'paused' }), 'running')).toBe(true);
    expect(passesFilter(chat('x', { state: 'failed' }), 'done')).toBe(true);
    expect(passesFilter(chat('x', { state: 'needsYou' }), 'done')).toBe(false);
    expect(passesFilter(chat('x', { mine: false }), 'mine')).toBe(false);
    expect(passesFilter(chat('x', { shared: true }), 'team')).toBe(true);
  });
});
