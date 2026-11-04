import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import { ChatAgenticProvider } from '@/components/context/ChatAgenticProvider';
import { useBrandStore } from '@/state/useBrandStore';
import type { Brand } from '@/types';
import { ChoosePlanDialog, type PlanPitch } from './ChoosePlanDialog';

/**
 * "Choose a plan to keep going" with the plans: Billing's features and
 * prices, one choice above the cards for how the plan starts (the free
 * trial, monthly or a year up front), what is due today and one button to
 * Checkout on each card, and a promotion code behind "Have a code?" (checked
 * with Stripe, monthly only). Members see the plans without buying.
 */

// An in-memory localStorage for the brand store to persist to, before the store
// loads: the test environment has none.
vi.hoisted(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, String(value)),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
});

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

/** SAVE50 as the promo route reads it from Stripe. */
const save50 = {
  valid: true,
  code: 'SAVE50',
  percentOff: 50,
  amountOff: null,
  duration: 'once',
  durationInMonths: null,
  monthlyOnly: true,
};

async function render({
  role = 'admin',
  action = 'Adding prompts needs a plan',
  demo = null,
  pitch = demo ? { from: 'demo', offer: demo } : null,
  chatAgentic = false,
}: {
  role?: TeamRole;
  action?: string | null;
  demo?: 'trial' | 'first_month' | null;
  pitch?: PlanPitch | null;
  /** The new Chat on for the workspace (CHAT_AGENTIC). */
  chatAgentic?: boolean;
} = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatAgenticProvider enabled={chatAgentic}>
          <RoleProvider role={role}>
            <ChoosePlanDialog
              open
              onOpenChange={() => {}}
              action={action}
              askAdmin="Ask your admin to choose a plan."
              organizationId="org1"
              pitch={pitch}
            />
          </RoleProvider>
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
}

function brand(id: string, name: string, isDemo = false): Brand {
  return {
    id,
    organizationId: 'org1',
    name,
    slug: id,
    shoppingModeEnabled: false,
    isActive: true,
    isDemo,
    domains: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const card = (plan: string) => dialog().querySelector<HTMLElement>(`[data-plan="${plan}"]`)!;
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
const price = (plan: string) => text(card(plan).querySelector('[data-slot="plan-price"]'));
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const codeInput = () => document.querySelector<HTMLInputElement>('#upgrade-promo-code');
/** A plan card's one button, and how it starts ('buy' or 'trial'). */
const startButton = (plan: string) =>
  card(plan).querySelector<HTMLButtonElement>('button[data-mode]')!;
const mode = (plan: string) => startButton(plan).dataset.mode;
/** What a card says is due today, and the terms under it. */
const due = (plan: string) => text(card(plan).querySelector('[data-slot="due-amount"]'));
const terms = (plan: string) => card(plan).querySelector('[data-slot="start-terms"]')?.textContent;
/** The start selector's buttons, by choice. */
const choiceButton = (choice: 'trial' | 'month' | 'year') =>
  dialog().querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`);
const choices = () =>
  [...dialog().querySelectorAll<HTMLButtonElement>('[data-choice]')].map((b) => b.textContent);
async function press(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}
const choose = (choice: 'trial' | 'month' | 'year') => press(choiceButton(choice)!);
const note = () => document.querySelector('#upgrade-promo-note')!.textContent;

async function click(label: string) {
  await act(async () => {
    button(label)!.click();
  });
}

/** Opens the code field behind "Have a code?", types a code and presses Apply. */
async function apply(code: string) {
  if (!codeInput()) await click('Have a code?');
  const input = codeInput()!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, code);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Apply');
}

/** The promo route answers with this; Checkout with a URL. */
function answer(promo: unknown) {
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/stripe/promo-code' ? Response.json(promo) : Response.json({ url: '#checkout' }),
  );
}

/** The body the dialog sent to a route. */
const sent = (url: string) =>
  JSON.parse(fetchMock.mock.calls.find(([u]) => u === url)![1].body as string);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  answer(save50);
  useBrandStore.setState({ brands: [], activeBrandId: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// A promotion code typed by hand: the first-month offer off, so nothing is applied first.
describe('ChoosePlanDialog', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FIRST_MONTH_OFFER', 'off');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows what was clicked, the title and the read-only word', async () => {
    await render();
    expect(dialog().querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Adding prompts needs a plan',
    );
    expect(dialog().textContent).toContain('Choose a plan to keep going');
    expect(dialog().textContent).toContain(
      "Your workspace has no active plan, so it's read-only. Everything you set up is still here",
    );
  });

  it('says the workspace is read-only when opened from the banner', async () => {
    await render({ action: null });
    expect(dialog().querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Your workspace is read-only',
    );
  });

  it("lists Billing's plans with their monthly prices, Growth as Popular, and Custom", async () => {
    await render();
    expect(price('starter')).toBe('$49/mo');
    expect(price('growth')).toBe('$249/mo');
    expect(card('growth').textContent).toContain('Popular');
    expect(card('starter').textContent).toContain('ChatGPT & Microsoft Copilot tracking');
    expect(card('starter').textContent).toContain('1x AI usage');
    expect(card('growth').textContent).toContain('5x AI usage');
    expect(card('growth').textContent).toContain('White-label reports & exports');
    expect(card('growth').textContent).toContain('Looker Studio');
    expect(button('Choose Starter')).toBeDefined();
    expect(button('Choose Growth')).toBeDefined();
    // One choice for a plan that ended: no trial, and no offer while it's off.
    expect(choices()).toEqual(['Monthly', 'YearlySave 20%']);
    expect(choiceButton('month')?.getAttribute('aria-pressed')).toBe('true');
    expect(mode('starter')).toBe('buy');
    expect(card('starter').querySelectorAll('button[data-mode]')).toHaveLength(1);
    expect(due('starter')).toBe('$49');
    expect(due('growth')).toBe('$249');
    expect(terms('starter')).toBeUndefined();
    expect(text(card('starter').querySelector('[data-slot="trust-line"]'))).toBe(
      'Secure checkout with Stripe · Cancel any time',
    );
    expect(dialog().querySelector('[data-slot="card-note"]')?.textContent).toBe('Card required.');

    const custom = card('custom').textContent;
    expect(custom).toContain('Starting at$499/mo');
    expect(custom).toContain('Contact us');
    expect(custom).toContain('Custom AI usage, from 10x');
    expect(custom).toContain('SSO / SAML and custom feature requests');
    expect(card('custom').querySelector('a')?.getAttribute('href')).toBe(
      'https://getcito.com/contact-us',
    );

    expect(dialog().textContent).toContain('Prices in USD.');
    const pricing = [...dialog().querySelectorAll('a')].find((a) =>
      a.textContent?.includes('See everything each plan includes'),
    );
    expect(pricing?.getAttribute('href')).toBe('https://getcito.com/pricing');
  });

  it('shows a year up front against twelve months, its monthly share and the year due today', async () => {
    await render();
    await choose('year');
    expect(choiceButton('year')?.getAttribute('aria-pressed')).toBe('true');
    expect(choiceButton('month')?.getAttribute('aria-pressed')).toBe('false');
    expect(price('starter')).toBe('Regular price $588$470/yr$39.17 a month, billed yearly');
    expect(price('growth')).toBe('Regular price $2,988$2,390/yr$199.17 a month, billed yearly');
    expect(due('starter')).toBe('$470');
    expect(due('growth')).toBe('$2,390');
  });

  it('keeps the code field behind "Have a code?" until asked for', async () => {
    await render();
    expect(codeInput()).toBeNull();
    await click('Have a code?');
    expect(codeInput()).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(codeInput()));
    expect(button('Have a code?')).toBeUndefined();
  });

  it('applies a code Stripe takes: first month off on the choice, the cards and the buttons', async () => {
    await render();
    await apply('save50');
    expect(sent('/api/stripe/promo-code')).toEqual({ code: 'save50' });
    expect(dialog().querySelector('[data-slot="promo-applied"]')?.textContent).toBe(
      'SAVE50 · 50% off your first month',
    );
    expect(codeInput()).toBeNull();
    expect(choiceButton('month')?.textContent).toBe('Monthly50% off the first month');
    expect(price('starter')).toBe(
      'SAVE50: first month 50% offRegular price $49$24.50first monththen $49/mo',
    );
    expect(price('growth')).toContain('$124.50first month');
    expect(due('starter')).toBe('$24.50');
    expect(due('growth')).toBe('$124.50');
    expect(startButton('growth').textContent).toBe('Buy now');
    expect(startButton('starter').textContent).toBe('Buy now');
    expect(note()).toContain('Code applied. You pay 50% less for the first month');
  });

  it('says when a code is not valid, by the field', async () => {
    answer({ valid: false });
    await render();
    await apply('nope10');
    expect(note()).toBe('“NOPE10” isn’t a valid code.');
    expect(codeInput()?.getAttribute('aria-invalid')).toBe('true');
    expect(codeInput()?.getAttribute('aria-describedby')).toBe('upgrade-promo-note');
    expect(document.querySelector('#upgrade-promo-note')?.getAttribute('aria-live')).toBe('polite');
    expect(price('starter')).toBe('$49/mo');
    expect(button('Choose Starter')).toBeDefined();
  });

  it('says when the code could not be checked', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Internal error' }, { status: 500 }));
    await render();
    await apply('SAVE50');
    expect(note()).toBe("Couldn't check the code. Try again.");
  });

  it('keeps a code to buying monthly, with a way back to Monthly', async () => {
    await render();
    await apply('SAVE50');
    await choose('year');
    expect(note()).toBe('SAVE50 is for buying monthly: 50% off the first month.Switch to Monthly');
    expect(price('starter')).toBe('Regular price $588$470/yr$39.17 a month, billed yearly');
    expect(due('starter')).toBe('$470');
    expect(button('Choose Starter')).toBeDefined();

    await click('Switch to Monthly');
    expect(choiceButton('month')?.getAttribute('aria-pressed')).toBe('true');
    expect(startButton('starter').textContent).toBe('Buy now');
  });

  it('takes the code off with ×, back to the field', async () => {
    await render();
    await apply('SAVE50');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Remove the code"]')!.click();
    });
    expect(codeInput()?.value).toBe('');
    expect(price('growth')).toBe('$249/mo');
    expect(choiceButton('month')?.textContent).toBe('Monthly');
    expect(button('Choose Growth')).toBeDefined();
  });

  it('opens Checkout for the plan and period, with the code on a monthly plan', async () => {
    await render();
    await apply('SAVE50');
    await press(startButton('growth'));
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'growth',
      organizationId: 'org1',
      interval: 'month',
      returnTo: 'billing',
      mode: 'buy',
      promotionCode: 'SAVE50',
    });
    await vi.waitFor(() => expect(window.location.hash).toBe('#checkout'));
  });

  it('opens Checkout for a year without the code', async () => {
    await render();
    await apply('SAVE50');
    await choose('year');
    await click('Choose Starter');
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'starter',
      organizationId: 'org1',
      interval: 'year',
      returnTo: 'billing',
      mode: 'buy',
    });
  });

  it('opens Checkout without a code when none was applied', async () => {
    await render();
    await click('Choose Starter');
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'starter',
      organizationId: 'org1',
      interval: 'month',
      returnTo: 'billing',
      mode: 'buy',
    });
  });

  it('takes back a code Checkout refused, and says so by the field', async () => {
    await render();
    await apply('SAVE50');
    fetchMock.mockResolvedValue(
      Response.json(
        { error: "That promo code isn't valid", code: 'invalid_promo_code' },
        { status: 400 },
      ),
    );
    await press(startButton('starter'));
    expect(note()).toBe('“SAVE50” isn’t a valid code.');
    expect(codeInput()?.value).toBe('SAVE50');
    expect(button('Choose Starter')).toBeDefined();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says by the button when Checkout would not open, and stops waiting', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Stripe is down' }, { status: 500 }));
    await render();
    await click('Choose Starter');
    const alert = card('starter').querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Couldn't open the checkout. Try again.");
    expect(card('starter').querySelector('[data-slot="trust-line"]')).toBeNull();
    expect(card('growth').querySelector('[role="alert"]')).toBeNull();
    expect(button('Choose Starter')?.disabled).toBe(false);
    expect(dialog().textContent).not.toContain('Opening checkout');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says what the route refused, by name', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: 'This organization already has a subscription', code: 'subscription_exists' },
        { status: 409 },
      ),
    );
    await render();
    await click('Choose Growth');
    expect(card('growth').querySelector('[role="alert"]')?.textContent).toBe(
      'This organization already has a subscription',
    );
  });

  it('stops waiting when Checkout cannot be reached at all', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await render();
    await click('Choose Starter');
    expect(card('starter').querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't open the checkout. Try again.",
    );
    expect(button('Choose Starter')?.disabled).toBe(false);
    // Tried again: the word goes while it opens.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await press(startButton('starter'));
    expect(card('starter').querySelector('[role="alert"]')).toBeNull();
    expect(startButton('starter').textContent).toBe('Opening checkout…');
  });

  it('shows the plans’ details in the cards, the dialog as tall as before', async () => {
    await render();
    const toggle = () =>
      dialog().querySelector<HTMLButtonElement>('[data-slot="plan-details-toggle"]')!;
    const layers = (plan: string) =>
      card(plan).querySelector('[data-slot="plan-details"]')!.parentElement!.children;
    expect(toggle().textContent).toBe('Show plan details');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    // Closed: the price and button show, the details wait in the same cell.
    expect(layers('starter')[0].className).not.toContain('invisible');
    expect(layers('starter')[1].className).toContain('invisible');
    expect(layers('starter')[1].textContent).toContain(
      'For small teams getting started with AI visibility',
    );
    expect(layers('custom')[1].textContent).toContain('SSO / SAML and custom feature requests');

    await press(toggle());
    expect(toggle().textContent).toBe('Hide plan details');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    for (const plan of ['starter', 'growth', 'custom']) {
      expect(layers(plan)[0].className).toContain('invisible');
      expect(layers(plan)[1].className).not.toContain('invisible');
    }

    await press(toggle());
    expect(layers('growth')[1].className).toContain('invisible');
  });

  it('shows another member the plans without buying, a code or a discount', async () => {
    await render({ role: 'manager' });
    expect(dialog().querySelector('[data-slot="member-note"]')?.textContent).toBe(
      'Only an admin can choose a plan for your workspace. Ask your admin to choose a plan.',
    );
    expect(button('Choose Starter')).toBeUndefined();
    expect(button('Choose Growth')).toBeUndefined();
    expect(dialog().querySelectorAll('[data-slot="ask-admin"]')).toHaveLength(2);
    expect(card('starter').textContent).toContain('Ask your admin to choose a plan');
    expect(card('starter').querySelector('[data-slot="due-today"]')).toBeNull();
    expect(button('Have a code?')).toBeUndefined();
    expect(codeInput()).toBeNull();
    expect(document.querySelector('#upgrade-promo-note')).toBeNull();
    expect(price('starter')).toBe('$49/mo');
    expect(card('custom').textContent).toContain('Contact us');

    // The period still switches, to see the prices.
    await choose('year');
    expect(price('growth')).toContain('$2,390/yr');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ChoosePlanDialog with the first-month offer on', () => {
  it('shows the offer on the first frame, before Stripe answers', async () => {
    // Stripe hasn't answered yet, and won't in this test.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await render();
    expect(dialog().querySelector('[data-slot="promo-applied"]')?.textContent).toBe(
      'SAVE50 · 50% off your first month',
    );
    expect(choiceButton('month')?.textContent).toBe('Monthly50% off the first month');
    expect(price('starter')).toContain('$24.50first month');
    expect(due('starter')).toBe('$24.50');
    expect(startButton('starter').textContent).toBe('Buy now');
    expect(sent('/api/stripe/promo-code')).toEqual({ code: 'SAVE50' });
  });

  it('applies the offer in the read-only dialog too: Buy now, its first month and a Limited offer mark', async () => {
    await render();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(dialog().querySelector('[data-slot="promo-applied"]')?.textContent).toContain(
      'SAVE50 · 50% off your first month',
    );
    expect(startButton('starter').textContent).toBe('Buy now');
    // The first month's price shows once, on the card; due today, the same.
    expect(due('starter')).toBe('$24.50');
    expect(card('starter').querySelector('[data-slot="limited-offer"]')?.textContent).toBe(
      'Limited offer',
    );
    // A plan that ended: no trial, and the offer's own word only on the choice.
    expect(choiceButton('trial')).toBeNull();
    expect(dialog().textContent).not.toContain('Free until');
    expect(note()).toBe('');
  });

  it('keeps the offer as configured when its code could not be checked', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Internal error' }, { status: 500 }));
    await render();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(price('starter')).toContain('$24.50first month');
    expect(startButton('starter').textContent).toBe('Buy now');
    await press(startButton('starter'));
    expect(sent('/api/stripe/checkout')).toMatchObject({ promotionCode: 'SAVE50' });
  });

  it('buys a year at its price: Choose, no offer', async () => {
    await render();
    await choose('year');
    expect(startButton('starter').textContent).toBe('Choose Starter');
    expect(due('starter')).toBe('$470');
    // The offer applied for the admin says nothing more on a year.
    expect(note()).toBe('');
    await press(startButton('starter'));
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'starter',
      organizationId: 'org1',
      interval: 'year',
      returnTo: 'billing',
      mode: 'buy',
    });
  });

  it('takes the offer away, with no error, when its code does not apply', async () => {
    answer({ valid: false });
    await render();
    await vi.waitFor(() => expect(startButton('starter').textContent).toBe('Choose Starter'));
    expect(dialog().querySelector('[data-slot="promo-applied"]')).toBeNull();
    expect(button('Have a code?')).toBeDefined();
    expect(note()).toBe('');
    expect(price('starter')).toBe('$49/mo');
    expect(choiceButton('month')?.textContent).toBe('Monthly');
  });

  it("doesn't try the offer for a member, who can't buy", async () => {
    await render({ role: 'analyst' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(card('starter').querySelector('[data-mode]')).toBeNull();
    expect(price('starter')).toBe('$49/mo');
    expect(dialog().querySelector('[data-slot="card-note"]')).toBeNull();
  });
});

describe('ChoosePlanDialog from the demo brand', () => {
  const demoBody =
    'This is a demo brand with sample data, so nothing here runs or costs anything. Pick a plan and GetCito starts tracking, writing and fixing for your own brand.';

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers a workspace that never subscribed three ways to start, Monthly first', async () => {
    await render({ demo: 'trial', action: 'Adding prompts works on your own brand' });
    expect(dialog().querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Adding prompts works on your own brand',
    );
    expect(dialog().querySelector('h2')?.textContent).toBe('Use GetCito for your own brand');
    expect(dialog().textContent).toContain(demoBody);
    expect(choices()).toEqual(['14-day trial', 'Monthly50% off the first month', 'YearlySave 20%']);
    expect(choiceButton('month')?.getAttribute('aria-pressed')).toBe('true');
    // Monthly: the first month at half price, the full plan today.
    expect(startButton('starter').textContent).toBe('Buy now');
    expect(due('starter')).toBe('$24.50');
    expect(terms('starter')).toBe('Full plan from day one');
    expect(price('starter')).toContain('$24.50first monththen $49/mo');
    expect(dialog().querySelector('[data-slot="card-note"]')?.textContent).toBe(
      'Card required for both.',
    );
  });

  it('shows the trial with nothing due today, when it ends and what follows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    await render({ demo: 'trial' });
    await choose('trial');
    expect(mode('starter')).toBe('trial');
    expect(startButton('starter').textContent).toBe('Start 14-day free trial');
    expect(startButton('growth').textContent).toBe('Start 14-day free trial');
    // No offer with the trial: the plain price.
    expect(price('starter')).toBe('$49/mo');
    expect(due('starter')).toBe('$0');
    expect(terms('starter')).toBe('Free until Nov 11, then $49/monthLimited AI usage for 14 days');
    expect(terms('growth')).toBe('Free until Nov 11, then $249/monthLimited AI usage for 14 days');
  });

  it('opens Checkout for the trial without the offer', async () => {
    await render({ demo: 'trial' });
    await choose('trial');
    await press(startButton('growth'));
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'growth',
      organizationId: 'org1',
      interval: 'month',
      returnTo: 'billing',
      mode: 'trial',
    });
  });

  it('opens Checkout for Buy now with the code', async () => {
    await render({ demo: 'trial' });
    await press(startButton('starter'));
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'starter',
      organizationId: 'org1',
      interval: 'month',
      returnTo: 'billing',
      mode: 'buy',
      promotionCode: 'SAVE50',
    });
  });

  it('says so when the trial was used after all', async () => {
    await render({ demo: 'trial' });
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/stripe/checkout'
        ? Response.json(
            { error: 'The free trial has been used', code: 'trial_unavailable' },
            { status: 409 },
          )
        : Response.json(save50),
    );
    await choose('trial');
    await press(startButton('starter'));
    expect(card('starter').querySelector('[role="alert"]')?.textContent).toBe(
      "This workspace's free trial has been used. Buy now to start the plan.",
    );
  });

  it('buys a year at its price, the trial still offered', async () => {
    await render({ demo: 'trial' });
    await choose('year');
    expect(startButton('starter').textContent).toBe('Choose Starter');
    expect(due('starter')).toBe('$470');
    expect(terms('starter')).toBe('Full plan from day one');
    expect(choiceButton('trial')).not.toBeNull();
  });

  it('offers a workspace whose plan ended only buying', async () => {
    await render({ demo: 'first_month' });
    expect(dialog().querySelector('h2')?.textContent).toBe('Use GetCito for your own brand');
    expect(choiceButton('trial')).toBeNull();
    expect(startButton('starter').textContent).toBe('Buy now');
    expect(terms('starter')).toBeUndefined();
    expect(dialog().querySelector('[data-slot="card-note"]')?.textContent).toBe('Card required.');
  });

  it('names the workspace’s own brand once it has one', async () => {
    useBrandStore.setState({
      brands: [brand('own', 'Acme Coffee'), brand('demo', 'Brewline Coffee', true)],
      activeBrandId: 'demo',
    });
    await render({ demo: 'trial' });
    expect(dialog().querySelector('h2')?.textContent).toBe('Use GetCito for Acme Coffee');
    expect(dialog().textContent).toContain(
      'Pick a plan and GetCito starts tracking, writing and fixing for Acme Coffee.',
    );
    expect(dialog().textContent).not.toContain('Brewline Coffee');
  });

  it('shows the plain price and Choose with the offer off, the trial still there', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIRST_MONTH_OFFER', 'off');
    try {
      await render({ demo: 'trial' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(choices()).toEqual(['14-day trial', 'Monthly', 'YearlySave 20%']);
      expect(startButton('starter').textContent).toBe('Choose Starter');
      expect(due('starter')).toBe('$49');
      expect(terms('starter')).toBe('Full plan from day one');
      expect(dialog().textContent).not.toContain('50%');
      expect(dialog().querySelector('[data-slot="limited-offer"]')).toBeNull();
      await press(startButton('starter'));
      expect(sent('/api/stripe/checkout')).not.toHaveProperty('promotionCode');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('asks a member to turn to an admin, with no way to start', async () => {
    await render({ demo: 'trial', role: 'analyst' });
    expect(choiceButton('trial')).toBeNull();
    expect(card('starter').querySelector('[data-mode]')).toBeNull();
    expect(card('starter').textContent).toContain('Ask your admin to choose a plan');
  });
});

describe("ChoosePlanDialog for a brand that isn't tracked yet", () => {
  it('asks how to start: the trial, monthly or a year', async () => {
    await render({ pitch: { from: 'own_brand', offer: 'trial' }, action: null });
    expect(dialog().querySelector('h2')?.textContent).toBe('Choose how to start');
    expect(dialog().textContent).toContain(
      'Everything you set up is here. Pick a plan and GetCito starts tracking, writing and fixing for your brand.',
    );
    expect(dialog().textContent).not.toContain('demo brand');
    expect(startButton('starter').textContent).toBe('Buy now');
    await choose('trial');
    expect(startButton('starter').textContent).toBe('Start 14-day free trial');
  });

  it('names the brand on screen', async () => {
    useBrandStore.setState({
      brands: [brand('other', 'Other Brand'), brand('own', 'Acme Coffee')],
      activeBrandId: 'own',
    });
    await render({ pitch: { from: 'own_brand', offer: 'trial' }, action: null });
    expect(dialog().textContent).toContain(
      'Everything you set up for Acme Coffee is here. Pick a plan and GetCito starts tracking, writing and fixing for it.',
    );
  });
});

// The dialog reads no AI usage (it sits outside the usage's provider, and a
// workspace without a plan has none): the new Chat's flag says what it covers.
describe("ChoosePlanDialog's AI usage hint", () => {
  const hint = () =>
    [...card('growth').querySelectorAll('li span')]
      .find((el) => el.textContent === '5x AI usage')
      ?.getAttribute('title');

  it.each([
    ['once the plan ended', null],
    ['from the demo brand', { from: 'demo', offer: 'trial' }],
    ["for a brand that isn't tracked yet", { from: 'own_brand', offer: 'trial' }],
  ] as const)('says Chat and agents draw on it with the new Chat on, %s', async (_where, pitch) => {
    await render({ pitch, chatAgentic: true });
    expect(hint()).toContain('Chat and agents');
    expect(hint()).toContain('Your own AI key comes with Enterprise only.');
    expect(hint()).not.toContain('Agent Chat');
  });

  it('keeps the older word with the new Chat off', async () => {
    await render();
    expect(hint()).toContain('Agent Chat runs on your own AI key.');
  });
});

describe("ChoosePlanDialog's Chat points", () => {
  it('lists Chat and Agent Center with the new Chat on, Full auto from Growth up', async () => {
    await render({ chatAgentic: true });
    expect(card('starter').textContent).toContain('Chat and Agent Center');
    expect(card('starter').textContent).not.toContain('Full auto');
    expect(card('growth').textContent).toContain(
      'Chat and Agent CenterFull auto, with agents that publish on their own',
    );
    // Custom's follow its AI usage.
    expect(card('custom').textContent).toContain(
      'Custom AI usage, from 10xChat and Agent CenterFull auto, with agents that publish on their own',
    );
  });

  it('leaves them out with the new Chat off', async () => {
    await render();
    expect(dialog().textContent).not.toContain('Chat and Agent Center');
    expect(dialog().textContent).not.toContain('Full auto');
  });
});
