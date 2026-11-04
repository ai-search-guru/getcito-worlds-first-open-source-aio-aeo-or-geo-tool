import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PromptSuggestion, TrackSuggestionsResult } from '@/lib/actions/promptSuggestions';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { SuggestionsCard } from './_SuggestionsCard';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  getPromptSuggestions: vi.fn(),
  refreshPromptSuggestions: vi.fn(),
  acceptSuggestion: vi.fn(),
  dismissSuggestion: vi.fn(),
  dismissSuggestions: vi.fn(),
  trackSuggestions: vi.fn(),
}));
vi.mock('@/lib/actions/promptSuggestions', () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));

// The viewer's role: an admin unless a test says otherwise.
const viewer = vi.hoisted(() => ({ role: 'admin' as string }));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({
    role: viewer.role,
    canManage: viewer.role === 'admin' || viewer.role === 'manager',
    canAdmin: viewer.role === 'admin',
  }),
}));

const suggestion = (n: number): PromptSuggestion => ({
  id: `s${n}`,
  brandId: 'b1',
  suggestedText: `Prompt ${n}`,
  topicName: null,
  topicId: null,
  reason: null,
  estVolume: null,
  relevance: null,
  source: 'llm',
  sourceData: null,
  status: 'new',
  generatedAt: '2026-10-21T08:00:00.000Z',
  expiresAt: '2026-11-21T08:00:00.000Z',
});

const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `s${from + i}`);

let container: HTMLDivElement;
let root: Root;
const onAccepted = vi.fn();
// The workspace's plan: active unless a test says it's read-only.
let isLocked = false;
const openUpgrade = vi.fn();

async function render(
  count: number,
  planId: 'starter' | 'growth' = 'starter',
  onAddTopic?: () => void,
) {
  actions.getPromptSuggestions.mockResolvedValue({
    ok: true,
    suggestions: Array.from({ length: count }, (_, i) => suggestion(i + 1)),
    stale: false,
  });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <SuggestionsCard
            brandId="b1"
            onAccepted={onAccepted}
            onAddTopic={onAddTopic}
            sourceStates={null}
            planId={planId}
            limitActions={<button type="button">Upgrade plan</button>}
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const addAllButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Add All');
const rows = () => container.querySelectorAll('li');

async function clickAddAll() {
  await act(async () => {
    addAllButton()!.click();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  isLocked = false;
  viewer.role = 'admin';
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SuggestionsCard — Add All', () => {
  it('sits between New and Clear All', async () => {
    await render(3);
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    const at = (label: string) => labels.indexOf(label);
    expect(at('New')).toBeGreaterThan(-1);
    expect(at('Add All')).toBe(at('New') + 1);
    expect(at('Clear All')).toBe(at('Add All') + 1);
  });

  it('tracks every suggestion listed and takes them off the list', async () => {
    await render(3);
    actions.trackSuggestions.mockResolvedValue({
      trackedIds: ids(1, 3),
      skippedIds: [],
    } satisfies TrackSuggestionsResult);

    await clickAddAll();

    expect(actions.trackSuggestions).toHaveBeenCalledExactlyOnceWith(ids(1, 3));
    expect(rows()).toHaveLength(0);
    expect(onAccepted).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith('3 prompts added to your tracked list');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('sends more than 25 in batches', async () => {
    await render(30);
    actions.trackSuggestions.mockImplementation(async (batch: string[]) => ({
      trackedIds: batch,
      skippedIds: [],
    }));

    await clickAddAll();

    expect(actions.trackSuggestions.mock.calls).toEqual([[ids(1, 25)], [ids(26, 30)]]);
    expect(rows()).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith('30 prompts added to your tracked list');
  });

  it('keeps the rest and says how to make room when the plan limit is reached', async () => {
    await render(25);
    actions.trackSuggestions.mockResolvedValue({
      trackedIds: ids(1, 10),
      skippedIds: [],
      error: 'Your Starter plan allows up to 50 active prompt locations…',
      code: 'plan_limit',
    } satisfies TrackSuggestionsResult);

    await clickAddAll();

    expect(rows()).toHaveLength(15);
    expect(rows()[0].textContent).toContain('Prompt 11');
    expect(toast.success).toHaveBeenCalledWith('10 prompts added to your tracked list');
    expect(toast.error).not.toHaveBeenCalled();
    const note = container.querySelector('[role="alert"]')!;
    expect(note.textContent).toContain("15 suggestions couldn't be added");
    expect(note.textContent).toContain(
      "10 were added before your plan's prompt limit was reached.",
    );
    expect(note.textContent).toContain(
      'Upgrade your plan, or pause 15 prompts in Tracked Prompts first and try again.',
    );
    expect(note.querySelector('a[href="/dashboard/prompts/tracked"]')?.textContent).toBe(
      'Go to Tracked Prompts',
    );
    // The page's own Upgrade / Contact us buttons.
    expect([...note.querySelectorAll('button')].map((b) => b.textContent)).toContain(
      'Upgrade plan',
    );
  });

  it('stops after the batch that reached the limit', async () => {
    await render(30, 'growth');
    actions.trackSuggestions.mockResolvedValue({
      trackedIds: [],
      skippedIds: ['s1'],
      error: 'limit',
      code: 'plan_limit',
    } satisfies TrackSuggestionsResult);

    await clickAddAll();

    expect(actions.trackSuggestions).toHaveBeenCalledOnce();
    expect(onAccepted).not.toHaveBeenCalled();
    // The skipped one was handled elsewhere: it leaves, the other 29 stay.
    expect(rows()).toHaveLength(29);
    const note = container.querySelector('[role="alert"]')!;
    expect(note.textContent).toContain("29 suggestions couldn't be added");
    expect(note.textContent).toContain(
      "Your plan's prompt limit is reached. Contact us to raise your limit, or pause 29 prompts",
    );

    await act(async () => {
      (note.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('reports any other failure as an error and keeps what was not added', async () => {
    await render(3);
    actions.trackSuggestions.mockResolvedValue({
      trackedIds: ['s1'],
      skippedIds: [],
      error: 'Something broke',
    } satisfies TrackSuggestionsResult);

    await clickAddAll();

    expect(rows()).toHaveLength(2);
    expect(toast.success).toHaveBeenCalledWith('1 prompt added to your tracked list');
    expect(toast.error).toHaveBeenCalledWith('Something broke');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('says so when every suggestion was already handled elsewhere', async () => {
    await render(2);
    actions.trackSuggestions.mockResolvedValue({
      trackedIds: [],
      skippedIds: ids(1, 2),
    } satisfies TrackSuggestionsResult);

    await clickAddAll();

    expect(rows()).toHaveLength(0);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('These suggestions were already added or dismissed');
  });
});

describe('SuggestionsCard — Clear All', () => {
  // Suggestions from Search Console and Analytics stay hidden for 30 days once dismissed.
  const measured = (n: number, source: 'gsc' | 'ga'): PromptSuggestion => ({
    ...suggestion(n),
    source,
  });

  async function renderList(list: PromptSuggestion[]) {
    actions.getPromptSuggestions.mockResolvedValue({ ok: true, suggestions: list, stale: false });
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <SuggestionsCard brandId="b1" onAccepted={onAccepted} sourceStates={null} />
          </UpgradeDialogContext.Provider>
        </NextIntlClientProvider>,
      );
    });
  }
  const button = (label: string, root: ParentNode = container) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  const dialog = () => document.body.querySelector('[role="dialog"]');
  async function click(target: HTMLButtonElement | undefined) {
    await act(async () => {
      target!.click();
    });
  }

  it('asks first, with how many it dismisses and how many come from Search Console or Analytics', async () => {
    await renderList([suggestion(1), measured(2, 'gsc'), suggestion(3), measured(4, 'ga')]);
    await click(button('Clear All'));
    expect(dialog()?.textContent).toContain('4 suggestions listed will be dismissed.');
    expect(dialog()?.textContent).toContain(
      '2 of them come from Search Console or Analytics: once dismissed, they stay hidden for 30 days.',
    );
    expect(actions.dismissSuggestions).not.toHaveBeenCalled();
  });

  it('changes nothing when cancelled', async () => {
    await renderList([measured(1, 'gsc'), suggestion(2)]);
    await click(button('Clear All'));
    await click(button('Cancel', dialog()!));
    expect(actions.dismissSuggestions).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('clears a list of only Search Console and Analytics suggestions once confirmed', async () => {
    actions.dismissSuggestions.mockResolvedValue({ ok: true, dismissed: ['s1', 's2'], failed: [] });
    await renderList([measured(1, 'gsc'), measured(2, 'ga')]);
    await click(button('Clear All'));
    expect(dialog()?.textContent).toContain('2 suggestions listed will be dismissed.');
    expect(dialog()?.textContent).toContain('2 of them come from Search Console or Analytics');
    await click(button('Clear all', dialog()!));
    expect(actions.dismissSuggestions).toHaveBeenCalledWith(['s1', 's2']);
    expect(rows()).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says nothing of Search Console when none is listed, and brings back what couldn't be dismissed", async () => {
    actions.dismissSuggestions.mockResolvedValue({ ok: true, dismissed: ['s1'], failed: ['s2'] });
    await renderList([suggestion(1), suggestion(2)]);
    await click(button('Clear All'));
    expect(dialog()?.textContent).not.toContain('Search Console');
    await click(button('Clear all', dialog()!));
    expect([...rows()].map((r) => r.textContent).join()).toContain('Prompt 2');
    expect(rows()).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith("1 suggestion couldn't be dismissed. Try again.");
  });

  it('puts every one back when the dismiss could not run', async () => {
    actions.dismissSuggestions.mockResolvedValue({ ok: false, failure: 'failed' });
    await renderList([suggestion(1), measured(2, 'gsc')]);
    await click(button('Clear All'));
    await click(button('Clear all', dialog()!));
    expect(rows()).toHaveLength(2);
    expect(toast.error).toHaveBeenCalledWith("Couldn't clear the suggestions. Try again.");
  });
});

describe('SuggestionsCard — estimated volume', () => {
  it("shows an AI's guess as a grey range, never a bare number", async () => {
    actions.getPromptSuggestions.mockResolvedValue({
      ok: true,
      suggestions: [{ ...suggestion(1), estVolume: 1200 }],
      stale: false,
    });
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <SuggestionsCard
            brandId="b1"
            onAccepted={onAccepted}
            sourceStates={null}
            planId="growth"
          />
        </NextIntlClientProvider>,
      );
    });
    const range = container.querySelector<HTMLButtonElement>('button[aria-label*="a month"]')!;
    expect(range.textContent).toBe('600–2.4k/mo');
    expect(range.getAttribute('aria-label')).toBe('600–2.4k a month, estimated, Low confidence');
    expect(range.className).toContain('text-muted-foreground');
    expect(container.textContent).not.toContain('~1,200');
  });
});

describe('SuggestionsCard on a read-only workspace (plan not active)', () => {
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === name || b.getAttribute('aria-label') === name,
    )!;

  it('adds, accepts, dismisses and generates nothing, and says why', async () => {
    isLocked = true;
    await render(2);

    await clickAddAll();
    expect(openUpgrade).toHaveBeenLastCalledWith('Adding prompts needs a plan');
    await act(async () => button('Add to tracked prompts').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Adding prompts needs a plan');
    await act(async () => button('Dismiss suggestion').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Dismissing suggestions needs a plan');
    await act(async () => button('New').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Suggesting prompts needs a plan');

    expect(openUpgrade).toHaveBeenCalledTimes(4);
    expect(actions.trackSuggestions).not.toHaveBeenCalled();
    expect(actions.acceptSuggestion).not.toHaveBeenCalled();
    expect(actions.dismissSuggestion).not.toHaveBeenCalled();
    expect(actions.refreshPromptSuggestions).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
  });

  it('accepts on an active plan', async () => {
    await render(1);
    actions.acceptSuggestion.mockResolvedValue({ success: true });
    await act(async () => button('Add to tracked prompts').click());
    expect(actions.acceptSuggestion).toHaveBeenCalledWith('s1');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});

describe('SuggestionsCard on a brand without topics', () => {
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === name || b.getAttribute('aria-label') === name,
    )!;
  // The dialog renders in a portal, outside the card.
  const askedForTopic = () => document.body.textContent?.includes('Add a topic first') ?? false;
  const addTopicHref = () =>
    [...document.body.querySelectorAll('a')]
      .find((a) => a.textContent === 'Add a topic')
      ?.getAttribute('href');
  const noTopics = {
    error: 'Add a topic first: prompts are grouped under topics.',
    code: 'no_topics',
  };

  it('asks for a topic first when Generate Suggestions finds none, and opens Add Topic in place', async () => {
    actions.refreshPromptSuggestions.mockResolvedValue({ ok: false, failure: 'no_topics' });
    const onAddTopic = vi.fn();
    await render(0, 'starter', onAddTopic);
    await act(async () => button('Generate Suggestions').click());
    expect(askedForTopic()).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    // On the Prompts page a button, not a link: the page switches to its Topics tab.
    const addTopic = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Add a topic',
    )!;
    await act(async () => addTopic.click());
    expect(onAddTopic).toHaveBeenCalledTimes(1);
    expect(askedForTopic()).toBe(false);
  });

  it('links to the Topics tab when no page gives a way in', async () => {
    actions.refreshPromptSuggestions.mockResolvedValue({ ok: false, failure: 'no_topics' });
    await render(0);
    await act(async () => button('Generate Suggestions').click());
    expect(addTopicHref()).toBe('/dashboard/prompts/topics?new=1');
  });

  it('asks for a topic first when New finds none, and keeps the list', async () => {
    actions.refreshPromptSuggestions.mockResolvedValue({ ok: false, failure: 'no_topics' });
    await render(2);
    await act(async () => button('New').click());
    expect(askedForTopic()).toBe(true);
    expect(rows()).toHaveLength(2);
  });

  it('asks for a topic first when adding a suggestion finds none, and keeps it listed', async () => {
    actions.acceptSuggestion.mockResolvedValue(noTopics);
    await render(2);
    await act(async () => button('Add to tracked prompts').click());
    expect(askedForTopic()).toBe(true);
    expect(rows()).toHaveLength(2);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('asks for a topic first when Add All finds none', async () => {
    actions.trackSuggestions.mockResolvedValue({ trackedIds: [], skippedIds: [], ...noTopics });
    await render(3);
    await clickAddAll();
    expect(askedForTopic()).toBe(true);
    expect(rows()).toHaveLength(3);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('generates as before once the brand has a topic', async () => {
    actions.refreshPromptSuggestions.mockResolvedValue({ ok: true, suggestions: [suggestion(7)] });
    await render(0);
    await act(async () => button('Generate Suggestions').click());
    expect(rows()).toHaveLength(1);
    expect(askedForTopic()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Suggestions refreshed');
  });
});

/**
 * A failed generation says why in plain words (apiFailure), never the
 * message production hides: a used-up allowance, a read-only workspace or
 * the demo brand (the upgrade dialog), a role refusal or an outage.
 */
describe('SuggestionsCard — a failed generation', () => {
  const generate = async () => {
    await render(0);
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Generate Suggestions',
    )!;
    await act(async () => button.click());
  };

  it("says this month's allowance is used up", async () => {
    actions.refreshPromptSuggestions.mockResolvedValue({
      ok: false,
      failure: 'limit',
      retryable: false,
    });
    await generate();
    expect(toast.error).toHaveBeenCalledWith(
      "You've used this month's allowance. Upgrade, or wait until it resets.",
      expect.objectContaining({ action: expect.objectContaining({ label: 'Upgrade' }) }),
    );
  });

  it('opens the upgrade dialog for a read-only workspace or the demo brand', async () => {
    actions.refreshPromptSuggestions.mockResolvedValue({
      ok: false,
      failure: 'subscription',
      retryable: false,
    });
    await generate();
    expect(openUpgrade).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says something went wrong for a refusal or an outage, and when the request itself fails', async () => {
    actions.refreshPromptSuggestions.mockResolvedValue({
      ok: false,
      failure: 'failed',
      retryable: true,
    });
    await generate();
    expect(toast.error).toHaveBeenLastCalledWith('Something went wrong. Try again.', {});

    act(() => root.unmount());
    root = createRoot(container);
    actions.refreshPromptSuggestions.mockRejectedValue(new Error('masked in production'));
    await generate();
    expect(toast.error).toHaveBeenLastCalledWith('Something went wrong. Try again.', {});
    expect(toast.error).not.toHaveBeenCalledWith('masked in production');
  });
});

describe('SuggestionsCard by role', () => {
  const labels = () =>
    [...container.querySelectorAll('button')].map(
      (b) => b.getAttribute('aria-label') ?? b.textContent,
    );

  it('shows an analyst Dismiss and Clear All, but no way to add a prompt', async () => {
    viewer.role = 'analyst';
    await render(2);
    expect(labels()).not.toContain('New');
    expect(labels()).not.toContain('Add All');
    expect(labels()).not.toContain('Add to tracked prompts');
    expect(labels()).toContain('Clear All');
    expect(labels().filter((l) => l === 'Dismiss suggestion')).toHaveLength(2);
  });

  it('leaves an agency partner the list to read, without adding or dismissing', async () => {
    viewer.role = 'agency_partner';
    await render(2);
    expect(rows()).toHaveLength(2);
    for (const label of ['Add All', 'Clear All', 'Add to tracked prompts', 'Dismiss suggestion']) {
      expect(labels(), label).not.toContain(label);
    }
  });

  it('tells an analyst who generates suggestions, instead of Generate Suggestions', async () => {
    viewer.role = 'analyst';
    await render(0);
    expect(labels()).not.toContain('Generate Suggestions');
    expect(container.textContent).toContain(
      'Ask an admin or a manager to generate prompt suggestions.',
    );
  });

  it('offers a manager Generate Suggestions on an empty list', async () => {
    viewer.role = 'manager';
    await render(0);
    expect(labels()).toContain('Generate Suggestions');
  });

  it('shows a manager every action', async () => {
    viewer.role = 'manager';
    await render(1);
    for (const label of [
      'New',
      'Add All',
      'Clear All',
      'Add to tracked prompts',
      'Dismiss suggestion',
    ]) {
      expect(labels(), label).toContain(label);
    }
  });
});

describe('SuggestionsCard — shopping questions from the catalog (ECOM-003)', () => {
  const fromCatalog: PromptSuggestion = {
    ...suggestion(2),
    suggestedText: 'best hiking backpacks under $150',
    source: 'catalog',
    sourceData: {
      category: 'Bags > Hiking backpacks',
      products: 18,
      priceLow: 60,
      priceHigh: 180,
      priceUnder: 150,
      currency: 'USD',
    },
  };

  async function show(search = '') {
    window.history.replaceState(null, '', `/dashboard/prompts${search}`);
    actions.getPromptSuggestions.mockResolvedValue({
      ok: true,
      suggestions: [suggestion(1), fromCatalog],
      stale: false,
    });
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <SuggestionsCard brandId="b1" onAccepted={onAccepted} sourceStates={null} />
        </NextIntlClientProvider>,
      );
    });
  }

  afterEach(() => window.history.replaceState(null, '', '/'));

  it('marks a suggestion drawn from the catalog as Your catalog', async () => {
    await show();
    const [plain, shopping] = [...rows()];
    expect(plain.textContent).not.toContain('Your catalog');
    expect(shopping.textContent).toContain('Your catalog');
    expect(shopping.textContent).toContain('GetCito Agents');
  });

  it('lists only the shopping questions on ?source=shopping', async () => {
    await show('?source=shopping');
    expect([...rows()].map((li) => li.textContent)).toEqual([
      expect.stringContaining('best hiking backpacks under $150'),
    ]);
    expect(container.textContent).toContain('Shopping');
  });
});

describe('SuggestionsCard — a failed read', () => {
  async function mount() {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <SuggestionsCard brandId="b1" onAccepted={onAccepted} sourceStates={null} />
        </NextIntlClientProvider>,
      );
    });
  }
  const retryButton = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry');

  afterEach(() => vi.useRealTimers());

  it('tries once more by itself when the API did not answer, and lists what comes back', async () => {
    vi.useFakeTimers();
    actions.getPromptSuggestions
      .mockResolvedValueOnce({ ok: false, failure: 'failed', retryable: true })
      .mockResolvedValueOnce({ ok: true, suggestions: [suggestion(1)], stale: false });
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(actions.getPromptSuggestions).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(1);
    expect(container.textContent).not.toContain("Couldn't load suggestions");
  });

  it("says the API is not answering in plain words, never React's hidden message, and Retry reads again", async () => {
    vi.useFakeTimers();
    actions.getPromptSuggestions.mockResolvedValue({
      ok: false,
      failure: 'failed',
      retryable: true,
    });
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(actions.getPromptSuggestions).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Couldn't load suggestions");
    expect(container.textContent).toContain("GetCito isn't answering right now.");
    expect(container.textContent).not.toContain('Minified React error');

    actions.getPromptSuggestions.mockResolvedValue({
      ok: true,
      suggestions: [suggestion(1), suggestion(2)],
      stale: false,
    });
    await act(async () => {
      retryButton()!.click();
    });
    expect(rows()).toHaveLength(2);
  });

  it('says why when trying again would not help, without retrying by itself', async () => {
    actions.getPromptSuggestions.mockResolvedValue({
      ok: false,
      failure: 'workspace',
      retryable: false,
    });
    await mount();
    expect(actions.getPromptSuggestions).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("This brand isn't in your workspace.");
    expect(retryButton()).toBeDefined();
  });

  it('reads a server action that threw on its way as no answer', async () => {
    vi.useFakeTimers();
    actions.getPromptSuggestions.mockRejectedValue(new Error('Minified React error #441'));
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(container.textContent).toContain("GetCito isn't answering right now.");
    expect(container.textContent).not.toContain('Minified React error');
  });
});
