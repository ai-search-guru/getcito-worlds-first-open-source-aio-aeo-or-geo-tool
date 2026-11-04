import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import { ChatAgenticProvider } from '@/components/context/ChatAgenticProvider';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { ChatPanelContext, type ChatPanelState } from '@/components/chat/panel/chatPanelContext';
import type { CompatibleAgents } from '@/lib/chat/agentAction';

/**
 * Run agent on an Action Center action (CHAT-21 §F; W2-17): the button on
 * the row and in the drawer, only for Admins and Managers while the new
 * Chat is on and the action is open; its picker (agents, Run with Chat,
 * Create an agent for this kind of action), loaded when it opens; a pick
 * starts the run and opens its chat in the side panel; a read-only
 * workspace gets the upgrade dialog.
 */

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push }),
  usePathname: () => '/dashboard/action-center/actions',
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/actions/chatAccessRequests', () => ({
  requestAccess: vi.fn(async () => ({ ok: true, id: 'request-1' })),
}));

const { RunAgentButton } = await import('./RunAgentButton');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ACTION = {
  id: 'acacacac-0000-4000-8000-000000000001',
  actionNo: 1258,
  status: 'new' as const,
};
const PICKER: CompatibleAgents = {
  action: { no: 1258, category: 'recover' },
  agents: [
    {
      id: 'agent-1',
      name: 'Citation win-back',
      status: 'active',
      skills: ['winback', 'faq'],
      mode: 'auto',
      usedOnCategoryAt: '2026-10-20T10:00:00.000Z',
    },
    {
      id: 'agent-2',
      name: 'Weekly report',
      status: 'paused',
      skills: ['report'],
      mode: 'ask_first',
      usedOnCategoryAt: null,
    },
  ],
  createSkill: 'winback',
};

let container: HTMLDivElement;
let root: Root;
let answer: (url: string, init?: RequestInit) => Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));
const openChat = vi.fn();
const openUpgrade = vi.fn();
const onRow = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function render({
  role = 'manager',
  chatOn = true,
  status = ACTION.status as string,
  locked = false,
  panel = true,
  variant = 'row' as 'row' | 'drawer',
}: {
  role?: TeamRole;
  chatOn?: boolean;
  status?: string;
  locked?: boolean;
  panel?: boolean;
  variant?: 'row' | 'drawer';
} = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <ChatAgenticProvider enabled={chatOn}>
            <UpgradeDialogContext.Provider
              value={{ isLocked: locked, reason: 'ended', adminName: null, openUpgrade }}
            >
              <ChatPanelContext.Provider
                value={{ available: panel, openChat } as unknown as ChatPanelState}
              >
                {/* The row opens the action on a click. */}
                <div onClick={onRow}>
                  <RunAgentButton
                    action={{ ...ACTION, status: status as typeof ACTION.status }}
                    title="Win back citations for /blog/what-is-aeo"
                    variant={variant}
                  />
                </div>
              </ChatPanelContext.Provider>
            </UpgradeDialogContext.Provider>
          </ChatAgenticProvider>
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const trigger = () =>
  container.querySelector<HTMLButtonElement>('[data-action="actionCenter.runAgent"]');
const item = (name: string) => document.querySelector<HTMLElement>(`[data-action="${name}"]`);
async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}
/** Opens the picker: its code loads, then it reads the agents. */
async function openPicker() {
  await click(trigger()!);
  for (let i = 0; i < 100 && document.querySelector('[role="status"]'); i++) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  answer = (url) => {
    if (url.startsWith('/api/chat/agents/compatible')) return json({ ok: true, ...PICKER });
    if (url.startsWith('/api/chat/agents/agent-1/run')) {
      return json(
        {
          ok: true,
          runs: [{ brand: 'Brand A', status: 'running', repeated: false, coalesced: false }],
          chatId: 'chat-1',
        },
        202,
      );
    }
    if (url.startsWith('/api/chat/agents/agent-2/run')) {
      return json(
        {
          ok: true,
          runs: [{ brand: 'Brand A', status: 'queued', repeated: false, coalesced: false }],
          chatId: null,
        },
        202,
      );
    }
    if (url.endsWith('/chat')) return json({ ok: true, chatId: 'chat-2', queued: false }, 202);
    return json({ ok: false }, 404);
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('who sees Run agent', () => {
  it('shows it to Admins and Managers on an open action while Chat is on', async () => {
    await render({ role: 'admin' });
    expect(trigger()?.getAttribute('aria-label')).toBe(
      // Starts with what the drawer's button says (WCAG 2.5.3).
      'Run agent · Win back citations for /blog/what-is-aeo',
    );
    await render({ role: 'manager', variant: 'drawer' });
    expect(trigger()?.textContent).toBe('Run agent');
    // The drawer's top row makes room for it; the size of Copy Data and Export beside it.
    expect(trigger()?.hasAttribute('data-run-agent')).toBe(true);
    expect(trigger()?.className).toContain('h-7');
  });

  it('hides it from Analysts and Agency partners, with Chat off, and on a closed action', async () => {
    for (const role of ['analyst', 'agency_partner'] as TeamRole[]) {
      await render({ role });
      expect(trigger()).toBeNull();
    }
    await render({ chatOn: false });
    expect(trigger()).toBeNull();
    for (const status of ['completed', 'dismissed']) {
      await render({ status });
      expect(trigger()).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the picker', () => {
  it('lists the agents for the action, Run with Chat and Create an agent, without opening the row', async () => {
    await render();
    await openPicker();
    expect(onRow).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/chat/agents/compatible?actionId=${ACTION.id}`,
      expect.anything(),
    );
    const agents = [...document.querySelectorAll('[data-action="runAgent.pickAgent"]')];
    expect(agents.map((a) => a.textContent)).toEqual([
      'Citation win-back/winback · Auto, ask before changes · Used on Recover actions',
      'Weekly reportPaused/report · Ask me first',
    ]);
    expect(item('runAgent.runWithChat')?.textContent).toContain('Run with Chat');
    expect(item('runAgent.createAgent')?.getAttribute('href')).toBe(
      '/dashboard/agents/new?skill=winback',
    );
  });

  it('starts the picked agent on the action and opens its chat in the side panel', async () => {
    await render();
    await openPicker();
    await click(item('runAgent.pickAgent')!);
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/chat/agents/agent-1/run');
    expect(JSON.parse(init!.body as string)).toEqual({ actionId: ACTION.id });
    expect(openChat).toHaveBeenCalledWith('chat-1');
    expect(toast).toHaveBeenCalledWith('Citation win-back is working on AC-1258');
    expect(onRow).not.toHaveBeenCalled();
  });

  it('says a run waits for a slot, and opens the chat page where the panel isn’t', async () => {
    await render();
    await openPicker();
    await click(document.querySelectorAll<HTMLElement>('[data-action="runAgent.pickAgent"]')[1]);
    expect(toast).toHaveBeenCalledWith(
      'Weekly report is queued for AC-1258. It starts when a run slot frees up.',
    );
    expect(openChat).not.toHaveBeenCalled();

    await render({ panel: false });
    await openPicker();
    await click(item('runAgent.runWithChat')!);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/chat/actions/${ACTION.id}/chat`);
    expect(push).toHaveBeenCalledWith(
      `/dashboard/chat/chat-2?from=${encodeURIComponent('/dashboard/action-center/actions')}`,
    );
    expect(toast).toHaveBeenCalledWith('Chat is working on AC-1258');
  });

  it('shows the out-of-permission answer when the server refuses', async () => {
    answer = () =>
      json(
        {
          ok: false,
          failure: 'failed',
          code: 'forbidden_role',
          error: 'Your role is Manager.',
          denial: {
            asked: 'You asked: Run an agent now.',
            rule: { kind: 'role', detail: 'Your role is Manager.', source: 'Roles & access' },
            whoCan: 'Admins can do this.',
            nextActions: ['ask_admin'],
          },
        },
        403,
      );
    await render();
    await openPicker();
    expect(document.querySelector('[data-slot="agent-denial"]')?.textContent).toContain(
      'Run an agent now',
    );
  });

  it('moves between its choices with ↑ ↓ and closes with Esc', async () => {
    await render();
    await openPicker();
    const items = [...document.querySelectorAll<HTMLElement>('[data-run-agent-item]')];
    expect(items.map((el) => el.dataset.action)).toEqual([
      'runAgent.pickAgent',
      'runAgent.pickAgent',
      'runAgent.runWithChat',
      'runAgent.createAgent',
    ]);
    const popup = document.querySelector<HTMLElement>('[data-slot="popover-content"]')!;
    const press = (key: string) =>
      act(() => {
        (document.activeElement ?? popup).dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );
      });
    items[0].focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    press('ArrowUp');
    press('ArrowUp');
    // From the first, up wraps to the last.
    expect(document.activeElement).toBe(items[3]);
    press('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    press('Escape');
    await settle();
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the upgrade dialog when the workspace went read-only since the page loaded', async () => {
    answer = () =>
      json({ ok: false, failure: 'subscription', error: 'Your plan is not active.' }, 402);
    await render();
    await click(trigger()!);
    for (let i = 0; i < 100 && !openUpgrade.mock.calls.length; i++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    expect(openUpgrade).toHaveBeenCalledWith('Running an agent on an action needs a plan');
    expect(document.querySelector('[data-action="runAgent.pickAgent"]')).toBeNull();
  });

  it('says a run didn’t start, and why, instead of "queued"', async () => {
    const base = answer;
    answer = (url, init) =>
      url.startsWith('/api/chat/agents/agent-1/run')
        ? json(
            {
              ok: true,
              runs: [{ brand: 'Brand A', status: 'stopped', repeated: false, coalesced: false }],
              chatId: null,
              stopReason: 'action_closed',
            },
            202,
          )
        : base(url, init);
    await render();
    await openPicker();
    await click(item('runAgent.pickAgent')!);
    expect(toast.error).toHaveBeenCalledWith('The action was closed, so the run didn’t start.');
    expect(toast).not.toHaveBeenCalled();
    expect(openChat).not.toHaveBeenCalled();
  });

  it('opens the upgrade dialog instead in a read-only workspace', async () => {
    await render({ locked: true });
    await click(trigger()!);
    expect(openUpgrade).toHaveBeenCalledWith('Running an agent on an action needs a plan');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
