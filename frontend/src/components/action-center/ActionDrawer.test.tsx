import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionItem } from '@/lib/actions/actionCenter';
import type { Signal } from '@/lib/signals/map';
import { parseTaskDetails } from '@/lib/action-center/taskDetails';
import { promptVolumeEstimate } from '@/lib/volumeEstimate';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * Status, assignee and due date sit right under the drawer's header, ahead of
 * the tabs, rather than in a footer below the content: they are what someone
 * opening an action checks and changes first.
 */

const server = vi.hoisted(() => ({
  addTask: vi.fn(),
  assignAction: vi.fn(),
  deleteTask: vi.fn(),
  getActionDetail: vi.fn(),
  getPromptDemand: vi.fn(),
  setActionDueDate: vi.fn(),
  updateActionStatus: vi.fn(),
  updateTaskStatus: vi.fn(),
  updateTaskTitle: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
const push = vi.hoisted(() => vi.fn());
const drafts = vi.hoisted(() => ({ getActionDrafts: vi.fn(), startDraftFromAction: vi.fn() }));
const taskCheck = vi.hoisted(() => ({ checkActionTask: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/actions/actionCenter', () => server);
vi.mock('@/lib/actions/contentDrafts', () => drafts);
vi.mock('@/lib/actions/actionTaskCheck', () => taskCheck);
vi.mock('sonner', () => ({ toast }));

const { ActionDrawer } = await import('./ActionDrawer');

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
  dueDate: '2026-11-01',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  taskTotal: 0,
  taskCompleted: 0,
  signalCount: 1,
};

let container: HTMLDivElement;
let root: Root;
const onChanged = vi.fn();
const onPatched = vi.fn();
const openUpgrade = vi.fn();

const emptyDetail = { tasks: [], signals: [], events: [], kpis: [], positionOutcome: null };

beforeEach(() => {
  vi.clearAllMocks();
  server.getActionDetail.mockResolvedValue(emptyDetail);
  drafts.getActionDrafts.mockResolvedValue([]);
  for (const fn of [server.addTask, server.setActionDueDate]) fn.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderDrawer(shown: ActionItem = action, isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ActionDrawer
            brandId="b1"
            action={shown}
            members={[]}
            onOpenChange={() => {}}
            onChanged={onChanged}
            onPatched={onPatched}
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

/** True when `a` comes before `b` in the document. */
const before = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('ActionDrawer', () => {
  it('puts status, assignee and due date under the header, ahead of the tabs', async () => {
    await renderDrawer();
    const drawer = document.body.querySelector('[role="dialog"]')!;
    const labels = [...drawer.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toEqual(['Status', 'Assignee', 'Due date']);

    const tabs = drawer.querySelector('nav')!;
    for (const label of drawer.querySelectorAll('label')) {
      expect(before(label, tabs)).toBe(true);
    }
    // Each field once (no second copy below the content), named by its label.
    for (const label of drawer.querySelectorAll('label')) {
      const control = drawer.querySelectorAll(`#${label.htmlFor}`);
      expect(control).toHaveLength(1);
    }
    expect(drawer.querySelector<HTMLInputElement>('#action-drawer-due-date')!.value).toBe(
      '2026-11-01',
    );
  });

  it('names the action’s number in the top row, its full label kept for hover and screen readers (W2-17)', async () => {
    await renderDrawer();
    const drawer = document.body.querySelector('[role="dialog"]')!;
    const id = drawer.querySelector<HTMLElement>('[title^="Action ID"]')!;
    expect(id.title).toBe(`Action ID: AC-${action.actionNo}`);
    expect(id.textContent).toBe(`Action ID: AC-${action.actionNo}`);
    // Only the label gives way, and only beside Run agent.
    const label = id.firstElementChild as HTMLElement;
    expect(label.textContent).toBe('Action ID: ');
    expect(label.className).toBe('group-has-[[data-run-agent]]/top:sr-only');
    expect(id.closest('.group\\/top')).not.toBeNull();
  });

  it("gives the Why the demand of a signal's prompt the action didn't keep", async () => {
    const lost = (id: string, promptId: string, promptText: string) =>
      ({
        id,
        category: 'citation',
        kind: 'lost_citations',
        impact: 'high',
        status: 'new',
        source: ['ai_results'],
        detectedAt: '2026-10-09T00:00:00Z',
        lastDetectedAt: '2026-10-09T00:00:00Z',
        resolvedAt: null,
        previousValue: null,
        currentValue: null,
        changeValue: null,
        payload: { promptId, promptText },
        kpiKeys: [],
        actionId: 'a1',
        where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
      }) as Signal;
    const estimate = promptVolumeEstimate({
      estAiVolume: 5500,
      googleVolumes: { a: 10_000, b: 12_200, c: 14_000 },
      aiVolumeMultiplier: 0.45,
      keywords: ['a', 'b', 'c'],
      fetchedAt: new Date().toISOString(),
    });
    server.getActionDetail.mockResolvedValue({
      ...emptyDetail,
      // p2 is named by a signal the nightly pass added, never kept by the action.
      signals: [
        lost('s1', 'p1', 'Best coffee subscription?'),
        lost('s2', 'p2', 'Coffee delivery near me'),
      ],
      entities: [
        { type: 'prompts', key: 'p1', label: 'Best coffee subscription?', removed: false },
      ],
    });
    server.getPromptDemand.mockResolvedValue({ p1: estimate, p2: estimate });

    await renderDrawer({ ...action, payload: { targetEntity: 'prompts', targetCount: 1 } });

    expect(server.getPromptDemand).toHaveBeenCalledWith('b1', ['p1', 'p2']);
    // Both prompts' demand, not the kept one's alone (4.1–6.9k).
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain(
      '2 prompts (8.2–13.8k AI searches a month, estimated)',
    );
  });

  describe('changes', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const dueDate = () => document.querySelector<HTMLInputElement>('#action-drawer-due-date')!;
    /** What the browser does as a date is picked or typed into the field. */
    const enter = (value: string) =>
      act(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        set.call(dueDate(), value);
        dueDate().dispatchEvent(new Event('input', { bubbles: true }));
      });
    const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(800)));

    it('shows a due date at once and saves only the one it settles on', async () => {
      await renderDrawer();
      // Typing 18 passes through the 1st.
      enter('2026-11-01');
      enter('2026-11-18');
      expect(dueDate().value).toBe('2026-11-18');
      expect(server.setActionDueDate).not.toHaveBeenCalled();

      await settle();
      expect(server.setActionDueDate).toHaveBeenCalledTimes(1);
      expect(server.setActionDueDate).toHaveBeenCalledWith('b1', 'a1', '2026-11-18');
      expect(onPatched).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ dueDate: '2026-11-18' }),
      );
      // The list isn't read again; the detail is, for its History.
      expect(onChanged).not.toHaveBeenCalled();
      expect(server.getActionDetail).toHaveBeenCalledTimes(2);
    });

    it("doesn't save a year still being typed, and puts the saved date back on leaving", async () => {
      await renderDrawer();
      enter('0002-11-01');
      await settle();
      expect(server.setActionDueDate).not.toHaveBeenCalled();

      act(() => dueDate().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
      expect(dueDate().value).toBe('2026-11-01');
      expect(server.setActionDueDate).not.toHaveBeenCalled();
    });

    it('saves on leaving the field, and a cleared date as none', async () => {
      await renderDrawer();
      enter('2026-12-05');
      await act(async () => dueDate().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
      expect(server.setActionDueDate).toHaveBeenCalledWith('b1', 'a1', '2026-12-05');

      enter('');
      await settle();
      expect(server.setActionDueDate).toHaveBeenLastCalledWith('b1', 'a1', null);
      expect(server.setActionDueDate).toHaveBeenCalledTimes(2);
    });

    it('says so when a save fails, and reads the list again', async () => {
      server.setActionDueDate.mockRejectedValueOnce(new Error('offline'));
      await renderDrawer();
      enter('2026-12-05');
      await settle();
      expect(toast.error).toHaveBeenCalledWith("Couldn't update the action.");
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('changes nothing on a read-only workspace: the due date and Add task open the upgrade dialog', async () => {
      await renderDrawer(action, true);
      enter('2026-11-18');
      expect(openUpgrade).toHaveBeenLastCalledWith('Setting a due date needs a plan');
      expect(dueDate().value).toBe('2026-11-01');
      await settle();
      expect(server.setActionDueDate).not.toHaveBeenCalled();

      const button = (name: string) =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === name || b.textContent?.startsWith(`${name} (`),
        )!;
      await act(async () => button('Tasks').click());
      await act(async () => button('Add task').click());
      expect(openUpgrade).toHaveBeenLastCalledWith('Adding tasks needs a plan');
      expect(document.querySelector('input[aria-label="Add task"]')).toBeNull();
      expect(server.addTask).not.toHaveBeenCalled();
    });

    it("passes a new task's count to the list without reading it again", async () => {
      await renderDrawer();
      const button = (name: string) =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === name || b.textContent?.startsWith(`${name} (`),
        )!;
      await act(async () => button('Tasks').click());
      await act(async () => button('Add task').click());
      const field = document.querySelector<HTMLInputElement>('input[aria-label="Add task"]')!;
      act(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        set.call(field, 'Refresh /pricing');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      server.getActionDetail.mockResolvedValueOnce({
        ...emptyDetail,
        tasks: [
          { id: 't1', position: 1, status: 'completed' },
          { id: 't2', position: 2, status: 'skipped' },
          { id: 't3', position: 3, status: 'todo' },
        ],
      });
      await act(async () => button('Add').click());

      expect(server.addTask).toHaveBeenCalledWith('b1', 'a1', 'Refresh /pricing');
      // Skipped work leaves the count, as in the list.
      expect(onPatched).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ taskTotal: 2, taskCompleted: 1 }),
      );
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  /** What Chat attached and where it came from (CHAT-09 §D–E). */
  describe('from Chat', () => {
    const button = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === name || b.textContent?.startsWith(`${name} (`),
      )!;
    const attached = (fileId: string) => ({
      fileId,
      title: `File ${fileId}`,
      type: 'document',
      attachedAt: '2026-10-30T09:00:00Z',
      attachedBy: 'Alex',
      href: `/api/chat/files/${fileId}`,
      draft: false,
    });

    it('names how many files Chat attached to a task, for a screen reader too', async () => {
      server.getActionDetail.mockResolvedValue({
        ...emptyDetail,
        tasks: [
          {
            id: 't1',
            position: 1,
            status: 'todo',
            taskKey: null,
            title: 'Add a FAQ to /pricing',
            titleParams: {},
            dependsOn: [],
            details: null,
            attachments: [attached('f1'), attached('f2')],
          },
        ],
      });
      await renderDrawer();
      await act(async () => button('Tasks').click());
      const clip = document.body.querySelector('[role="img"]')!;
      expect(clip.getAttribute('aria-label')).toBe('2 files attached from Chat');
      expect(clip.textContent).toBe('2');
    });

    it('links its chat only for a reader who may open it', async () => {
      const sent = {
        ...action,
        kind: 'chat_finding',
        payload: {
          source: 'chat',
          title: 'Win back /pricing',
          why: 'Lost 6 citations.',
          conversationId: 'c1',
          entities: { pages: ['https://acme.example/pricing'], platforms: ['google-aio'] },
        },
      } as ActionItem;
      server.getActionDetail.mockResolvedValue({ ...emptyDetail, chatHref: null });
      await renderDrawer(sent);
      const dialog = () => document.body.querySelector('[role="dialog"]')!;
      expect(dialog().textContent).toContain('Chat');
      expect(dialog().textContent).toContain('Google AI Overviews');
      expect(dialog().textContent).not.toContain('Open the chat');
      server.getActionDetail.mockResolvedValue({ ...emptyDetail, chatHref: '/dashboard/chat/c1' });
      act(() => root.unmount());
      root = createRoot(container);
      await renderDrawer(sent);
      const link = [...dialog().querySelectorAll('a')].find(
        (a) => a.textContent === 'Open the chat',
      );
      expect(link?.getAttribute('href')).toBe('/dashboard/chat/c1');
    });
  });

  describe('How we check (AC-010)', () => {
    const lastCheck = { at: '2026-10-20T00:00:00Z', passed: false, missing: ['not_changed'] };
    const task = (taskKey: string, title: string) => ({
      id: 't1',
      position: 1,
      status: 'todo',
      taskKey,
      title,
      titleParams: {},
      dependsOn: [],
      details: parseTaskDetails({
        url: 'https://acme.example/pricing',
        check: 'auto',
        autoCheck: lastCheck,
      }),
    });
    const open = async (taskKey: string, title: string) => {
      server.getActionDetail.mockResolvedValue({ ...emptyDetail, tasks: [task(taskKey, title)] });
      await renderDrawer();
      const button = (name: string) =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === name || b.textContent?.startsWith(`${name} (`),
        )!;
      await act(async () => button('Tasks').click());
      await act(async () => button(`1. ${title}`).click());
      return document.body.querySelector('[role="dialog"]')!.textContent ?? '';
    };

    it('shows a call-to-action task planned as Automatic as Manual, with no automatic check', async () => {
      const text = await open('improve_cta_path', 'Tighten the call to action');
      expect(text).toContain('Manual: you confirm it');
      expect(text).toContain('The call to action is live on the page: you confirm it');
      expect(text).not.toContain('Automatic: we fetch the page again');
      expect(text).not.toContain('Last check');
      expect(text).not.toContain('Check now');
    });

    it('still shows a page-checked task’s automatic check, its last one and Check now', async () => {
      const text = await open('refresh_content', 'Refresh the page');
      expect(text).toContain('Automatic: we fetch the page again');
      expect(text).toContain('Last check');
      expect(text).toContain('Check now');
    });
  });

  describe('writing tasks (CE-022)', () => {
    const PRICING = 'https://acme.example/pricing';
    const FEATURES = 'https://acme.example/features';
    const task = (id: string, taskKey: string, title: string) => ({
      id,
      position: 1,
      status: 'todo',
      taskKey,
      title,
      titleParams: {},
      dependsOn: [],
      details: null,
    });
    const button = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === name || b.textContent?.startsWith(`${name} (`),
      );
    const openTask = async (title: string) => {
      await act(async () => button('Tasks')!.click());
      await act(async () => button(`1. ${title}`)!.click());
    };

    it('opens the Content Editor on a draft for the page the action names', async () => {
      server.getActionDetail.mockResolvedValue({
        ...emptyDetail,
        tasks: [task('t1', 'optimize_content', 'Optimize the page')],
      });
      drafts.startDraftFromAction.mockResolvedValue({
        draftId: 'd-new',
        created: true,
        importFailed: false,
      });
      await renderDrawer({ ...action, payload: { pages: [PRICING] } });
      await openTask('Optimize the page');

      await act(async () => button('Optimize page')!.click());
      expect(drafts.startDraftFromAction).toHaveBeenCalledWith('b1', 'a1', 't1', {
        page: PRICING,
        title: expect.any(String),
      });
      expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d-new');
    });

    it('starts no draft on a read-only workspace: Optimize page opens the upgrade dialog', async () => {
      server.getActionDetail.mockResolvedValue({
        ...emptyDetail,
        tasks: [task('t1', 'optimize_content', 'Optimize the page')],
      });
      await renderDrawer({ ...action, payload: { pages: [PRICING] } }, true);
      await openTask('Optimize the page');
      await act(async () => button('Optimize page')!.click());
      expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Optimizing content needs a plan');
      expect(drafts.startDraftFromAction).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    });

    it('opens the draft already written, and lists each page when the action names several', async () => {
      server.getActionDetail.mockResolvedValue({
        ...emptyDetail,
        tasks: [task('t1', 'refresh_content', 'Refresh the pages')],
      });
      drafts.getActionDrafts.mockResolvedValue([
        { id: 'd-pricing', method: 'optimize', sourceUrl: PRICING, status: 'draft' },
      ]);
      await renderDrawer({ ...action, payload: { pages: [PRICING, FEATURES] } });
      await openTask('Refresh the pages');

      expect(drafts.getActionDrafts).toHaveBeenCalledWith('b1', 'a1');
      const rows = [...document.querySelectorAll('li')].filter((li) =>
        li.textContent?.startsWith('/'),
      );
      expect(rows.map((li) => li.textContent)).toEqual(['/pricingOpen draft', '/featuresOptimize']);
      expect(rows[0].querySelector('a')!.getAttribute('href')).toBe(
        '/dashboard/content/editor/d-pricing',
      );
      await act(async () => rows[1].querySelector('button')!.click());
      expect(drafts.startDraftFromAction).toHaveBeenCalledWith(
        'b1',
        'a1',
        't1',
        expect.objectContaining({ page: FEATURES }),
      );
    });

    it('starts a new page without one, and says so when it can’t', async () => {
      server.getActionDetail.mockResolvedValue({
        ...emptyDetail,
        tasks: [
          task('t1', 'create_content_draft', 'Write the draft'),
          task('t2', 'create_content_brief', 'Write the brief'),
        ],
      });
      drafts.startDraftFromAction.mockResolvedValue({ error: 'failed' });
      await renderDrawer({ ...action, payload: { pages: [PRICING] } });
      await openTask('Write the draft');

      await act(async () => button('Create content')!.click());
      expect(drafts.startDraftFromAction).toHaveBeenCalledWith(
        'b1',
        'a1',
        't1',
        expect.objectContaining({ page: null }),
      );
      expect(toast.error).toHaveBeenCalledWith("Couldn't open the Content Editor. Try again.");
      expect(push).not.toHaveBeenCalled();
      // Only the writing task has one.
      await act(async () => button('1. Write the brief')!.click());
      expect(
        [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Create content'),
      ).toHaveLength(1);
    });
  });
});

describe('ActionDrawer Check now (AC-010)', () => {
  const checked = {
    id: 't1',
    position: 1,
    status: 'todo',
    taskKey: null,
    title: 'Let AI crawlers in',
    titleParams: {},
    dependsOn: [],
    // A written task is checked on its page when it carries its change (#1683).
    details: parseTaskDetails({
      url: 'https://acme.example/pricing',
      check: 'auto',
      change: { before: 'Disallow: /', after: 'Allow: /' },
    }),
  };
  const button = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === name || b.textContent?.startsWith(`${name} (`),
    );
  const openTask = async () => {
    await act(async () => button('Tasks')!.click());
    await act(async () => button('1. Let AI crawlers in')!.click());
  };

  it('checks a task on its page now', async () => {
    server.getActionDetail.mockResolvedValue({ ...emptyDetail, tasks: [checked] });
    taskCheck.checkActionTask.mockResolvedValue({
      checked: { at: '2026-10-27T12:00:00Z', passed: true, missing: [] },
      reason: null,
    });
    await renderDrawer();
    await openTask();
    await act(async () => button('Check now')!.click());
    expect(taskCheck.checkActionTask).toHaveBeenCalledExactlyOnceWith('t1');
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('checks nothing on a read-only workspace: Check now opens the upgrade dialog', async () => {
    server.getActionDetail.mockResolvedValue({ ...emptyDetail, tasks: [checked] });
    await renderDrawer(action, true);
    await openTask();
    await act(async () => button('Check now')!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Checking a task needs a plan');
    expect(taskCheck.checkActionTask).not.toHaveBeenCalled();
  });
});
