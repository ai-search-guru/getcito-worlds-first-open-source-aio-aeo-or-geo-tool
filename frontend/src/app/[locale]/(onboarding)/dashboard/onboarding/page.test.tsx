import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/**
 * Onboarding's suggestions once the day's setup suggestions are used up
 * (429 onboarding_daily_limit): each step says so, and says how to go on,
 * with no Try again; any other failure keeps Try again. The wizard resumes on
 * a brand already created, so the steps are reached without walking them.
 */

/** The brand's rows the resume reads; prompt sets decide step 3 or step 5. */
const db = vi.hoisted(() => ({
  promptSets: [] as { id: string }[],
  // Onboarded already, with no active plan: the resume opens the plan step.
  onboarded: false,
  // The filters each brands read was made with.
  brandFilters: [] as [string, unknown][][],
  // The organization has its demo brand already.
  hasDemo: false,
}));
vi.mock('@/lib/supabase/client', () => {
  /** A query that answers `data` however it ends (single, limit, or awaited). */
  const query = (read: () => unknown, filters?: [string, unknown][]) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'limit', 'order', 'update']) q[m] = () => q;
    q.eq = (column: string, value: unknown) => {
      filters?.push([column, value]);
      return q;
    };
    q.single = async () => ({ data: read() });
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: read() });
    return q;
  };
  /** The demo brand, for a read that asks for it. */
  const demoRows = (filters: [string, unknown][]) =>
    filters.some(([column, value]) => column === 'is_demo' && value === true)
      ? db.hasDemo
        ? [{ id: 'demo' }]
        : []
      : null;
  const rows: Record<string, () => unknown> = {
    // "What do you work on?" (menu access) answered: the resume goes on to the plan step.
    profiles: () => ({
      organization_id: 'org-1',
      onboarding_completed: db.onboarded,
      work_areas_asked_at: db.onboarded ? '2026-10-01T00:00:00Z' : null,
    }),
    brands: () => [
      {
        id: 'b1',
        organization_id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        brand_domains: [{ id: 'd1', brand_id: 'b1', domain: 'acme.com', is_primary: true }],
      },
    ],
    prompt_sets: () => db.promptSets,
  };
  return {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (table: string) => {
        const filters: [string, unknown][] = [];
        if (table === 'brands') db.brandFilters.push(filters);
        return query(
          () => (table === 'brands' ? demoRows(filters) : null) ?? rows[table]?.() ?? null,
          filters,
        );
      },
    }),
  };
});
const prepareDemoBrand = vi.hoisted(() => vi.fn(async () => ({ ok: false, status: 0 })));
vi.mock('@/lib/demo/demoClient', () => ({
  prepareDemoBrand,
  demoPreparation: () => null,
  setDemoHidden: vi.fn(),
}));
vi.mock('@/lib/actions/topic', () => ({
  getTopics: vi.fn(async () => [{ id: 't1', name: 'Coffee' }]),
  createTopics: vi.fn(async () => undefined),
}));
const getCompetitors = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));
vi.mock('@/lib/actions/competitor', () => ({
  getCompetitors,
  addCompetitor: vi.fn(),
}));
vi.mock('@/lib/actions/brand', () => ({ createBrand: vi.fn(), markBrandAsEcommerce: vi.fn() }));
const getTrackedPromptCount = vi.hoisted(() => vi.fn(async () => 10));
vi.mock('@/lib/actions/prompt', () => ({
  getPromptCapacity: vi.fn(async () => ({ maxPrompts: 50, used: 0 })),
  getTrackedPromptCount,
  savePromptSet: vi.fn(),
}));
vi.mock('@/lib/actions/tracking', () => ({ triggerTrackingCheck: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ bootstrapBrandVolumes: vi.fn() }));
vi.mock('@/lib/actions/menuAccess', () => ({ setMyWorkAreas: vi.fn() }));
const setup = vi.hoisted(() => ({
  suggestTopics: vi.fn(),
  generatePromptsFromTopics: vi.fn(),
  suggestCompetitors: vi.fn(),
  detectSiteType: vi.fn(async () => ({ siteType: null, industry: null })),
}));
vi.mock('@/lib/aiBrandSetup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/aiBrandSetup')>()),
  ...setup,
}));
// The effects depend on these: the same ones every render.
const stable = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, refresh: () => {} },
  store: { addBrand: () => {}, setActiveBrand: () => {}, updateBrand: () => {} },
}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => stable.router }));
vi.mock('@/state/useBrandStore', () => ({ useBrandStore: () => stable.store }));
vi.mock('@/components/onboarding/OnboardingFrame', () => ({
  OnboardingFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/onboarding/DashboardPreview', () => ({ DashboardPreview: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: OnboardingPage } = await import('./page');
const { SetupDailyLimitError } = await import('@/lib/aiBrandSetup');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.promptSets = [];
  db.onboarded = false;
  db.brandFilters = [];
  db.hasDemo = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <OnboardingPage />
      </NextIntlClientProvider>,
    );
  });
  // The resume reads, then the step's own suggestions.
  await act(async () => {});
  await act(async () => {});
}

const text = () => container.textContent ?? '';
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);

describe('setup suggestions used up for the day', () => {
  it('says so on the competitors step, with no Try again', async () => {
    db.promptSets = [{ id: 's1' }];
    setup.suggestCompetitors.mockRejectedValue(new SetupDailyLimitError('limit'));
    await render();
    expect(setup.suggestCompetitors).toHaveBeenCalledOnce();
    expect(text()).toContain(
      'Setup suggestions are used up for today. Try again tomorrow, or add your own.',
    );
    expect(text()).not.toContain("Couldn't fetch competitor suggestions");
    expect(button('Try again')).toBeUndefined();
  });

  it('keeps Try again for any other failure', async () => {
    db.promptSets = [{ id: 's1' }];
    setup.suggestCompetitors.mockRejectedValue(new Error('Server error: 500'));
    await render();
    expect(text()).toContain("Couldn't fetch competitor suggestions right now");
    expect(button('Try again')).toBeDefined();
  });

  it('says on the prompts step to add your own to each topic to continue', async () => {
    setup.generatePromptsFromTopics.mockRejectedValue(new SetupDailyLimitError('limit'));
    await render();
    await act(async () => button('Looks good')!.click());
    expect(setup.generatePromptsFromTopics).toHaveBeenCalledOnce();
    expect(text()).toContain(
      'Setup suggestions are used up for today. Add your own prompts to each topic below to continue.',
    );
    expect(text()).not.toContain("Couldn't generate prompt suggestions");
  });
});

describe('the plan step', () => {
  // The trial check, the first-month code's check, and Checkout's answer.
  const trialAvailable = { value: true };
  const promo = { status: 200 };
  const answer = async (url: string) =>
    url === '/api/stripe/trial'
      ? Response.json({ trialAvailable: trialAvailable.value, trialDays: 14 })
      : url === '/api/stripe/promo-code'
        ? Response.json(
            promo.status === 200
              ? {
                  valid: true,
                  code: 'SAVE50',
                  percentOff: 50,
                  amountOff: null,
                  duration: 'once',
                  durationInMonths: null,
                }
              : { error: 'Internal error' },
            { status: promo.status },
          )
        : Response.json({ url: '#checkout' });
  const fetchMock = vi.fn(answer);
  /** What was sent to Checkout. */
  const checkoutBody = () =>
    JSON.parse(
      (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(
        ([url]) => url === '/api/stripe/checkout',
      )![1].body as string,
    );
  const modeButtons = (mode: 'buy' | 'trial') => [
    ...container.querySelectorAll<HTMLButtonElement>(`[data-mode="${mode}"]`),
  ];
  const slots = (slot: string) =>
    [...container.querySelectorAll(`[data-slot="${slot}"]`)].map((el) => el.textContent);
  const choices = () =>
    [...container.querySelectorAll('[data-choice]')].map((el) => el.textContent);
  async function choose(choice: 'trial' | 'month' | 'year') {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)!.click();
    });
  }

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    trialAvailable.value = true;
    promo.status = 200;
    fetchMock.mockClear();
    fetchMock.mockImplementation(answer);
    vi.stubGlobal('fetch', fetchMock);
    db.onboarded = true;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    getCompetitors.mockResolvedValue([]);
  });

  it('offers the demo brand under the plans, for someone not ready to add a card', async () => {
    db.onboarded = true;
    await render();
    expect(text()).toContain('Choose how to start');
    const card = container.querySelector('[data-slot="explore-demo"]')!;
    expect(card.textContent).toContain('Not ready to add a card? Explore a demo brand');
    // The own brand, read without the demo brand.
    expect(card.textContent).toContain('Acme stays saved');
    expect(db.brandFilters).toContainEqual([
      ['organization_id', 'org-1'],
      ['is_demo', false],
    ]);
    expect(button('Explore the demo')).toBeDefined();
  });

  it('offers one choice of how to start, then one button on each plan, a card for both', async () => {
    await render();
    expect(text()).toContain('Choose how to start');
    expect(text()).not.toContain('Start Your 14-Day Free Trial');
    expect(text()).not.toContain('No charge today');
    expect(choices()).toEqual(['14-day trial', 'Monthly50% off the first month', 'YearlySave 20%']);
    // Monthly first, with the first-month offer: its price large on the card.
    expect(modeButtons('buy').map((b) => b.textContent)).toEqual(['Buy now', 'Buy now']);
    expect(modeButtons('trial')).toEqual([]);
    expect(slots('plan-price')[0]).toContain('$24.50first month');
    expect(slots('due-amount')).toEqual(['$24.50', '$124.50']);
    expect(slots('start-terms')).toEqual(['Full plan from day one', 'Full plan from day one']);
    expect(slots('limited-offer')).toEqual(['Limited offer', 'Limited offer']);
    expect(slots('trust-line')).toEqual([
      'Secure checkout with Stripe · Cancel any time',
      'Secure checkout with Stripe · Cancel any time',
    ]);
    expect(container.querySelector('[data-slot="card-note"]')?.textContent).toBe(
      'Card required for both.',
    );
    // Billing's own taglines and features, not onboarding's copy of them.
    expect(text()).toContain('For small teams getting started with AI visibility');
    expect(text()).toContain('50 prompts tracked');
    expect(text()).not.toContain('Core Platform Features');
    // The demo card stays below the plans.
    expect(container.querySelector('[data-slot="explore-demo"]')).not.toBeNull();
  });

  it("says what is ready to track, from the own brand's real setup", async () => {
    getCompetitors.mockResolvedValue([
      { id: 'c1', name: 'Crema Club' },
      { id: 'c2', name: 'Origin Box' },
    ]);
    await render();
    await act(async () => {});
    expect(getTrackedPromptCount).toHaveBeenCalledWith('b1');
    expect(container.querySelector('[data-slot="ready-to-track"]')?.textContent).toBe(
      'Ready to track for Acme: 10 prompts · 1 topic · 2 competitors',
    );
    expect(container.querySelector('[data-slot="ready-to-track"] strong')?.textContent).toBe(
      'Acme',
    );
  });

  it('says nothing of it when the setup could not be read', async () => {
    getTrackedPromptCount.mockRejectedValueOnce(new Error('offline'));
    await render();
    await act(async () => {});
    expect(container.querySelector('[data-slot="ready-to-track"]')).toBeNull();
  });

  it('shows the trial with nothing due today, when it ends and what follows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    await render();
    await choose('trial');
    expect(modeButtons('trial').map((b) => b.textContent)).toEqual([
      'Start 14-day free trial',
      'Start 14-day free trial',
    ]);
    expect(slots('due-amount')).toEqual(['$0', '$0']);
    expect(slots('start-terms')).toEqual([
      'Free until Nov 11, then $49/monthLimited AI usage for 14 days',
      'Free until Nov 11, then $249/monthLimited AI usage for 14 days',
    ]);
    // No offer with the trial: the plain price.
    expect(text()).not.toContain('Limited offer');
  });

  it('buys now with the first-month offer, and starts the trial without it', async () => {
    await render();
    await act(async () => modeButtons('buy')[0].click());
    expect(checkoutBody()).toEqual({
      planId: 'starter',
      organizationId: 'org-1',
      interval: 'month',
      mode: 'buy',
      promotionCode: 'SAVE50',
    });

    act(() => root.unmount());
    root = createRoot(container);
    fetchMock.mockClear();
    await render();
    await choose('trial');
    await act(async () => modeButtons('trial')[1].click());
    expect(checkoutBody()).toEqual({
      planId: 'growth',
      organizationId: 'org-1',
      interval: 'month',
      mode: 'trial',
    });
  });

  it('buys a year at its price, without the code', async () => {
    await render();
    await choose('year');
    expect(slots('due-amount')).toEqual(['$470', '$2,390']);
    expect(modeButtons('buy').map((b) => b.textContent)).toEqual([
      'Choose Starter',
      'Choose Growth',
    ]);
    await act(async () => modeButtons('buy')[1].click());
    expect(checkoutBody()).toEqual({
      planId: 'growth',
      organizationId: 'org-1',
      interval: 'year',
      mode: 'buy',
    });
  });

  it('says by the button when Checkout would not open, and stops waiting', async () => {
    await render();
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/stripe/checkout'
        ? Response.json({ error: 'Price not configured for this plan' }, { status: 400 })
        : answer(url),
    );
    await act(async () => modeButtons('buy')[1].click());
    const growth = container.querySelector('[data-plan="growth"]')!;
    expect(growth.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't open the checkout. Try again.",
    );
    expect(modeButtons('buy').map((b) => b.textContent)).toEqual(['Buy now', 'Buy now']);
    expect(modeButtons('buy').every((b) => !b.disabled)).toBe(true);
  });

  it('turns to buying once Checkout finds the trial used', async () => {
    await render();
    await choose('trial');
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/stripe/checkout'
        ? Response.json({ error: 'Trial used', code: 'trial_unavailable' }, { status: 409 })
        : answer(url),
    );
    await act(async () => modeButtons('trial')[0].click());
    expect(choices()).toEqual(['Monthly50% off the first month', 'YearlySave 20%']);
    expect(container.querySelector('[data-plan="starter"] [role="alert"]')?.textContent).toBe(
      "This workspace's free trial has been used. Buy now to start the plan.",
    );
    expect(text()).toContain('Choose Your Plan');
  });

  it('keeps the offer as configured when its code could not be checked', async () => {
    promo.status = 500;
    await render();
    await act(async () => {});
    expect(slots('due-amount')).toEqual(['$24.50', '$124.50']);
    await act(async () => modeButtons('buy')[0].click());
    expect(checkoutBody()).toMatchObject({ promotionCode: 'SAVE50' });
  });

  it('offers only buying once the trial was used', async () => {
    trialAvailable.value = false;
    await render();
    expect(text()).toContain('Choose Your Plan');
    expect(choices()).toEqual(['Monthly50% off the first month', 'YearlySave 20%']);
    expect(modeButtons('trial')).toEqual([]);
    expect(slots('start-terms')).toEqual([]);
    expect(container.querySelector('[data-slot="card-note"]')?.textContent).toBe('Card required.');
  });

  it('shows the plain price with the first-month offer off', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIRST_MONTH_OFFER', 'off');
    await render();
    expect(choices()).toEqual(['14-day trial', 'Monthly', 'YearlySave 20%']);
    expect(modeButtons('buy').map((b) => b.textContent)).toEqual([
      'Choose Starter',
      'Choose Growth',
    ]);
    expect(slots('due-amount')).toEqual(['$49', '$249']);
    expect(text()).not.toContain('Limited offer');
    expect(text()).not.toContain('50%');
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/stripe/promo-code');
    await act(async () => modeButtons('buy')[0].click());
    expect(checkoutBody()).toEqual({
      planId: 'starter',
      organizationId: 'org-1',
      interval: 'month',
      mode: 'buy',
    });
  });

  it('starts the demo brand setup ahead for an organization with none yet', async () => {
    await render();
    await act(async () => {});
    expect(prepareDemoBrand).toHaveBeenCalledTimes(1);
  });

  it('starts nothing ahead when the demo brand is there already', async () => {
    db.hasDemo = true;
    await render();
    await act(async () => {});
    expect(prepareDemoBrand).not.toHaveBeenCalled();
  });
});
