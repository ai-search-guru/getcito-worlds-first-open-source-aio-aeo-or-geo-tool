import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';

/**
 * Competitors on a read-only workspace (plan not active): Add, Suggest (it
 * asks the AI as its dialog opens) and Delete open the upgrade dialog instead.
 */

const competitorActions = vi.hoisted(() => ({
  getCompetitors: vi.fn(),
  addCompetitor: vi.fn(),
  deleteCompetitor: vi.fn(),
  getCompetitorTimeline: vi.fn(async () => ({ weeks: [], events: [] })),
}));
vi.mock('@/lib/actions/competitor', () => competitorActions);
vi.mock('@/lib/actions/tracking', () => ({
  getCompetitorComparison: vi.fn(async () => ({ brands: [] })),
  getHeadToHeadComparison: vi.fn(),
  getHeadToHeadRuns: vi.fn(),
}));
const suggestCompetitors = vi.hoisted(() => vi.fn());
vi.mock('@/lib/aiBrandSetup', () => ({ suggestCompetitors }));
vi.mock('@/hooks/useFeatureGate', () => ({
  useFeatureGate: () => ({ canUse: () => true, isCloud: true }),
}));
const brand = {
  id: 'b1',
  name: 'Acme',
  slug: 'acme',
  domains: [{ domain: 'acme.com', isPrimary: true }],
};
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (select: (state: unknown) => unknown) => select({ getActiveBrand: () => brand }),
}));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/filters/DateRangeFilter', () => ({ DateRangeFilter: () => null }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: CompetitorsPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked: boolean, role: TeamRole = 'manager') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <CompetitorsPage />
          </UpgradeDialogContext.Provider>
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

// The header's buttons: the empty state below repeats Add and Suggest.
const headerButton = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
const dialog = () => document.querySelector('[role="dialog"]');

beforeEach(() => {
  vi.clearAllMocks();
  competitorActions.getCompetitors.mockResolvedValue([
    { id: 'c1', brandId: 'b1', name: 'Rival', domain: 'rival.com', createdAt: '2026-10-01' },
  ]);
  suggestCompetitors.mockResolvedValue({ competitors: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Competitors on a read-only workspace', () => {
  it('asks the AI for nothing: Suggest opens the upgrade dialog, not its own', async () => {
    await render(true);
    await act(async () => headerButton('Suggest competitors').click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Suggesting competitors needs a plan');
    expect(suggestCompetitors).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('adds and deletes nothing', async () => {
    await render(true);
    await act(async () => headerButton('Add Competitor').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Adding competitors needs a plan');
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')!;
    await act(async () => remove.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Deleting competitors needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(competitorActions.deleteCompetitor).not.toHaveBeenCalled();
  });

  it('opens Suggest, which asks the AI, on an active plan', async () => {
    await render(false);
    await act(async () => headerButton('Suggest competitors').click());
    expect(openUpgrade).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(suggestCompetitors).toHaveBeenCalledTimes(1);
  });
});

describe('Competitors for a member who is not an admin or a manager', () => {
  it.each(['analyst', 'agency_partner'] as const)(
    'shows an %s the competitors without Add, Suggest or Delete',
    async (role) => {
      await render(false, role);
      expect(container.textContent).toContain('Rival');
      expect(headerButton('Add Competitor')).toBeUndefined();
      expect(headerButton('Suggest competitors')).toBeUndefined();
      expect(container.querySelector('button[aria-label="Delete"]')).toBeNull();
    },
  );
});
