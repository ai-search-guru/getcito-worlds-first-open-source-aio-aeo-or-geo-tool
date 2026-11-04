import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brand } from '@/types';
import type { ActionItem } from '@/lib/actions/actionCenter';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type { FirstRun } from '@/hooks/useFirstRun';
import {
  buildGettingStarted,
  type GettingStartedFacts,
  type GettingStartedStatus,
  type GettingStartedStep,
} from '@/lib/getting-started/steps';

/**
 * The actions list's Export CSV (AC-005): it reads what each listed action's
 * Affected tab names, then downloads the list with it, as UTF-8 Excel reads.
 * And Getting started (AC-ALT2 §4): its steps open the page while a brand
 * runs it, and the page is unchanged for a brand that doesn't.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const brand: Brand = {
  id: 'brand-id',
  organizationId: 'organization-id',
  name: 'Acme',
  slug: 'acme',
  industry: 'Technology',
  region: 'US',
  shoppingModeEnabled: false,
  isActive: true,
  domains: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const action: ActionItem = {
  id: 'a1',
  actionNo: 35,
  category: 'recover',
  kind: 'recover_lost_citations',
  impact: 'high',
  status: 'new',
  payload: {},
  kpiKeys: [],
  assignee: null,
  dueDate: null,
  createdAt: '2026-10-16T09:05:31Z',
  updatedAt: '2026-10-16T09:05:31Z',
  taskTotal: 8,
  taskCompleted: 0,
  signalCount: 3,
  priorityScore: 90,
  priorityLevel: 'critical',
  priorityReason: null,
};

const {
  getActions,
  getActionsAffected,
  getGettingStarted,
  startGettingStarted,
  skipGettingStarted,
  role,
  saveBlob,
  toast,
  firstRun,
} = vi.hoisted(() => ({
  getActions: vi.fn(),
  getActionsAffected: vi.fn(),
  getGettingStarted: vi.fn(),
  startGettingStarted: vi.fn(),
  skipGettingStarted: vi.fn(),
  role: { canManage: true },
  saveBlob: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  // The brand's first run as the page reads it, and who listens for its end.
  firstRun: { run: null as FirstRun | null, finished: new Set<(brandId: string) => void>() },
}));

// No white label kit: downloads keep GetCito's names (exportName.test.ts has a kit's).
vi.mock('@/lib/actions/whiteLabel', () => ({
  getExportBranding: async () => ({ ok: true, branding: null }),
}));
vi.mock('next-intl', () => ({
  // Chat's "How do I finish …" names its action: the test reads which one.
  useTranslations: () => (key: string, values?: { title?: string }) =>
    key === 'actionHow' ? `${key}: ${values?.title}` : key,
}));
const setActiveBrand = vi.hoisted(() => vi.fn());
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (
    selector: (state: {
      getActiveBrand: () => Brand;
      brands: Brand[];
      setActiveBrand: (id: string) => void;
    }) => unknown,
  ) =>
    selector({
      getActiveBrand: () => brand,
      brands: [brand, { ...brand, id: 'other-brand' }],
      setActiveBrand,
    }),
}));
vi.mock('@/lib/actions/actionCenter', () => ({ getActions, getActionsAffected }));
vi.mock('@/lib/actions/gettingStarted', () => ({
  getGettingStarted,
  startGettingStarted,
  skipGettingStarted,
}));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => role }));
vi.mock('@/hooks/useFirstRun', () => ({
  useFirstRun: () => firstRun.run,
  onFirstRunFinished: (listener: (brandId: string) => void) => {
    firstRun.finished.add(listener);
    return () => firstRun.finished.delete(listener);
  },
}));
vi.mock('@/lib/actions/team', () => ({ listBrandMembers: vi.fn(async () => []) }));
vi.mock('@/lib/download', () => ({ saveBlob }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/action-center/ActionCenterTabs', () => ({ ActionCenterTabs: () => null }));
vi.mock('@/components/action-center/ActionTable', () => ({ ActionTable: () => null }));
vi.mock('@/components/action-center/ActionDrawer', () => ({ ActionDrawer: () => null }));
vi.mock('@/components/getting-started/GettingStartedTable', async () => {
  const { needsFirstAnswers } = await import('@/lib/getting-started/steps');
  return {
    arrivingStep: (step: GettingStartedStep, run: FirstRun | null) =>
      run !== null && needsFirstAnswers(step) && step.state !== 'done',
    GettingStartedTable: ({
      steps,
      showNote,
      onSelect,
    }: {
      steps: GettingStartedStep[];
      showNote: boolean;
      onSelect: (step: GettingStartedStep) => void;
    }) => (
      <div data-testid="steps">
        <span data-testid="steps-summary">{`${steps.length} steps${showNote ? ', with the note' : ''}`}</span>
        {steps.map((step) => (
          <button key={step.key} data-step={step.key} onClick={() => onSelect(step)}>
            {step.key}
          </button>
        ))}
      </div>
    ),
    readyWhenKey: () => 'setup',
  };
});
vi.mock('@/components/getting-started/StepCard', () => ({
  GettingStartedStepCard: ({ step }: { step: GettingStartedStep }) => (
    <div data-testid="card">{step.key}</div>
  ),
}));

const { default: ActionCenterActionsPage } = await import('./page');
const { ChatPageSetterContext } = await import('@/components/chat/panel/chatPanelContext');

let container: HTMLDivElement;
let root: Root;

const exportButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'exportCsv')!;

const openUpgrade = vi.fn();
async function render(isLocked = false) {
  await act(async () =>
    root.render(
      <UpgradeDialogContext.Provider
        value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
      >
        <ActionCenterActionsPage />
      </UpgradeDialogContext.Provider>,
    ),
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  getActions.mockReset().mockResolvedValue([action]);
  getGettingStarted.mockReset().mockResolvedValue(null);
  startGettingStarted.mockReset().mockResolvedValue(undefined);
  skipGettingStarted.mockReset().mockResolvedValue(undefined);
  role.canManage = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  getActionsAffected.mockReset();
  saveBlob.mockReset();
  toast.mockReset();
  toast.error.mockReset();
  firstRun.run = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Stale filter (00432)', () => {
  it('lists only New actions no one has worked on for a month, from the URL', async () => {
    window.history.replaceState(null, '', '/?status=stale');
    const stale: ActionItem = { ...action, id: 'a2', staleAt: '2026-10-31T03:00:00Z' };
    const leftNew: ActionItem = {
      ...action,
      id: 'a3',
      status: 'on_hold',
      staleAt: '2026-10-31T03:00:00Z',
    };
    getActions.mockResolvedValue([action, stale, leftNew]);
    getActionsAffected.mockResolvedValue({});
    await render();
    await act(async () => exportButton().click());
    expect(getActionsAffected).toHaveBeenLastCalledWith('brand-id', ['a2']);
  });
});

describe('the From Products chip (ECOM-013)', () => {
  const chip = () =>
    [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('fromProducts'),
    );
  const product: ActionItem = { ...action, id: 'a2', category: 'growth', kind: 'shopping_product' };
  const category: ActionItem = {
    ...action,
    id: 'a3',
    category: 'compete',
    kind: 'shopping_category',
  };

  it('lists only what Product Visibility sent, and lets it go on a second click', async () => {
    getActions.mockResolvedValue([action, product, category]);
    getActionsAffected.mockResolvedValue({});
    await render();
    expect(chip()!.textContent).toBe('fromProducts2');
    expect(chip()!.getAttribute('aria-pressed')).toBe('false');

    await act(async () => chip()!.click());
    expect(chip()!.getAttribute('aria-pressed')).toBe('true');
    await act(async () => exportButton().click());
    expect(getActionsAffected).toHaveBeenLastCalledWith('brand-id', ['a2', 'a3']);

    await act(async () => chip()!.click());
    await act(async () => exportButton().click());
    expect(getActionsAffected.mock.lastCall![1]).toHaveLength(3);
  });

  it('opens on it from the URL, and shows no chip without such an action', async () => {
    window.history.replaceState(null, '', '/?from=products');
    getActions.mockResolvedValue([action, product]);
    getActionsAffected.mockResolvedValue({});
    await render();
    expect(chip()!.getAttribute('aria-pressed')).toBe('true');
    await act(async () => exportButton().click());
    expect(getActionsAffected).toHaveBeenLastCalledWith('brand-id', ['a2']);

    act(() => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, '', '/');
    getActions.mockResolvedValue([action]);
    await render();
    expect(chip()).toBeUndefined();
  });

  it('shows the chip on from the URL with no such action left, to turn it off', async () => {
    window.history.replaceState(null, '', '/?from=products');
    getActions.mockResolvedValue([action]);
    getActionsAffected.mockResolvedValue({});
    await render();
    expect(chip()!.textContent).toBe('fromProducts0');
    expect(chip()!.getAttribute('aria-pressed')).toBe('true');

    await act(async () => chip()!.click());
    expect(chip()).toBeUndefined();
    await act(async () => exportButton().click());
    expect(getActionsAffected).toHaveBeenLastCalledWith('brand-id', ['a1']);
  });
});

describe('the actions list Export CSV', () => {
  it("adds each action's affected count and names, in a file Excel reads as UTF-8", async () => {
    getActionsAffected.mockResolvedValue({
      a1: { count: 3, items: ['Best coffee subscription?', 'Coffee delivery'] },
    });
    await render();
    await act(async () => exportButton().click());

    expect(getActionsAffected).toHaveBeenCalledWith('brand-id', ['a1']);
    const [blob, fileName] = saveBlob.mock.calls[0] as [Blob, string];
    expect(fileName).toMatch(/^getcito_acme_actions_\d{4}-\d{2}-\d{2}\.csv$/);
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const [header, row] = new TextDecoder().decode(bytes.slice(3)).split('\n');
    expect(header).toContain(',signal_count,affected_count,affected_items,created');
    expect(row).toContain(',3,3,Best coffee subscription?; Coffee delivery,');
    expect(exportButton().disabled).toBe(false);
  });

  it('says so when the affected items cannot be read, and downloads nothing', async () => {
    getActionsAffected.mockRejectedValue(new Error('offline'));
    await render();
    await act(async () => exportButton().click());

    expect(toast.error).toHaveBeenCalledWith('export.exportFailed');
    expect(saveBlob).not.toHaveBeenCalled();
    expect(exportButton().disabled).toBe(false);
  });

  it("holds the button while it reads, and drops the file once the brand's view is gone", async () => {
    let answer: (value: unknown) => void = () => {};
    getActionsAffected.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render();
    await act(async () => exportButton().click());
    expect(exportButton().disabled).toBe(true);

    act(() => root.unmount());
    await act(async () => answer({}));
    expect(saveBlob).not.toHaveBeenCalled();
    // Mounted again for afterEach's unmount.
    root = createRoot(container);
  });
});

const started = (over: Partial<GettingStartedFacts> = {}): GettingStartedStatus =>
  buildGettingStarted({
    startedAt: '2026-10-20T10:00:00Z',
    dismissedAt: null,
    confirmedAt: '2026-10-20T10:00:00Z',
    records: {},
    recordedAt: {},
    kpiSetupAt: null,
    competitors: 1,
    topicPrompts: [],
    gsc: false,
    ga: false,
    firstAnswer: false,
    firstVisit: false,
    dataSuggestions: 0,
    dataTracked: 0,
    contentSuggestions: 0,
    contentPicked: 0,
    contentCreated: 0,
    contentRecent: 0,
    audits: 0,
    draftsCreated: 0,
    draftsOptimized: 0,
    ...over,
  });

const steps = () => container.querySelector('[data-testid="steps"]');
const text = () => container.textContent ?? '';

describe('Getting started in the actions list', () => {
  it("leaves the page as it is for a brand that doesn't run it", async () => {
    getGettingStarted.mockResolvedValue(started({ startedAt: null }));
    await render();

    expect(steps()).toBeNull();
    expect(text()).not.toContain('card.title');
    expect(text()).toContain('cards.priority');
    expect(exportButton()).toBeDefined();
  });

  it('opens on its steps for a new brand, the ranking cards waiting for the first signals', async () => {
    getActions.mockResolvedValue([]);
    getGettingStarted.mockResolvedValue(started());
    await render();

    expect(container.querySelector('[data-testid="steps-summary"]')?.textContent).toBe(
      '17 steps, with the note',
    );
    expect(text()).toContain('card.title');
    expect(text().match(/firstSignals/g)).toHaveLength(3);
    // Getting started takes Highest Priority's place; the filters are for actions.
    expect(text()).not.toContain('cards.priority');
    expect(exportButton()).toBeUndefined();
  });

  it("opens a step's card, and says when a step still waiting for data opens", async () => {
    getGettingStarted.mockResolvedValue(started());
    await render();
    const card = () => container.querySelector('[data-testid="card"]');
    expect(card()).toBeNull();

    const stepButton = (key: string) =>
      container.querySelector<HTMLButtonElement>(`[data-step="${key}"]`)!;
    await act(async () => stepButton('competitors').click());
    expect(card()?.textContent).toBe('competitors');

    // Mentions waits for the first answers.
    await act(async () => stepButton('mentions').click());
    expect(toast).toHaveBeenCalledWith('opensWhenReady');
    expect(card()?.textContent).toBe('competitors');
  });

  it("opens the card of a step the first run brings the data for, while it's on", async () => {
    firstRun.run = { brandId: 'brand-id', queued: false, progress: null, left: null };
    getGettingStarted.mockResolvedValue(started());
    await render();

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-step="mentions"]')!.click(),
    );
    expect(container.querySelector('[data-testid="card"]')?.textContent).toBe('mentions');
    expect(toast).not.toHaveBeenCalled();
  });

  it('reads the list again when the first run finishes, and once more for the first actions', async () => {
    getGettingStarted.mockResolvedValue(started());
    await render();
    expect(getActions).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      // Another brand's run: nothing to read here.
      await act(async () => firstRun.finished.forEach((listener) => listener('other-brand')));
      expect(getActions).toHaveBeenCalledTimes(1);

      await act(async () => firstRun.finished.forEach((listener) => listener('brand-id')));
      expect(getActions).toHaveBeenCalledTimes(2);
      expect(getGettingStarted).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });
      expect(getActions).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // gkhngyk on #1235: Create action, a signal and the history drawer link to
  // ?action=<id>; on a new brand the drawer opened over the steps.
  it('lists the actions for a link to one action, or to a filtered list', async () => {
    for (const search of ['?action=a1', '?status=new', '?q=coffee']) {
      window.history.replaceState(null, '', `/${search}`);
      getGettingStarted.mockResolvedValue(started());
      await render();
      expect(steps(), search).toBeNull();
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  /** Chat's Open in Actions (actions/[id]) names the action's brand, so its drawer opens. */
  it('switches to the brand a link names, once, when it is one of the person’s', async () => {
    setActiveBrand.mockClear();
    window.history.replaceState(null, '', '/?action=a1&brand=other-brand');
    await render();
    expect(setActiveBrand).toHaveBeenCalledWith('other-brand');
    expect(setActiveBrand).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    root = createRoot(container);
    setActiveBrand.mockClear();
    window.history.replaceState(null, '', '/?action=a1&brand=not-theirs');
    await render();
    expect(setActiveBrand).not.toHaveBeenCalled();
  });

  it('keeps a category the URL names, and lists the actions', async () => {
    window.history.replaceState(null, '', '/?category=all');
    getGettingStarted.mockResolvedValue(started());
    await render();

    expect(steps()).toBeNull();
    expect(text()).toContain('card.title');
    expect(exportButton()).toBeDefined();
  });

  it('reads as before when Getting started cannot be read', async () => {
    getGettingStarted.mockRejectedValue(new Error('offline'));
    await render();

    expect(steps()).toBeNull();
    expect(text()).toContain('cards.priority');
  });
});

// Dialogs open in a portal on the body.
const pageText = () => document.body.textContent ?? '';
const buttonNamed = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

// AC-ALT2 §5: existing customers, skipping, and a brand added beside others.
describe('starting and skipping Getting started', () => {
  it('offers Start to a manager whose brand isn’t set up, and runs it', async () => {
    getGettingStarted
      .mockResolvedValueOnce(started({ startedAt: null }))
      .mockResolvedValue(started({ competitors: 4 }));
    await render();
    expect(text()).toContain('start.hint');
    await act(async () => buttonNamed('start.button')!.click());

    expect(startGettingStarted).toHaveBeenCalledWith('brand-id');
    expect(toast.success).toHaveBeenCalledWith('start.started');
    expect(steps()).not.toBeNull();
  });

  it('offers nothing to a brand that is set up, nor to someone who can’t set it up', async () => {
    const setUp = { startedAt: null, competitors: 3, topicPrompts: [3, 3, 3], gsc: true };
    getGettingStarted.mockResolvedValue(started({ ...setUp, contentRecent: 1 }));
    await render();
    expect(buttonNamed('start.button')).toBeUndefined();

    act(() => root.unmount());
    root = createRoot(container);
    role.canManage = false;
    getGettingStarted.mockResolvedValue(started({ startedAt: null }));
    await render();
    expect(buttonNamed('start.button')).toBeUndefined();
  });

  it('skips it only after asking, then lists the actions', async () => {
    getGettingStarted
      .mockResolvedValueOnce(started())
      .mockResolvedValue(started({ dismissedAt: '2026-10-20T12:00:00Z' }));
    await render();
    await act(async () => buttonNamed('skip.button')!.click());
    expect(skipGettingStarted).not.toHaveBeenCalled();
    expect(pageText()).toContain('skip.body');

    await act(async () => buttonNamed('skip.confirm')!.click());
    expect(skipGettingStarted).toHaveBeenCalledWith('brand-id');
    expect(toast.success).toHaveBeenCalledWith('skip.done');
    expect(steps()).toBeNull();
    // Start stays available after a skip.
    expect(buttonNamed('start.button')).toBeDefined();
  });

  it("closes the new brand's question when the answer can't be saved, and keeps it closed", async () => {
    getGettingStarted.mockResolvedValue(started({ confirmedAt: null }));
    startGettingStarted.mockRejectedValue(new Error('missing column confirmed_at'));
    await render();
    expect(pageText()).toContain('secondBrand.title');

    await act(async () => buttonNamed('secondBrand.run')!.click());
    expect(toast.error).toHaveBeenCalledWith('start.failed');
    expect(pageText()).not.toContain('secondBrand.title');
    // Start takes the question's place, to run it later.
    expect(buttonNamed('start.button')).toBeDefined();
  });

  // next-intl is mocked: the upgrade dialog's label is its key.
  it('starts and skips nothing on a read-only workspace: each opens the upgrade dialog', async () => {
    openUpgrade.mockReset();
    getGettingStarted.mockResolvedValue(started({ startedAt: null }));
    await render(true);
    await act(async () => buttonNamed('start.button')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('startGettingStarted');
    expect(startGettingStarted).not.toHaveBeenCalled();

    act(() => root.unmount());
    root = createRoot(container);
    getGettingStarted.mockResolvedValue(started());
    await render(true);
    await act(async () => buttonNamed('skip.button')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('skipGettingStarted');
    expect(pageText()).not.toContain('skip.body');
    expect(skipGettingStarted).not.toHaveBeenCalled();
  });

  it("doesn't ask on a read-only workspace whether to run it for a new brand: Start waits", async () => {
    openUpgrade.mockReset();
    getGettingStarted.mockResolvedValue(started({ confirmedAt: null }));
    await render(true);
    expect(pageText()).not.toContain('secondBrand.title');
    await act(async () => buttonNamed('start.button')!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('startGettingStarted');
    expect(startGettingStarted).not.toHaveBeenCalled();
  });

  it('asks a manager whether to run it for a brand added beside others', async () => {
    getGettingStarted
      .mockResolvedValueOnce(started({ confirmedAt: null }))
      .mockResolvedValue(started());
    await render();
    expect(pageText()).toContain('secondBrand.title');
    expect(steps()).toBeNull();

    await act(async () => buttonNamed('secondBrand.run')!.click());
    expect(startGettingStarted).toHaveBeenCalledWith('brand-id');
    expect(toast.success).toHaveBeenCalledWith('secondBrand.ran');
    expect(steps()).not.toBeNull();
  });
});

describe('what Chat’s side panel sees (W1-08)', () => {
  it('tells the panel its filters, questions and the actions in view', async () => {
    const setPage = vi.fn();
    await act(async () =>
      root.render(
        <ChatPageSetterContext.Provider value={setPage}>
          <UpgradeDialogContext.Provider
            value={{ isLocked: false, reason: 'ended', adminName: null, openUpgrade }}
          >
            <ActionCenterActionsPage />
          </UpgradeDialogContext.Provider>
        </ChatPageSetterContext.Provider>,
      ),
    );
    const page = setPage.mock.lastCall![0];
    expect(page).toMatchObject({
      pageName: 'title',
      filters: [],
      referenceables: [{ type: 'task', id: action.id }],
    });
    expect(page.suggestions).toEqual(expect.arrayContaining(['actionsImpact', 'actionsWeek']));
    // Leaving the page takes it back.
    act(() => root.unmount());
    expect(setPage).toHaveBeenLastCalledWith(null);
    root = createRoot(container);
  });

  it('asks how to finish the first of the Top actions, whatever order the list came in', async () => {
    const opportunity = (id: string, title: string, priorityScore: number): ActionItem => ({
      ...action,
      id,
      kind: 'content_opportunity',
      payload: { title },
      priorityScore,
    });
    getActions.mockResolvedValue([
      opportunity('low', 'Low one', 20),
      opportunity('high', 'High one', 95),
      opportunity('mid', 'Mid one', 60),
    ]);
    const setPage = vi.fn();
    await act(async () =>
      root.render(
        <ChatPageSetterContext.Provider value={setPage}>
          <UpgradeDialogContext.Provider
            value={{ isLocked: false, reason: 'ended', adminName: null, openUpgrade }}
          >
            <ActionCenterActionsPage />
          </UpgradeDialogContext.Provider>
        </ChatPageSetterContext.Provider>,
      ),
    );
    expect(setPage.mock.lastCall![0].suggestions[0]).toBe('actionHow: High one');
  });
});
