import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type { Prompt } from '@/types';
import type { FirstRun } from '@/hooks/useFirstRun';

/**
 * Tracked Prompts on a read-only workspace (plan not active): Add prompt,
 * the row menu, the bulk bar and Analyze open the upgrade dialog, labelled
 * with what was clicked, and write nothing; on an active plan they work as
 * before. The volumes the server refuses it don't read as an outage. The
 * Location filter stays off Query Fan-out, which doesn't use it, and Chat's
 * side panel hears of a location only on the tab that reads one.
 */

const actions = vi.hoisted(() => ({
  getPromptsPageData: vi.fn(),
  setPromptActive: vi.fn(),
  setPromptsActive: vi.fn(),
  deletePrompt: vi.fn(),
  deletePrompts: vi.fn(),
  importPrompts: vi.fn(),
  updatePrompt: vi.fn(),
  getLocationQuota: vi.fn(),
  getPromptLocationMatrix: vi.fn(),
  bulkUpdatePromptLocations: vi.fn(),
}));
vi.mock('@/lib/actions/prompt', () => actions);
vi.mock('@/lib/actions/trackingCountries', () => ({ getTrackingCountries: async () => [] }));
const volumes = vi.hoisted(() => ({
  startPromptVolumeAnalysis: vi.fn(),
  getVolumeAnalysisStatus: vi.fn(async () => null),
  refreshVolumes: vi.fn(),
}));
vi.mock('@/lib/actions/volumes', () => volumes);
// The brand's locations, as the Location filter reads them: none unless a test says so.
const filterOptions = vi.hoisted(() => ({ regions: [] as string[] }));
vi.mock('@/lib/actions/tracking', () => ({
  getBrandFilterOptions: vi.fn(async () => ({ regions: filterOptions.regions })),
}));
// The brand's topics, as the Add Prompt dialog reads them: one unless a test says none.
const topicActions = vi.hoisted(() => ({ getTopics: vi.fn() }));
vi.mock('@/lib/actions/topic', () => topicActions);
const COFFEE_TOPIC = {
  id: 't1',
  brandId: 'b1',
  name: 'Coffee',
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
};
const contentUsage = vi.hoisted(() => ({ value: null as object | null }));
const getOpenSuggestionForPrompt = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => null),
);
vi.mock('@/lib/actions/content', () => ({
  getContentUsage: vi.fn(async () => contentUsage.value),
  getGenerationJobStatus: vi.fn(),
  getOpenSuggestionForPrompt,
  suggestContentForPrompt: vi.fn(),
}));
vi.mock('@/lib/actions/contentDrafts', () => ({ getDraftForPrompt: vi.fn(async () => null) }));
vi.mock('@/lib/actions/promptWorkflow', () => ({ setPromptWorkStatus: vi.fn() }));
// Start (New content) and the Positions panel have tests of their own.
vi.mock('@/components/content/NewContentDialog', () => ({ NewContentDialog: () => null }));
vi.mock('@/components/prompts/PromptPositionsSheet', () => ({
  PromptPositionsSheet: () => null,
}));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ canManage: true }) }));
// The brand's first run: null unless a test says it goes on.
const firstRun = vi.hoisted(() => ({ run: null as FirstRun | null }));
vi.mock('@/hooks/useFirstRun', () => ({ useFirstRun: () => firstRun.run }));
// The Topics tab has tests of its own; here, what the page asks of it.
const topicsTab = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock('./_TopicsTab', () => ({
  TopicsTab: (props: Record<string, unknown>) => {
    topicsTab.props.push(props);
    return <div data-testid="topics-tab" />;
  },
}));
vi.mock('./_FanoutTab', () => ({ QueryFanoutTab: () => <div data-testid="fanout-tab" /> }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (select: (state: unknown) => unknown) =>
    select({ activeBrandId: 'b1', brands: [{ id: 'b1', slug: 'acme', name: 'Acme' }] }),
}));
// The page's query string: empty unless a test says otherwise.
const query = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query.search) }));
// The route names the tab: Tracked unless a test opens Insights.
const nav = vi.hoisted(() => ({ pathname: '/dashboard/prompts/tracked', push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
);
vi.mock('sonner', () => ({ toast }));

const { default: PromptsPage } = await import('./page');
const { ChatPageSetterContext } = await import('@/components/chat/panel/chatPanelContext');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const prompt: Prompt = {
  id: 'p1',
  promptSetId: 'set-1',
  text: 'Best coffee subscription?',
  platforms: ['chatgpt'],
  regions: ['US'],
  models: [],
  isActive: true,
  workStatus: null,
  targetUrlCount: 0,
  citedUrlCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked: boolean, setChatPage: ((page: unknown) => void) | null = null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatPageSetterContext.Provider value={setChatPage}>
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <PromptsPage />
          </UpgradeDialogContext.Provider>
        </ChatPageSetterContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  );
const dialog = () => document.querySelector('[role="dialog"]');

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/dashboard/prompts/tracked';
  query.search = '';
  filterOptions.regions = [];
  firstRun.run = null;
  contentUsage.value = null;
  getOpenSuggestionForPrompt.mockResolvedValue(null);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  );
  actions.getPromptsPageData.mockResolvedValue({
    volumes: [],
    quota: null,
    promptSets: [{ prompts: [prompt] }],
    visibility: {},
    positions: {},
  });
  actions.setPromptsActive.mockResolvedValue({ updated: 1 });
  topicActions.getTopics.mockResolvedValue([COFFEE_TOPIC]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Tracked Prompts during the brand's first run", () => {
  it('says the first answers are arriving above the table, and nothing once it is done', async () => {
    firstRun.run = {
      brandId: 'b1',
      queued: false,
      progress: { current: 18, total: 40 },
      left: { minutes: 6 },
    };
    await render(false);
    expect(container.textContent).toContain(
      'Your first answers are arriving (18 of 40) · ~6 min. This fills in when tracking finishes.',
    );

    firstRun.run = null;
    await render(false);
    expect(container.textContent).not.toContain('Your first answers are arriving');
  });
});

describe('Tracked Prompts on a read-only workspace', () => {
  it('opens the upgrade dialog from Add prompt, not the Add Prompt dialog', async () => {
    await render(true);
    await act(async () => button('Add prompt')!.click());
    expect(openUpgrade).toHaveBeenCalledWith('Adding prompts needs a plan');
    expect(dialog()).toBeNull();
  });

  it('opens Add Prompt on an active plan', async () => {
    await render(false);
    await act(async () => button('Add prompt')!.click());
    expect(openUpgrade).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it('pauses nothing from the row menu or the bulk bar', async () => {
    await render(true);
    const trigger = container.querySelector<HTMLElement>(
      `[aria-label="Actions for ${prompt.text}"]`,
    )!;
    await act(async () => trigger.click());
    const pause = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === 'Pause tracking',
    )!;
    await act(async () => pause.click());
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenLastCalledWith('Pausing prompts needs a plan');
    expect(actions.setPromptActive).not.toHaveBeenCalled();

    const box = container.querySelector<HTMLElement>(`[aria-label="Select ${prompt.text}"]`)!;
    await act(async () => box.click());
    await act(async () => button('Pause')!.click());
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(openUpgrade).toHaveBeenLastCalledWith('Pausing prompts needs a plan');
    expect(actions.setPromptsActive).not.toHaveBeenCalled();
  });

  it('pauses from the bulk bar on an active plan', async () => {
    await render(false);
    const box = container.querySelector<HTMLElement>(`[aria-label="Select ${prompt.text}"]`)!;
    await act(async () => box.click());
    await act(async () => button('Pause')!.click());
    expect(actions.setPromptsActive).toHaveBeenCalledWith(['p1'], false);
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});

describe('the Location filter', () => {
  const locationFilter = () =>
    [...container.querySelectorAll('label')].find((l) => l.textContent === 'Location');

  it('shows on Tracked Prompts for a brand tracked in more than one location', async () => {
    filterOptions.regions = ['US', 'GB'];
    await render(false);
    expect(locationFilter()).toBeDefined();
  });

  it("is left off Query Fan-out, which doesn't use it", async () => {
    filterOptions.regions = ['US', 'GB'];
    nav.pathname = '/dashboard/prompts/fan-outs';
    await render(false);
    expect(container.querySelector('[data-testid="fanout-tab"]')).not.toBeNull();
    expect(locationFilter()).toBeUndefined();
  });
});

describe("what Chat's side panel sees", () => {
  // A link that carries a location from Tracked Prompts to every tab.
  const filtersOn = async (pathname: string) => {
    filterOptions.regions = ['US', 'GB'];
    query.search = 'region=GB';
    nav.pathname = pathname;
    const setChatPage = vi.fn();
    await render(false, setChatPage);
    return setChatPage.mock.lastCall![0].filters;
  };

  it('names the location on Tracked Prompts, whose table it filters', async () => {
    expect(await filtersOn('/dashboard/prompts/tracked')).toEqual([
      { key: 'region', label: expect.stringContaining('United Kingdom'), value: 'GB' },
    ]);
  });

  it.each([
    ['Query Fan-out', '/dashboard/prompts/fan-outs'],
    ['Topics', '/dashboard/prompts/topics'],
    ['Insights', '/dashboard/prompts/insights'],
  ])("leaves the location out on %s, which doesn't read it", async (_tab, pathname) => {
    expect(await filtersOn(pathname)).toEqual([]);
  });
});

describe('Add Prompt on a brand without topics', () => {
  // A button, not a link: the page reads its tab from the route only when it opens.
  const addTopic = () =>
    [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Add a topic');
  const typePrompt = async (text: string) => {
    const input = dialog()!.querySelector<HTMLInputElement>('input')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('asks for a topic first instead of the form, with a way to the Topics tab', async () => {
    topicActions.getTopics.mockResolvedValue([]);
    await render(false);
    await act(async () => button('Add prompt')!.click());
    expect(dialog()?.textContent).toContain('Add a topic first');
    expect(addTopic()).toBeDefined();
    expect(button('Save & close')).toBeUndefined();
    expect(actions.importPrompts).not.toHaveBeenCalled();
  });

  it('switches to the Topics tab in place with Add Topic asked for, closing the dialog', async () => {
    topicActions.getTopics.mockResolvedValue([]);
    topicsTab.props = [];
    await render(false);
    await act(async () => button('Add prompt')!.click());
    await act(async () => addTopic()!.click());
    await act(async () => {});
    expect(dialog()).toBeNull();
    expect(window.location.pathname).toBe('/dashboard/prompts/topics');
    expect(document.querySelector('[data-testid="topics-tab"]')).not.toBeNull();
    expect(topicsTab.props.at(-1)).toMatchObject({ openAddTopic: true });

    // Once the tab has opened it, the request is handed back.
    await act(async () => (topicsTab.props.at(-1)!.onAddTopicOpened as () => void)());
    expect(topicsTab.props.at(-1)).toMatchObject({ openAddTopic: false });
  });

  it('shows the form as before when the brand has a topic', async () => {
    await render(false);
    await act(async () => button('Add prompt')!.click());
    expect(dialog()?.textContent).not.toContain('Add a topic first');
    expect(button('Save & close')).toBeDefined();
  });

  it('reads the topics again on every open, so one added since counts', async () => {
    topicActions.getTopics.mockResolvedValueOnce([]);
    await render(false);
    await act(async () => button('Add prompt')!.click());
    expect(dialog()?.textContent).toContain('Add a topic first');
    await act(async () => button('Cancel')!.click());
    await act(async () => button('Add prompt')!.click());
    expect(dialog()?.textContent).not.toContain('Add a topic first');
    expect(topicActions.getTopics).toHaveBeenCalledTimes(2);
  });

  it('asks for a topic first when saving finds the brand has none left', async () => {
    actions.importPrompts.mockResolvedValue({
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    await render(false);
    await act(async () => button('Add prompt')!.click());
    await typePrompt('Best espresso beans?');
    await act(async () => button('Save & close')!.click());
    expect(actions.importPrompts).toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Add a topic first');
    expect(addTopic()).toBeDefined();
  });
});

describe('locations on a read-only workspace (PROMPT-015)', () => {
  // Tracked in the US and Germany; the second prompt only in the US, so its
  // Germany cell offers + Track.
  const twoPlaces: Prompt = { ...prompt, regions: ['US', 'DE'] };
  const usOnly: Prompt = { ...prompt, id: 'p2', text: 'Coffee beans every week?', regions: ['US'] };

  beforeEach(() => {
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [twoPlaces, usOnly] }],
      visibility: {},
      positions: {},
    });
    actions.getLocationQuota.mockResolvedValue({
      maxPrompts: 200,
      used: 3,
      planId: 'growth',
      planName: 'Growth',
    });
    actions.getPromptLocationMatrix.mockResolvedValue({});
  });
  // The view is kept in the URL (?layout=locations): the next tests start on the table.
  afterEach(() => window.history.replaceState(null, '', window.location.pathname));

  const openMenu = async (trigger: HTMLElement) => {
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };
  const showLocations = async () => {
    await act(async () => button('Locations')!.click());
    await act(async () => {});
  };

  it('opens the upgrade dialog, not the locations one, from every way in', async () => {
    await render(true);

    // The bulk bar's Locations menu, on the selection.
    const box = container.querySelector<HTMLElement>(`[aria-label="Select ${prompt.text}"]`)!;
    await act(async () => box.click());
    const bulk = [...container.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find(
      (b) => b.textContent === 'Locations',
    )!;
    let items = await openMenu(bulk);
    await act(async () => items.find((i) => i.textContent === 'Remove locations')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Removing locations needs a plan');
    items = await openMenu(bulk);
    await act(async () => items.find((i) => i.textContent === 'Add locations')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Changing locations needs a plan');
    await act(async () => box.click());

    await showLocations();
    // A column's menu.
    items = await openMenu(
      container.querySelector<HTMLElement>('[aria-label="Actions for Germany"]')!,
    );
    await act(async () => items.find((i) => i.textContent === 'Stop tracking in Germany')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Removing locations needs a plan');
    // A cell's ×.
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          `[aria-label="Stop tracking “${prompt.text}” in Germany"]`,
        )!
        .click(),
    );
    expect(openUpgrade).toHaveBeenLastCalledWith('Removing locations needs a plan');
    // A cell's + Track, and + Add location.
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(`[aria-label="Track “${usOnly.text}” in Germany"]`)!
        .click(),
    );
    expect(openUpgrade).toHaveBeenLastCalledWith('Changing locations needs a plan');
    await act(async () => button('+ Add location')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Changing locations needs a plan');

    expect(openUpgrade).toHaveBeenCalledTimes(6);
    expect(dialog()).toBeNull();
    expect(actions.bulkUpdatePromptLocations).not.toHaveBeenCalled();
  });

  it("opens stop tracking on a column's prompts on an active plan", async () => {
    await render(false);
    await showLocations();
    const items = await openMenu(
      container.querySelector<HTMLElement>('[aria-label="Actions for Germany"]')!,
    );
    await act(async () => items.find((i) => i.textContent === 'Stop tracking in Germany')!.click());
    expect(openUpgrade).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Stop tracking in locations');
  });
});

describe('volumes on a read-only workspace', () => {
  // The prompt has no volume yet: the banner offers "Analyze 1 prompt".
  const pageData = (volumesDegraded: boolean) => ({
    volumes: [],
    quota: null,
    promptSets: [{ prompts: [prompt] }],
    visibility: {},
    positions: {},
    volumesDegraded,
    visibilityDegraded: false,
  });

  it('starts no analysis: Analyze opens the upgrade dialog', async () => {
    await render(true);
    await act(async () => button('Analyze 1 prompt')!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Analyzing prompts needs a plan');
    expect(volumes.startPromptVolumeAnalysis).not.toHaveBeenCalled();
  });

  it('opens the upgrade dialog, not "not part of your plan", when the server says the plan ended', async () => {
    volumes.startPromptVolumeAnalysis.mockResolvedValue({
      ok: false,
      code: 'subscription_inactive',
    });
    await render(false);
    await act(async () => button('Analyze 1 prompt')!.click());
    expect(volumes.startPromptVolumeAnalysis).toHaveBeenCalledWith('b1', false);
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says nothing broke when the refused volumes leave their columns empty', async () => {
    actions.getPromptsPageData.mockResolvedValue(pageData(true));
    await render(true);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('still warns of a volumes outage on an active plan', async () => {
    actions.getPromptsPageData.mockResolvedValue(pageData(true));
    await render(false);
    expect(toast.warning).toHaveBeenCalledWith(
      'Volume data is temporarily unavailable — showing prompts without it.',
    );
  });
});

describe('the volume quota without an active plan', () => {
  // The server reads 0 of 0 with `noPlan` once the plan has ended.
  const noPlan = { used: 3, limit: 0, remaining: 0, noPlan: true };
  const pageData = (quota: object | null) => ({
    volumes: [],
    quota,
    promptSets: [{ prompts: [prompt] }],
    visibility: {},
    positions: {},
  });
  const reds = () => container.querySelectorAll('.text-red-500');

  it('offers Analyze on Tracked, not "limit is reached", and it opens the upgrade dialog', async () => {
    actions.getPromptsPageData.mockResolvedValue(pageData(noPlan));
    await render(true);
    expect(container.textContent).toContain('Run volume analysis to fill in');
    expect(container.textContent).not.toContain('limit is reached');
    const analyze = button('Analyze 1 prompt')!;
    expect(analyze.disabled).toBe(false);
    await act(async () => analyze.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Analyzing prompts needs a plan');
    expect(volumes.startPromptVolumeAnalysis).not.toHaveBeenCalled();
  });

  it("keeps the row menu's Suggest content clickable at a content quota of 0 of 0: it opens the upgrade dialog", async () => {
    contentUsage.value = {
      plan: 'growth',
      planName: 'Growth',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      opportunities: { used: 2, limit: 0, remaining: 0, perRequest: 0, noPlan: true },
      briefs: { used: 0, limit: 0, remaining: 0, noPlan: true },
      noPlan: true,
    };
    await render(true);
    const trigger = container.querySelector<HTMLElement>(
      `[aria-label="Actions for ${prompt.text}"]`,
    )!;
    await act(async () => trigger.click());
    const suggest = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
      el.textContent?.startsWith('Suggest content'),
    )!;
    expect(suggest.textContent).toBe('Suggest content');
    expect(suggest.hasAttribute('data-disabled')).toBe(false);
    await act(async () => suggest.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Suggesting content needs a plan');
  });

  it("opens the prompt's content suggestion from the row menu, which costs nothing", async () => {
    contentUsage.value = {
      plan: 'growth',
      planName: 'Growth',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      opportunities: { used: 2, limit: 0, remaining: 0, perRequest: 0, noPlan: true },
      briefs: { used: 0, limit: 0, remaining: 0, noPlan: true },
      noPlan: true,
    };
    getOpenSuggestionForPrompt.mockResolvedValue('opp-1');
    await render(true);
    const trigger = container.querySelector<HTMLElement>(
      `[aria-label="Actions for ${prompt.text}"]`,
    )!;
    await act(async () => trigger.click());
    expect(getOpenSuggestionForPrompt).toHaveBeenCalledWith('p1');
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const open = items.find((el) => el.textContent === 'Open content suggestion')!;
    expect(open).toBeDefined();
    expect(items.some((el) => el.textContent?.startsWith('Suggest content'))).toBe(false);
    await act(async () => open.click());
    expect(nav.push).toHaveBeenCalledWith('/dashboard/content?opportunity=opp-1');
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('says "No active plan" on Insights, not a red 0/0 or "limit reached"', async () => {
    nav.pathname = '/dashboard/prompts/insights';
    actions.getPromptsPageData.mockResolvedValue(pageData(noPlan));
    await render(true);
    expect(container.textContent).toContain('No active plan');
    expect(container.textContent).not.toContain('0/0');
    expect(container.textContent).not.toContain('Monthly analysis limit reached');
    expect(reds()).toHaveLength(0);
    const analyze = button('Analyze Volumes')!;
    expect(analyze.disabled).toBe(false);
    await act(async () => analyze.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Analyzing prompts needs a plan');
  });

  it('still says the limit is reached, in red, once an active plan is used up', async () => {
    nav.pathname = '/dashboard/prompts/insights';
    actions.getPromptsPageData.mockResolvedValue(pageData({ used: 10, limit: 10, remaining: 0 }));
    await render(false);
    expect(container.textContent).toContain('0/10 analyses left');
    expect(container.textContent).toContain('Monthly analysis limit reached');
    expect(container.textContent).not.toContain('No active plan');
    expect(reds().length).toBeGreaterThan(0);
    expect(button('Analyze Volumes')!.disabled).toBe(true);
  });
});

describe('the Prompt Volumes chart', () => {
  it('says the rate the volumes were estimated with, as the AI Adoption Rate card does', async () => {
    nav.pathname = '/dashboard/prompts/insights';
    actions.getPromptsPageData.mockResolvedValue({
      quota: { used: 1, limit: 10, remaining: 9 },
      promptSets: [{ prompts: [prompt] }],
      visibility: {},
      positions: {},
      volumes: [
        {
          id: 'v1',
          promptId: 'p1',
          promptText: prompt.text,
          promptCategory: 'Coffee',
          intent: 'commercial',
          keywords: ['coffee subscription'],
          googleVolumes: { 'coffee subscription': 1000 },
          totalGoogleVolume: 1000,
          aiVolumeMultiplier: 0.4,
          estAiVolume: 400,
          competitionIndex: null,
          competition: null,
          fetchedAt: '2026-10-20T00:00:00.000Z',
        },
      ],
    });
    await render(false);
    // The row's rate, not the default: the card and the caption say the same
    // one, and the caption claims no other share of Google searches.
    expect(container.textContent).toContain('AI Adoption Rate40%');
    expect(container.textContent).toContain('Google volume × the 40% AI adoption rate');
    expect(container.textContent).not.toMatch(/~\d+% of Google searches/);
  });
});
