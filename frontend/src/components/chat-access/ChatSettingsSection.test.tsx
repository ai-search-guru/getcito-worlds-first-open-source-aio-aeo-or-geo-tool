import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatSettingsView, PolicyRow } from '@/lib/actions/chatSettings';

/** Settings › Chat (CHAT-20 §5, mockup #g-policy). */

const actions = vi.hoisted(() => ({
  getChatSettingsView: vi.fn(),
  setToolPolicy: vi.fn(),
  resetToolPolicies: vi.fn(),
  setChatSwitch: vi.fn(),
  setManagerExecute: vi.fn(),
  setAutoGoLive: vi.fn(),
  removeAutoChoice: vi.fn(),
}));
vi.mock('@/lib/actions/chatSettings', () => actions);
vi.mock('@/lib/actions/chatAccessRequests', () => ({ requestAccess: vi.fn() }));
vi.mock('@/components/context/upgradeGate', () => ({
  useUpgradeGate: () => ({ guard: (fn: unknown) => fn }),
}));
vi.mock('@/components/context/AiUsageProvider', () => ({
  useAiUsage: () => ({ usage: null, refresh: vi.fn() }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ChatSettingsSection } = await import('./ChatSettingsSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of [...Object.values(actions), ...Object.values(toast)]) fn.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flags = { alwaysCard: false, costCard: false, adminMayTurnOff: false, goLiveOnOwn: false };
const rows: PolicyRow[] = [
  {
    key: 'trackedPrompts',
    area: 'prompts',
    class: 'read',
    flags,
    policy: 'on',
    defaultPolicy: 'on',
    changed: false,
    choices: [],
  },
  {
    key: 'saveDraft',
    area: 'content',
    class: 'write',
    flags,
    policy: 'ask_full_auto',
    defaultPolicy: 'ask_full_auto',
    changed: false,
    choices: [
      { policy: 'never', locked: false },
      { policy: 'ask', locked: false },
      { policy: 'ask_full_auto', locked: true },
      { policy: 'always', locked: true },
    ],
  },
];
const view = (over: Partial<ChatSettingsView> = {}): ChatSettingsView => ({
  role: 'admin',
  plan: null,
  fullAutoLocked: null,
  fullAutoForMembers: true,
  dontAskAgain: true,
  managerExecuteOff: ['feeds'],
  rows,
  autoChoices: ['saveDraft'],
  goLive: null,
  ...over,
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatSettingsSection />
      </NextIntlClientProvider>,
    );
  });
}
const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);

describe('ChatSettingsSection', () => {
  it("lets an Admin pick a tool's policy, saved and read again", async () => {
    actions.getChatSettingsView.mockResolvedValue({ ok: true, view: view() });
    actions.setToolPolicy.mockResolvedValue({ ok: true });
    await render();
    expect(text()).toContain('Read tracked prompts');
    expect(text()).toContain('Runs freely');
    expect(text()).toContain('Auto in Full auto');
    expect(text()).not.toContain('create_draft');
    await act(async () => button('Never')!.click());
    expect(actions.setToolPolicy).toHaveBeenCalledWith('saveDraft', 'never');
    expect(toast.success).toHaveBeenCalledWith('Saved');
    expect(actions.getChatSettingsView).toHaveBeenCalledTimes(2);
  });

  it('switches a go-live group for Managers, and says why a save failed', async () => {
    actions.getChatSettingsView.mockResolvedValue({ ok: true, view: view() });
    actions.setManagerExecute.mockResolvedValue({ ok: false, failure: 'read_only' });
    await render();
    const feeds = container.querySelector('[role="switch"][aria-label="Product feeds"]')!;
    expect(feeds.getAttribute('aria-checked')).toBe('false');
    await act(async () => (feeds as HTMLButtonElement).click());
    expect(actions.setManagerExecute).toHaveBeenCalledWith('feeds', true);
    expect(toast.error).toHaveBeenCalledWith('This workspace is read-only until a plan is active.');
  });

  it('locks what the plan locks, and Full auto below Growth', async () => {
    actions.getChatSettingsView.mockResolvedValue({
      ok: true,
      view: view({ fullAutoLocked: 'growth', plan: null }),
    });
    await render();
    const always = button('Always') as HTMLButtonElement;
    expect(always.disabled).toBe(true);
    expect(always.title).toBe('Needs Growth');
    expect(container.querySelectorAll('[role="switch"][aria-label^="Full auto"]')).toHaveLength(0);
    expect(text()).toContain('Needs Growth · you');
    expect(text()).toContain('Card in every mode');
  });

  it('is read-only for anyone else, who still removes their own tick', async () => {
    actions.getChatSettingsView.mockResolvedValue({ ok: true, view: view({ role: 'manager' }) });
    actions.removeAutoChoice.mockResolvedValue({ ok: true });
    await render();
    expect(text()).toContain('Read-only · only Admins change the Chat tool policy');
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(button('Reset to defaults')).toBeUndefined();
    await act(async () => button('Remove')!.click());
    expect(actions.removeAutoChoice).toHaveBeenCalledWith('saveDraft');
    expect(toast.success).toHaveBeenCalledWith('Removed: it asks again');
  });

  it('says so in plain words when it can’t be read, and reads again on Retry', async () => {
    actions.getChatSettingsView.mockResolvedValue({ ok: false, failure: 'failed' });
    await render();
    expect(text()).toContain("Couldn't load Chat's settings.");
    await act(async () => button('Retry')!.click());
    expect(actions.getChatSettingsView).toHaveBeenCalledTimes(2);
  });
});

describe('agents that publish on their own (AUTONOMOUS-GO-LIVE §7.1)', () => {
  const GO_LIVE = {
    on: false,
    since: null,
    byName: null,
    qualityOff: false,
    workspace: 'Acme',
  };
  const goLiveSwitch = () =>
    container.querySelector(
      '[role="switch"][aria-label="Allow agents to publish and send on their own"]',
    ) as HTMLButtonElement | null;
  const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;

  it('stays hidden with its flag off, and says nothing new there', async () => {
    actions.getChatSettingsView.mockResolvedValue({ ok: true, view: view() });
    await render();
    expect(text()).not.toContain('Agents that publish on their own');
    expect(text()).toContain("NEVER tools don't exist · EXECUTE needs a click");
  });

  it('asks an Admin to accept the responsibility first, then turns it on', async () => {
    actions.getChatSettingsView.mockResolvedValue({ ok: true, view: view({ goLive: GO_LIVE }) });
    actions.setAutoGoLive.mockResolvedValue({ ok: true });
    await render();
    expect(text()).toContain('Agents that publish on their own');
    expect(text()).toContain('unless an Admin let an agent go live on its own');
    await act(async () => goLiveSwitch()!.click());
    expect(actions.setAutoGoLive).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toContain('Let agents publish on their own?');
    expect(dialog()!.textContent).toContain(
      'Your workspace is responsible for what they publish, as if a member had clicked Publish.',
    );
    expect(dialog()!.textContent).toContain(
      "I understand, and I'm allowed to decide this for Acme.",
    );
    const turnOn = [...dialog()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Turn on',
    )!;
    expect(turnOn.disabled).toBe(true);
    await act(async () => (dialog()!.querySelector('[role="checkbox"]') as HTMLElement).click());
    expect(turnOn.disabled).toBe(false);
    await act(async () => turnOn.click());
    expect(actions.setAutoGoLive).toHaveBeenCalledWith(true, 1);
    expect(toast.success).toHaveBeenCalledWith('Agents you allow can now publish on their own');
  });

  it('turns it off with no dialog, and says who turned it on when', async () => {
    actions.getChatSettingsView.mockResolvedValue({
      ok: true,
      view: view({
        goLive: { ...GO_LIVE, on: true, since: '2026-11-01T09:00:00Z', byName: 'Ada Admin' },
      }),
    });
    actions.setAutoGoLive.mockResolvedValue({ ok: true });
    await render();
    expect(text()).toContain('On since Nov 1, 2026 · by Ada Admin');
    await act(async () => goLiveSwitch()!.click());
    expect(dialog()).toBeNull();
    expect(actions.setAutoGoLive).toHaveBeenCalledWith(false, 1);
  });

  it('locks it below Growth and while Content Quality is off, and others only read it', async () => {
    actions.getChatSettingsView.mockResolvedValue({
      ok: true,
      view: view({ fullAutoLocked: 'growth', goLive: GO_LIVE }),
    });
    await render();
    expect(goLiveSwitch()).toBeNull();
    expect(text()).toContain("Needs Growth · you're on");

    act(() => root.unmount());
    root = createRoot(container);
    actions.getChatSettingsView.mockResolvedValue({
      ok: true,
      view: view({ goLive: { ...GO_LIVE, qualityOff: true } }),
    });
    await render();
    expect(text()).toContain('Needs Content Quality, which checks each page before it goes live');

    act(() => root.unmount());
    root = createRoot(container);
    actions.getChatSettingsView.mockResolvedValue({
      ok: true,
      view: view({ role: 'manager', goLive: { ...GO_LIVE, on: true } }),
    });
    await render();
    expect(goLiveSwitch()).toBeNull();
  });
});
