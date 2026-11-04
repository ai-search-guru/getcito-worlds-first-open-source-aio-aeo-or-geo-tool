import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * History's range: the Actions list starts on 30 days, the scorecard on 90,
 * since an action's final reading comes 30 days after it closed (learning
 * B1). A range in the URL, or one picked, holds in either view.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: { getActiveBrand: () => { id: string } }) => unknown) =>
    selector({ getActiveBrand: () => ({ id: 'b1' }) }),
}));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/action-center/ActionCenterTabs', () => ({
  ActionCenterTabs: () => null,
}));
vi.mock('@/components/action-center/HistoryTable', () => ({ HistoryTable: () => null }));
vi.mock('@/components/action-center/HistoryDrawer', () => ({ HistoryDrawer: () => null }));
vi.mock('@/components/action-center/ScorecardTable', () => ({ ScorecardTable: () => null }));

const { getActionHistory, getActionScorecard } = vi.hoisted(() => ({
  getActionHistory: vi.fn(),
  getActionScorecard: vi.fn(),
}));
vi.mock('@/lib/actions/actionHistory', () => ({ getActionHistory }));
vi.mock('@/lib/actions/actionScorecard', () => ({ getActionScorecard }));

import ActionCenterHistoryPage from './page';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getActionHistory.mockResolvedValue([{ id: 'a1', status: 'completed', outcome: 'improved' }]);
  getActionScorecard.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  getActionHistory.mockReset();
  getActionScorecard.mockReset();
  window.history.replaceState(null, '', '/');
});

async function renderAt(url: string) {
  window.history.replaceState(null, '', url);
  await act(async () => {
    root.render(<ActionCenterHistoryPage />);
  });
}

/** The days back the latest call to `read` asked from. */
function daysAsked(read: typeof getActionHistory): number {
  const { from } = read.mock.calls.at(-1)?.[1] as { from: string };
  return Math.round((Date.now() - Date.parse(from)) / 86_400_000);
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no ${text} button`);
  return found;
}

describe('History range', () => {
  it('starts the Actions list on 30 days', async () => {
    await renderAt('/');
    expect(daysAsked(getActionHistory)).toBe(30);
    expect(getActionScorecard).not.toHaveBeenCalled();
  });

  it('starts the scorecard on 90 days when the URL names no range', async () => {
    await renderAt('/?view=scorecard');
    expect(daysAsked(getActionScorecard)).toBe(90);
    expect(button('range.90d').className).toContain('bg-primary');
  });

  it('keeps a range the URL names', async () => {
    await renderAt('/?view=scorecard&range=30d');
    expect(daysAsked(getActionScorecard)).toBe(30);
  });

  it('moves to 90 days on switching to the scorecard, unless a range was picked', async () => {
    await renderAt('/');
    await act(async () => button('view.scorecard').click());
    expect(daysAsked(getActionScorecard)).toBe(90);
    // The URL is written after a pause; the view's own default stays out of it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(window.location.search).toBe('?view=scorecard');

    await act(async () => button('range.7d').click());
    await act(async () => button('view.actions').click());
    expect(daysAsked(getActionHistory)).toBe(7);
  });
});
