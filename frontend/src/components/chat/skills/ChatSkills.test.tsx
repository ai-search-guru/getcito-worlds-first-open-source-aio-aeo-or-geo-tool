import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { SkillList, WorkspaceSkillView } from '@/lib/chat/skills/store';

/**
 * Skills (mockup #s-skills; CHAT-13 items 8–10, W3-07): GetCito's skills
 * and the workspace's own in two tabs with their counts; search and the
 * library's filter chips; a card's connections on the brand open, Connect
 * in place of Run when a Required one is missing; Run starts a chat with
 * the skill, Schedule fills Chat Home's box, Create agent starts an agent
 * on it; the switch for an Admin; a workspace skill's details with Share
 * and Delete.
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
const gate = vi.hoisted(() => ({ openUpgrade: vi.fn(), isLocked: false }));
vi.mock('@/components/context/upgradeGate', () => ({
  useUpgradeGate: () => ({ openUpgrade: gate.openUpgrade, isLocked: gate.isLocked }),
}));
const BRAND = 'bbbbbbbb-0000-4000-8000-000000000001';
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (pick: (s: { activeBrandId: string }) => unknown) =>
    pick({ activeBrandId: BRAND }),
}));

const { ChatSkills } = await import('./ChatSkills');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const own = (over: Partial<WorkspaceSkillView> = {}): WorkspaceSkillView => ({
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'board-update',
  title: 'Monthly board update',
  description: 'Writes the month’s board update from the Weekly report data.',
  source: 'user',
  sourceUrl: null,
  license: null,
  status: 'approved',
  visibility: 'private',
  enabled: true,
  mine: true,
  warnings: [],
  updateAvailable: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  can: { toggle: true, remove: true, share: 'request' },
  ...over,
});

const LIST: SkillList = {
  library: [
    {
      name: 'winback',
      title: 'Win back lost citations',
      description: 'Finds pages that lost citations and refreshes them.',
      filters: ['content', 'visibility'],
      enabled: true,
    },
    {
      name: 'report',
      title: 'Weekly report',
      description: 'Your week in AI visibility.',
      filters: ['reports'],
      enabled: true,
    },
    {
      name: 'publish',
      title: 'Ready to publish',
      description: 'Checks, page fields and a CMS draft.',
      filters: ['content'],
      enabled: false,
    },
  ],
  skills: [
    own(),
    own({
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      name: 'copy-editing',
      title: 'Copy editing',
      source: 'import',
      sourceUrl: 'https://github.com/acme/skills/tree/main/copy-editing',
      license: 'MIT',
      status: 'pending_review',
      enabled: false,
      mine: false,
      warnings: ['Links to an outside site'],
      can: { toggle: false, remove: false, share: null },
    }),
  ],
  limit: { used: 2, max: 10 },
  can: { save: true, manageLibrary: true },
};

let container: HTMLDivElement;
let root: Root;
let list: SkillList;
let connected: string[];
let answer: (url: string, init?: RequestInit) => Response | null;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const custom = answer(url, init);
  if (custom) return custom;
  if (url === '/api/chat/skills') return Response.json({ ok: true, ...list });
  if (url.startsWith('/api/chat/skills/connections')) return Response.json({ ok: true, connected });
  return Response.json({ ok: true });
});

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatSkills />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const all = (selector: string, within: ParentNode = container) => [
  ...within.querySelectorAll<HTMLElement>(selector),
];
const card = (name: string) => container.querySelector<HTMLElement>(`[data-skill="${name}"]`)!;
const cards = () => all('[data-slot="skill-card"]').map((el) => el.dataset.skill);
const inCard = (name: string, action: string) =>
  card(name).querySelector<HTMLElement>(`[data-action="${action}"]`);
async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}
const calls = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  list = structuredClone(LIST);
  connected = ['google_search_console'];
  answer = () => null;
  fetchMock.mockClear();
  nav.push.mockReset();
  for (const fn of [toast, toast.error, toast.success, gate.openUpgrade]) fn.mockReset();
  gate.isLocked = false;
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ChatSkills', () => {
  it('lists GetCito’s skills with the brand’s connections, and the tabs with their counts', async () => {
    await render();
    expect(all('[role="tab"]').map((tab) => tab.textContent)).toEqual([
      'GetCito skills 3',
      'My skills 2',
    ]);
    expect(cards()).toEqual(['winback', 'report', 'publish']);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/chat/skills/connections?brand=${BRAND}`,
      expect.anything(),
    );
    // Search Console is connected; no CMS is: an Optional one only says so.
    const chips = all('[data-slot="skill-connections"] span', card('winback'));
    expect(chips.map((chip) => [chip.textContent, chip.dataset.connected])).toEqual([
      ['Google Search Console', 'true'],
      ['Any CMS · not connected', 'false'],
    ]);
    expect(inCard('winback', 'skills.run')).not.toBeNull();
  });

  it('puts Connect in place of Run when a Required connection is missing', async () => {
    list.library[2].enabled = true;
    await render();
    const connect = inCard('publish', 'skills.connect')!;
    expect(connect.textContent).toBe('Connect Any CMS');
    expect(connect.getAttribute('href')).toBe('/dashboard/settings/integrations');
    expect(inCard('publish', 'skills.run')).toBeNull();
    expect(inCard('publish', 'skills.schedule')).toBeNull();
  });

  it('narrows the list by search and by filter chip', async () => {
    await render();
    // The owner's names (2026-11-02): Brand Visibility beside Product Visibility, and Technical.
    expect(all('[data-action="skills.filter"]').map((chip) => chip.textContent)).toEqual([
      'All',
      'Content',
      'Brand Visibility',
      'Product Visibility',
      'Technical',
      'Reports',
    ]);
    await click(container.querySelector<HTMLElement>('[data-filter="reports"]')!);
    expect(cards()).toEqual(['report']);
    await click(container.querySelector<HTMLElement>('[data-filter="all"]')!);
    const search = container.querySelector<HTMLInputElement>('[data-action="skills.search"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, '/win');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(cards()).toEqual(['winback']);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, 'nothing like it');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('No skills match.');
  });

  it('runs a skill in a new chat, schedules it from Chat Home’s box, and starts an agent on it', async () => {
    answer = (url) =>
      url === '/api/chat/runs'
        ? new Response('', { status: 200, headers: { 'x-chat-conversation': 'chat-1' } })
        : null;
    await render();
    await click(inCard('winback', 'skills.run')!);
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/chat/runs')!;
    expect(JSON.parse(String(init!.body))).toMatchObject({ message: '/winback', brandId: BRAND });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/chat-1');
    await click(inCard('report', 'skills.schedule')!);
    expect(nav.push).toHaveBeenLastCalledWith(
      `/dashboard/chat?${new URLSearchParams({ compose: 'Every Monday at 9:00, /report ' })}`,
    );
    expect(inCard('report', 'skills.createAgent')!.getAttribute('href')).toBe(
      '/dashboard/agents/new?skill=report',
    );
  });

  it('starts no run while the workspace is read-only or the demo brand is open: the plan opens', async () => {
    gate.isLocked = true;
    await render();
    await click(inCard('winback', 'skills.run')!);
    expect(gate.openUpgrade).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/chat/runs')).toBe(false);
  });

  it('opens the plan when the workspace is read-only, and says why a run didn’t start', async () => {
    answer = (url) =>
      url === '/api/chat/runs'
        ? Response.json({ code: 'subscription_inactive', error: 'Read-only' }, { status: 402 })
        : null;
    await render();
    await click(inCard('winback', 'skills.run')!);
    expect(gate.openUpgrade).toHaveBeenCalled();
    answer = (url) =>
      url === '/api/chat/runs'
        ? Response.json({ code: 'failed', error: 'Chat is busy.' }, { status: 503 })
        : null;
    await click(inCard('winback', 'skills.run')!);
    expect(toast.error).toHaveBeenCalledWith('Chat is busy.');
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('lets an Admin turn an GetCito skill on or off for the workspace; an off one doesn’t run', async () => {
    await render();
    expect(inCard('publish', 'skills.run')).toBeNull();
    expect(card('publish').textContent).toContain('Off');
    await click(inCard('winback', 'skills.toggle')!);
    const [url, init] = calls('PATCH')[0];
    expect(url).toBe('/api/chat/skills/library/winback');
    expect(JSON.parse(String(init!.body))).toEqual({ enabled: false });
    expect(toast.success).toHaveBeenCalledWith('/winback is off for the workspace.');
    // The list is read again.
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/chat/skills')).toHaveLength(2);
    // Not an Admin: no switch.
    list.can.manageLibrary = false;
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(inCard('winback', 'skills.toggle')).toBeNull();
  });

  it('shows My skills with where each came from and its review, and the plan’s limit', async () => {
    await render();
    await click(container.querySelector<HTMLElement>('[data-tab="mine"]')!);
    expect(cards()).toEqual(['board-update', 'copy-editing']);
    expect(container.textContent).toContain('2 of 10 in your plan');
    expect(card('board-update').textContent).toContain('Made in Chat by you');
    expect(card('board-update').textContent).toContain('Only you');
    expect(card('copy-editing').textContent).toContain('Waiting for review');
    expect(card('copy-editing').textContent).toContain('Imported from acme/skills on GitHub');
    // Not approved: no Run, no switch; its review opens from the card (W3-09).
    expect(inCard('copy-editing', 'skills.run')).toBeNull();
    expect(inCard('copy-editing', 'skills.toggle')).toBeNull();
    expect(inCard('copy-editing', 'skills.review')!.getAttribute('href')).toBe(
      '/dashboard/chat/skills/aaaaaaaa-0000-4000-8000-000000000002',
    );
    expect(inCard('board-update', 'skills.review')).toBeNull();
    expect(container.querySelector('[data-slot="update-available"]')).toBeNull();
    // No filter chips here: workspace skills have none.
    expect(container.querySelector('[data-action="skills.filter"]')).toBeNull();
  });

  it('marks an import whose source has a new version, and opens its update (W4-31)', async () => {
    const copy = list.skills.find((skill) => skill.name === 'copy-editing')!;
    Object.assign(copy, { status: 'approved', enabled: true, updateAvailable: true });
    await render();
    await click(container.querySelector<HTMLElement>('[data-tab="mine"]')!);
    expect(card('copy-editing').querySelector('[data-slot="update-available"]')!.textContent).toBe(
      'Update available',
    );
    expect(inCard('copy-editing', 'skills.reviewUpdate')!.getAttribute('href')).toBe(
      '/dashboard/chat/skills/aaaaaaaa-0000-4000-8000-000000000002/update',
    );
  });

  it('opens a skill’s details: Ask an Admin to share, and Delete after a second click', async () => {
    answer = (url, init) =>
      url.endsWith('/share') && init?.method === 'POST'
        ? Response.json({ ok: true, requested: true })
        : null;
    await render();
    await click(container.querySelector<HTMLElement>('[data-tab="mine"]')!);
    await click(inCard('board-update', 'skills.details')!);
    const dialog = () => document.querySelector<HTMLElement>('[data-slot="skill-details"]')!;
    expect(dialog().textContent).toContain('Made in Chat by you');
    await click(dialog().querySelector<HTMLElement>('[data-action="skills.share"]')!);
    expect(calls('POST').map(([url]) => url)).toEqual([
      '/api/chat/skills/aaaaaaaa-0000-4000-8000-000000000001/share',
    ]);
    expect(toast.success).toHaveBeenCalledWith('Asked your Admins to share it.');

    await click(inCard('board-update', 'skills.details')!);
    await click(dialog().querySelector<HTMLElement>('[data-action="skills.delete"]')!);
    expect(dialog().textContent).toContain('Delete /board-update?');
    expect(calls('DELETE')).toHaveLength(0);
    await click(dialog().querySelector<HTMLElement>('[data-action="skills.confirmDelete"]')!);
    expect(calls('DELETE').map(([url]) => url)).toEqual([
      '/api/chat/skills/aaaaaaaa-0000-4000-8000-000000000001',
    ]);
    expect(toast.success).toHaveBeenCalledWith('Deleted /board-update.');
  });

  it('shows a review’s notes in an import’s details, and offers no changes to someone else’s', async () => {
    await render();
    await click(container.querySelector<HTMLElement>('[data-tab="mine"]')!);
    await click(inCard('copy-editing', 'skills.details')!);
    const dialog = document.querySelector<HTMLElement>('[data-slot="skill-details"]')!;
    expect(dialog.textContent).toContain('What the review noted');
    expect(dialog.textContent).toContain('Links to an outside site');
    expect(dialog.textContent).toContain('MIT');
    expect(dialog.querySelector('[data-action="skills.share"]')).toBeNull();
    expect(dialog.querySelector('[data-action="skills.delete"]')).toBeNull();
  });

  it('imports a skill from New skill, then opens its review (W3-09)', async () => {
    answer = (url, init) =>
      url === '/api/chat/skills/import' && init?.method === 'POST'
        ? Response.json({ ok: true, skill: { id: 'new-1', name: 'launch-post', requested: false } })
        : null;
    await render();
    await click(container.querySelector<HTMLElement>('[data-action="skills.newSkill"]')!);
    const items = all('[role="menuitem"]', document.body);
    expect(items.map((item) => item.textContent)).toEqual([
      'Upload a SKILL.md or .zip',
      'Import from GitHub',
    ]);
    await click(items[1]);
    const dialog = document.querySelector<HTMLElement>('[data-slot="import-skill"]')!;
    expect(dialog.textContent).toContain('Import a skill from GitHub');
    const input = dialog.querySelector<HTMLInputElement>('[data-action="skills.importUrl"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'https://github.com/acme/skills/tree/main/launch-post',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(dialog.querySelector<HTMLElement>('[data-action="skills.importSubmit"]')!);
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/skills/new-1');
  });

  it('offers New skill only to those who may save skills', async () => {
    list.can.save = false;
    await render();
    expect(container.querySelector('[data-action="skills.newSkill"]')).toBeNull();
  });

  it('says when the list can’t be read, and reads it again on Retry', async () => {
    answer = (url) =>
      url === '/api/chat/skills' ? Response.json({ ok: false }, { status: 500 }) : null;
    await render();
    expect(container.textContent).toContain("Skills couldn't be loaded.");
    answer = () => null;
    await click(container.querySelector<HTMLElement>('[data-action="skills.retry"]')!);
    expect(cards()).toEqual(['winback', 'report', 'publish']);
  });
});
