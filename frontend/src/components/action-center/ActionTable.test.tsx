import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ActionItem } from '@/lib/actions/actionCenter';
import { ActionTable } from './ActionTable';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { ChatPanelContext, type ChatPanelState } from '@/components/chat/panel/chatPanelContext';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const action: ActionItem = {
  id: 'a1',
  actionNo: 7,
  category: 'recover',
  kind: 'recover_lost_citations',
  impact: 'high',
  priorityScore: 72,
  priorityLevel: 'high',
  priorityReason: null,
  status: 'in_progress',
  payload: {},
  kpiKeys: [],
  assignee: null,
  dueDate: null,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  taskTotal: 0,
  taskCompleted: 0,
  signalCount: 1,
};

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();
const onStatusChange = vi.fn();
const onDelete = vi.fn();
const openUpgrade = vi.fn();

function render(props: Partial<React.ComponentProps<typeof ActionTable>> = {}, isLocked = false) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ActionTable
            actions={[action]}
            onSelect={onSelect}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
            canDelete
            {...props}
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

async function openMenu() {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

const disabled = (item: HTMLElement) =>
  item.hasAttribute('data-disabled') || item.getAttribute('aria-disabled') === 'true';

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('a stale action (00432)', () => {
  const stale: ActionItem = { ...action, status: 'new', staleAt: '2026-10-31T03:00:00.000Z' };
  const onKeep = vi.fn();

  it('shows Stale beside New, and offers Still relevant in its menu', async () => {
    render({ actions: [stale], onKeep });
    expect(container.textContent).toContain('NewStale');
    const items = await openMenu();
    expect(items.map((item) => item.textContent)).toEqual([
      'In Progress',
      'Completed',
      'Dismiss',
      'Still relevant',
      'Delete',
    ]);
    await act(async () => items[3].click());
    expect(onKeep).toHaveBeenCalledWith(stale);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is neither once it left New, nor without the stamp', async () => {
    render({ actions: [{ ...stale, status: 'on_hold' }], onKeep });
    expect(container.textContent).not.toContain('Stale');
    expect((await openMenu()).map((item) => item.textContent)).not.toContain('Still relevant');
  });

  it('keeps nothing on a read-only workspace: the upgrade dialog instead', async () => {
    render({ actions: [stale], onKeep }, true);
    await act(async () => (await openMenu())[3].click());
    expect(onKeep).not.toHaveBeenCalled();
    expect(openUpgrade).toHaveBeenCalled();
  });
});

describe('ActionTable row menu', () => {
  it('offers In Progress, Completed, Dismiss and Delete, the current status off', async () => {
    render();
    const items = await openMenu();
    expect(items.map((item) => item.textContent)).toEqual([
      'In Progress',
      'Completed',
      'Dismiss',
      'Delete',
    ]);
    expect(items.map(disabled)).toEqual([true, false, false, false]);
  });

  it('changes the status from the list, without opening the drawer', async () => {
    render();
    const items = await openMenu();
    await act(async () => items[1].click());
    expect(onStatusChange).toHaveBeenCalledWith(action, 'completed');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('asks why before dismissing, and dismisses with the reason, or none (learning A5)', async () => {
    render();
    let items = await openMenu();
    await act(async () => items[2].click());
    expect(onStatusChange).not.toHaveBeenCalled();
    const dialog = () => document.querySelector('[role="dialog"]')!;
    expect(dialog().textContent).toContain('Why dismiss it?');
    const choice = (label: string) =>
      [...dialog().querySelectorAll('button')].find((b) => b.textContent?.startsWith(label))!;
    await act(async () => choice("It's already done").click());
    expect(onStatusChange).toHaveBeenCalledWith(action, 'dismissed', 'already_done');

    onStatusChange.mockClear();
    items = await openMenu();
    await act(async () => items[2].click());
    await act(async () => choice('Dismiss without saying why').click());
    expect(onStatusChange).toHaveBeenCalledWith(action, 'dismissed', null);
  });

  it('asks before deleting, and deletes on Delete', async () => {
    render();
    const items = await openMenu();
    await act(async () => items[3].click());
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Delete this action?');
    const confirm = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Delete',
    )!;
    await act(async () => confirm.click());
    expect(onDelete).toHaveBeenCalledWith(action);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('changes and deletes nothing on a read-only workspace: the upgrade dialog instead', async () => {
    render({}, true);
    await act(async () => (await openMenu())[1].click());
    expect(openUpgrade).toHaveBeenLastCalledWith("Changing an action's status needs a plan");
    await act(async () => (await openMenu())[3].click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Deleting actions needs a plan');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("keeps Delete off for members who can't delete", async () => {
    render({ canDelete: false });
    const items = await openMenu();
    expect(disabled(items[3])).toBe(true);
  });

  it('waits while a change to the row is in flight, and has no menu without handlers', () => {
    render({ busyIds: new Set(['a1']) });
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]')!.disabled,
    ).toBe(true);
    render({ onStatusChange: undefined, onDelete: undefined });
    expect(container.querySelector('button[aria-label^="Actions for"]')).toBeNull();
  });
});

// New GetCito (AC-ALT2): no one assigned means the whole workspace's.
describe('ActionTable assignee', () => {
  const assigneeCell = () => container.querySelectorAll('tbody tr td')[3];

  it('counts what is left, and says what was removed since (AC-009)', () => {
    render({
      actions: [
        {
          ...action,
          // As getActions reads it: 13 prompts when created, one deleted since.
          payload: {
            targetEntity: 'prompts',
            targetCount: 12,
            createdTargetCount: 13,
            removedCount: 1,
            removedLabels: ['best crm for agents'],
          },
        },
      ],
    });
    const row = container.querySelector('tbody tr')!;
    expect(row.textContent).toContain('12 prompts');
    // A button, so focus shows the names as hover does; a click stays on it.
    const note = [...row.querySelectorAll<HTMLButtonElement>('button')].find((el) =>
      el.textContent?.includes('removed since'),
    )!;
    expect(note.textContent).toBe('(1 prompt removed since this action was created)');
    act(() => note.click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows an action with no one on it as Everyone', () => {
    render();
    expect(assigneeCell().textContent).toBe('Everyone');
    expect(assigneeCell().querySelector('[title]')?.getAttribute('title')).toBe(
      'Everyone in the workspace: no one is assigned yet',
    );
  });

  it("shows an assigned member's initials", () => {
    render({
      actions: [
        { ...action, assignee: { id: 'u1', fullName: 'Ayse Kaya', email: null, avatarUrl: null } },
      ],
    });
    expect(assigneeCell().textContent).toBe('AK');
  });
});

describe('ActionTable and Chat’s side panel (W1-08)', () => {
  it('asks about a task from its row, without opening the task', () => {
    const ask = vi.fn();
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ChatPanelContext.Provider value={{ available: true, ask } as unknown as ChatPanelState}>
            <ActionTable actions={[action]} onSelect={onSelect} />
          </ChatPanelContext.Provider>
        </NextIntlClientProvider>,
      );
    });
    const icon = container.querySelector<HTMLButtonElement>('[data-action="page.askAboutThis"]')!;
    act(() => icon.click());
    expect(ask).toHaveBeenCalledExactlyOnceWith({
      type: 'task',
      id: 'a1',
      label: expect.any(String),
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('has no Ask about this without the panel', () => {
    render();
    expect(container.querySelector('[data-action="page.askAboutThis"]')).toBeNull();
  });
});
