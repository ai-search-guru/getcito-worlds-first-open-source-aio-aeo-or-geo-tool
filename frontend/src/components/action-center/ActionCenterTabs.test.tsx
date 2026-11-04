import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/** The Action Center's tabs: Needs review (AC-010) for admins and managers, with its count. */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard/action-center/actions',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: { activeBrandId: string }) => unknown) =>
    selector({ activeBrandId: 'b1' }),
}));
let canManage = true;
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ role: canManage ? 'admin' : 'analyst', canManage, canAdmin: canManage }),
}));
vi.mock('@/lib/actions/signals', () => ({ getNewSignalCount: vi.fn(async () => 0) }));
const { getTaskReviewCount } = vi.hoisted(() => ({ getTaskReviewCount: vi.fn() }));
vi.mock('@/lib/actions/actionTaskReviews', () => ({ getTaskReviewCount }));
vi.mock('./FirstRunNote', () => ({ FirstRunNote: () => null }));

import { ActionCenterTabs } from './ActionCenterTabs';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getTaskReviewCount.mockResolvedValue(3);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  canManage = true;
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ActionCenterTabs />
      </NextIntlClientProvider>,
    );
  });
}

const tabs = () => [...container.querySelectorAll('nav a')].map((a) => a.textContent);

describe('ActionCenterTabs', () => {
  it('shows Needs review last, with how many wait, to an admin or a manager', async () => {
    await render();
    expect(getTaskReviewCount).toHaveBeenCalledWith('b1');
    expect(tabs()).toEqual(['Actions', 'Signals', 'KPIs', 'History', 'Needs review3']);
  });

  it('counts again when a review is approved or dismissed on its page', async () => {
    await render();
    getTaskReviewCount.mockResolvedValue(2);
    await act(async () => {
      window.dispatchEvent(new Event('action-task-reviews-changed'));
    });
    expect(tabs().at(-1)).toBe('Needs review2');
  });

  it('shows no count when nothing waits', async () => {
    getTaskReviewCount.mockResolvedValue(0);
    await render();
    expect(tabs().at(-1)).toBe('Needs review');
  });

  it('leaves it out for anyone else, and reads no count', async () => {
    canManage = false;
    await render();
    expect(tabs()).toEqual(['Actions', 'Signals', 'KPIs', 'History']);
    expect(getTaskReviewCount).not.toHaveBeenCalled();
  });
});
