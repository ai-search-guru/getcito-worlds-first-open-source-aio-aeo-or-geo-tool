import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatListItem } from '@/lib/chat/conversations';
import type { DailySuggestion, DailySuggestionsRead } from '@/lib/chat/dailySuggestions';
import type { SuggestionsReadResult } from '@/lib/actions/chatSuggestions';

/**
 * The Inbox's topic tabs and daily suggestions (CHAT-26 §2.1, §2.2, §2.4,
 * §5, §6; mockup #d-inbox, #d-paused): All, Daily suggestions, Needs you
 * and Runs with their counts (Reports and Alerts hidden until they have a
 * source); the suggestions' rows with their dot, line and day; seen marked
 * for the rows on screen; a row opens its action in the Action Center; the
 * paused banner with Turn back on; Pause; an Agency partner's first Inbox;
 * none for an Analyst; a read-only workspace; and the Inbox as it was while
 * the new Chat is off. The tabs move with the arrow keys and the address
 * keeps the open one; a row names its brand with several, stays faded once
 * its action is closed, and doesn't open on a brand the person's list lacks.
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), search: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: nav.push }),
}));
const plan = vi.hoisted(() => ({ locked: false, openUpgrade: vi.fn() }));
vi.mock('@/components/context/upgradeGate', () => ({
  useUpgradeDialog: () => ({
    isLocked: plan.locked,
    isDemo: false,
    reason: 'expired',
    adminName: null,
    openUpgrade: plan.openUpgrade,
  }),
}));
const sonner = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: sonner.error, success: sonner.success }),
}));
const takeDown = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/cmsTakeDown', () => ({ takeDownDraft: takeDown }));
/** The demo brand on screen, and one brand of the workspace's own. */
const BRANDS = [
  { id: 'brand-a', name: 'Demo', isDemo: true },
  { id: 'brand-b', name: 'Trailpeak' },
];
const store = vi.hoisted(() => ({
  setActiveBrand: vi.fn(),
  brands: [] as { id: string; name: string; isDemo?: boolean }[],
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (pick: (s: unknown) => unknown) =>
    pick({
      brands: store.brands,
      activeBrandId: 'brand-a',
      setActiveBrand: store.setActiveBrand,
    }),
}));
const server = vi.hoisted(() => ({
  read: vi.fn(),
  seen: vi.fn(async () => ({ ok: true })),
  open: vi.fn(async () => ({ ok: true })),
  set: vi.fn(async () => ({ ok: true })),
  start: vi.fn(async () => ({ ok: true, made: 2 })),
}));
vi.mock('@/lib/actions/chatSuggestions', () => ({
  readDailySuggestions: server.read,
  markDailySuggestionsSeen: server.seen,
  openDailySuggestion: server.open,
  setDailySuggestions: server.set,
  startDailySuggestions: server.start,
}));
const notices = vi.hoisted(() => ({
  read: vi.fn(async () => true),
  close: vi.fn(async () => true),
}));
vi.mock('@/lib/actions/chatNotices', () => ({
  markChatNoticesRead: notices.read,
  closeChatNotice: notices.close,
}));
const list = vi.hoisted(() => ({ chats: [] as ChatListItem[] }));
vi.mock('./ChatListProvider', () => ({
  useChatList: () => ({ status: 'ready', chats: list.chats, refresh: async () => undefined }),
}));

const { ChatInboxView } = await import('./ChatInbox');
const { RoleContext } = await import('@/components/context/RoleProvider');
const { ChatInbox } = await import('./ChatInboxPage');

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
  lastMessageAt: '2026-10-29T08:00:00',
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
  finishedAt: null,
  ...row,
});

/** The mockup's three rows: new today, seen yesterday, started in the Content Editor. */
const suggestion = (id: string, row: Partial<DailySuggestion> = {}): DailySuggestion => ({
  id,
  brandId: 'brand-b',
  actionId: `action-${id}`,
  sentOn: '2026-10-29',
  sentAt: '2026-10-29T07:05:00Z',
  seenAt: null,
  openedAt: null,
  startedAt: null,
  startedVia: null,
  closed: null,
  summary: {
    actionNo: 2841,
    kind: 'content_opportunity',
    payload: { title: 'Optimize 5 hiking backpack pages AI asks about' },
    priorityLevel: 'high',
    startNow: { method: 'optimize', pages: 5, minutes: 20 },
  },
  ...row,
});
const MOCKUP_ROWS = [
  suggestion('s1'),
  suggestion('s2', {
    sentOn: '2026-10-28',
    seenAt: '2026-10-28T09:00:00Z',
    summary: {
      actionNo: 2866,
      kind: 'content_opportunity',
      payload: { title: 'Add an llms.txt to trailpeak.example' },
      priorityLevel: 'medium',
      startNow: null,
    },
  }),
  suggestion('s3', {
    sentOn: '2026-10-27',
    seenAt: '2026-10-27T09:00:00Z',
    openedAt: '2026-10-27T09:01:00Z',
    startedAt: '2026-10-27T12:00:00',
    startedVia: 'editor',
    summary: {
      actionNo: 2930,
      kind: 'content_opportunity',
      payload: { title: 'Link your 4 most-read guides to the Backpacks category' },
      priorityLevel: 'high',
      startNow: { method: 'optimize', pages: 4, minutes: 16 },
    },
  }),
];
const readOf = (read: Partial<DailySuggestionsRead> = {}): DailySuggestionsRead => ({
  roleFeed: 'default_on',
  state: 'on',
  suggestions: MOCKUP_ROWS,
  total: (read.suggestions ?? MOCKUP_ROWS).length,
  today: '2026-10-29',
  ...read,
});
const ok = (read: Partial<DailySuggestionsRead> = {}): SuggestionsReadResult => ({
  ok: true,
  read: readOf(read),
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 29, 9, 30));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  nav.push.mockClear();
  nav.search = '';
  window.history.replaceState(null, '', '/dashboard/chat/inbox');
  plan.locked = false;
  plan.openUpgrade.mockClear();
  sonner.error.mockClear();
  sonner.success.mockClear();
  takeDown.mockReset();
  store.setActiveBrand.mockClear();
  store.brands = BRANDS;
  for (const fn of Object.values(server)) fn.mockClear();
  server.read.mockResolvedValue(ok());
  list.chats = [
    chat('a', { state: 'needsYou', progress: { done: 3, total: 6 } }),
    chat('b', { state: 'running', step: 'Comparing cited pages', progress: { done: 1, total: 5 } }),
  ];
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
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

const text = () => host.textContent ?? '';
const tabs = () =>
  [...host.querySelectorAll('[role="tab"]')].map((tab) => (tab as HTMLElement).textContent);
const click = async (selector: string) =>
  act(async () => (host.querySelector(selector) as HTMLElement).click());
const openTab = (name: string) => click(`[data-tab="${name}"]`);
const rowTitles = () =>
  [...host.querySelectorAll('[data-action="inbox.openItem"][role="link"]')].map(
    (row) => row.querySelector('span:nth-child(2)')?.firstChild?.textContent,
  );

describe('the topic tabs', () => {
  it('shows All, Daily suggestions, Needs you and Runs with their counts, and the week in the subtitle', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    expect(tabs()).toEqual(['All5', 'Daily suggestions3', 'Needs you1', 'Runs1']);
    expect(text()).not.toContain('Reports');
    expect(text()).not.toContain('Alerts');
    expect(text()).toContain(
      '1 needs you · 1 running · 3 suggestions this week. Results from your agents and daily suggestions land here.',
    );
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('All5');
  });

  it('shows only the tab’s rows', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    expect(rowTitles()).toEqual([
      'Chat a',
      'Chat b',
      'Optimize 5 hiking backpack pages AI asks about',
      'Add an llms.txt to trailpeak.example',
      'Link your 4 most-read guides to the Backpacks category',
    ]);
    await openTab('needsYou');
    expect(rowTitles()).toEqual(['Chat a']);
    await openTab('runs');
    expect(rowTitles()).toEqual(['Chat b']);
    await openTab('suggestions');
    expect(rowTitles()).toEqual([
      'Optimize 5 hiking backpack pages AI asks about',
      'Add an llms.txt to trailpeak.example',
      'Link your 4 most-read guides to the Backpacks category',
    ]);
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('Daily suggestions3');
  });

  it('says "Nothing needs you." when nothing does', async () => {
    list.chats = [];
    await render(<ChatInbox suggestions={ok({ suggestions: [] })} />);
    expect(text()).toContain(
      'Nothing needs you. Results from your agents and daily suggestions land here.',
    );
    expect(tabs()).toEqual(['All0', 'Daily suggestions0', 'Needs you0', 'Runs0']);
    expect(text()).toContain('Nothing here.');
  });
});

describe('notices (AGENT-OWN-KEY §5.3, 00441)', () => {
  const KEY_NOTICE = {
    id: '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c09',
    kind: 'own_key_failed' as const,
    provider: 'openai' as const,
    class: 'no_credit' as const,
    reminder: false,
    createdAt: '2026-10-29T08:00:00Z',
    read: false,
  };
  const withNotice = (over: Partial<typeof KEY_NOTICE> = {}) => ({
    ok: true as const,
    notices: [{ ...KEY_NOTICE, ...over }],
  });
  const noticeRows = () => [...host.querySelectorAll('[data-slot="inbox-notice"]')];

  beforeEach(() => notices.read.mockClear());

  it('leads Needs you and All with the key’s notice, counted in both, with Fix it', async () => {
    await render(<ChatInbox suggestions={ok()} notices={withNotice()} />);
    expect(tabs()).toEqual(['All6', 'Daily suggestions3', 'Needs you2', 'Runs1']);
    expect(text()).toContain('2 need you · 1 running · 3 suggestions this week.');
    const [row] = noticeRows();
    expect(row.textContent).toContain('Your OpenAI key isn’t working · agents are paused');
    expect(row.textContent).toContain('Your OpenAI account is out of credit.');
    expect(row.querySelector('[data-action="inbox.fixKey"]')!.getAttribute('href')).toBe(
      '/dashboard/settings/ai-providers',
    );
    // Shown: marked read, once.
    expect(notices.read).toHaveBeenCalledExactlyOnceWith([KEY_NOTICE.id]);

    await openTab('needsYou');
    expect(noticeRows()).toHaveLength(1);
    await openTab('runs');
    expect(noticeRows()).toHaveLength(0);
  });

  it('says a reminder is one, and marks nothing read that was read', async () => {
    await render(
      <ChatInbox suggestions={ok()} notices={withNotice({ reminder: true, read: true })} />,
    );
    expect(noticeRows()[0].textContent).toContain(
      'Your OpenAI account is out of credit. Still not working after 3 days.',
    );
    expect(notices.read).not.toHaveBeenCalled();
  });

  it('warns at 80% of the key’s agent limit, with the estimate and the way to the limit', async () => {
    const limit = {
      id: '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c0a',
      kind: 'own_key_limit' as const,
      level: 80 as const,
      usedUsd: 205.4,
      capUsd: 250,
      renewsAt: '2026-11-20T09:00:00.000Z',
      createdAt: '2026-11-01T08:00:00Z',
      read: false,
    };
    await render(<ChatInbox suggestions={ok()} notices={{ ok: true, notices: [limit] }} />);
    const [row] = noticeRows();
    expect(row.getAttribute('data-kind')).toBe('own_key_limit_80');
    expect(row.textContent).toContain('Agents have used 80% of their monthly limit on your key');
    expect(row.textContent).toContain('About $205 of $250 this month, estimated · renews Nov 20');
    const link = row.querySelector('[data-action="inbox.keyLimit"]')!;
    expect(link.textContent).toBe('Review limit');
    expect(link.getAttribute('href')).toBe('/dashboard/settings/ai-providers');
    expect(notices.read).toHaveBeenCalledExactlyOnceWith([limit.id]);
  });

  it('says the agents paused at the limit, and offers to raise it', async () => {
    const reached = {
      id: '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c0b',
      kind: 'own_key_limit' as const,
      level: 100 as const,
      usedUsd: 251.2,
      capUsd: 250,
      renewsAt: '2026-11-20T09:00:00.000Z',
      createdAt: '2026-11-01T08:00:00Z',
      read: true,
    };
    await render(<ChatInbox suggestions={ok()} notices={{ ok: true, notices: [reached] }} />);
    const [row] = noticeRows();
    expect(row.textContent).toContain(
      "Agents reached their monthly limit on your key · they're paused",
    );
    expect(row.textContent).toContain('They start again on Nov 20, or when you raise the limit.');
    expect(row.querySelector('[data-action="inbox.keyLimit"]')!.textContent).toBe('Raise limit');
    expect(notices.read).not.toHaveBeenCalled();
  });

  it('tells of a page an agent sent on its own, with Open page and Open run, closed once opened (AUTONOMOUS-GO-LIVE §6.4)', async () => {
    notices.close.mockClear();
    const wentLive = {
      id: '7d8f2c1a-1b2c-4d3e-8f90-123456789abc',
      kind: 'agent_went_live' as const,
      agent: 'Publisher',
      title: 'Pricing FAQ',
      target: 'webflow' as const,
      draftId: 'draft-1',
      chatId: 'chat-1',
      url: null,
      createdAt: '2026-11-02T08:00:00Z',
      read: false,
    };
    const off = {
      id: '8e9f3d2b-2c3d-4e5f-9a01-23456789abcd',
      kind: 'agent_go_live_off' as const,
      agent: 'Publisher',
      agentId: 'agent-1',
      createdAt: '2026-11-02T09:00:00Z',
      read: true,
    };
    await render(<ChatInbox suggestions={ok()} notices={{ ok: true, notices: [wentLive, off] }} />);
    const [sent, stopped] = noticeRows();
    expect(sent.getAttribute('data-kind')).toBe('agent_went_live');
    expect(sent.textContent).toContain('Publisher sent “Pricing FAQ” to Webflow as a draft');
    expect(sent.textContent).toContain('On its own, after Quality and your brand facts');
    const page = sent.querySelector<HTMLAnchorElement>('[data-action="inbox.openGoLivePage"]')!;
    expect(page.getAttribute('href')).toBe('/dashboard/content/editor/draft-1');
    expect(sent.querySelector('[data-action="inbox.openGoLiveRun"]')!.getAttribute('href')).toBe(
      '/dashboard/chat/chat-1',
    );
    expect(stopped.textContent).toContain('Publisher no longer publishes on its own');
    expect(stopped.textContent).toContain('It changed. Turn it on again if you still want it.');
    expect(
      stopped.querySelector('[data-action="inbox.openGoLiveAgent"]')!.getAttribute('href'),
    ).toBe('/dashboard/agents/agent-1');
    // Shown: the unread one marked read. Opened: closed.
    expect(notices.read).toHaveBeenCalledExactlyOnceWith([wentLive.id]);
    await act(async () => page.click());
    expect(notices.close).toHaveBeenCalledExactlyOnceWith(wentLive.id);
  });

  it('tells of a page an agent published live on its own, Open page opening the live page (PR 9)', async () => {
    const published = {
      id: '9f0a4e3c-3d4e-4f60-8b12-3456789abcde',
      kind: 'agent_went_live' as const,
      agent: 'Publisher',
      title: 'Pricing FAQ',
      target: 'wordpress' as const,
      draftId: 'draft-1',
      chatId: null,
      url: 'https://www.acme.example/pricing-faq/',
      createdAt: '2026-11-02T08:00:00Z',
      read: true,
    };
    await render(<ChatInbox suggestions={ok()} notices={{ ok: true, notices: [published] }} />);
    const [row] = noticeRows();
    expect(row.getAttribute('data-kind')).toBe('agent_published');
    expect(row.textContent).toContain('Publisher published “Pricing FAQ” on acme.example');
    expect(row.textContent).toContain('Live on acme.example · on its own');
    const page = row.querySelector<HTMLAnchorElement>('[data-action="inbox.openGoLivePage"]')!;
    expect(page.getAttribute('href')).toBe('https://www.acme.example/pricing-faq/');
    expect(page.getAttribute('target')).toBe('_blank');
    expect(row.querySelector('[data-action="inbox.openGoLiveRun"]')).toBeNull();
  });

  it('offers Take down on a page published on its own to an Admin or a Manager, then says it’s down (PR 10)', async () => {
    const published = {
      id: '9f0a4e3c-3d4e-4f60-8b12-3456789abcde',
      kind: 'agent_went_live' as const,
      agent: 'Publisher',
      title: 'Pricing FAQ',
      target: 'wordpress' as const,
      draftId: 'draft-1',
      chatId: null,
      url: 'https://www.acme.example/pricing-faq/',
      createdAt: new Date().toISOString(),
      read: true,
    };
    takeDown.mockResolvedValue({ ok: true, target: 'wordpress' });
    // An Analyst sees the notice, not Take down.
    await render(<ChatInbox suggestions={ok()} notices={{ ok: true, notices: [published] }} />);
    expect(host.querySelector('[data-action="inbox.takeDown"]')).toBeNull();

    await render(
      <RoleContext.Provider value={{ role: 'manager' }}>
        <ChatInbox suggestions={ok()} notices={{ ok: true, notices: [published] }} />
      </RoleContext.Provider>,
    );
    await click('[data-action="inbox.takeDown"]');
    const dialog = document.querySelector('[data-slot="take-down-dialog"]')!;
    expect(dialog.textContent).toContain('Take down “Pricing FAQ”?');
    expect(dialog.textContent).toContain(
      'It leaves acme.example now and goes back to a draft in WordPress.',
    );
    await act(async () =>
      (dialog.querySelector('[data-action="takeDown.confirm"]') as HTMLElement).click(),
    );
    expect(takeDown).toHaveBeenCalledWith('draft-1');
    expect(sonner.success).toHaveBeenCalledWith('Taken down. It’s a draft in WordPress again.');
    const [row] = noticeRows();
    expect(row.textContent).toContain('Taken down · a draft in WordPress again');
    expect(row.querySelector('[data-action="inbox.takeDown"]')).toBeNull();
    // The live address is gone: Open page opens the page in the Content Editor.
    expect(
      row.querySelector('[data-action="inbox.openGoLivePage"]')!.getAttribute('href'),
    ).toContain('/dashboard/content/editor/draft-1');
  });

  it('keeps the dialog open with the CMS’s words when it refuses, and Keep it live closes it', async () => {
    const published = {
      id: '9f0a4e3c-3d4e-4f60-8b12-3456789abcdf',
      kind: 'agent_went_live' as const,
      agent: 'Publisher',
      title: 'Pricing FAQ',
      target: 'webflow' as const,
      draftId: 'draft-1',
      chatId: null,
      url: 'https://acme.example/blog/pricing-faq',
      createdAt: new Date().toISOString(),
      read: true,
    };
    takeDown.mockResolvedValue({
      ok: false,
      reason: 'refused',
      message: 'Webflow didn’t take it down: Forbidden.',
    });
    await render(
      <RoleContext.Provider value={{ role: 'admin' }}>
        <ChatInbox suggestions={ok()} notices={{ ok: true, notices: [published] }} />
      </RoleContext.Provider>,
    );
    await click('[data-action="inbox.takeDown"]');
    const dialog = () => document.querySelector('[data-slot="take-down-dialog"]');
    await act(async () =>
      (dialog()!.querySelector('[data-action="takeDown.confirm"]') as HTMLElement).click(),
    );
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe(
      'Webflow didn’t take it down: Forbidden.',
    );
    await act(async () =>
      (dialog()!.querySelector('[data-action="takeDown.keep"]') as HTMLElement).click(),
    );
    expect(dialog()).toBeNull();
    expect(noticeRows()[0].querySelector('[data-action="inbox.takeDown"]')).not.toBeNull();
  });

  it('shows the notice in the Inbox without tabs too, and none that couldn’t be read', async () => {
    list.chats = [];
    await render(
      <ChatInboxView
        status="ready"
        items={[]}
        now={null}
        onRetry={() => {}}
        notices={withNotice().notices}
      />,
    );
    expect(noticeRows()).toHaveLength(1);
    expect(text()).not.toContain('Nothing needs you.');
    expect(text()).toContain('1 needs you.');

    await render(<ChatInbox suggestions={ok()} notices={{ ok: false }} />);
    expect(noticeRows()).toHaveLength(0);
  });

  it('says a scheduled job didn’t run, or paused, and why, with Open to its chat (W3-04a)', async () => {
    const job = {
      id: '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c10',
      kind: 'schedule_failed' as const,
      title: 'Weekly report',
      reason: 'Something went wrong.',
      href: '/dashboard/chat/0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c11' as const,
      createdAt: '2026-11-02T06:10:00Z',
      read: false,
    };
    await render(
      <ChatInbox
        suggestions={ok()}
        notices={{
          ok: true,
          notices: [
            job,
            {
              ...job,
              id: '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c12',
              kind: 'schedule_paused',
              reason: 'The monthly AI limit was reached.',
              href: '/dashboard/chat',
            },
          ],
        }}
      />,
    );
    const [failed, paused] = noticeRows();
    expect(failed.textContent).toContain('Weekly report didn’t run');
    expect(failed.textContent).toContain('Something went wrong.');
    expect(failed.querySelector('[data-action="inbox.openSchedule"]')!.getAttribute('href')).toBe(
      job.href,
    );
    expect(paused.textContent).toContain('Weekly report is paused');
    expect(paused.textContent).toContain('The monthly AI limit was reached.');
    expect(notices.read).toHaveBeenCalledExactlyOnceWith([
      job.id,
      '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c12',
    ]);
  });
});

describe('the daily suggestions', () => {
  it("lists the last 7 days' rows with their dot, line and day, under the line with Pause", async () => {
    await render(<ChatInbox suggestions={ok()} />);
    await openTab('suggestions');
    expect(text()).toContain(
      'Up to 7 a week, picked from what waits in your Action Center. This list shows the last 7 days and renews every 14 days. Pause daily suggestions',
    );
    const rows = [...host.querySelectorAll('[data-suggestion]')];
    expect(rows.map((row) => row.querySelector('[data-dot]')?.getAttribute('data-dot'))).toEqual([
      'new',
      'seen',
      'started',
    ]);
    expect(rows.map((row) => row.querySelector('[data-dot]')?.getAttribute('title'))).toEqual([
      'New',
      'Seen',
      'Started',
    ]);
    expect(rows.map((row) => row.querySelector('.block')?.textContent)).toEqual([
      'AC-2841 · High · Content Editor or Chat · about 20 min',
      'AC-2866 · Medium · Chat',
      'AC-2930 · High · started in Content Editor Oct 27',
    ]);
    expect(rows.map((row) => row.querySelector('.whitespace-nowrap')?.textContent)).toEqual([
      'Today · Oct 29',
      'Oct 28',
      'Oct 27',
    ]);
    expect(rows.map((row) => row.querySelector('button')?.textContent)).toEqual([
      'Open',
      'Open',
      'Open',
    ]);
  });

  it('says so when none came in the last 7 days', async () => {
    await render(<ChatInbox suggestions={ok({ suggestions: [] })} />);
    await openTab('suggestions');
    expect(text()).toContain('No daily suggestions in the last 7 days.');
  });

  it('marks the rows on screen seen, once, and not the ones seen before', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    expect(server.seen).toHaveBeenCalledTimes(1);
    expect(server.seen).toHaveBeenCalledWith(['s1']);
    await openTab('suggestions');
    await openTab('needsYou');
    await openTab('suggestions');
    expect(server.seen).toHaveBeenCalledTimes(1);
  });

  it('marks nothing seen while no suggestion is on screen', async () => {
    const onSeen = vi.fn();
    await render(
      <ChatInboxView
        status="ready"
        now={new Date(2026, 9, 29, 9, 30)}
        onRetry={() => undefined}
        items={list.chats}
        daily={{
          read: readOf(),
          brandOf: () => ({ name: null, known: true }),
          justStarted: false,
          busy: false,
          onOpen: vi.fn(),
          onSeen,
          onPause: vi.fn(),
          onResume: vi.fn(),
        }}
      />,
    );
    expect(onSeen).toHaveBeenCalledWith(['s1']);
    onSeen.mockClear();
    await openTab('runs');
    expect(onSeen).not.toHaveBeenCalled();
  });

  it('opens the suggestion’s page on its brand, which marks it opened (W2-26)', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    await openTab('suggestions');
    await click('[data-suggestion="s2"]');
    expect(store.setActiveBrand).toHaveBeenCalledWith('brand-b');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/inbox/s2');
    nav.push.mockClear();
    await click('[data-suggestion="s1"] button');
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/inbox/s1');
    // The page marks it opened, not the Inbox.
    expect(server.open).not.toHaveBeenCalled();
  });

  it('pauses them from the link', async () => {
    server.read.mockResolvedValue(ok({ state: 'off' }));
    await render(<ChatInbox suggestions={ok()} />);
    await openTab('suggestions');
    await click('[data-action="suggestions.pause"]');
    expect(server.set).toHaveBeenCalledWith(false);
    expect(server.read).toHaveBeenCalled();
    expect(text()).toContain(
      'Daily suggestions are pausedYou paused them. Your Action Center is unchanged.Turn back on',
    );
  });
});

describe('paused', () => {
  it('shows the banner, and Turn back on turns them on and reads again', async () => {
    await render(<ChatInbox suggestions={ok({ state: 'paused', suggestions: [] })} />);
    await openTab('suggestions');
    expect(text()).toContain(
      'Daily suggestions are pausedNone was opened or used in 30 days, so we stopped picking them. Your Action Center is unchanged.Turn back on',
    );
    expect(text()).toContain('Turned back on, the first suggestion arrives tomorrow morning.');
    expect(host.querySelector('[data-action="suggestions.pause"]')).toBeNull();
    await click('[data-action="suggestions.resume"]');
    expect(server.set).toHaveBeenCalledWith(true);
    expect(server.read).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-action="suggestions.resume"]')).toBeNull();
    expect(host.querySelector('[data-action="suggestions.pause"]')).not.toBeNull();
  });
});

describe('who gets them', () => {
  it("makes an Agency partner's feeds on their first Inbox, with the line saying so", async () => {
    server.read.mockResolvedValue(ok({ roleFeed: 'opt_in', state: 'on', suggestions: [] }));
    await render(
      <ChatInbox suggestions={ok({ roleFeed: 'opt_in', state: 'none', suggestions: [] })} />,
    );
    expect(server.start).toHaveBeenCalledTimes(1);
    expect(server.read).toHaveBeenCalledTimes(1);
    expect(text()).toContain(
      'Daily suggestions are on for you: one action a day from your Action Center, starting tomorrow morning.',
    );
  });

  it('makes none for an Admin, nor again for a partner who has them', async () => {
    await render(<ChatInbox key="admin" suggestions={ok({ state: 'none' })} />);
    await render(
      <ChatInbox key="partner" suggestions={ok({ roleFeed: 'opt_in', state: 'off' })} />,
    );
    expect(server.start).not.toHaveBeenCalled();
  });

  it('gives an Analyst no Daily suggestions tab', async () => {
    await render(
      <ChatInbox suggestions={ok({ roleFeed: 'never', state: 'none', suggestions: [] })} />,
    );
    expect(tabs()).toEqual(['All2', 'Needs you1', 'Runs1']);
    expect(text()).toContain('1 needs you · 1 running. Results from your agents land here.');
    expect(server.start).not.toHaveBeenCalled();
    expect(server.seen).not.toHaveBeenCalled();
  });
});

describe('a read-only workspace', () => {
  it('shows the list and writes nothing: Pause opens the plan dialog, a row still opens', async () => {
    plan.locked = true;
    await render(<ChatInbox suggestions={ok({ roleFeed: 'opt_in', state: 'on' })} />);
    await openTab('suggestions');
    expect(host.querySelectorAll('[data-suggestion]')).toHaveLength(3);
    expect(server.seen).not.toHaveBeenCalled();
    await click('[data-action="suggestions.pause"]');
    expect(server.set).not.toHaveBeenCalled();
    expect(plan.openUpgrade).toHaveBeenCalledWith('Pausing daily suggestions needs a plan');
    await click('[data-suggestion="s1"]');
    expect(server.open).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/inbox/s1');
  });

  it("doesn't make a partner's feeds", async () => {
    plan.locked = true;
    await render(
      <ChatInbox suggestions={ok({ roleFeed: 'opt_in', state: 'none', suggestions: [] })} />,
    );
    expect(server.start).not.toHaveBeenCalled();
  });
});

describe('with the new Chat off', () => {
  it('is the Inbox as it was: no tabs, no suggestions', async () => {
    list.chats = [];
    await render(<ChatInbox suggestions={{ ok: false, failure: 'chat_off' }} />);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(text()).toBe('InboxNothing needs you. Results from your agents land here.');
    expect(server.seen).not.toHaveBeenCalled();
    expect(server.start).not.toHaveBeenCalled();
  });
});

describe('the tabs, by keyboard and address', () => {
  const tabEl = (name: string) => host.querySelector(`[data-tab="${name}"]`) as HTMLElement;
  const key = async (name: string, k: string) =>
    act(async () => {
      tabEl(name).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    });

  it('keeps one tab stop, selected, tied to its panel', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    expect(tabEl('all').getAttribute('aria-selected')).toBe('true');
    expect(tabEl('suggestions').getAttribute('aria-selected')).toBe('false');
    expect(
      [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('tabindex')),
    ).toEqual(['0', '-1', '-1', '-1']);
    const panel = host.querySelector('[role="tabpanel"]')!;
    expect(tabEl('all').getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabEl('all').id);
  });

  it('moves between the tabs with the arrow keys, Home and End', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    await key('all', 'ArrowRight');
    expect(tabEl('suggestions').getAttribute('aria-selected')).toBe('true');
    expect(tabEl('suggestions').getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(tabEl('suggestions'));
    await key('suggestions', 'End');
    expect(tabEl('runs').getAttribute('aria-selected')).toBe('true');
    await key('runs', 'ArrowRight');
    expect(tabEl('all').getAttribute('aria-selected')).toBe('true');
    await key('all', 'ArrowLeft');
    expect(tabEl('runs').getAttribute('aria-selected')).toBe('true');
    await key('runs', 'Home');
    expect(tabEl('all').getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe(
      tabEl('all').id,
    );
  });

  it('keeps the open tab in the address, and opens on the one it names', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    await openTab('suggestions');
    expect(window.location.search).toBe('?tab=suggestions');
    await openTab('all');
    expect(window.location.search).toBe('');
    act(() => root.unmount());
    root = createRoot(host);
    nav.search = 'tab=suggestions';
    await render(<ChatInbox suggestions={ok()} />);
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('Daily suggestions3');
  });

  it('follows the address when it names another tab from outside', async () => {
    nav.search = 'tab=runs';
    await render(<ChatInbox suggestions={ok()} />);
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('Runs1');
    nav.search = '';
    await render(<ChatInbox suggestions={ok()} />);
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('All5');
  });

  it('opens on All when the address names a tab the person has not', async () => {
    nav.search = 'tab=suggestions';
    await render(
      <ChatInbox suggestions={ok({ roleFeed: 'never', state: 'none', suggestions: [] })} />,
    );
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('All2');
  });
});

describe('a row', () => {
  it('keeps an action done or dismissed since, faded, with its status and no filled Open', async () => {
    await render(
      <ChatInbox
        suggestions={ok({
          suggestions: [
            suggestion('s1', { closed: 'completed' }),
            suggestion('s2', { closed: 'dismissed', seenAt: '2026-10-29T08:00:00Z' }),
          ],
        })}
      />,
    );
    await openTab('suggestions');
    const rows = [...host.querySelectorAll('[data-suggestion]')];
    expect(rows.map((row) => row.getAttribute('data-closed'))).toEqual(['completed', 'dismissed']);
    expect(rows.every((row) => row.className.includes('opacity-60'))).toBe(true);
    expect(rows.map((row) => row.querySelector('.block')?.textContent)).toEqual([
      'AC-2841 · High · Done',
      'AC-2841 · High · Dismissed',
    ]);
    expect(text()).not.toContain('Content Editor or Chat');
    const open = rows[0].querySelector('button')!;
    expect(open.className).toContain('bg-background');
    expect(open.className).not.toContain('bg-primary');
    await click('[data-suggestion="s1"]');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/inbox/s1');
  });

  it('names its brand when the person has more than one', async () => {
    await render(<ChatInbox suggestions={ok({ suggestions: [suggestion('s1')] })} />);
    await openTab('suggestions');
    expect(host.querySelector('[data-suggestion] .block')?.textContent).toBe(
      'AC-2841 · High · Content Editor or Chat · about 20 min',
    );
    act(() => root.unmount());
    root = createRoot(host);
    store.brands = [...BRANDS, { id: 'brand-c', name: 'Ridgeline' }];
    await render(<ChatInbox suggestions={ok({ suggestions: [suggestion('s1')] })} />);
    await openTab('suggestions');
    expect(host.querySelector('[data-suggestion] .block')?.textContent).toBe(
      'Trailpeak · AC-2841 · High · Content Editor or Chat · about 20 min',
    );
  });

  it("doesn't open on a brand the person's list lacks", async () => {
    await render(
      <ChatInbox suggestions={ok({ suggestions: [suggestion('s1', { brandId: 'brand-x' })] })} />,
    );
    await openTab('suggestions');
    const row = host.querySelector('[data-suggestion="s1"]') as HTMLElement;
    expect(row.getAttribute('role')).toBeNull();
    expect(row.getAttribute('tabindex')).toBeNull();
    const button = row.querySelector('button')!;
    expect(button.disabled).toBe(true);
    expect(row.title).toBe("This brand isn't in your brand list.");
    await act(async () => row.click());
    expect(server.open).not.toHaveBeenCalled();
    expect(store.setActiveBrand).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('has a title when its action has no kind', async () => {
    await render(
      <ChatInbox
        suggestions={ok({
          suggestions: [
            suggestion('s1', {
              summary: { actionNo: 12, kind: '', payload: {}, priorityLevel: null, startNow: null },
            }),
          ],
        })}
      />,
    );
    await openTab('suggestions');
    expect(rowTitles()).toEqual(['An action from your Action Center']);
  });

  it('says Today by the day the read dated, not the browser clock', async () => {
    await render(<ChatInbox suggestions={ok({ today: '2026-10-28' })} />);
    await openTab('suggestions');
    expect(
      [...host.querySelectorAll('[data-suggestion]')].map(
        (row) => row.querySelector('.whitespace-nowrap')?.textContent,
      ),
    ).toEqual(['Oct 29', 'Today · Oct 28', 'Oct 27']);
  });
});

describe('more than the read lists', () => {
  it('counts them all, and says how many the list shows', async () => {
    await render(<ChatInbox suggestions={ok({ total: 140 })} />);
    expect(tabs()).toEqual(['All142', 'Daily suggestions140', 'Needs you1', 'Runs1']);
    expect(text()).toContain('140 suggestions this week');
    expect(text()).toContain('Showing the newest 3 of 140.');
    await openTab('suggestions');
    expect(text()).toContain('Showing the newest 3 of 140.');
  });

  it('says nothing of it when it lists them all', async () => {
    await render(<ChatInbox suggestions={ok()} />);
    expect(text()).not.toContain('Showing the newest');
  });
});

describe('Pause and Turn back on, failing', () => {
  it('says so in a toast, when the server answers a failure or the call throws', async () => {
    server.set.mockResolvedValueOnce({ ok: false, failure: 'failed' } as never);
    await render(<ChatInbox suggestions={ok()} />);
    await openTab('suggestions');
    await click('[data-action="suggestions.pause"]');
    expect(sonner.error).toHaveBeenCalledWith("Couldn't change your daily suggestions. Try again.");
    expect(server.read).not.toHaveBeenCalled();
    server.set.mockRejectedValueOnce(new Error('offline'));
    await click('[data-action="suggestions.pause"]');
    expect(sonner.error).toHaveBeenCalledTimes(2);
    expect(
      (host.querySelector('[data-action="suggestions.pause"]') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('opens the plan dialog when the workspace turned read-only meanwhile', async () => {
    server.set.mockResolvedValueOnce({ ok: false, failure: 'read_only' } as never);
    await render(<ChatInbox suggestions={ok({ state: 'paused', suggestions: [] })} />);
    await openTab('suggestions');
    await click('[data-action="suggestions.resume"]');
    expect(plan.openUpgrade).toHaveBeenCalledWith('Turning daily suggestions back on needs a plan');
    expect(sonner.error).not.toHaveBeenCalled();
  });
});

describe("an Agency partner's first Inbox, with nothing made", () => {
  it('says nothing when no feed was made', async () => {
    server.start.mockResolvedValueOnce({ ok: true, made: 0 });
    await render(
      <ChatInbox suggestions={ok({ roleFeed: 'opt_in', state: 'none', suggestions: [] })} />,
    );
    expect(server.start).toHaveBeenCalledTimes(1);
    expect(server.read).not.toHaveBeenCalled();
    expect(text()).not.toContain('Daily suggestions are on for you');
  });
});
