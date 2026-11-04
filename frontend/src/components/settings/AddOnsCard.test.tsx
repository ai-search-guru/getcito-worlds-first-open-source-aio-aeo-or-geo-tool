import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import {
  getBillingAddOns,
  startAddOnPurchase,
  type BillingAddOns,
  type BillingAddOnsRead,
} from '@/lib/actions/addOns';
import type { AddOnPackView } from '@/lib/billing/addOnView';
import { AddOnsCard, formatPackPrice } from './AddOnsCard';

/**
 * Settings › Billing › Add-ons: the packs with what each adds, "Most picked"
 * on $50 and +25 GB, the credit left, and the purchases; Admins buy, others
 * are asked to ask one; nothing at all while Chat is off.
 */

vi.mock('@/lib/actions/addOns', () => ({
  getBillingAddOns: vi.fn(),
  startAddOnPurchase: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const pack = (over: Partial<AddOnPackView> & Pick<AddOnPackView, 'id'>): AddOnPackView => ({
  kind: 'ai',
  priceCents: 5000,
  currency: 'usd',
  monthly: false,
  validMonths: 12,
  mostPicked: false,
  available: true,
  adds: { kind: 'limits', count: 1 },
  ...over,
});

const PACKS: AddOnPackView[] = [
  pack({ id: 'ai_10', priceCents: 1000, adds: { kind: 'share', percent: 20 } }),
  pack({ id: 'ai_50', mostPicked: true }),
  pack({ id: 'ai_250', priceCents: 25000, adds: { kind: 'limits', count: 5 } }),
  pack({
    id: 'ai_1000',
    priceCents: 100000,
    adds: { kind: 'limits', count: 20 },
    available: false,
  }),
  pack({
    id: 'storage_25',
    kind: 'storage',
    priceCents: 500,
    monthly: true,
    validMonths: null,
    mostPicked: true,
    adds: { kind: 'storage', gb: 25 },
  }),
  pack({
    id: 'storage_100',
    kind: 'storage',
    priceCents: 1500,
    monthly: true,
    validMonths: null,
    adds: { kind: 'storage', gb: 100 },
  }),
];

const addOns = (over: Partial<BillingAddOns> = {}): BillingAddOnsRead => ({
  ok: true,
  addOns: {
    isAdmin: true,
    buy: 'open',
    packs: PACKS,
    credit: { leftCents: 4820, expiresAt: '2027-10-01T10:00:00.000Z' },
    purchases: [
      {
        id: 'p1',
        createdAt: '2026-10-01T10:00:00.000Z',
        kind: 'ai',
        packPriceCents: 5000,
        paidCents: 5000,
        currency: 'usd',
        gb: null,
        state: 'active',
        creditLeftCents: 4820,
        until: '2027-10-01T10:00:00.000Z',
        hasInvoice: true,
      },
      {
        id: 'p2',
        createdAt: '2026-10-02T10:00:00.000Z',
        kind: 'storage',
        packPriceCents: 500,
        paidCents: 350,
        currency: 'usd',
        gb: 25,
        state: 'active',
        creditLeftCents: null,
        until: '2026-11-20T09:00:00.000Z',
        hasInvoice: false,
      },
    ],
    ...over,
  },
});

let container: HTMLDivElement;
let root: Root;

async function render(read: BillingAddOnsRead) {
  vi.mocked(getBillingAddOns).mockResolvedValue(read);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AddOnsCard />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const text = () => document.body.textContent ?? '';
const buttons = () => [...document.body.querySelectorAll('button')];
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label);
const cards = () => [...container.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
const card = (price: string) => cards().find((c) => c.textContent?.startsWith(price))!;
async function click(el: Element | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await act(async () => {});
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(getBillingAddOns).mockReset();
  vi.mocked(startAddOnPurchase).mockReset();
  window.location.hash = '';
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('formats a pack’s price without cents unless it has some', () => {
  expect(formatPackPrice(1000, 'usd')).toBe('$10');
  expect(formatPackPrice(100000, 'usd')).toBe('$1,000');
  expect(formatPackPrice(4820, 'usd')).toBe('$48.20');
});

it('shows nothing while Chat is off for the workspace', async () => {
  await render({ ok: false, failure: 'off' });
  expect(container.innerHTML).toBe('');
});

describe('for an Admin', () => {
  it('shows the AI packs with what each adds, Most picked on $50, and the credit left', async () => {
    await render(addOns());
    expect(text()).toContain('Add-ons');
    expect(text()).toContain('AI credit: $48.20 left · expires Oct 1, 2027');
    expect(cards().map((c) => c.textContent)).toEqual([
      '$10+20% of the monthly limitValid 12 months',
      '$50+1 monthly limitValid 12 monthsMost picked',
      '$250+5 monthly limitsValid 12 months',
      '$1,000+20 monthly limitsNot on sale yet',
    ]);
    // Most picked is picked to start with; a pack not on sale can't be.
    expect(card('$50').getAttribute('aria-checked')).toBe('true');
    expect(card('$1,000').disabled).toBe(true);
    expect(text()).toContain(
      "Monthly limit = your workspace's included AI usage, shared by every seat.",
    );
  });

  it('opens Stripe Checkout for the AI pack picked', async () => {
    vi.mocked(startAddOnPurchase).mockResolvedValue({
      ok: true,
      next: 'checkout',
      url: '#checkout',
    });
    await render(addOns());
    await click(card('$250'));
    await click(button('Continue to payment'));
    expect(startAddOnPurchase).toHaveBeenCalledWith('ai_250');
    expect(window.location.hash).toBe('#checkout');
  });

  it('marks the picked tab black in light and white in dark, as the plan tabs (#1806)', async () => {
    await render(addOns());
    const picked = () =>
      buttons()
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => [b.textContent, b.classList.contains('bg-primary')]);
    expect(picked()).toEqual([['AI credits', true]]);
    expect(button('Storage')?.classList.contains('bg-primary')).toBe(false);
    await click(button('Storage'));
    expect(picked()).toEqual([['Storage', true]]);
  });

  it('says a purchase that failed to start, and lets the person try again', async () => {
    vi.mocked(startAddOnPurchase).mockRejectedValue(new TypeError('Failed to fetch'));
    await render(addOns());
    await click(button('Continue to payment'));
    expect(text()).toContain("Couldn't start the purchase. Try again.");
    expect(button('Continue to payment')?.disabled).toBe(false);
  });

  it('confirms storage before adding it to the plan, as it is charged at once', async () => {
    vi.mocked(startAddOnPurchase).mockResolvedValue({ ok: true, next: 'added' });
    await render(addOns());
    await click(button('Storage'));
    expect(cards().map((c) => c.textContent)).toEqual([
      '$5+25 GB of storageMonthlyMost picked',
      '$15+100 GB of storageMonthly',
    ]);
    await click(button('Continue to payment'));
    expect(startAddOnPurchase).not.toHaveBeenCalled();
    expect(text()).toContain('Add 25 GB to your plan?');
    expect(text()).toContain('$5 a month, renewed with your plan.');

    await click(button('Add to plan'));
    expect(startAddOnPurchase).toHaveBeenCalledWith('storage_25');
    expect(text()).toContain('Added to your plan.');
    // Read again, to show it.
    expect(getBillingAddOns).toHaveBeenCalledTimes(2);
  });

  it('shows Stripe’s words when the card is declined', async () => {
    vi.mocked(startAddOnPurchase).mockResolvedValue({
      ok: false,
      failure: 'payment_failed',
      message: 'Your card was declined.',
    });
    await render(addOns());
    await click(button('Storage'));
    await click(button('Continue to payment'));
    await click(button('Add to plan'));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Your card was declined.');
  });

  it('lists the purchases with their state, what’s left and the invoice', async () => {
    await render(addOns());
    const rows = [...container.querySelectorAll('tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['Oct 1, 2026', 'AI credits · $50', '$50', 'Active', '$48.20 left', ''],
      ['Oct 2, 2026', 'Storage · +25 GB', '$3.50', 'Active', 'Until Nov 20, 2026', '—'],
    ]);
    expect(container.querySelector('tbody a')?.getAttribute('href')).toBe(
      '/api/add-ons/invoice/p1',
    );
  });

  it('says a trial can’t buy, with nothing to click', async () => {
    await render(addOns({ buy: 'trial' }));
    expect(text()).toContain("Trials can't buy packs. Choose a plan to buy them.");
    expect(button('Continue to payment')).toBeUndefined();
    expect(cards().every((c) => c.disabled)).toBe(true);
  });
});

it('shows everyone else the packs and the line to ask an admin, never a way to buy', async () => {
  await render(addOns({ isAdmin: false, purchases: null }));
  expect(cards()).toHaveLength(4);
  expect(text()).toContain('Only admins can buy packs. Ask an admin of your workspace.');
  expect(button('Continue to payment')).toBeUndefined();
  expect(cards().every((c) => c.disabled)).toBe(true);
  expect(text()).not.toContain('Purchases');
});

it('says so when the add-ons can’t be read', async () => {
  await render({ ok: false, failure: 'failed' });
  expect(text()).toContain("Couldn't read your add-ons. Try again later.");
});
