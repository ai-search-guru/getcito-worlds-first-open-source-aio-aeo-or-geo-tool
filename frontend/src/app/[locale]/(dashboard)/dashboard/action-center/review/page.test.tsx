import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import { parseTaskDetails } from '@/lib/action-center/taskDetails';
import type { TaskReview } from '@/lib/actions/actionTaskReviews';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * Needs review (AC-010): an admin or a manager fills what an agent's task
 * misses and approves it onto its action, or dismisses it.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: { getActiveBrand: () => { id: string } }) => unknown) =>
    selector({ getActiveBrand: () => ({ id: 'b1' }) }),
}));
let canManage = true;
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ role: canManage ? 'manager' : 'analyst', canManage, canAdmin: false }),
}));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/action-center/ActionCenterTabs', () => ({
  ActionCenterTabs: () => null,
}));
const { getTaskReviews, approveTaskReview, dismissTaskReview } = vi.hoisted(() => ({
  getTaskReviews: vi.fn(),
  approveTaskReview: vi.fn(),
  dismissTaskReview: vi.fn(),
}));
vi.mock('@/lib/actions/actionTaskReviews', () => ({
  getTaskReviews,
  approveTaskReview,
  dismissTaskReview,
}));
const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast }));

import ActionCenterReviewPage from './page';

const review: TaskReview = {
  id: 'r1',
  actionId: 'a1',
  actionNo: 12,
  title: 'Add a pricing FAQ to /pricing',
  details: parseTaskDetails({ where: '/pricing', doneWhen: 'FAQ present', check: 'rerun' }),
  missing: ['url', 'change'],
  createdAt: '2026-10-26T10:00:00Z',
};

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ActionCenterReviewPage />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name);
const field = (label: string) => {
  const target = [...container.querySelectorAll('label')].find((l) =>
    l.textContent?.startsWith(label),
  );
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[id="${target?.getAttribute('for')}"]`,
  )!;
};
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getTaskReviews.mockResolvedValue([review]);
  approveTaskReview.mockResolvedValue({ taskId: 't9' });
  dismissTaskReview.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  canManage = true;
});

describe('Needs review', () => {
  it('lists a task with what it misses and its action', async () => {
    await render();
    expect(getTaskReviews).toHaveBeenCalledWith('b1');
    expect(container.textContent).toContain('Add a pricing FAQ to /pricing');
    expect(container.textContent).toContain('Missing:URLChange');
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      '/dashboard/action-center/actions?action=a1',
    );
    expect(container.querySelector('a')!.textContent).toBe('Open AC-12');
  });

  it('approves only with the four fields filled, then the task leaves the list', async () => {
    await render();
    act(() => button('Edit')!.click());
    expect(button('Approve')!.disabled).toBe(true);
    type(field('URL'), '/pricing');
    expect(button('Approve')!.disabled).toBe(true);
    type(field('Change · After'), 'FAQ: Do plans ship free?');
    expect(button('Approve')!.disabled).toBe(false);
    await act(async () => button('Approve')!.click());
    expect(approveTaskReview).toHaveBeenCalledWith(
      'b1',
      'r1',
      expect.objectContaining({
        // Its text unchanged: the review's own.
        title: 'Add a pricing FAQ to /pricing',
        url: '/pricing',
        after: 'FAQ: Do plans ship free?',
        doneWhen: 'FAQ present',
        check: 'rerun',
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Task added to AC-12');
    expect(container.textContent).toContain('Nothing waits for review');
  });

  it('tells the tab to count again once a task leaves the list', async () => {
    const changed = vi.fn();
    window.addEventListener('action-task-reviews-changed', changed);
    try {
      await render();
      act(() => button('Edit')!.click());
      type(field('URL'), '/pricing');
      type(field('Change · After'), 'FAQ');
      await act(async () => button('Approve')!.click());
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('action-task-reviews-changed', changed);
    }
  });

  it("says when the task's action is closed", async () => {
    approveTaskReview.mockResolvedValue({ error: 'closed' });
    await render();
    act(() => button('Edit')!.click());
    type(field('URL'), '/pricing');
    type(field('Change · After'), 'FAQ');
    await act(async () => button('Approve')!.click());
    expect(toast.error).toHaveBeenCalledWith(
      "This task's action is closed or deleted, so it can't take the task.",
    );
  });

  it('says what is still missing when the database refuses it', async () => {
    approveTaskReview.mockResolvedValue({ error: 'incomplete' });
    await render();
    act(() => button('Edit')!.click());
    type(field('URL'), '/pricing');
    type(field('Change · After'), 'FAQ');
    await act(async () => button('Approve')!.click());
    expect(toast.error).toHaveBeenCalledWith(
      'Fill the URL, the change, Done when and How we check first.',
    );
    expect(container.textContent).toContain('Add a pricing FAQ to /pricing');
  });

  it('dismisses after asking', async () => {
    await render();
    act(() => button('Dismiss')!.click());
    expect(container.textContent).toContain("Dismiss this task? It won't reach the action.");
    expect(dismissTaskReview).not.toHaveBeenCalled();
    await act(async () =>
      [...container.querySelectorAll('button')]
        .filter((b) => b.textContent === 'Dismiss')
        .at(-1)!
        .click(),
    );
    expect(dismissTaskReview).toHaveBeenCalledWith('b1', 'r1');
    expect(container.textContent).toContain('Nothing waits for review');
  });

  it('approves and dismisses nothing on a read-only workspace: the upgrade dialog instead', async () => {
    await render(true);
    act(() => button('Edit')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Approving tasks needs a plan');
    expect(button('Approve')).toBeUndefined();
    act(() => button('Dismiss')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Dismissing tasks needs a plan');
    expect(container.textContent).not.toContain("Dismiss this task? It won't reach the action.");
    expect(approveTaskReview).not.toHaveBeenCalled();
    expect(dismissTaskReview).not.toHaveBeenCalled();
  });

  it('reads nothing for someone who is not an admin or a manager', async () => {
    canManage = false;
    await render();
    expect(getTaskReviews).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Only admins and managers review tasks.');
  });
});
