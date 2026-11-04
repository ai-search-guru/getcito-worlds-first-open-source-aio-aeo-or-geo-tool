import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { SuggestionDetail } from '@/lib/actions/chatSuggestions';
import type { ChatComposerSetup } from '@/lib/chat/composerSetup';

/**
 * A daily suggestion's page (CHAT-26 §2.3, mockup #d-detail): the action's
 * title as the question with its source, "Picked for you today · no AI
 * cost" and what was read, why this, why now and what it takes, the action
 * from the Action Center with Content Editor (only with writing to do) and
 * Do it with Chat, and the next moves. Opening it is a use; starting it in
 * Chat (the button or the composer) or the Content Editor marks it started
 * and opens the work; Not now and Remove go back to the Inbox. A closed
 * action starts nothing; a read-only workspace writes nothing.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
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
  useUpgradeGate: () => ({
    isLocked: plan.locked,
    openUpgrade: plan.openUpgrade,
    guard:
      <Args extends unknown[]>(fn: (...args: Args) => unknown, options: { action?: string } = {}) =>
      (...args: Args) =>
        plan.locked ? plan.openUpgrade(options.action) : fn(...args),
  }),
}));
const sonner = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), sonner) }));
const store = vi.hoisted(() => ({ setActiveBrand: vi.fn(), activeBrandId: 'brand-a' }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (pick: (s: unknown) => unknown) =>
    pick({
      brands: [
        { id: 'brand-a', name: 'Demo', isDemo: true },
        { id: 'brand-b', name: 'Trailpeak' },
      ],
      activeBrandId: store.activeBrandId,
      setActiveBrand: store.setActiveBrand,
    }),
}));
const server = vi.hoisted(() => ({
  open: vi.fn(async () => ({ ok: true })),
  snooze: vi.fn(async () => ({ ok: true }) as { ok: boolean; failure?: string }),
  remove: vi.fn(async () => ({ ok: true }) as { ok: boolean; failure?: string }),
  started: vi.fn(async () => ({ ok: true })),
  signals: vi.fn(async () => []),
  draft: vi.fn(
    async () =>
      ({ draftId: 'draft-1', created: true, importFailed: false }) as Record<string, unknown>,
  ),
}));
vi.mock('@/lib/actions/chatSuggestions', () => ({
  openDailySuggestion: server.open,
  snoozeDailySuggestion: server.snooze,
  removeDailySuggestion: server.remove,
  startedDailySuggestion: server.started,
}));
vi.mock('@/lib/actions/actionCenter', () => ({ getActionSignals: server.signals }));
vi.mock('@/lib/actions/contentDrafts', () => ({ startDraftFromAction: server.draft }));
// The drawer's story: the Why its signals tell, once they're read.
const story = vi.hoisted(() => ({
  why: 'Five of your pages come up in 14 prompts.' as string | null,
}));
vi.mock('@/components/action-center/useActionStory', () => ({
  useActionStory: (_brand: string, _action: unknown, signals: unknown[] | null) => ({
    affected: null,
    volumes: null,
    story: signals && story.why ? { family: 'gap', why: story.why, goal: '' } : null,
    ready: signals !== null,
  }),
}));
const crumb = vi.hoisted(() => ({ tail: null as string | null }));
vi.mock('./ChatCrumb', () => ({ useChatCrumb: (tail: string | null) => (crumb.tail = tail) }));
vi.mock('./ChatInbox', () => ({ useNow: () => new Date('2026-10-29T09:30:00Z') }));
// The thread under the page: what it was handed, and the page as its empty state.
const thread = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('./ChatThreadView', () => ({
  ChatThreadView: (props: Record<string, unknown>) => {
    thread.props = props;
    return <div data-slot="thread">{props.empty as ReactNode}</div>;
  },
}));

const { ChatSuggestion, SuggestionDetailView, SuggestionUnavailable } =
  await import('./SuggestionDetail');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const PAGES = ['https://trailpeak.example/ridge-45l', 'https://trailpeak.example/crest-30l'];
const detailOf = (more: Partial<SuggestionDetail> = {}): SuggestionDetail => ({
  suggestion: {
    id: 'sugg-1',
    brandId: 'brand-b',
    actionId: 'action-1',
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
      payload: {},
      priorityLevel: 'high',
      startNow: { method: 'optimize', pages: 5, minutes: 20 },
    },
  },
  action: {
    id: 'action-1',
    actionNo: 2841,
    category: 'growth',
    kind: 'content_opportunity',
    impact: 'high',
    status: 'new',
    payload: {
      title: 'Optimize 5 hiking backpack pages AI asks about',
      pages: PAGES,
      promptIds: ['p1', 'p2', 'p3'],
    },
    kpiKeys: [],
    assignee: null,
    dueDate: null,
    createdAt: '2026-10-23T08:00:00Z',
    updatedAt: '2026-10-28T08:00:00Z',
    taskTotal: 4,
    taskCompleted: 0,
    signalCount: 0,
    priorityScore: 81,
    priorityLevel: 'high',
    priorityReason: null,
  },
  pick: { score: 81, waitingDays: 6 },
  start: { taskId: 'task-2', method: 'optimize', page: PAGES[0] },
  auditedAt: '2026-10-28T10:00:00Z',
  today: '2026-10-29',
  ...more,
});
const setup: ChatComposerSetup = {
  defaultMode: 'auto',
  fullAutoOpen: false,
  fullAutoOffByAdmin: false,
  usageNoticeSeen: null,
  onOwnKey: false,
  keyFailure: null,
  skills: [],
};
const moves = () => ({
  busy: false,
  onEditor: vi.fn(),
  onChat: vi.fn(),
  onFirstPage: vi.fn(),
  onSnooze: vi.fn(),
  onRemove: vi.fn(),
});

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  nav.push.mockClear();
  plan.locked = false;
  plan.openUpgrade.mockClear();
  for (const fn of Object.values(sonner)) fn.mockClear();
  for (const fn of Object.values(server)) fn.mockClear();
  store.setActiveBrand.mockClear();
  store.activeBrandId = 'brand-a';
  story.why = 'Five of your pages come up in 14 prompts.';
  crumb.tail = null;
  thread.props = {};
  fetchMock
    .mockReset()
    .mockResolvedValue(
      new Response(null, { status: 200, headers: { 'x-chat-conversation': 'chat-1' } }),
    );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const text = () => host.textContent ?? '';
const $ = (selector: string) => host.querySelector(selector) as HTMLElement | null;
const click = async (selector: string) => act(async () => $(selector)!.click());
const tools = () => [...host.querySelectorAll('[data-tool]')].map((tool) => tool.textContent);

describe('SuggestionDetailView', () => {
  it('reads as the mockup: the question, what was read, why, the action and the next moves', async () => {
    await render(
      <SuggestionDetailView
        detail={detailOf()}
        now={new Date('2026-10-29T09:30:00Z')}
        why="Five of your pages come up in 14 prompts."
        modeLabel="Auto, ask before changes"
        moves={moves()}
      />,
    );
    expect($('h1')?.textContent).toBe('Optimize 5 hiking backpack pages AI asks about');
    expect(text()).toContain('fromDaily suggestion · Oct 29 · Action Center AC-2841');
    expect(text()).toContain('Picked for you today · no AI cost');
    expect(tools()).toEqual([
      'Read AC-2841 · 2 pages, 3 prompts',
      'Ranked your open actions · priority 81, waiting 6 days',
      'Checked the pages · Site Audit, Oct 28',
    ]);
    expect($('[data-slot="lead"]')?.textContent).toBe(
      'Five of your pages come up in 14 prompts. With the agent, it takes about 20 minutes.',
    );
    expect(text()).toContain('From your Action Center');
    expect(text()).toContain('Waiting 6 days');
    expect(text()).toContain('AC-2841 Optimize 5 hiking backpack pages AI asks about');
    expect(text()).toContain('4 tasks · Unassigned · opened Oct 23');
    const open = $('[data-action="suggestion.openAction"]')!;
    expect(open.getAttribute('href')).toBe('/dashboard/action-center/actions?action=action-1');
    expect(open.getAttribute('aria-label')).toBe('Open AC-2841 in Action Center');
    expect(text()).toContain('/ridge-45l · /crest-30l');
    expect(text()).toContain('No extra cost to pick');
    expect(text()).toContain('Mode: Auto, ask before changes');
    expect($('[data-action="suggestion.openEditor"]')?.textContent).toBe('Content Editor');
    expect($('[data-action="suggestion.startChat"]')?.textContent).toBe('Do it with Chat');
    expect(
      [...host.querySelectorAll('[data-slot="next-moves"] button')].map((b) => b.textContent),
    ).toEqual([
      'Start with /ridge-45lThe first of its 2 pages',
      "Not nowBack in a week if it's still open",
      'Remove this suggestionThe action stays in Action Center',
    ]);
  });

  it('says the day it was picked, the priority’s reason, and leaves out what it hasn’t', async () => {
    const detail = detailOf({ start: null, auditedAt: null, today: '2026-10-30' });
    detail.action.priorityReason = {
      change: null,
      subject: { entity: null, count: null },
      demand: null,
      realDemand: null,
      commercial: false,
      heldBefore: false,
      days: null,
      sources: 1,
    };
    detail.action.payload = { title: 'Add an llms.txt' };
    detail.suggestion.summary.startNow = null;
    await render(
      <SuggestionDetailView
        detail={detail}
        now={null}
        why="Why this."
        modeLabel="Ask me first"
        moves={moves()}
      />,
    );
    expect(text()).toContain('Picked for you Oct 29 · no AI cost');
    expect(tools()).toEqual([
      'Read AC-2841',
      'Ranked your open actions · priority 81, waiting 6 days',
    ]);
    expect($('[data-slot="lead"]')?.textContent).toMatch(/^Why this\. Why now: .+\.$/);
    // The reason is a sentence already: one full stop, not two.
    expect($('[data-slot="lead"]')?.textContent).not.toContain('..');
    expect($('[data-action="suggestion.openEditor"]')).toBeNull();
    expect($('[data-action="nextMove.open"]')).toBeNull();
    expect(text()).not.toContain('/ridge-45l');
  });

  it('holds the lead while the action’s signals are read', async () => {
    await render(
      <SuggestionDetailView
        detail={detailOf()}
        now={null}
        why={null}
        modeLabel="Auto"
        moves={moves()}
      />,
    );
    expect($('[data-slot="lead"]')).toBeNull();
    expect($('[data-slot="lead-loading"]')).not.toBeNull();
  });

  it('says an action done since is done, and starts nothing but Remove', async () => {
    const detail = detailOf();
    detail.suggestion.closed = 'completed';
    await render(
      <SuggestionDetailView
        detail={detail}
        now={null}
        why="Why."
        modeLabel="Auto"
        moves={moves()}
      />,
    );
    expect($('[data-slot="closed"]')?.textContent).toBe('Done');
    expect(text()).not.toContain('Waiting 6 days');
    expect(text()).not.toContain('it takes about');
    expect($('[data-action="suggestion.startChat"]')).toBeNull();
    expect($('[data-action="suggestion.openEditor"]')).toBeNull();
    expect($('[data-action="suggestion.snooze"]')).toBeNull();
    expect($('[data-action="suggestion.dismiss"]')).not.toBeNull();
  });

  it('names a few pages, then how many more', async () => {
    const detail = detailOf();
    detail.action.payload = {
      ...detail.action.payload,
      pages: Array.from({ length: 7 }, (_, i) => `https://trailpeak.example/p${i}`),
    };
    await render(
      <SuggestionDetailView
        detail={detail}
        now={null}
        why="Why."
        modeLabel="Auto"
        moves={moves()}
      />,
    );
    expect(text()).toContain('/p0 · /p1 · /p2 · /p3 · /p4 · +2 more');
  });
});

describe('ChatSuggestion', () => {
  it('opens it on its brand, names it in the breadcrumb and scopes the composer to its action', async () => {
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    expect(server.open).toHaveBeenCalledWith('sugg-1');
    expect(store.setActiveBrand).toHaveBeenCalledWith('brand-b');
    expect(crumb.tail).toBe('Daily suggestion · Oct 29');
    expect(server.signals).toHaveBeenCalledWith('brand-b', 'action-1');
    expect($('[data-slot="lead"]')?.textContent).toContain('Five of your pages');
    expect(text()).toContain('Mode: Auto, ask before changes');
    expect(thread.props).toMatchObject({
      thread: null,
      variant: 'dock',
      defaultMode: 'auto',
      pageRoute: '/dashboard/chat/inbox/sugg-1',
      chips: [
        { key: 'page', label: 'Daily suggestion' },
        { key: 'brand', label: 'Trailpeak', value: 'brand-b' },
        {
          key: 'action',
          label: 'AC-2841 · Optimize 5 hiking backpack pages AI asks about',
          value: 'action-1',
        },
      ],
    });
  });

  it('tells its Why from the action’s description when no signal tells it', async () => {
    story.why = null;
    server.signals.mockRejectedValueOnce(new Error('offline'));
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    expect($('[data-slot="lead"]')).not.toBeNull();
    expect($('[data-slot="lead"]')?.textContent).not.toContain('Five of your pages');
  });

  it('puts the first page in the box, sending nothing', async () => {
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    await click('[data-action="nextMove.open"]');
    expect(thread.props.draft).toMatchObject({ text: 'Start with /ridge-45l.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does it with Chat: a chat on the action, marked started in Chat, then opened', async () => {
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    await click('[data-action="suggestion.startChat"]');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat/runs');
    expect(JSON.parse(init.body as string)).toMatchObject({
      message:
        "Let's do AC-2841 from my Action Center: Optimize 5 hiking backpack pages AI asks about",
      mode: 'auto',
      brandId: 'brand-b',
      context: {
        route: '/dashboard/chat/inbox/sugg-1',
        chips: [{ key: 'page' }, { key: 'brand' }, { key: 'action', value: 'action-1' }],
      },
    });
    expect(server.started).toHaveBeenCalledWith('sugg-1', 'chat');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/chat-1');
  });

  it('says why a chat didn’t start, the plan dialog for a read-only workspace', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 'subscription_inactive' }, { status: 402 }),
    );
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    await click('[data-action="suggestion.startChat"]');
    expect(plan.openUpgrade).toHaveBeenCalledWith('Starting a chat needs a plan');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await click('[data-action="suggestion.startChat"]');
    expect(sonner.error).toHaveBeenCalledWith("Couldn't start the chat. Try again.");
    expect(server.started).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('marks it started in Chat once a message from its page starts a chat', async () => {
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    await act(async () => (thread.props.onConversation as (id: string) => void)('chat-2'));
    expect(server.started).toHaveBeenCalledWith('sugg-1', 'chat');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/chat-2');
  });

  it('opens the action’s draft in the Content Editor, marked started there', async () => {
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    await click('[data-action="suggestion.openEditor"]');
    expect(server.draft).toHaveBeenCalledWith('brand-b', 'action-1', 'task-2', {
      page: PAGES[0],
      title: 'Optimize 5 hiking backpack pages AI asks about',
    });
    expect(server.started).toHaveBeenCalledWith('sugg-1', 'editor');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/content/editor/draft-1');
    act(() => root.unmount());
    root = createRoot(host);
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    server.draft.mockResolvedValueOnce({ error: 'failed' });
    nav.push.mockClear();
    await click('[data-action="suggestion.openEditor"]');
    expect(sonner.error).toHaveBeenCalledWith("Couldn't open the Content Editor. Try again.");
    expect(nav.push).not.toHaveBeenCalled();
    // A failed move frees the buttons again.
    expect(($('[data-action="suggestion.openEditor"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('puts it off a week or removes it, then goes back to the Inbox', async () => {
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    await click('[data-action="suggestion.snooze"]');
    expect(server.snooze).toHaveBeenCalledWith('sugg-1');
    expect(sonner.success).toHaveBeenCalledWith("Not now: back in a week, if it's still open.");
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/inbox?tab=suggestions');
    // Done, it stays busy while the Inbox opens: no other move meanwhile.
    expect(($('[data-action="suggestion.dismiss"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => root.unmount());
    root = createRoot(host);
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    await click('[data-action="suggestion.dismiss"]');
    expect(server.remove).toHaveBeenCalledWith('sugg-1');
    act(() => root.unmount());
    root = createRoot(host);
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    expect(sonner.success).toHaveBeenLastCalledWith(
      'Removed from your Inbox. The action stays in Action Center.',
    );
    server.remove.mockResolvedValueOnce({ ok: false, failure: 'failed' });
    nav.push.mockClear();
    await click('[data-action="suggestion.dismiss"]');
    expect(sonner.error).toHaveBeenCalledWith("Couldn't change this suggestion. Try again.");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('makes one move of a double click, before the buttons show busy', async () => {
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    await act(async () => {
      $('[data-action="suggestion.dismiss"]')!.click();
      $('[data-action="suggestion.dismiss"]')!.click();
      $('[data-action="suggestion.snooze"]')!.click();
      $('[data-action="suggestion.startChat"]')!.click();
      $('[data-action="suggestion.openEditor"]')!.click();
    });
    expect(server.remove).toHaveBeenCalledTimes(1);
    expect(server.snooze).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(server.draft).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it('writes nothing in a read-only workspace: each move opens the plan dialog', async () => {
    plan.locked = true;
    await render(<ChatSuggestion detail={detailOf()} setup={setup} />);
    expect(server.open).not.toHaveBeenCalled();
    await click('[data-action="suggestion.startChat"]');
    await click('[data-action="suggestion.openEditor"]');
    await click('[data-action="suggestion.snooze"]');
    await click('[data-action="suggestion.dismiss"]');
    expect(plan.openUpgrade.mock.calls.map(([label]) => label)).toEqual([
      'Starting a chat needs a plan',
      'Optimizing content needs a plan',
      'Putting a suggestion off needs a plan',
      'Removing a suggestion needs a plan',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(server.draft).not.toHaveBeenCalled();
    expect(server.snooze).not.toHaveBeenCalled();
    expect(server.remove).not.toHaveBeenCalled();
  });
});

describe('SuggestionUnavailable', () => {
  it('says so, with the way back to the Inbox', async () => {
    await render(<SuggestionUnavailable />);
    expect(text()).toContain("This suggestion isn't available.");
    expect($('[data-action="nav.inbox"]')?.getAttribute('href')).toBe(
      '/dashboard/chat/inbox?tab=suggestions',
    );
  });
});
