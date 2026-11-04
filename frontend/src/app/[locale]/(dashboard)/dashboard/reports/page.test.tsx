import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { ChatAgenticProvider } from '@/components/context/ChatAgenticProvider';

/**
 * Reports on a read-only workspace (plan not active): the reports list and
 * open; Generate Report and Delete (before its confirm) open the upgrade
 * dialog instead.
 */

const reports = vi.hoisted(() => ({
  getReports: vi.fn(),
  createReport: vi.fn(),
  deleteReport: vi.fn(),
}));
vi.mock('@/lib/actions/reports', () => reports);
const brand = { id: 'b1', name: 'Acme', shoppingModeEnabled: false };
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (select: (state: unknown) => unknown) =>
    select({ activeBrandId: 'b1', brands: [brand] }),
}));
const push = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: ReportsPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  reports.getReports.mockResolvedValue([
    {
      id: 'r1',
      brandId: 'b1',
      title: 'October review',
      template: 'executive_summary',
      dateFrom: '2026-10-01T00:00:00Z',
      dateTo: '2026-10-27T00:00:00Z',
      createdAt: '2026-10-27T00:00:00Z',
    },
  ]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(isLocked: boolean, chatAgentic = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatAgenticProvider enabled={chatAgentic}>
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <ReportsPage />
          </UpgradeDialogContext.Provider>
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
}

const generate = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Generate Report')!;
// The row's last button: the bin.
const remove = () => [...container.querySelectorAll('tbody button')].at(-1) as HTMLButtonElement;
const dialog = () => document.querySelector('[role="dialog"]');

describe('Reports', () => {
  it('generates and deletes nothing on a read-only workspace: the upgrade dialog instead', async () => {
    await render(true);
    expect(container.textContent).toContain('October review');
    await act(async () => generate().click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Generating reports needs a plan');
    await act(async () => remove().click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Deleting reports needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(reports.createReport).not.toHaveBeenCalled();
    expect(reports.deleteReport).not.toHaveBeenCalled();
  });

  it('opens Generate Report on an active plan', async () => {
    await render(false);
    await act(async () => generate().click());
    expect(dialog()).not.toBeNull();
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('links What GetCito did for you only with the new Chat on (CHAT-22 §2 item 5)', async () => {
    await render(false);
    expect(container.querySelector('[data-action="reports.openImpact"]')).toBeNull();
    await render(false, true);
    const link = container.querySelector('[data-action="reports.openImpact"]')!;
    expect(link.textContent).toBe('What GetCito did for you');
    expect(link.getAttribute('href')).toBe('/dashboard/reports/impact');
  });
});
