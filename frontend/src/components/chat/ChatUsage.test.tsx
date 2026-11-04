import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider } from '@/components/context/RoleProvider';
import type { AiUsage } from '@/lib/billing/aiUsage';

/** Chat's AI usage (W1-23, CHAT-04 items 15–17): the 80% line once a period, and the cap. */

const state = vi.hoisted(() => ({ usage: null as AiUsage | null }));
vi.mock('@/components/context/AiUsageProvider', () => ({
  useAiUsage: () => ({ usage: state.usage, refresh: () => {} }),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const getMore = vi.hoisted(() => ({ open: null as ((tab?: string) => void) | null }));
vi.mock('@/components/ai-usage/getMoreContext', () => ({ useGetMore: () => getMore.open }));

const prefs = vi.hoisted(() => ({ saveUsageNoticePeriod: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/actions/chatPrefs', () => prefs);

const { ChatUsageNotice, chatAtCap } = await import('./ChatUsage');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  plan: 'growth',
  planName: 'Growth',
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  unlimited: false,
  percentUsed: 84.6,
  features: [],
  chatMetered: true,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
async function render(seenPeriod: string | null = null, onOwnKey = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role="admin">
          <ChatUsageNotice seenPeriod={seenPeriod} onOwnKey={onOwnKey} />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  prefs.saveUsageNoticePeriod.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('chatAtCap', () => {
  it('pauses Chat once the allowance it draws on is used up, not on its own key', () => {
    expect(chatAtCap(usage({ percentUsed: 100 }))).toBe(true);
    expect(chatAtCap(usage({ percentUsed: 100, chatMetered: false }))).toBe(false);
    expect(chatAtCap(usage())).toBe(false);
    expect(chatAtCap(usage({ unlimited: true, percentUsed: null }))).toBe(false);
    expect(chatAtCap(null)).toBe(false);
    // Chat on the workspace's own key: the server holds nothing on the budget for it.
    expect(chatAtCap(usage({ percentUsed: 100 }), true)).toBe(false);
  });
});

describe('ChatUsageNotice', () => {
  it('says 80% once a period, keeps that on the person, and × closes it', async () => {
    state.usage = usage();
    await render();
    expect(container.textContent).toBe("You've used 84.6% of this month's AI limit.");
    expect(prefs.saveUsageNoticePeriod).toHaveBeenCalledWith('2026-10-01');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-action="usage.closeNotice"]')!.click(),
    );
    expect(container.innerHTML).toBe('');

    // Seen this period, on this device or another: not said again.
    act(() => root.unmount());
    root = createRoot(container);
    await render('2026-10-01');
    expect(container.innerHTML).toBe('');
    expect(prefs.saveUsageNoticePeriod).toHaveBeenCalledTimes(1);
  });

  it('says it again in a new period, and once per visit however many chats open', async () => {
    state.usage = usage({ periodStart: '2026-11-01T00:00:00.000Z' });
    await render('2026-10-01');
    expect(container.textContent).toContain('84.6%');
    expect(prefs.saveUsageNoticePeriod).toHaveBeenCalledWith('2026-11-01');

    // Another chat on the same visit: the page's read is older than the save.
    act(() => root.unmount());
    root = createRoot(container);
    await render('2026-10-01');
    expect(container.innerHTML).toBe('');
  });

  it('shows the red banner with where to get more once used up, and nothing below 80%', async () => {
    state.usage = usage({ percentUsed: 100 });
    await render();
    expect(container.textContent).toContain("You've used this month's AI limit.");
    expect(container.firstElementChild!.className).toContain('bg-red-50');

    state.usage = usage({ percentUsed: 40 });
    await render();
    expect(container.innerHTML).toBe('');
  });

  it('opens the Get more window once a period at the cap, and never for the trial', async () => {
    getMore.open = vi.fn();
    state.usage = usage({ percentUsed: 100, trial: true });
    await render();
    expect(getMore.open).not.toHaveBeenCalled();

    act(() => root.unmount());
    root = createRoot(container);
    state.usage = usage({ percentUsed: 100, periodStart: '2026-12-01T00:00:00.000Z' });
    await render();
    expect(getMore.open).toHaveBeenCalledWith('ai');
    // Another chat at the same cap: not again.
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(getMore.open).toHaveBeenCalledTimes(1);
    getMore.open = null;
  });

  it('never opens the Get more window on the workspace’s own key: Chat isn’t paused there', async () => {
    getMore.open = vi.fn();
    state.usage = usage({ percentUsed: 100, periodStart: '2027-01-01T00:00:00.000Z' });
    await render(null, true);
    expect(getMore.open).not.toHaveBeenCalled();
    getMore.open = null;
  });
});
