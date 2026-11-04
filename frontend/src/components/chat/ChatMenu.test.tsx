import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatListItem } from '@/lib/chat/conversations';

/**
 * The chat menu and its shell (CHAT-01 items 6, 9a–9f; CHAT-23 G1): the
 * toggle and New chat, Home with what needs the person, Agents at work in
 * three rows with See all and Show less, Chats by day, Search chats in
 * place of the days while typing, All chats and Archived at the end, and no
 * item for a page that isn't built. `Ctrl+\` hides the menu, keeps the
 * choice on the person and shows the strip instead; `Ctrl+Shift+O` starts a
 * new chat; `Ctrl K` opens the search palette and closes it again.
 */

const nav = vi.hoisted(() => ({ pathname: '/dashboard/chat', push: vi.fn() }));
const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search.value) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));
vi.mock('@/components/agentic/RunsTray', () => ({
  RunsTray: () => <button type="button" data-action="runs.toggleTray" />,
}));
vi.mock('@/lib/actions/chatPrefs', () => ({
  saveChatMenuOpen: vi.fn(async () => ({ ok: true })),
}));
// The Connections row's Ask your Admin (W4-25) sends through this server action.
vi.mock('@/lib/actions/chatAccessRequests', () => ({
  requestAccess: vi.fn(async () => ({ ok: true })),
}));
const usage = vi.hoisted(() => ({ percentUsed: null as number | null, trial: false }));
vi.mock('@/components/context/AiUsageProvider', () => ({
  useAiUsage: () => ({
    usage:
      usage.percentUsed === null
        ? null
        : {
            unlimited: false,
            percentUsed: usage.percentUsed,
            features: [],
            plan: 'growth',
            trial: usage.trial,
          },
    refresh: () => undefined,
  }),
}));

const { ChatMenuView } = await import('./ChatMenu');
const { ChatShell } = await import('./ChatShell');
const { useChatCrumb } = await import('./ChatCrumb');
const { AgentsSeen } = await import('./agents/AgentsSeen');
const { saveChatMenuOpen } = await import('@/lib/actions/chatPrefs');
const { useChatRailStore } = await import('@/state/useChatRailStore');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NOW = new Date('2026-10-30T12:00:00');

const chat = (id: string, row: Partial<ChatListItem> = {}): ChatListItem => ({
  id,
  title: `Chat ${id}`,
  brand: 'GetCito',
  pinned: false,
  archived: false,
  shared: false,
  mine: true,
  ownerInitials: null,
  lastMessageAt: '2026-10-30T09:00:00',
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
  finishedAt: null,
  ...row,
});

let root: Root;
let host: HTMLDivElement;
let wide = true;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  nav.pathname = '/dashboard/chat';
  nav.push.mockClear();
  vi.mocked(saveChatMenuOpen).mockClear();
  usage.percentUsed = null;
  usage.trial = false;
  window.sessionStorage.clear();
  wide = true;
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  window.localStorage?.clear?.();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const action = (name: string) => host.querySelectorAll<HTMLElement>(`[data-action="${name}"]`);
const text = () => host.textContent ?? '';

function menu(chats: ChatListItem[], extra: Partial<Parameters<typeof ChatMenuView>[0]> = {}) {
  return (
    <ChatMenuView
      status="ready"
      chats={chats}
      total={chats.length}
      pathname="/dashboard/chat"
      open
      onToggle={() => undefined}
      onNewChat={() => undefined}
      onRetry={() => undefined}
      now={NOW}
      {...extra}
    />
  );
}

describe('ChatMenuView', () => {
  it('puts the Connections row under Skills, its list closed until opened (W4-25)', async () => {
    await render(menu([]));
    const skills = action('chatMenu.openSkills')[0];
    const row = skills.nextElementSibling as HTMLElement;
    expect(row.textContent).toBe('ConnectionsManage▾');
    expect(
      row.querySelector('[data-action="chatMenu.manageConnections"]')?.getAttribute('href'),
    ).toBe('/dashboard/chat/connections');
    expect(action('chatMenu.toggleConnections')[0].getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('#chat-menu-connections')).toBeNull();
  });

  it('shows the toggle, New chat with its keys, Home and the governance pages, and no unbuilt page', async () => {
    await render(menu([]));
    const toggle = action('chatMenu.toggle')[0];
    expect(toggle.getAttribute('aria-label')).toBe('Hide chat menu');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('title')).toBe('Hide menu · Ctrl+\\');
    expect(action('chat.new')[0].textContent).toContain('New chat');
    expect(action('chatMenu.openHome')[0].getAttribute('aria-current')).toBe('page');
    expect(action('chatMenu.openActivity')[0].getAttribute('href')).toBe(
      '/dashboard/chat/activity',
    );
    expect(action('chatMenu.openPolicy')[0].getAttribute('href')).toBe('/dashboard/settings/chat');
    expect(action('chatMenu.openSettings')[0].getAttribute('href')).toBe(
      '/dashboard/chat/settings',
    );
    // No allowance to meter: no usage beside Settings.
    expect(action('chatMenu.openSettings')[0].textContent).toBe('Settings');
    expect(action('chatMenu.openInbox')[0].getAttribute('href')).toBe('/dashboard/chat/inbox');
    expect(action('chatMenu.openFiles')[0].getAttribute('href')).toBe('/dashboard/chat/files');
    // Agent Center, out of Chat, with "New" until it is first opened (governance mockup #cnav).
    expect(action('chatMenu.openAgents')[0].getAttribute('href')).toBe('/dashboard/agents');
    expect(action('chatMenu.openAgents')[0].textContent).toBe('Agent CenterNew');
    // Skills (W3-07); Scheduled isn't built yet.
    expect(action('chatMenu.openSkills')[0].getAttribute('href')).toBe('/dashboard/chat/skills');
    expect(action('chatMenu.openScheduled')).toHaveLength(0);
    expect(text()).toContain('No chats yet.');
    expect(action('chatMenu.searchChats')[0].getAttribute('placeholder')).toBe(
      'Search chats · Ctrl K',
    );
    expect(action('chatMenu.openAllChats')[0].getAttribute('href')).toBe('/dashboard/chat/all');
    expect(action('chatMenu.openAllChats')[0].textContent).toBe('All chats · 0 ›');
    expect(action('chatMenu.openArchived')[0].getAttribute('href')).toBe(
      '/dashboard/chat/all?tab=archived',
    );
  });

  it('lists the matching chats in place of the days while Search chats has words', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        ok: true,
        chats: url.includes('q=zzz') ? [] : [chat('found', { title: 'Citations drop' })],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await render(menu([chat('t', { lastMessageAt: '2026-10-30T10:00:00' })], { archived: 2 }));
    expect(action('chatMenu.openArchived')[0].textContent).toBe('Archived · 2 ›');
    const field = action('chatMenu.searchChats')[0] as HTMLInputElement;
    const type = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 260));
      });
    };
    await type('citat');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/conversations/search?q=citat&view=active',
      expect.anything(),
    );
    expect(text()).toContain('Citations drop');
    expect(text()).not.toContain('Today');
    await type('zzz');
    expect(text()).toContain('No chats match.');
    await act(async () => action('emptyState.clearFilters')[0].click());
    expect(field.value).toBe('');
    expect(text()).toContain('Today');
    vi.unstubAllGlobals();
  });

  it('counts the Inbox, and lists Agents at work in three rows until See all', async () => {
    const chats = [
      chat('a', { state: 'needsYou', progress: { done: 3, total: 6 } }),
      chat('b', {
        state: 'running',
        step: 'Comparing cited pages',
        progress: { done: 1, total: 5 },
      }),
      chat('c', { state: 'running' }),
      chat('d', { state: 'done', unread: true, finishedAt: '2026-10-30T08:02:00' }),
      chat('e'),
    ];
    await render(menu(chats));
    // The Inbox counts what Agents at work lists, with a dot while one needs the person.
    const inbox = action('chatMenu.openInbox')[0];
    expect(inbox.textContent).toBe('Inbox4');
    expect(inbox.getAttribute('aria-label')).toBe('Inbox · 4 items · 1 needs you');
    expect(text()).toContain('Agents at work4');
    expect(text()).toContain('Needs your OK · step 4 of 6');
    expect(text()).toContain('Step 2 of 5 · Comparing cited pages');
    expect(text()).not.toContain('Chat d');
    await act(async () => action('chatMenu.seeAllRuns')[0].click());
    expect(text()).toContain('Done · 08:02');
    expect(action('chatMenu.showLessRuns')).toHaveLength(1);
    await act(async () => action('chatMenu.showLessRuns')[0].click());
    expect(text()).not.toContain('Chat d');
    // A chat at work isn't listed again below.
    expect(action('chatMenu.openChat')).toHaveLength(4);
  });

  it("leaves a teammate's shared chat out of the Inbox: it waits on its author", async () => {
    await render(
      menu([
        chat('a', { state: 'running' }),
        chat('t', { mine: false, shared: true, ownerInitials: 'SL', state: 'needsYou' }),
      ]),
    );
    const inbox = action('chatMenu.openInbox')[0];
    expect(inbox.textContent).toBe('Inbox1');
    expect(inbox.getAttribute('aria-label')).toBe('Inbox · 1 item');
  });

  it('groups the other chats by day, bold while unread, and folds Chats', async () => {
    await render(
      menu([
        chat('t', { lastMessageAt: '2026-10-30T10:00:00' }),
        chat('y', { lastMessageAt: '2026-10-29T10:00:00', title: null }),
        chat('s', { lastMessageAt: '2026-09-02T10:00:00', ownerInitials: 'SL', mine: false }),
      ]),
    );
    expect(text()).toContain('Today');
    expect(text()).toContain('Yesterday');
    expect(text()).toContain('September');
    expect(text()).toContain('New chat');
    expect(text()).toContain('SL');
    const fold = action('chatMenu.toggleChats')[0];
    await act(async () => fold.click());
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(action('chatMenu.openChat')).toHaveLength(0);
  });

  it("moves Today's chats to Yesterday once the menu, left open, passes midnight", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-30T23:50:00'));
      const at = chat('late', { lastMessageAt: '2026-10-30T23:40:00' });
      await render(menu([at], { now: undefined }));
      expect(text()).toContain('Today');
      vi.setSystemTime(new Date('2026-10-31T00:10:00'));
      // The next read of the list: the same chat, a new array.
      await render(menu([{ ...at }], { now: undefined }));
      expect(text()).toContain('Yesterday');
      expect(text()).not.toContain('Today');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says when the list could not be read, with Retry', async () => {
    const onRetry = vi.fn();
    await render(menu([], { status: 'error', onRetry }));
    expect(text()).toContain("Couldn't load your chats.");
    await act(async () => (host.querySelector('#chat-menu-chats button') as HTMLElement).click());
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('ChatShell', () => {
  it('hides the menu with Ctrl+\\, keeps the choice and shows the strip; again shows it', async () => {
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true }));
    });
    expect(saveChatMenuOpen).toHaveBeenCalledWith(false);
    expect(host.querySelector('#chat-menu')?.className).toContain('w-0');
    const strip = host.querySelector('[role="toolbar"]')!;
    expect(strip.querySelector('[data-action="chatMenu.toggle"]')?.getAttribute('aria-label')).toBe(
      'Show chat menu',
    );
    expect(strip.querySelector('[data-action="chat.new"]')).not.toBeNull();
    expect(strip.querySelector('[data-action="search.open"]')?.textContent).toBe('SearchCtrl K');
    expect(strip.querySelector('[data-action="runs.toggleTray"]')).not.toBeNull();
    expect(strip.querySelector('[data-action="chatMenu.openInbox"]')).not.toBeNull();
    await act(async () =>
      (strip.querySelector('[data-action="chatMenu.toggle"]') as HTMLElement).click(),
    );
    expect(saveChatMenuOpen).toHaveBeenLastCalledWith(true);
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('starts a new chat with Ctrl+Shift+O, and leaves Ctrl+B to the composer', async () => {
    await render(<ChatShell menuOpen={false}>{<p>page</p>}</ChatShell>);
    const bold = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(bold);
    });
    expect(bold.defaultPrevented).toBe(false);
    const newChat = new KeyboardEvent('keydown', {
      key: 'O',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(newChat);
    });
    expect(newChat.defaultPrevented).toBe(true);
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat');
  });

  it('below 1100px opens a drawer and leaves the saved choice alone', async () => {
    wide = false;
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', metaKey: true }));
    });
    expect(saveChatMenuOpen).not.toHaveBeenCalled();
  });

  it('opens the search palette with Ctrl K, with New chat and the Chat pages, and closes it again', async () => {
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    const press = async () => {
      const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
      await act(async () => {
        window.dispatchEvent(event);
      });
      return event;
    };
    expect((await press()).defaultPrevented).toBe(true);
    const palette = document.body.querySelector('[data-action="search.input"]');
    expect(palette).not.toBeNull();
    const popup = palette!.closest('[data-slot="popover-content"]')!;
    expect(popup.querySelector('[data-action="chat.new"]')).not.toBeNull();
    expect(popup.querySelector('[data-action="search.openPage"]')?.textContent).toContain(
      'All chats',
    );
    expect(
      [...popup.querySelectorAll('[data-action="search.openPage"]')].map((b) => b.textContent),
    ).toEqual(['☰All chats', '✦Agent Center', '▤Files', '⇄Connections', '⚙Settings']);
    await act(async () =>
      (popup.querySelector('[data-action="search.openPage"]') as HTMLElement).click(),
    );
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/all');
    await press();
    expect(document.body.querySelector('[data-action="search.input"]')).not.toBeNull();
    await press();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.body.querySelector('[data-action="search.input"]')).toBeNull();
  });

  it("shows the month's AI usage beside Settings, amber from 80%", async () => {
    usage.percentUsed = 18;
    await render(menu([]));
    const settings = action('chatMenu.openSettings')[0];
    expect(settings.textContent).toBe('Settings18%');
    expect(settings.querySelector('[title="AI usage this month"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    usage.percentUsed = 85;
    await render(menu([]));
    expect(action('chatMenu.openSettings')[0].querySelector('i')?.className).toContain('amber');
  });

  it('names the free trial’s credit in words beside Settings, as the header’s meter', async () => {
    usage.trial = true;
    const shown = async (percent: number) => {
      act(() => root.unmount());
      root = createRoot(host);
      usage.percentUsed = percent;
      await render(menu([]));
      return action('chatMenu.openSettings')[0];
    };
    let settings = await shown(18);
    expect(settings.textContent).toBe('SettingsTrial credit');
    expect(settings.querySelector('i')).toBeNull();
    expect(settings.querySelector('[title="AI: the free trial\'s AI credit"]')).not.toBeNull();
    settings = await shown(85);
    expect(settings.textContent).toBe('SettingsAlmost used');
    expect(settings.innerHTML).toContain('text-amber-700');
    settings = await shown(100);
    expect(settings.textContent).toBe('SettingsUsed up');
    expect(settings.innerHTML).toContain('text-red-700');
  });

  it('gives a Chat page Back to Chat and the breadcrumb, back to the last conversation', async () => {
    nav.pathname = '/dashboard/chat/all';
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    const back = action('nav.backToChat')[0];
    expect(back.textContent).toBe('← Back to Chat');
    expect(back.getAttribute('href')).toBe('/dashboard/chat');
    expect(back.getAttribute('title')).toBe('Back to Chat Home');
    expect(action('nav.breadcrumb')[0].getAttribute('href')).toBe('/dashboard/chat');
    expect(host.querySelector('header nav')?.textContent).toBe('Chat›All chats');

    // A conversation opened in this tab is where Back to Chat goes.
    const id = 'cccccccc-0000-4000-8000-000000000001';
    nav.pathname = `/dashboard/chat/${id}`;
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    expect(action('nav.backToChat')).toHaveLength(0);
    nav.pathname = '/dashboard/chat/inbox';
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    expect(action('nav.backToChat')[0].getAttribute('href')).toBe(`/dashboard/chat/${id}`);
    expect(action('nav.backToChat')[0].getAttribute('title')).toBe(
      'Back to your last conversation',
    );
    expect(host.querySelector('header nav')?.textContent).toBe('Chat›Inbox');

    // Settings sits right under Home: its name, no way back needed.
    nav.pathname = '/dashboard/chat/settings';
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    expect(action('nav.backToChat')).toHaveLength(0);
    expect(host.querySelector('header h1')?.textContent).toBe('Settings');
  });

  it('leads to Agent Center out of Chat, and drops its New once Agent Center was opened', async () => {
    // A browser's storage, where the pill's "seen" is kept.
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
      clear: () => kept.clear(),
    });
    nav.pathname = '/dashboard/chat/inbox';
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    const item = () =>
      host.querySelector<HTMLAnchorElement>('#chat-menu [data-action="chatMenu.openAgents"]')!;
    expect(item().getAttribute('href')).toBe('/dashboard/agents');
    expect(item().getAttribute('aria-current')).toBeNull();
    expect(item().textContent).toBe('Agent CenterNew');
    // Its pages have no Chat header: the shell names none of them.
    expect(host.querySelector('header nav')?.textContent).toBe('Chat›Inbox');

    // Agent Center opened, however it was reached (its pages mark it seen).
    act(() => root.unmount());
    root = createRoot(host);
    await render(<AgentsSeen />);
    act(() => root.unmount());
    root = createRoot(host);
    nav.pathname = '/dashboard/chat/all';
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    expect(item().textContent).toBe('Agent Center');
    vi.unstubAllGlobals();
  });

  it("names the Inbox and a daily suggestion's page in the breadcrumb, which fills the page (CHAT-26)", async () => {
    function Named() {
      useChatCrumb('Daily suggestion · Oct 29');
      return <p>suggestion</p>;
    }
    nav.pathname = '/dashboard/chat/inbox/55555555-5555-4555-8555-555555555555';
    await render(
      <ChatShell menuOpen>
        <Named />
      </ChatShell>,
    );
    expect(host.querySelector('header nav')?.textContent).toBe(
      'Chat›Inbox›Daily suggestion · Oct 29',
    );
    // Its Inbox goes back to the Daily suggestions.
    expect(action('nav.breadcrumb')[1].getAttribute('href')).toBe(
      '/dashboard/chat/inbox?tab=suggestions',
    );
    // A chat to be: no page padding around it.
    expect(host.querySelector('.chat-scroll')?.className).not.toContain('p-6');
  });

  it('leads a chat opened as a full page back to the app page it came from (CHAT-22)', async () => {
    const id = 'cccccccc-0000-4000-8000-000000000002';
    nav.pathname = `/dashboard/chat/${id}`;
    search.value = `from=${encodeURIComponent('/dashboard/mentions?platform=chatgpt-web')}`;
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    const back = action('nav.backToPage')[0];
    expect(back.textContent).toBe('↙ Back to Mentions');
    expect(back.getAttribute('href')).toBe('/dashboard/mentions?platform=chatgpt-web');

    // Never anywhere else.
    search.value = `from=${encodeURIComponent('https://example.com/dashboard/x')}`;
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    expect(action('nav.backToPage')).toHaveLength(0);
    search.value = '';
  });

  it('closes only the palette with Esc, and never navigates', async () => {
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    const input = document.body.querySelector<HTMLInputElement>('[data-action="search.input"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.body.querySelector('[data-action="search.input"]')).toBeNull();
    // The menu stays as it was, and nothing went back.
    expect(host.querySelector('#chat-menu')?.className).toContain('w-64');
    expect(nav.push).not.toHaveBeenCalled();
    expect(saveChatMenuOpen).not.toHaveBeenCalled();
  });

  it("sets the app sidebar beside Chat to the person's saved rail state", async () => {
    useChatRailStore.setState({ open: false });
    await render(
      <ChatShell menuOpen railOpen>
        {<p>page</p>}
      </ChatShell>,
    );
    expect(useChatRailStore.getState().open).toBe(true);
  });
});
