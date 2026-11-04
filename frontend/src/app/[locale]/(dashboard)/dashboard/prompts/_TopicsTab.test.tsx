import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * The Topics tab's buttons sit where the Prompts tab's do: beside the tabs,
 * in the same order and size — Add Topic, Export CSV, Manage topics.
 */

let canManage = true;
// The workspace's plan: active unless a test says it's read-only.
let isLocked = false;
const openUpgrade = vi.fn();
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ canManage }) }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (select: (state: unknown) => unknown) =>
    select({ activeBrandId: 'b1', brands: [{ id: 'b1', slug: 'acme' }] }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));
// The leaderboard's rows: none unless a test gives some.
let topicRows: Record<string, unknown>[] = [];
const getTopicsOverview = vi.fn(async () => ({ topics: topicRows, unassignedPromptCount: 0 }));
const getPromptCountByTopic = vi.fn(async () => 3);
const deleteTopic = vi.fn(async () => undefined);
vi.mock('@/lib/actions/topic', () => ({
  getTopicsOverview,
  getPromptCountByTopic,
  deleteTopic,
  createTopic: vi.fn(),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('./_TopicSuggestionsCard', () => ({ TopicSuggestionsCard: () => null }));

const { TopicsTab } = await import('./_TopicsTab');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let slot: HTMLDivElement;
let root: Root;

beforeEach(() => {
  canManage = true;
  isLocked = false;
  topicRows = [];
  openUpgrade.mockClear();
  getTopicsOverview.mockClear();
  getPromptCountByTopic.mockClear();
  deleteTopic.mockClear();
  toast.mockClear();
  container = document.createElement('div');
  slot = document.createElement('div');
  document.body.append(slot, container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  container.remove();
  slot.remove();
});

async function render(addTopic: { openAddTopic?: boolean; onAddTopicOpened?: () => void } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <TopicsTab
            actionsSlot={slot}
            range={{ from: '2026-10-11T00:00:00.000Z', days: 7 }}
            rangePreset="7d"
            customFrom=""
            customTo=""
            {...addTopic}
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const labels = (el: Element) =>
  [...el.querySelectorAll('a, button')].map((b) => b.textContent?.trim());

describe('TopicsTab buttons', () => {
  it('go beside the tabs as Add Topic, Export CSV, Manage topics', async () => {
    await render();
    expect(labels(slot)).toEqual(['Add Topic', 'Export CSV', 'Manage topics']);
    expect(slot.querySelector('a')!.getAttribute('href')).toBe('/dashboard/brands/b1/topics');
    // Not a second copy in the tab's own content.
    expect(labels(container)).not.toContain('Manage topics');
  });

  it("leave Add Topic out for members who can't manage", async () => {
    canManage = false;
    await render();
    expect(labels(slot)).toEqual(['Export CSV', 'Manage topics']);
  });
});

describe('Add Topic on a read-only workspace (plan not active)', () => {
  const addTopic = () =>
    [...slot.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Add Topic',
    )!;
  const dialog = () => document.querySelector('[role="dialog"]');

  it('opens the upgrade dialog instead of the Add Topic form', async () => {
    isLocked = true;
    await render();
    await act(async () => addTopic().click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Adding topics needs a plan');
    expect(dialog()).toBeNull();
  });

  it('opens the Add Topic form on an active plan', async () => {
    await render();
    await act(async () => addTopic().click());
    expect(openUpgrade).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Add Topic');
  });
});

/**
 * "Add a topic" from a prompt flow on a brand without topics links here with
 * ?new=1: Add Topic opens once, and the link's param is cleared so a reload
 * doesn't open it again.
 */
describe('Add Topic opened by a link (?new=1)', () => {
  const dialog = () => document.querySelector('[role="dialog"]');

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('opens the Add Topic form and clears the param', async () => {
    window.history.replaceState(null, '', '/dashboard/prompts/topics?new=1&range=30d');
    await render();
    expect(dialog()?.textContent).toContain('Add Topic');
    expect(window.location.search).toBe('?range=30d');
  });

  it('opens nothing without the param', async () => {
    window.history.replaceState(null, '', '/dashboard/prompts/topics');
    await render();
    expect(dialog()).toBeNull();
  });

  it("opens nothing for members who can't add topics", async () => {
    canManage = false;
    window.history.replaceState(null, '', '/dashboard/prompts/topics?new=1');
    await render();
    expect(dialog()).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('opens the upgrade dialog instead on a read-only workspace', async () => {
    isLocked = true;
    window.history.replaceState(null, '', '/dashboard/prompts/topics?new=1');
    await render();
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Adding topics needs a plan');
    expect(dialog()).toBeNull();
  });
});

/**
 * The Prompts page asks for Add Topic from one of its own tabs (Add prompt,
 * Suggestions, Query Fan-out on a brand without topics): it opens once, and
 * the request is handed back.
 */
describe('Add Topic asked for by the Prompts page', () => {
  const dialog = () => document.querySelector('[role="dialog"]');

  it('opens the Add Topic form and hands the request back', async () => {
    const onAddTopicOpened = vi.fn();
    await render({ openAddTopic: true, onAddTopicOpened });
    expect(dialog()?.textContent).toContain('Add Topic');
    expect(onAddTopicOpened).toHaveBeenCalledTimes(1);
  });

  it('opens nothing unless asked', async () => {
    await render({ openAddTopic: false });
    expect(dialog()).toBeNull();
  });

  it("hands the request back without opening it for members who can't add topics", async () => {
    canManage = false;
    const onAddTopicOpened = vi.fn();
    await render({ openAddTopic: true, onAddTopicOpened });
    expect(dialog()).toBeNull();
    expect(onAddTopicOpened).toHaveBeenCalledTimes(1);
  });
});

describe('Delete topic in a row\'s "…" menu', () => {
  // Two active prompts; with a paused one, the topic holds three.
  const ESPRESSO = {
    id: 't1',
    name: 'Espresso',
    promptCount: 2,
    visibilityRate: 50,
    visiblePrompts: 1,
    activePrompts: 2,
    visibilityChange: null,
    totalMentions: 3,
    totalCitations: 1,
    shareOfVoice: 20,
    topCompetitor: null,
    lastRunAt: null,
    trendSparkline: [],
  };
  const trigger = () => container.querySelector<HTMLElement>('[aria-label="Actions for Espresso"]');
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const button = (root: Element | null, text: string) =>
    [...(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (b) => b.textContent?.trim() === text,
    )!;

  /** Opens the row's menu and picks Delete topic. */
  async function pickDelete() {
    await act(async () => trigger()!.click());
    const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === 'Delete topic',
    )!;
    await act(async () => item.click());
  }

  /** Confirms in the dialog, with the Undo window's timer faked. */
  async function confirm() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => button(dialog(), 'Delete topic').click());
  }

  beforeEach(() => {
    topicRows = [ESPRESSO];
  });

  it("isn't shown to members who can't manage topics", async () => {
    canManage = false;
    await render();
    expect(container.textContent).toContain('Espresso');
    expect(trigger()).toBeNull();
  });

  it('asks first, with every prompt in the topic counted, paused ones too', async () => {
    await render();
    await pickDelete();
    expect(getPromptCountByTopic).toHaveBeenCalledExactlyOnceWith('b1', 't1');
    expect(dialog()?.textContent).toContain('Delete the topic "Espresso"?');
    expect(dialog()?.textContent).toContain(
      "3 prompts are in this topic. They aren't deleted: they keep their tracking and results, and move to prompts without a topic. You can undo for 10 seconds.",
    );
    expect(deleteTopic).not.toHaveBeenCalled();
  });

  it('hides the topic at once and deletes it after the 10-second Undo window', async () => {
    await render();
    await pickDelete();
    await confirm();
    expect(trigger()).toBeNull();
    expect(toast).toHaveBeenCalledExactlyOnceWith('Topic deleted', {
      description: 'Espresso',
      duration: 10_000,
      action: { label: 'Undo', onClick: expect.any(Function) },
    });
    expect(deleteTopic).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(10_000));
    expect(deleteTopic).toHaveBeenCalledExactlyOnceWith('t1');
    // Read again: its prompts now count as prompts without a topic.
    expect(getTopicsOverview).toHaveBeenCalledTimes(2);
  });

  it('puts the topic back on Undo and deletes nothing', async () => {
    await render();
    await pickDelete();
    await confirm();
    await act(async () => toast.mock.calls[0][1].action.onClick());
    expect(trigger()).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(deleteTopic).not.toHaveBeenCalled();
  });

  it('still deletes the topic when the tab closes inside the window', async () => {
    await render();
    await pickDelete();
    await confirm();
    act(() => root.unmount());
    expect(deleteTopic).toHaveBeenCalledExactlyOnceWith('t1');
  });

  it('brings the topic back with an error when the delete fails', async () => {
    deleteTopic.mockRejectedValueOnce(new Error('Only an admin or a manager can delete topics.'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    await pickDelete();
    await confirm();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(trigger()).not.toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      'Couldn\'t delete "Espresso", so it\'s back in the list.',
    );
    quiet.mockRestore();
  });

  it('opens the upgrade dialog instead on a read-only workspace (plan not active)', async () => {
    isLocked = true;
    await render();
    await pickDelete();
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Deleting topics needs a plan');
    expect(dialog()).toBeNull();
    expect(getPromptCountByTopic).not.toHaveBeenCalled();
  });
});
