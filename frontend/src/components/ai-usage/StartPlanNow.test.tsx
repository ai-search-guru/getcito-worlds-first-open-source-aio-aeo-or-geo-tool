import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import { PLANS } from '@/config/plans';
import { FIRST_MONTH_CODE, firstMonthPrice } from '@/lib/billing/planPurchase';

/**
 * Start my plan now (trial AI credit, 2026-10-29): the trial ends today on
 * its own plan and period, paid by the card on file, with the plan's full AI
 * usage from then on; a dialog names the plan, today's charge and the end of
 * the trial. An admin's only.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => router }));
const aiUsage = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/components/context/AiUsageProvider', () => ({
  useAiUsage: () => ({ usage: null, refresh: aiUsage.refresh }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { StartPlanNow } = await import('./StartPlanNow');
const { PLAN_STARTED_EVENT } = await import('@/lib/billing/planStarted');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** What the subscription route answers: GET the trial, PATCH the plan bought, or an error. */
let subscription: { planId: string; status: string; interval: string | null };
let patchAnswers: { status: number; body: unknown }[];
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const answer =
    init?.method === 'PATCH'
      ? (patchAnswers.shift() ?? { status: 500, body: {} })
      : { status: 200, body: subscription };
  return new Response(JSON.stringify(answer.body), { status: answer.status });
});

let container: HTMLDivElement;
let root: Root;

async function render(role: TeamRole = 'admin') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <StartPlanNow />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
async function click(label: string) {
  await act(async () => button(label)!.click());
  await act(async () => {});
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
/** The dialog's own Start my plan now, not the button that opened it. */
async function confirm() {
  const button = [...dialog()!.querySelectorAll('button')].find(
    (b) => b.textContent === 'Start my plan now',
  );
  await act(async () => button!.click());
  await act(async () => {});
}
const patchBodies = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String(init!.body)));
const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

beforeEach(() => {
  subscription = { planId: 'growth', status: 'trialing', interval: 'month' };
  patchAnswers = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  router.refresh.mockReset();
  aiUsage.refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('StartPlanNow', () => {
  it('is an admin’s only', async () => {
    for (const role of ['manager', 'analyst'] as const) {
      await render(role);
      expect(container.innerHTML).toBe('');
    }
  });

  it('names the plan, today’s charge and that the trial ends now, then buys the trial', async () => {
    const started = vi.fn();
    window.addEventListener(PLAN_STARTED_EVENT, started);
    const monthly = PLANS.growth.pricing!.monthly;
    await render();
    await click('Start my plan now');
    const text = dialog()!.textContent!;
    expect(text).toContain('Start your Growth plan now?');
    expect(text).toContain('PlanGrowth, monthly');
    expect(text).toContain(`Charged today$${money(firstMonthPrice(monthly))}`);
    expect(text).toContain(`first month with the offer, then $${money(monthly)} a month`);
    expect(text).toContain('Free trialEnds now');
    // No card to enter: the trial's is on file.
    expect(dialog()!.querySelector('input')).toBeNull();

    const bought = { planId: 'growth', status: 'active', interval: 'month' };
    patchAnswers.push({ status: 200, body: bought });
    await confirm();
    expect(patchBodies()).toEqual([
      { newPlanId: 'growth', interval: 'month', buyNow: true, promoCode: FIRST_MONTH_CODE },
    ]);
    expect(started).toHaveBeenCalledOnce();
    expect((started.mock.calls[0][0] as CustomEvent).detail).toEqual(bought);
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(aiUsage.refresh).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith('Your Growth plan is active. Thank you!');
    expect(dialog()).toBeNull();
    window.removeEventListener(PLAN_STARTED_EVENT, started);
  });

  it('buys a yearly trial at its yearly price, with no code', async () => {
    subscription = { planId: 'starter', status: 'trialing', interval: 'year' };
    await render();
    await click('Start my plan now');
    expect(dialog()!.textContent).toContain('PlanStarter, yearly');
    expect(dialog()!.textContent).toContain(
      `Charged today$${money(PLANS.starter.pricing!.annual!)}`,
    );
    expect(dialog()!.textContent).not.toContain('with the offer');
    patchAnswers.push({ status: 200, body: { planId: 'starter', status: 'active' } });
    await confirm();
    expect(patchBodies()).toEqual([{ newPlanId: 'starter', interval: 'year', buyNow: true }]);
  });

  it('shows the full price to confirm again when the offer’s code is turned down', async () => {
    const monthly = PLANS.growth.pricing!.monthly;
    await render();
    await click('Start my plan now');
    patchAnswers.push({ status: 400, body: { code: 'invalid_promo_code' } });
    await confirm();
    expect(toast.error).toHaveBeenCalledWith(
      "The first-month offer isn't available any more. Check the full price and confirm again.",
    );
    expect(dialog()!.textContent).toContain(`Charged today$${money(monthly)}`);
    expect(router.refresh).not.toHaveBeenCalled();

    patchAnswers.push({ status: 200, body: { planId: 'growth', status: 'active' } });
    await confirm();
    expect(patchBodies()[1]).toEqual({ newPlanId: 'growth', interval: 'month', buyNow: true });
  });

  it('keeps the trial on a declined card, and offers to update it', async () => {
    await render();
    await click('Start my plan now');
    patchAnswers.push({
      status: 402,
      body: { code: 'payment_failed', error: 'Your card was declined.' },
    });
    await confirm();
    expect(toast.error).toHaveBeenCalledWith(
      'Your card was declined.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Update card' }) }),
    );
    expect(dialog()).not.toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('starts nothing once the plan has started', async () => {
    subscription = { planId: 'growth', status: 'active', interval: 'month' };
    await render();
    await click('Start my plan now');
    expect(dialog()!.textContent).toContain('Your plan has already started.');
    const confirm = [...dialog()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Start my plan now',
    );
    expect(confirm!.disabled).toBe(true);
  });
});
