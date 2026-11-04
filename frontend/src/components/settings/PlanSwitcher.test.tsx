import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { toast } from 'sonner';
import { RoleProvider } from '@/components/context/RoleProvider';
import { ChatAgenticProvider } from '@/components/context/ChatAgenticProvider';
import type { TeamRole } from '@/components/context/RoleProvider';
import { sendCancelFeedback } from '@/lib/actions/cancelFeedback';
import { PlanSwitcher } from './PlanSwitcher';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/actions/cancelFeedback', () => ({
  sendCancelFeedback: vi.fn(async () => ({ ok: true })),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
const refreshAiUsage = vi.hoisted(() => vi.fn());
// The workspace's AI usage: unread unless a test turns the new Chat on (chatMetered).
const aiUsage = vi.hoisted(() => ({ usage: null as { chatMetered: boolean } | null }));
vi.mock('@/components/context/AiUsageProvider', () => ({
  useAiUsage: () => ({ usage: aiUsage.usage, refresh: refreshAiUsage }),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onUpdate = vi.fn();

async function render(
  planId = 'starter',
  {
    status = 'active',
    interval = 'month',
    role = 'admin',
    cancelAtPeriodEnd = false,
    trialOffered = false,
    chatAgentic = false,
  }: {
    status?: string;
    interval?: string;
    role?: TeamRole;
    cancelAtPeriodEnd?: boolean;
    trialOffered?: boolean;
    /** The new Chat on for the workspace (CHAT_AGENTIC). */
    chatAgentic?: boolean;
  } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatAgenticProvider enabled={chatAgentic}>
          <RoleProvider role={role}>
            <PlanSwitcher
              subscription={{
                planId,
                status,
                currentPeriodEnd: null,
                cancelAtPeriodEnd,
                priceAmount: 49,
                interval,
              }}
              onUpdate={onUpdate}
              organizationId="org1"
              trialOffered={trialOffered}
            />
          </RoleProvider>
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

async function click(label: string) {
  await act(async () => {
    button(label)!.click();
  });
}

/**
 * The plan cards by plan name: a paid plan's cards, or, once it has ended,
 * the cards a new plan starts from (as the plan dialog's).
 */
const planCards = () =>
  [...container.querySelectorAll('[data-slot="card"], section[data-plan]')].map(
    (card) =>
      [
        card.querySelector('[data-slot="card-title"], h3')?.textContent ?? '',
        card as HTMLElement,
      ] as const,
  );
const planCard = (plan: string) => planCards().find(([name]) => name === plan)?.[1];

/** Each plan card's text, by plan name. */
const cardText = () =>
  Object.fromEntries(planCards().map(([name, card]) => [name, card.textContent]));

/** A plan card's way to start ('buy' or 'trial'), by plan name. */
const startButton = (plan: string, mode: 'buy' | 'trial') =>
  planCard(plan)?.querySelector<HTMLButtonElement>(`button[data-mode="${mode}"]`) ?? null;

/** Picks how a plan starts, above the cards: the trial, monthly or a year. */
async function choose(choice: 'trial' | 'month' | 'year') {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)!.click();
  });
}

/** What a plan card says is due today. */
const dueToday = (plan: string) =>
  planCard(plan)?.querySelector('[data-slot="due-amount"]')?.textContent ?? null;

/** Each plan card's name and its list, in order. */
const cards = () =>
  Object.fromEntries(
    [...container.querySelectorAll('[data-slot="card"]')].map((card) => [
      card.querySelector('[data-slot="card-title"]')?.textContent,
      [...card.querySelectorAll('li')].map((li) => li.textContent),
    ]),
  );

beforeEach(() => {
  vi.clearAllMocks();
  aiUsage.usage = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the plan cards', () => {
  it('list what each plan includes, as the pricing page does', async () => {
    await render();
    expect(cards()).toEqual({
      Starter: [
        '1 brand',
        'Unlimited seats',
        '50 prompts tracked',
        'ChatGPT & Microsoft Copilot tracking',
        '10 content briefs a month',
        '100 site audits a month',
        '1x AI usage',
        'MCP & API access',
      ],
      Growth: [
        '4 brands',
        'Unlimited seats',
        '200 prompts tracked',
        'ChatGPT, Perplexity, Gemini, Microsoft Copilot, Google AI Mode and Google AI Overviews tracking',
        '50 content briefs a month',
        '500 site audits a month',
        '5x AI usage',
        'Multi-region tracking',
        'White-label reports & exports',
        'Looker Studio',
      ],
    });
    expect(container.textContent).not.toContain('8 answer engines');
    // AI usage says what it covers on hover.
    const ai = [...container.querySelectorAll('li span')].find(
      (el) => el.textContent === '5x AI usage',
    );
    expect(ai?.getAttribute('title')).toContain(
      "Improve suggestions, the Content Editor's AI and the Action Center",
    );
    expect(container.textContent).toContain(
      'For small teams getting started with AI visibility monitoring and optimization.',
    );
  });

  it('lists Chat and Agent Center once the new Chat is on, Full auto from Growth up', async () => {
    await render('starter', { chatAgentic: true });
    const { Starter, Growth } = cards();
    expect(Starter.slice(6)).toEqual(['1x AI usage', 'Chat and Agent Center', 'MCP & API access']);
    expect(Growth.slice(6)).toEqual([
      '5x AI usage',
      'Chat and Agent Center',
      'Full auto, with agents that publish on their own',
      'Multi-region tracking',
      'White-label reports & exports',
      'Looker Studio',
    ]);
    const custom = container.textContent;
    expect(custom).toContain('Custom AI usage, from 10xChat and Agent Center');
    expect(custom).toContain('Full auto, with agents that publish on their own');
  });

  it('leaves Chat off the cards while the new Chat is off', async () => {
    await render('starter');
    expect(container.textContent).not.toContain('Chat and Agent Center');
    expect(container.textContent).not.toContain('Full auto');
  });

  it('says Chat and agents draw on AI usage once the new Chat is on, own keys on Enterprise only', async () => {
    const hint = (text: string) =>
      [...container.querySelectorAll('li span')]
        .find((el) => el.textContent === text)
        ?.getAttribute('title');
    await render('growth');
    expect(hint('5x AI usage')).toContain('Agent Chat runs on your own AI key.');

    act(() => root.unmount());
    root = createRoot(container);
    aiUsage.usage = { chatMetered: true };
    await render('growth');
    expect(hint('5x AI usage')).toBe(
      "A monthly allowance for GetCito's AI features: Chat and agents, Improve suggestions, the Content Editor's AI and the Action Center's task writing. Your own AI key comes with Enterprise only. The free trial comes with a smaller allowance.",
    );
    expect(hint('Custom AI usage, from 10x')).toContain(
      'On Enterprise, Chat can also run on your own AI key.',
    );
    expect(hint('Custom AI usage, from 10x')).not.toContain('Agent Chat');
  });

  it('says the same with the new Chat on where no AI usage is read, as once the plan ended', async () => {
    const hint = (text: string) =>
      [...container.querySelectorAll('li span')]
        .find((el) => el.textContent === text)
        ?.getAttribute('title');
    await render('growth', { status: 'canceled', chatAgentic: true });
    expect(hint('5x AI usage')).toContain('Chat and agents');
    expect(hint('5x AI usage')).toContain('Your own AI key comes with Enterprise only.');
    expect(hint('Custom AI usage, from 10x')).toContain(
      'On Enterprise, Chat can also run on your own AI key.',
    );
  });

  it('says what a custom plan adds, with a way to ask', async () => {
    await render('growth');
    expect(container.textContent).toContain('Need a custom plan?');
    expect(container.textContent).toContain(
      'For large companies and agencies managing AI visibility at scale. Starting at $499/month.',
    );
    // Its AI usage is set per customer, from Enterprise's $50 (10x Starter's).
    const ai = [...container.querySelectorAll('li span')].find(
      (el) => el.textContent === 'Custom AI usage, from 10x',
    );
    expect(ai?.getAttribute('title')).toContain('A monthly allowance for GetCito');
    // The trial's smaller allowance isn't Enterprise's.
    expect(ai?.getAttribute('title')).not.toContain('free trial');
    expect(ai?.getAttribute('title')).toContain('GetCito sets the amount with you.');
    expect(container.textContent).not.toContain('10x AI usage');
    for (const point of [
      'Unlimited brands in a custom workspace',
      'All answer engines, Claude included',
      'SSO / SAML and custom feature requests',
    ]) {
      expect(container.textContent).toContain(point);
    }
    expect(container.querySelector('a[href="https://getcito.com/contact-us"]')?.textContent).toBe(
      'Contact Us',
    );
  });

  it('links to every feature on the pricing page, in a new tab, for any role', async () => {
    await render('starter', { role: 'manager' });
    const link = container.querySelector('a[href="https://getcito.com/pricing"]');
    expect(link?.textContent).toBe('See everything each plan includes');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('the billing period', () => {
  it('shows a year up front with the full year struck through and the saving', async () => {
    await render();
    expect(cardText().Starter).toContain('$49/mo');
    expect(cardText().Growth).toContain('Popular');
    expect(cardText().Starter).not.toContain('Popular');

    await click('AnnualSave 20%');

    const starter = container.querySelectorAll('[data-slot="card"]')[0];
    const struck = starter.querySelector('.line-through');
    expect(struck?.textContent).toBe('Regular price $588');
    expect(starter.textContent).toContain('$470/yr');
    expect(starter.textContent).toContain('Save 20%');
    const growth = container.querySelectorAll('[data-slot="card"]')[1];
    expect(growth.querySelector('.line-through')?.textContent).toBe('Regular price $2,988');
    expect(growth.textContent).toContain('$2,390/yr');
  });

  it('marks the period shown, filled dark, and only that one', async () => {
    await render('starter', { status: 'trialing' });
    const pressed = () =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="group"] button')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => [b.textContent, b.classList.contains('bg-primary')]);
    const filled = () =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="group"] button')].filter((b) =>
        b.classList.contains('bg-primary'),
      );

    expect(pressed()).toEqual([['Monthly', true]]);
    expect(filled()).toHaveLength(1);
    await click('AnnualSave 20%');
    expect(pressed()).toEqual([['AnnualSave 20%', true]]);
    expect(filled()).toHaveLength(1);
  });

  it('moves a paid plan to annual billing from its own card', async () => {
    await render('starter');
    expect(button('Switch to annual billing')).toBeUndefined();

    await click('AnnualSave 20%');
    await click('Switch to annual billing');

    expect(document.body.textContent).toContain('Switch to annual billing?');
    expect(document.body.textContent).toContain('Your Starter plan will cost $470 a year.');
  });
});

describe('buying during the free trial', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ planId: 'growth', status: 'active', interval: 'month', priceAmount: 249 }),
      ),
    );
  });

  it('leaves buying and changing the plan to admins', async () => {
    await render('starter', { status: 'trialing', role: 'manager' });
    expect(document.body.textContent).toContain(
      'Only admins can buy or change the plan. Ask an admin in your organization.',
    );
    expect(
      [...document.querySelectorAll('button')].filter((b) =>
        /^(Buy|Upgrade|Downgrade|Switch)/.test(b.textContent?.trim() ?? ''),
      ),
    ).toEqual([]);
  });

  it('leaves cancelling to admins', async () => {
    const cancel = () =>
      [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Cancel Subscription',
      );
    await render('growth', { status: 'active', role: 'manager' });
    expect(cancel()).toBeUndefined();
    await render('growth', { status: 'active', role: 'admin' });
    expect(cancel()).toBeDefined();
  });

  it('offers every plan now, with the first-month code on monthly', async () => {
    await render('starter', { status: 'trialing' });
    expect(button('Buy Starter now')).toBeDefined();
    expect(button('Buy Growth now')).toBeDefined();
    expect(container.textContent).toContain('50% off your first month with code SAVE50');
  });

  it('buys Growth monthly with SAVE50 filled in', async () => {
    await render('starter', { status: 'trialing' });
    await click('Buy Growth now');

    expect(document.body.textContent).toContain('Buy Growth now?');
    expect(document.body.textContent).toContain(
      'Your free trial ends today and the card you added is charged $249 for the first month.',
    );
    const code = document.querySelector<HTMLInputElement>('#promo-code');
    expect(code?.value).toBe('SAVE50');
    expect(document.body.textContent).toContain('With SAVE50, your first month is $124.50.');

    await click('Buy now');

    expect(fetch).toHaveBeenCalledWith('/api/stripe/subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newPlanId: 'growth',
        interval: 'month',
        buyNow: true,
        promoCode: 'SAVE50',
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    // The layout reads the plan again: a read-only workspace opens up.
    expect(refresh).toHaveBeenCalledTimes(1);
    // The header meter reads the AI usage again: the paid period starts at 0.
    expect(refreshAiUsage).toHaveBeenCalledTimes(1);
  });

  it('buys a year without a code', async () => {
    await render('starter', { status: 'trialing' });
    await click('AnnualSave 20%');
    expect(container.textContent).not.toContain('SAVE50');
    await click('Buy Starter now');

    expect(document.querySelector('#promo-code')).toBeNull();
    await click('Buy now');

    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toEqual({
      newPlanId: 'starter',
      interval: 'year',
      buyNow: true,
    });
  });

  it('offers to update the card when the payment fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: 'Your card was declined.', code: 'payment_failed' }, { status: 402 }),
    );
    await render('starter', { status: 'trialing' });
    await click('Buy Starter now');
    await click('Buy now');

    expect(toast.error).toHaveBeenCalledWith('Your card was declined.', {
      description: 'Your free trial carries on. Update your card on Stripe, then try again.',
      action: { label: 'Update card', onClick: expect.any(Function) },
    });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(refreshAiUsage).not.toHaveBeenCalled();
    // The dialog stays open to try again.
    expect(document.body.textContent).toContain('Buy Starter now?');
  });
});

describe('choosing a plan once the old one has ended', () => {
  /** What Stripe says of the first-month code; it doesn't apply unless a test says. */
  let promo: Record<string, unknown>;
  /** Checkout's answer: its address, a hash jsdom can navigate to. */
  let checkout: Response;

  /** The JSON body sent to an address, the last time. */
  const sent = (url: string) => {
    const call = vi
      .mocked(fetch)
      .mock.calls.filter(([to]) => to === url)
      .at(-1);
    return call ? JSON.parse((call[1] as RequestInit).body as string) : undefined;
  };

  beforeEach(() => {
    promo = { valid: false };
    checkout = Response.json({ url: '#checkout' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/stripe/promo-code' ? Response.json(promo) : checkout,
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SAVE50 = {
    valid: true,
    code: 'SAVE50',
    percentOff: 50,
    amountOff: null,
    duration: 'once',
    durationInMonths: null,
  };

  it('starts a new subscription through Checkout, in the period chosen', async () => {
    await render('starter', { status: 'canceled', cancelAtPeriodEnd: true });
    expect(container.textContent).toContain(
      "Your plan isn't active. Choose one to start it again; you'll pay on Stripe's secure checkout.",
    );
    // No plan is current, and nothing to cancel or reactivate.
    expect(cardText().Starter).not.toContain('Current Plan');
    expect(button('Reactivate')).toBeUndefined();
    expect(button('Cancel Subscription')).toBeUndefined();

    // One choice above the cards: monthly or a year, no trial for a plan that ended.
    expect(
      [...container.querySelectorAll('[data-choice]')].map((b) => b.getAttribute('data-choice')),
    ).toEqual(['month', 'year']);
    await choose('year');
    expect(dueToday('Growth')).toBe('$2,390');
    await click('Choose Growth');

    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'growth',
      organizationId: 'org1',
      interval: 'year',
      returnTo: 'billing',
      mode: 'buy',
    });
    expect(window.location.hash).toBe('#checkout');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('says so when Checkout does not open, and lets the admin try again', async () => {
    checkout = Response.json({}, { status: 500 });
    await render('starter', { status: 'canceled' });
    await click('Choose Starter');
    // By the plan's button, in place of the checkout's word, and no spinner left.
    expect(planCard('Starter')?.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't open the checkout. Try again.",
    );
    expect(planCard('Starter')?.querySelector('[data-slot="trust-line"]')).toBeNull();
    expect(planCard('Growth')?.querySelector('[role="alert"]')).toBeNull();
    expect(button('Choose Starter')?.disabled).toBe(false);
    expect(container.textContent).not.toContain('Opening checkout');
  });

  it('shows the plans’ details in their cards on request, and hides them again', async () => {
    await render('starter', { status: 'canceled' });
    const toggle = () =>
      container.querySelector<HTMLButtonElement>('[data-slot="plan-details-toggle"]')!;
    const details = () => planCard('Growth')!.querySelector('[data-slot="plan-details"]')!;
    expect(toggle().textContent).toBe('Show plan details');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(details().className).toContain('invisible');
    expect(details().textContent).toContain('White-label reports & exports');
    expect(details().textContent).toContain('Looker Studio');

    await act(async () => toggle().click());
    expect(toggle().textContent).toBe('Hide plan details');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(details().className).not.toContain('invisible');
    // The price and button give their place to the details, in the same cell.
    expect(startButton('Growth', 'buy')!.parentElement!.parentElement!.className).toContain(
      'invisible',
    );

    await act(async () => toggle().click());
    expect(details().className).toContain('invisible');
  });

  it('shows the first-month offer on the first frame, before Stripe answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    await render('growth', { status: 'canceled' });
    expect(startButton('Starter', 'buy')?.textContent).toBe('Buy now');
    expect(cardText().Starter).toContain('$24.50first monththen $49/mo');
    expect(dueToday('Starter')).toBe('$24.50');
  });

  it('offers a plan that ended only Buy now, at 50% off the first month', async () => {
    promo = SAVE50;
    await render('growth', { status: 'canceled' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(startButton('Starter', 'buy')?.textContent).toBe('Buy now');
    expect(cardText().Starter).toContain('Limited offer');
    expect(cardText().Starter).toContain('$24.50first monththen $49/mo');
    expect(dueToday('Starter')).toBe('$24.50');
    expect(cardText().Starter).toContain('Secure checkout with Stripe · Cancel any time');
    expect(container.querySelector('[data-choice="trial"]')).toBeNull();
    expect(startButton('Starter', 'trial')).toBeNull();
    expect(container.textContent).not.toContain('free trial');

    await act(async () => startButton('Growth', 'buy')!.click());
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'growth',
      organizationId: 'org1',
      interval: 'month',
      returnTo: 'billing',
      mode: 'buy',
      promotionCode: 'SAVE50',
    });
  });

  it('offers a workspace that never had a plan both ways to start, as the plan dialog does', async () => {
    promo = SAVE50;
    await render('starter', { status: 'incomplete', trialOffered: true });
    expect(container.textContent).toContain(
      "Buy a plan now, or try one free for 14 days first. Either way you add a card on Stripe's secure checkout.",
    );
    await vi.waitFor(() => expect(startButton('Starter', 'buy')?.textContent).toBe('Buy now'));
    expect(cardText().Starter).toContain('Full plan from day one');
    await choose('trial');
    expect(startButton('Starter', 'buy')).toBeNull();
    expect(startButton('Growth', 'trial')?.textContent).toBe('Start 14-day free trial');
    expect(dueToday('Growth')).toBe('$0');
    expect(cardText().Growth).toMatch(/Free until [A-Z][a-z]{2} \d{1,2}, then \$249\/month/);
    expect(cardText().Growth).toContain('Limited AI usage for 14 days');

    // The trial comes without the offer's code.
    await act(async () => startButton('Growth', 'trial')!.click());
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'growth',
      organizationId: 'org1',
      interval: 'month',
      returnTo: 'billing',
      mode: 'trial',
    });
  });

  it('marks the chosen way to start, filled dark, and only that one', async () => {
    await render('starter', { status: 'incomplete', trialOffered: true });
    const choices = () => [...container.querySelectorAll<HTMLButtonElement>('[data-choice]')];
    const chosen = () =>
      choices()
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.dataset.choice);
    const filled = () =>
      choices()
        .filter((b) => b.classList.contains('bg-primary'))
        .map((b) => b.dataset.choice);

    // Monthly at first, where the first-month offer is.
    expect(choices().map((b) => b.dataset.choice)).toEqual(['trial', 'month', 'year']);
    expect(chosen()).toEqual(['month']);
    expect(filled()).toEqual(['month']);
    expect(container.querySelector('[data-choice="month"]')!.className).toContain(
      'text-primary-foreground',
    );

    for (const choice of ['trial', 'year'] as const) {
      await choose(choice);
      expect(chosen()).toEqual([choice]);
      expect(filled()).toEqual([choice]);
      expect(
        choices()
          .filter((b) => b.dataset.choice !== choice)
          .every((b) => b.className.includes('text-muted-foreground')),
      ).toBe(true);
    }
  });

  it('says so when Stripe turns the code down at Checkout, and shows the plain prices', async () => {
    promo = SAVE50;
    checkout = Response.json(
      { error: 'Invalid promotion code', code: 'invalid_promo_code' },
      { status: 400 },
    );
    await render('starter', { status: 'canceled' });
    await vi.waitFor(() => expect(startButton('Starter', 'buy')?.textContent).toBe('Buy now'));
    await act(async () => startButton('Starter', 'buy')!.click());
    expect(toast.error).toHaveBeenCalledWith('“SAVE50” isn’t a valid code.');
    expect(startButton('Starter', 'buy')?.textContent).toBe('Choose Starter');
    expect(startButton('Starter', 'buy')?.disabled).toBe(false);
  });

  it('leaves choosing a plan to admins', async () => {
    await render('starter', { status: 'canceled', role: 'analyst' });
    expect(button('Choose Starter')).toBeUndefined();
    expect(button('Choose Growth')).toBeUndefined();
    // A member's page never asks Stripe about the code.
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('a payment being retried (past_due)', () => {
  it('changes the plan on the subscription, and never opens a second Checkout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          planId: 'growth',
          status: 'past_due',
          interval: 'month',
          priceAmount: 249,
        }),
      ),
    );
    await render('starter', { status: 'past_due' });
    expect(button('Choose Starter')).toBeUndefined();
    expect(button('Choose Growth')).toBeUndefined();
    expect(container.textContent).not.toContain("Your plan isn't active.");
    await click('Upgrade to Growth');
    await click('Confirm Change');
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/api/stripe/subscription']);
  });
});

describe('cancelling', () => {
  it('asks what went wrong first, then cancels at the end of the period and tells the team', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ cancelAtPeriodEnd: true, currentPeriodEnd: '2026-11-20T00:00:00Z' }),
      ),
    );
    await render('growth');
    await click('Cancel Subscription');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Before you go, what went wrong?');
    await act(async () => {
      [...dialog.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === 'Cancel Subscription')!
        .click();
    });
    expect(fetch).toHaveBeenCalledWith('/api/stripe/subscription', { method: 'DELETE' });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-11-20T00:00:00Z',
      }),
    );
    expect(sendCancelFeedback).toHaveBeenCalledWith({ reasons: [], message: '', choice: 'cancel' });
  });
});
