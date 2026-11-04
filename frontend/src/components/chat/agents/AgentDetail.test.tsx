import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { AgentDetail as Agent, AgentRunView } from '@/lib/chat/agents';
import type { UpgradeDialogState } from '@/components/context/upgradeGate';
import {
  ADMIN_CAN,
  AGENT_ID,
  NOTHING_CAN,
  NOW,
  detail,
  run,
} from '@/lib/chat/testing/agentFixtures';

/**
 * An agent's detail (CHAT-21 §C; governance mockup #g-agent; CHAT-27 item
 * 25): its state, owner and This period; only the buttons `can` allows;
 * skills, mode, connections and model; triggers with the next run; runs
 * with their AI use against their cap ("3.2% of 10%"), state, trigger and
 * brand, never dollars; the side cards; a refused button's answer; and a
 * plain line when it can't be read or isn't there.
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
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/actions/chatAccessRequests', () => ({
  requestAccess: vi.fn(async () => ({ ok: true, id: 'request-1' })),
}));

const { AgentDetail } = await import('./AgentDetail');
const { UpgradeDialogContext } = await import('@/components/context/upgradeGate');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
let agent: Agent;
let runs: AgentRunView[];
let answer: (url: string, init?: RequestInit) => Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));

const base = (url: string): Response | null => {
  if (url === `/api/chat/agents/${AGENT_ID}`) return Response.json({ ok: true, agent });
  if (url === `/api/chat/agents/${AGENT_ID}/runs`) return Response.json({ ok: true, runs });
  return null;
};

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
/** The detail, in the dashboard's read-only state when `gate` is given. */
async function render(gate: UpgradeDialogState | null = null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider value={gate}>
          <AgentDetail id={AGENT_ID} now={NOW} timeZone="UTC" />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const action = (name: string) => all(`[data-action="${name}"]`);
const one = (selector: string) => container.querySelector<HTMLElement>(selector);
async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.click();
  });
  await settle();
}
const posts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([url]) => url.replace(`/api/chat/agents/${AGENT_ID}/`, ''));

beforeEach(() => {
  toast.mockClear();
  toast.error.mockClear();
  nav.push.mockClear();
  fetchMock.mockClear();
  agent = detail();
  runs = [
    run(),
    run({
      status: 'stopped',
      stopReason: 'no_answer',
      triggerKind: 'manual',
      by: 'Ayşe Demir',
      brand: 'Brand B',
      outcome: null,
      outcomeConfidence: null,
      usageShare: 0.004,
      maxShare: 0.15,
      chatId: null,
    }),
  ];
  answer = (url) => base(url) ?? Response.json({ ok: false, failure: 'failed' }, { status: 500 });
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

describe('AgentDetail: publishing on its own (AUTONOMOUS-GO-LIVE §7.2)', () => {
  const permission = {
    on: true,
    changed: false,
    version: 2,
    dailyLimit: 5,
    by: 'Alex Kim',
    at: '2026-11-01T10:00:00.000Z',
  };
  const card = () => one('[data-slot="agent-go-live-card"]');
  const row = (slot: string) => one(`[data-slot="agent-go-live-card"] [data-row="${slot}"]`);

  it('badges the mode, and lists who allowed it and the pages it sent in the last 24 hours', async () => {
    agent = detail({
      goLive: {
        switch: 'on',
        permission,
        recent: [
          {
            title: 'Pricing FAQ',
            target: 'Webflow',
            at: '2026-10-30T09:14:00.000Z',
            takenDown: false,
          },
          { title: '', target: 'WordPress', at: '2026-10-30T08:00:00.000Z', takenDown: true },
        ],
      },
    });
    await render();
    expect(one('[data-field="mode"] [data-slot="agent-go-live-badge"]')?.textContent).toBe(
      'Publishes on its own · 5 a day',
    );
    expect(row('goLiveStatus')?.textContent).toBe('On · up to 5 a day');
    expect(row('goLiveBy')?.textContent).toBe('Alex Kim · Nov 1, 2026');
    const recent = all('[data-slot="agent-go-live-recent"] li').map((li) => li.textContent);
    expect(recent).toEqual([
      '“Pricing FAQ” → WebflowToday 09:14',
      '“Untitled page” → WordPressToday 08:00 · Taken down',
    ]);
  });

  it('says why it is off: the switch in Settings › Chat, or a change to the agent; no badge', async () => {
    agent = detail({ goLive: { switch: 'off', permission, recent: [] } });
    await render();
    expect(one('[data-slot="agent-go-live-badge"]')).toBeNull();
    expect(row('goLiveStatus')?.textContent).toBe('Off in Settings › Chat');
    expect(card()!.textContent).toContain('Nothing went live on its own yet.');

    act(() => root.unmount());
    root = createRoot(container);
    agent = detail({
      goLive: {
        switch: 'on',
        permission: { ...permission, on: false, changed: true, by: null },
        recent: [],
      },
    });
    await render();
    expect(one('[data-slot="agent-go-live-badge"]')).toBeNull();
    expect(row('goLiveStatus')?.textContent).toBe(
      'Off since the agent changed. An Admin can turn it on again.',
    );
    expect(row('goLiveBy')?.textContent).toBe('A former member · Nov 1, 2026');
  });

  it('shows no card for an agent never allowed, nor while the flag is off', async () => {
    agent = detail({ goLive: { switch: 'on', permission: null, recent: [] } });
    await render();
    expect(card()).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    agent = detail();
    await render();
    expect(card()).toBeNull();
    expect(one('[data-slot="agent-go-live-badge"]')).toBeNull();
  });
});

describe('AgentDetail', () => {
  it('shows the name, state, owner, visibility and This period with the monthly cap', async () => {
    agent = detail({ maxMonthShare: 0.2 });
    await render();
    expect(one('h1')?.textContent).toBe('Citation win-back');
    expect(one('[data-slot="agent-status"]')?.textContent).toBe('Active · Next run Mon 09:00');
    const meta = one('[data-slot="agent-meta"]')!.textContent;
    expect(meta).toContain('Owner: You');
    expect(meta).toContain('Workspace');
    expect(one('[data-slot="agent-this-period"]')?.textContent).toBe(
      'This period: 2.1% · monthly cap 20%',
    );
  });

  it('shows no write button when `can` allows none', async () => {
    agent = detail({ can: { ...NOTHING_CAN } });
    await render();
    for (const name of [
      'agent.runNow',
      'agent.pause',
      'agent.resume',
      'agent.activate',
      'agent.restore',
      'agent.more',
    ]) {
      expect(action(name)).toHaveLength(0);
    }
  });

  it('shows the buttons `can` allows: Pause, Run now, and Duplicate, Take over and Archive under ⋯', async () => {
    agent = detail({ can: { ...ADMIN_CAN }, mine: false });
    await render();
    expect(action('agent.pause')).toHaveLength(1);
    expect(action('agent.runNow')).toHaveLength(1);
    await click(action('agent.more')[0]);
    expect(
      [...document.body.querySelectorAll('[data-action^="agent."][role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['Duplicate', 'Take over', 'Archive']);
  });

  it('offers Activate for a draft, Resume when paused and Restore when archived', async () => {
    const remount = async () => {
      act(() => root.unmount());
      root = createRoot(container);
      await render();
    };
    agent = detail({ status: 'draft', can: { ...NOTHING_CAN, activate: true } });
    await render();
    expect(action('agent.activate')).toHaveLength(1);
    expect(one('[data-slot="agent-status"]')?.textContent).toBe('Draft · Not on yet');

    agent = detail({
      status: 'paused',
      pausedReason: 'manual',
      can: { ...NOTHING_CAN, resume: true },
    });
    await remount();
    expect(action('agent.resume')).toHaveLength(1);
    expect(one('[data-slot="agent-status"]')?.textContent).toBe('Paused · Paused by a person');

    agent = detail({ status: 'archived', can: { ...NOTHING_CAN, restore: true } });
    await remount();
    expect(action('agent.restore')).toHaveLength(1);
    expect(action('agent.runNow')).toHaveLength(0);
  });

  it('pauses the agent and shows it paused, with a toast', async () => {
    agent = detail({ can: { ...ADMIN_CAN } });
    answer = (url) =>
      url.endsWith('/pause')
        ? Response.json({
            ok: true,
            agent: detail({
              status: 'paused',
              pausedReason: 'manual',
              can: { ...ADMIN_CAN, pause: false, resume: true },
            }),
          })
        : (base(url) as Response);
    await render();
    await click(action('agent.pause')[0]);
    expect(posts()).toEqual(['pause']);
    expect(toast).toHaveBeenCalledWith(
      'Citation win-back paused · its triggers stop until you resume it',
    );
    expect(action('agent.resume')).toHaveLength(1);
  });

  it('runs it now, reads it again, and duplicates it into a draft it opens', async () => {
    agent = detail({ can: { ...ADMIN_CAN } });
    answer = (url) =>
      url.endsWith('/run')
        ? Response.json(
            {
              ok: true,
              runs: [
                { brand: 'GetCito', status: 'queued', repeated: false, coalesced: false },
                { brand: 'Brand B', status: 'queued', repeated: false, coalesced: false },
              ],
            },
            { status: 202 },
          )
        : url.endsWith('/duplicate')
          ? Response.json(
              {
                ok: true,
                agent: detail({
                  id: 'aaaaaaaa-0000-4000-8000-000000000009',
                  name: 'Citation win-back copy',
                }),
              },
              { status: 201 },
            )
          : (base(url) as Response);
    await render();
    await click(action('agent.runNow')[0]);
    expect(toast).toHaveBeenCalledWith('2 runs queued, one a brand');
    expect(
      fetchMock.mock.calls.filter(([url]) => url === `/api/chat/agents/${AGENT_ID}`),
    ).toHaveLength(2);

    await click(action('agent.more')[0]);
    await click(document.body.querySelector<HTMLElement>('[data-action="agent.duplicate"]')!);
    expect(toast).toHaveBeenCalledWith('Copied as a draft · Citation win-back copy');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/agents/aaaaaaaa-0000-4000-8000-000000000009');
  });

  // Agent Center (/dashboard/agents): its own page now, out of Chat's header; the agents are its Your agents tab.
  it('leads back to Agent Center from the top, on Your agents', async () => {
    await render();
    const back = action('agents.back')[0];
    expect(back.getAttribute('href')).toBe('/dashboard/agents?tab=yours');
    expect(back.textContent).toBe('Back to Agent Center');
  });

  // Out of Chat, the dashboard's read-only state (plan ended, trial over) still holds.
  it('opens the upgrade dialog instead of running while the workspace is read-only', async () => {
    agent = detail({ can: { ...ADMIN_CAN } });
    const openUpgrade = vi.fn();
    await render({ isLocked: true, reason: 'ended', adminName: null, openUpgrade });
    await click(action('agent.runNow')[0]);
    expect(openUpgrade).toHaveBeenCalledWith('Run an agent now');
    expect(posts()).toEqual([]);
  });

  it('shows skills, mode, connections with Required or Optional, and the model', async () => {
    await render();
    const field = (name: string) => one(`[data-field="${name}"]`)?.textContent;
    expect(field('skills')).toBe('Skills/winback/refresh');
    expect(field('mode')).toBe('ModeAuto, ask before changes');
    expect(field('connections')).toBe('ConnectionsGoogle Search ConsoleRequiredWebflowOptional');
    expect(field('model')).toBe('ModelAutoMonthly AI limit');
  });

  it("lists the triggers with their next run on the schedule's own clock, or when they fire", async () => {
    // The schedule runs on Istanbul's clock (UTC+3); the screen is UTC.
    await render();
    const rows = all('[data-slot="agent-trigger"]');
    expect(rows.map((row) => row.textContent)).toEqual([
      'ScheduleEvery Mon 09:00Next run Mon 09:00 · Europe/Istanbul time · Last fired Mon 09:00',
      'Signal createdNew Recover signalFires when Action Center finds a matching signal',
    ]);
    expect(rows[0].querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Every Mon 09:00: on',
    );
    expect(one('[data-slot="agent-status"]')?.textContent).toBe('Active · Next run Mon 09:00');
  });

  it("says a paused agent's triggers don't fire, with no next run", async () => {
    agent = detail({ status: 'paused', pausedReason: 'manual' });
    await render();
    const rows = all('[data-slot="agent-trigger"]');
    expect(rows.map((row) => row.querySelector('em')?.textContent)).toEqual([
      "Paused · it doesn't fire · Last fired Mon 09:00",
      "Paused · it doesn't fire",
    ]);
    expect(container.textContent).not.toContain('Next run');
  });

  it("lists the runs with their AI use against their cap, state, trigger and brand, and opens a run's chat", async () => {
    await render();
    const table = one('[role="table"]')!;
    expect(table.getAttribute('aria-label')).toBe('Run history');
    expect([...table.querySelectorAll('[role="columnheader"]')].map((h) => h.textContent)).toEqual([
      'Run',
      'Trigger · brand',
      'Result',
      'Outcome',
      'AI use',
    ]);
    const rows = all('[data-slot="agent-run"]');
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.getAttribute('role') === 'row')).toBe(true);
    expect(rows[0].querySelectorAll('[role="cell"]')).toHaveLength(5);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/chat/cccccccc-0000-4000-8000-000000000001',
    );
    expect(rows[0].querySelector('[data-slot="run-ai-use"]')?.textContent).toBe('3.2% of 10%');
    expect(rows[0].textContent).toContain('Schedule');
    expect(rows[0].textContent).toContain('GetCito');
    expect(rows[0].textContent).toContain('Done');
    expect(rows[0].querySelector('[data-slot="run-outcome"]')?.textContent).toBe('Improved');
    expect(rows[1].querySelector('a')).toBeNull();
    expect(rows[1].textContent).toContain('Manual · Ayşe Demir');
    expect(rows[1].textContent).toContain('Brand B');
    expect(rows[1].textContent).toContain('Stopped');
    expect(rows[1].textContent).toContain('No answer in 7 days');
    expect(rows[1].querySelector('[data-slot="run-ai-use"]')?.textContent).toBe('0.4% of 15%');
    expect(container.textContent).not.toMatch(/\$/);

    await click(action('agent.filterRuns')[3]);
    expect(all('[data-slot="agent-run"]')).toHaveLength(1);
    await click(action('agent.filterRuns')[1]);
    expect(all('[data-slot="agent-run"]')).toHaveLength(1);
  });

  it('shows no AI use on runs where there is no AI limit to share', async () => {
    agent = detail({ usagePeriod: null, usage30d: null });
    await render();
    expect(all('[data-slot="run-ai-use"]').map((cell) => cell.textContent)).toEqual(['—', '—']);
    expect(one('[data-row="thisPeriod"]')?.textContent).toBe('—');
    expect(one('[data-slot="agent-this-period"]')).toBeNull();
  });

  it('keeps what a button answered when an older read comes back later', async () => {
    agent = detail({ can: { ...ADMIN_CAN } });
    let reads = 0;
    let finish: (res: Response) => void = () => undefined;
    answer = (url) => {
      if (url.endsWith('/run')) {
        return Response.json(
          {
            ok: true,
            runs: [{ brand: 'GetCito', status: 'queued', repeated: false, coalesced: false }],
          },
          { status: 202 },
        );
      }
      if (url.endsWith('/pause')) {
        return Response.json({
          ok: true,
          agent: detail({
            status: 'paused',
            pausedReason: 'manual',
            can: { ...ADMIN_CAN, pause: false, resume: true },
          }),
        });
      }
      if (url === `/api/chat/agents/${AGENT_ID}` && ++reads === 2) {
        // Run now's read again, slow: it answers after the pause, with the agent as it was.
        return new Promise<Response>((resolve) => {
          finish = resolve;
        }) as unknown as Response;
      }
      return base(url) as Response;
    };
    await render();
    await click(action('agent.runNow')[0]);
    await click(action('agent.pause')[0]);
    expect(action('agent.resume')).toHaveLength(1);
    await act(async () => finish(Response.json({ ok: true, agent })));
    await settle();
    expect(action('agent.resume')).toHaveLength(1);
    expect(one('[data-slot="agent-status"]')?.textContent).toBe('Paused · Paused by a person');
  });

  it('reads the runs again after Archive, so cancelled ones are not left Queued', async () => {
    agent = detail({ can: { ...ADMIN_CAN } });
    runs = [run({ status: 'queued', startedAt: null, outcome: null, outcomeConfidence: null })];
    answer = (url) =>
      url.endsWith('/archive')
        ? Response.json({
            ok: true,
            agent: detail({ status: 'archived', can: { ...NOTHING_CAN, restore: true } }),
          })
        : (base(url) as Response);
    await render();
    expect(one('[data-slot="agent-run"]')?.textContent).toContain('Queued');
    runs = [run({ status: 'stopped', stopReason: 'user', outcome: null, outcomeConfidence: null })];
    await click(action('agent.more')[0]);
    await click(document.body.querySelector<HTMLElement>('[data-action="agent.archive"]')!);
    expect(toast).toHaveBeenCalledWith('Citation win-back archived');
    expect(one('[data-slot="agent-run"]')?.textContent).toContain('Stopped by a person');
    expect(action('agent.restore')).toHaveLength(1);
  });

  it('shows Access, Scope and AI use as shares beside the runs', async () => {
    agent = detail({ maxRunShare: 0.15 });
    await render();
    const row = (name: string) => one(`[data-row="${name}"]`)?.textContent;
    expect(row('owner')).toBe('You');
    expect(row('visibility')).toBe('Workspace');
    expect(row('brands')).toBe('GetCito');
    expect(row('engines')).toBe('Perplexity');
    expect(row('perRun')).toBe('15%');
    expect(row('monthCap')).toBe('None');
    expect(row('thisPeriod')).toBe('2.1%');
    expect(row('days30')).toBe('3.4% · 4 runs');
  });

  it("shows the out-of-permission answer for a refused button, and the server's words for a plain refusal", async () => {
    agent = detail({ can: { ...ADMIN_CAN } });
    answer = (url) =>
      url.endsWith('/run')
        ? Response.json(
            {
              ok: false,
              failure: 'plan',
              code: 'plan_locked',
              error: 'Full auto needs Growth.',
              denial: {
                asked: 'You asked: Run an agent now',
                rule: { kind: 'plan', detail: 'Full auto needs Growth.', source: null },
                whoCan: 'Growth workspaces can do this.',
                nextActions: ['upgrade'],
                needsPlan: 'Growth',
              },
            },
            { status: 402 },
          )
        : url.endsWith('/pause')
          ? Response.json(
              {
                ok: false,
                failure: 'failed',
                code: 'wrong_status',
                error: 'This agent is paused, so it can’t do that now.',
              },
              { status: 409 },
            )
          : (base(url) as Response);
    await render();
    await click(action('agent.runNow')[0]);
    const denial = one('[data-slot="agent-denial"]')!;
    expect(denial.getAttribute('role')).toBe('alert');
    expect(denial.textContent).toContain('You asked: Run an agent now');
    expect(denial.textContent).toContain('Full auto needs Growth.');
    await click(action('agent.pause')[0]);
    expect(one('[data-slot="agent-denial"]')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('This agent is paused, so it can’t do that now.');
  });

  it('says when the agent could not be read, with Retry, and no skeleton left behind', async () => {
    answer = () => Response.json({ ok: false, failure: 'failed' }, { status: 500 });
    await render();
    expect(one('[data-slot="agent-error"]')?.textContent).toContain("Couldn't load this agent.");
    expect(one('[data-slot="skeleton"]')).toBeNull();
    answer = (url) => base(url) as Response;
    await click(action('agent.retry')[0]);
    expect(one('h1')?.textContent).toBe('Citation win-back');
  });

  it("says when the agent isn't there, with the way back to Agents", async () => {
    answer = () => Response.json({ ok: false, failure: 'not_found' }, { status: 404 });
    await render();
    expect(one('[data-slot="agent-error"]')?.textContent).toContain("This agent isn't available.");
    expect(action('agents.back')[0].getAttribute('href')).toBe('/dashboard/agents?tab=yours');
  });

  it('keeps the agent when only its runs could not be read', async () => {
    answer = (url) =>
      url.endsWith('/runs')
        ? Response.json({ ok: false, failure: 'failed' }, { status: 500 })
        : (base(url) as Response);
    await render();
    expect(one('h1')?.textContent).toBe('Citation win-back');
    expect(one('[data-slot="agent-runs-error"]')?.textContent).toContain("Couldn't load the runs.");
  });

  it('links Edit to the agent’s four steps, only where `can.edit` allows it (W2-15)', async () => {
    agent = detail({ can: { ...ADMIN_CAN } });
    await render();
    expect(action('agent.edit')[0].getAttribute('href')).toBe(`/dashboard/agents/${AGENT_ID}/edit`);
    act(() => root.unmount());
    root = createRoot(container);
    agent = detail({ can: { ...ADMIN_CAN, edit: false } });
    await render();
    expect(action('agent.edit')).toHaveLength(0);
  });

  it('deletes an archived agent from ⋯ once confirmed, then goes back to Agents (W2-15)', async () => {
    // Not archived: no Delete.
    agent = detail({ can: { ...ADMIN_CAN } });
    await render();
    await click(action('agent.more')[0]);
    expect(document.body.querySelector('[data-action="agent.delete"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);

    agent = detail({
      status: 'archived',
      can: { ...NOTHING_CAN, restore: true, duplicate: true, delete: true },
    });
    answer = (url, init) =>
      init?.method === 'DELETE' && url === `/api/chat/agents/${AGENT_ID}`
        ? Response.json({ ok: true })
        : (base(url) ?? Response.json({ ok: false, failure: 'failed' }, { status: 500 }));
    await render();
    await click(action('agent.more')[0]);
    const item = document.body.querySelector<HTMLElement>('[data-action="agent.delete"]')!;
    expect(item.textContent).toBe('Delete');
    await click(item);
    // It asks first; nothing is sent until the click.
    const dialog = document.body.querySelector<HTMLElement>('[data-slot="agent-delete-dialog"]')!;
    expect(dialog.textContent).toContain('Delete this agent?');
    expect(dialog.textContent).toContain(
      '“Citation win-back” will be deleted. Its past runs and files stay.',
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await click(document.body.querySelector<HTMLElement>('[data-action="agent.deleteConfirm"]')!);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => url),
    ).toEqual([`/api/chat/agents/${AGENT_ID}`]);
    expect(toast).toHaveBeenCalledWith('Citation win-back deleted · its runs and files stay');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/agents?tab=yours');
  });

  it('keeps an archived agent when Delete is refused, with the server’s words', async () => {
    agent = detail({ status: 'archived', can: { ...NOTHING_CAN, delete: true } });
    answer = (url, init) =>
      init?.method === 'DELETE'
        ? Response.json(
            {
              ok: false,
              failure: 'failed',
              code: 'wrong_status',
              error: "This agent is paused, so it can't do that now.",
            },
            { status: 409 },
          )
        : (base(url) ?? Response.json({ ok: false, failure: 'failed' }, { status: 500 }));
    await render();
    await click(action('agent.more')[0]);
    await click(document.body.querySelector<HTMLElement>('[data-action="agent.delete"]')!);
    await click(document.body.querySelector<HTMLElement>('[data-action="agent.deleteConfirm"]')!);
    expect(toast.error).toHaveBeenCalledWith("This agent is paused, so it can't do that now.");
    expect(nav.push).not.toHaveBeenCalled();
    expect(one('h1')?.textContent).toBe('Citation win-back');
  });
});
