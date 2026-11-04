import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import type { AgentListResult } from '@/lib/chat/agents';
import { AGENT_ID, NOW, listItem, listResult } from '@/lib/chat/testing/agentFixtures';

/**
 * Agent Center's Your agents tab (CHAT-21 §B; governance mockup #g-agents;
 * CHAT-27 item 24), as Agent Center shows it: the tabs with their counts
 * ask the server again; each card shows its state, skills, triggers, next
 * run, scope, last run, outcomes and AI use as a share with its tip, never
 * dollars; Admins and Managers get New agent, Run now and Pause, readers a
 * read-only line instead; a refused button shows the out-of-permission
 * answer; a failed read a plain line.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
// The tip shown inline, so its words can be read without hovering.
vi.mock('@/components/ui/tooltip', async () => {
  const { cloneElement } = await import('react');
  return {
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
      cloneElement(render, {}, children),
    TooltipContent: ({ children }: { children: ReactNode }) => (
      <span data-slot="tooltip">{children}</span>
    ),
  };
});
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/actions/chatAccessRequests', () => ({
  requestAccess: vi.fn(async () => ({ ok: true, id: 'request-1' })),
}));

const { AgentCenter } = await import('./AgentCenter');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
let page: AgentListResult;
let answer: (url: string, init?: RequestInit) => Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render(role: TeamRole = 'manager') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <AgentCenter initialTab="yours" now={NOW} timeZone="UTC" />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const action = (name: string) => all(`[data-action="${name}"]`);
const cards = () => all('[data-slot="agent-card"]');
const cell = (card: HTMLElement, name: string) =>
  card.querySelector<HTMLElement>(`[data-cell="${name}"]`)?.textContent ?? '';
const listCalls = () =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/chat/agents?'));
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await settle();
}

beforeEach(() => {
  toast.mockClear();
  toast.error.mockClear();
  fetchMock.mockClear();
  page = listResult([
    listItem(),
    listItem({
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      name: 'Weekly report',
      status: 'paused',
      pausedReason: 'cap',
      mine: false,
      visibility: 'workspace',
      skills: ['report'],
      triggers: [],
      scope: { allBrands: false, brands: ['A', 'B', 'C'] },
      lastRun: null,
      outcomes30d: {
        pending: 0,
        improved: 0,
        no_meaningful_change: 0,
        declined: 0,
        not_measurable: 0,
      },
      usage30d: null,
      can: { run: true, pause: false, resume: true },
    }),
  ]);
  answer = (url) =>
    url.startsWith('/api/chat/agents?')
      ? Response.json({ ok: true, ...page })
      : Response.json({ ok: false, failure: 'failed' }, { status: 500 });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('AgentsList (Agent Center › Your agents)', () => {
  it('shows the tabs with their counts and asks the server again for each tab', async () => {
    await render();
    expect(listCalls()).toEqual(['/api/chat/agents?view=mine']);
    const tabs = action('agents.filter');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Mine2',
      'Workspace5',
      'Paused1',
      'Archived3',
    ]);
    expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-slot="agents-count"]')?.textContent).toBe('4');

    await click(tabs[2]);
    expect(listCalls().at(-1)).toBe('/api/chat/agents?view=paused');
    expect(action('agents.filter')[2].getAttribute('aria-pressed')).toBe('true');
  });

  it('searches by name or skill once the typing stops, a skill with or without its slash', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await render();
      const input = action('agents.search')[0] as HTMLInputElement;
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        set.call(input, '/winback');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      await settle();
      expect(listCalls().at(-1)).toBe('/api/chat/agents?view=mine&q=winback');
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows each card's state, skills, triggers, next run, scope, last run and outcomes", async () => {
    await render();
    const [first, second] = cards();
    expect(first.querySelector('a[data-action="agents.open"]')?.getAttribute('href')).toBe(
      `/dashboard/agents/${AGENT_ID}`,
    );
    const status = first.querySelector('[data-slot="agent-status"]')!;
    expect(status.textContent).toBe('Active · Next run Mon 09:00');
    expect(first.querySelector('[data-slot="agent-dot"]')?.getAttribute('data-dot')).toBe('active');
    expect(first.querySelector('[data-slot="agent-formula"]')?.textContent).toBe(
      '/winback/refreshAuto, ask before changes',
    );
    expect(cell(first, 'trigger')).toBe('TriggerEvery Mon 09:00 · New Recover signal');
    expect(cell(first, 'nextRun')).toBe('Next runMon 09:00');
    expect(cell(first, 'scope')).toBe('ScopeGetCito');
    expect(cell(first, 'lastRun')).toContain('Today 09:14');
    expect(cell(first, 'outcomes')).toBe('Outcomes · 30 days4 improved · 2 pending');

    expect(second.querySelector('[data-slot="agent-status"]')?.textContent).toBe(
      'Paused · AI limit reached',
    );
    expect(second.querySelector('[data-slot="agent-dot"]')?.getAttribute('data-dot')).toBe(
      'paused',
    );
    expect(cell(second, 'trigger')).toBe('TriggerManual only');
    expect(cell(second, 'scope')).toBe('Scope3 brands');
    expect(cell(second, 'lastRun')).toBe('Last run—');
  });

  it('badges an agent that publishes and sends on its own, with its daily limit (AUTONOMOUS-GO-LIVE §7.2)', async () => {
    page = listResult([
      listItem({ goLiveLimit: 5 }),
      listItem({ id: 'aaaaaaaa-0000-4000-8000-000000000002' }),
    ]);
    await render();
    const [allowed, other] = cards();
    expect(allowed.querySelector('[data-slot="agent-go-live-badge"]')?.textContent).toBe(
      'Publishes on its own · 5 a day',
    );
    expect(other.querySelector('[data-slot="agent-go-live-badge"]')).toBeNull();
  });

  it('shows AI use · 30 days as a share with a thin bar, its runs on hover, and never dollars', async () => {
    await render();
    const [first, second] = cards();
    const use = first.querySelector<HTMLElement>('[data-slot="agent-ai-use"]')!;
    expect(use.querySelector('b')?.textContent).toBe('3.4%');
    expect(use.getAttribute('aria-label')).toBe(
      'AI use in the last 30 days: 3.4% of the monthly AI limit',
    );
    expect(use.querySelector<HTMLElement>('[data-slot="agent-ai-use-bar"]')?.style.width).toBe(
      '3.4%',
    );
    expect(first.querySelector('[data-slot="tooltip"]')?.textContent).toBe(
      '4 runs · average 0.9% a run · cap 10% a run',
    );
    expect(cell(second, 'aiUse')).toBe('AI use · 30 days—');
    expect(container.textContent).not.toMatch(/\$/);
  });

  it("gives each card the Run now and Pause or Resume the server's `can` gives it, and a Manager New agent", async () => {
    await render('manager');
    expect(action('agents.new')[0].getAttribute('href')).toBe('/dashboard/agents/new');
    const [first, second] = cards();
    expect(first.querySelector('[data-action="agents.run"]')).not.toBeNull();
    expect(first.querySelector('[data-action="agents.pauseResume"]')?.textContent).toBe('Pause');
    expect(second.querySelector('[data-action="agents.pauseResume"]')?.textContent).toBe('Resume');
    expect(container.querySelector('[data-slot="agents-read-only"]')).toBeNull();
  });

  it('shows no Resume the server wouldn’t take, whatever the role (workspace agents kept to Admins)', async () => {
    page.agents[1] = {
      ...page.agents[1],
      mine: true,
      can: { run: true, pause: false, resume: false },
    };
    await render('manager');
    const second = cards()[1];
    expect(second.querySelector('[data-action="agents.run"]')).not.toBeNull();
    expect(second.querySelector('[data-action="agents.pauseResume"]')).toBeNull();
  });

  it('says while the workspace’s own key fails: Fix in AI Providers for an Admin, ask an Admin otherwise', async () => {
    page.keyFailure = { class: 'no_credit', provider: 'openai' };
    await render('admin');
    const banner = () => container.querySelector('[data-slot="agents-key-banner"]')!;
    expect(banner().textContent).toContain('Your OpenAI key isn’t working · agents are paused');
    expect(banner().textContent).toContain('Your OpenAI account is out of credit.');
    expect(action('agents.fixKey')[0].getAttribute('href')).toBe(
      '/dashboard/settings/ai-providers',
    );

    await act(async () => root.unmount());
    root = createRoot(container);
    await render('manager');
    expect(action('agents.fixKey')).toHaveLength(0);
    expect(banner().textContent).toContain('An Admin can fix it in Settings › AI Providers.');

    await act(async () => root.unmount());
    root = createRoot(container);
    page.keyFailure = null;
    await render('admin');
    expect(container.querySelector('[data-slot="agents-key-banner"]')).toBeNull();
  });

  it('shows Analysts and Agency partners no write buttons, a read-only line, and the Workspace tab first', async () => {
    // What the server gives a reader: nothing to press.
    page.agents = page.agents.map((a) => ({
      ...a,
      can: { run: false, pause: false, resume: false },
    }));
    for (const role of ['analyst', 'agency_partner'] as const) {
      fetchMock.mockClear();
      await render(role);
      expect(listCalls()[0]).toBe('/api/chat/agents?view=workspace');
      for (const name of ['agents.new', 'agents.run', 'agents.pauseResume']) {
        expect(action(name)).toHaveLength(0);
      }
      expect(action('agents.open').length).toBeGreaterThan(0);
      const note = container.querySelector('[data-slot="agents-read-only"]')!;
      expect(note.textContent).toContain('You see agents read-only');
      expect(note.textContent).toContain('Ask your Admin');
      await act(async () => root.unmount());
      root = createRoot(container);
    }
  });

  it('runs an agent now and says so, then reads the list again', async () => {
    answer = (url) =>
      url.endsWith('/run')
        ? Response.json(
            {
              ok: true,
              runs: [{ brand: 'GetCito', status: 'queued', repeated: false, coalesced: false }],
            },
            { status: 202 },
          )
        : Response.json({ ok: true, ...page });
    await render();
    await click(cards()[0].querySelector<HTMLElement>('[data-action="agents.run"]')!);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/chat/agents/${AGENT_ID}/run`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(toast).toHaveBeenCalledWith('Run queued for GetCito');
    expect(listCalls()).toHaveLength(2);
  });

  it('reads the tab shown again after a button, even when it changed meanwhile', async () => {
    let finish: (res: Response) => void = () => undefined;
    answer = (url) => {
      if (url.endsWith('/pause')) {
        return new Promise<Response>((resolve) => {
          finish = resolve;
        }) as unknown as Response;
      }
      return Response.json({ ok: true, ...page });
    };
    await render();
    const pause = cards()[0].querySelector<HTMLElement>('[data-action="agents.pauseResume"]')!;
    await act(async () => pause.click());
    // While the pause is on its way, the person opens Paused.
    await click(action('agents.filter')[2]);
    expect(listCalls().at(-1)).toBe('/api/chat/agents?view=paused');
    const before = listCalls().length;
    await act(async () =>
      finish(
        Response.json({
          ok: true,
          agent: { ...listItem(), status: 'paused', name: 'Citation win-back' },
        }),
      ),
    );
    await settle();
    expect(listCalls().slice(before)).toEqual(['/api/chat/agents?view=paused']);
    expect(action('agents.filter')[2].getAttribute('aria-pressed')).toBe('true');
  });

  it("shows the server's out-of-permission answer for a refused button", async () => {
    answer = (url) =>
      url.endsWith('/pause')
        ? Response.json(
            {
              ok: false,
              failure: 'failed',
              code: 'forbidden_role',
              error: 'Managers change only their own agents.',
              denial: {
                asked: 'You asked: Pause an agent',
                rule: {
                  kind: 'role',
                  detail: 'Managers change only their own agents.',
                  source: null,
                },
                whoCan: 'Admins can do this.',
                nextActions: ['ask_admin'],
              },
            },
            { status: 403 },
          )
        : Response.json({ ok: true, ...page });
    await render();
    await click(cards()[0].querySelector<HTMLElement>('[data-action="agents.pauseResume"]')!);
    const denial = container.querySelector('[data-slot="agent-denial"]')!;
    expect(denial.textContent).toContain('You asked: Pause an agent');
    expect(denial.textContent).toContain('Managers change only their own agents.');
    expect(denial.textContent).toContain('Admins can do this.');
    expect(toast.error).not.toHaveBeenCalled();
    await click(denial.querySelector<HTMLElement>('[data-action="denial.close"]')!);
    expect(container.querySelector('[data-slot="agent-denial"]')).toBeNull();
  });

  it("says a plain refusal in the server's words, and a failure in ours", async () => {
    answer = (url) =>
      url.endsWith('/resume')
        ? Response.json(
            { ok: false, failure: 'failed', code: 'archived', error: 'This agent is archived.' },
            { status: 409 },
          )
        : url.endsWith('/pause')
          ? Response.json(
              { ok: false, failure: 'failed', error: 'Failed to pause' },
              { status: 500 },
            )
          : Response.json({ ok: true, ...page });
    await render('admin');
    await click(cards()[1].querySelector<HTMLElement>('[data-action="agents.pauseResume"]')!);
    expect(toast.error).toHaveBeenLastCalledWith('This agent is archived.');
    await click(cards()[0].querySelector<HTMLElement>('[data-action="agents.pauseResume"]')!);
    expect(toast.error).toHaveBeenLastCalledWith("Couldn't do that. Try again.");
  });

  it('says which brand lacks which Required connection when Resume is refused', async () => {
    const words =
      'This agent needs Any CMS, and Brand B doesn’t have it connected. Connect it for that brand, then run the agent again.';
    answer = (url) =>
      url.endsWith('/resume')
        ? Response.json(
            { ok: false, failure: 'failed', code: 'connection_missing', error: words },
            { status: 409 },
          )
        : Response.json({ ok: true, ...page });
    await render('admin');
    await click(cards()[1].querySelector<HTMLElement>('[data-action="agents.pauseResume"]')!);
    expect(toast.error).toHaveBeenLastCalledWith(words);
    expect(toast).not.toHaveBeenCalled();
  });

  it('says when the list could not be read, with Retry, and no skeleton left behind', async () => {
    answer = () => Response.json({ ok: false, failure: 'failed' }, { status: 500 });
    await render();
    expect(container.querySelector('[data-slot="agents-error"]')?.textContent).toContain(
      "Couldn't load the agents.",
    );
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    answer = () => Response.json({ ok: true, ...page });
    await click(action('agents.retry')[0]);
    expect(cards()).toHaveLength(2);
  });

  it('says when a tab is empty, and offers to clear a search that found nothing', async () => {
    page = listResult([]);
    await render();
    const empty = container.querySelector('[data-slot="agents-empty"]')!;
    expect(empty.textContent).toContain('No agents here');
    expect(empty.textContent).toContain('Make one with New agent.');
    expect(action('agents.showAll')).toHaveLength(0);
  });
});
