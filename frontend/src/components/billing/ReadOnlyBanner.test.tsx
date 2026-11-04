import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { PlanProvider } from '@/components/context/PlanProvider';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import { UpgradeDialogProvider } from '@/components/context/UpgradeDialogProvider';
import { DemoBrandContext } from '@/components/context/DemoBrandProvider';
import { useBrandStore } from '@/state/useBrandStore';
import { ReadOnlyBanner } from './ReadOnlyBanner';

// An in-memory localStorage for the brand store: the test environment has none.
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

let pathname = '/dashboard/insights';
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => pathname,
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
const push = vi.hoisted(() => vi.fn());
const ensureDemoBrand = vi.hoisted(() => vi.fn());
vi.mock('@/lib/demo/demoClient', () => ({
  prepareDemoBrand: ensureDemoBrand,
  demoPreparation: () => null,
  setDemoHidden: vi.fn(),
}));
vi.mock('@/lib/actions/brand', () => ({ getBrandById: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render({
  active = false,
  status = 'canceled',
  role = 'admin',
  adminName = null,
  neverSubscribed = false,
  demoBrand = null,
}: {
  active?: boolean;
  status?: string | null;
  role?: TeamRole;
  adminName?: string | null;
  neverSubscribed?: boolean;
  demoBrand?: { id: string; hidden: boolean } | null;
} = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanProvider planId="starter" subscriptionActive={active} subscriptionStatus={status}>
          <RoleProvider role={role}>
            <DemoBrandContext.Provider
              value={{ isDemo: false, demoBrand, offer: 'trial', neverSubscribed }}
            >
              <UpgradeDialogProvider adminName={adminName}>
                <ReadOnlyBanner />
              </UpgradeDialogProvider>
            </DemoBrandContext.Provider>
          </RoleProvider>
        </PlanProvider>
      </NextIntlClientProvider>,
    );
  });
}

const link = () => container.querySelector('a');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  pathname = '/dashboard/insights';
  useBrandStore.setState({ loaded: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe('ReadOnlyBanner', () => {
  const seePlans = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'See plans');

  // A new browser: the brand on screen may be the demo brand, which has its own band.
  it('shows nothing until the brands are loaded', async () => {
    useBrandStore.setState({ loaded: false });
    await render({ status: 'canceled' });
    expect(container.textContent).toBe('');
  });

  it('says the workspace is read-only, and See plans opens the dialog', async () => {
    await render({ status: 'canceled' });
    expect(container.textContent).toContain(
      'Your workspace is read-only. You can look around; adding, running and AI need a plan.',
    );
    expect(link()).toBeNull();
    await act(async () => {
      seePlans()!.click();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Choose a plan to keep going',
    );
  });

  it('leaves See plans out on Billing itself', async () => {
    pathname = '/dashboard/settings/billing';
    await render();
    expect(container.textContent).toContain('Your workspace is read-only.');
    expect(seePlans()).toBeUndefined();
  });

  it('offers an admin Update payment method while a payment is being retried, on Billing too', async () => {
    pathname = '/dashboard/settings/billing';
    await render({ status: 'past_due' });
    expect(container.textContent).toContain(
      "Your last payment didn't go through, so your workspace is read-only.",
    );
    expect(container.querySelector('button')?.textContent).toBe('Update payment method');
    expect(seePlans()).toBeUndefined();
  });

  it('asks another member to have the admin update the payment method', async () => {
    await render({ status: 'unpaid', role: 'analyst', adminName: 'Jane Owner' });
    expect(container.textContent).toContain(
      'Ask Jane Owner, your workspace admin, to update the payment method.',
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('offers every member See plans once the plan ended', async () => {
    await render({ role: 'analyst' });
    expect(seePlans()).toBeDefined();
  });

  const seeTheDemo = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'See the demo');

  it('offers an admin or a manager See the demo once the plan ended', async () => {
    await render();
    expect(seeTheDemo()).toBeDefined();
    act(() => root.unmount());
    root = createRoot(container);
    await render({ role: 'manager' });
    expect(seeTheDemo()).toBeDefined();
  });

  it('opens the demo brand from See the demo', async () => {
    ensureDemoBrand.mockResolvedValue({ ok: false, status: 500 });
    await render();
    // Once ahead, as the band shows, and once more for the click.
    expect(ensureDemoBrand).toHaveBeenCalledTimes(1);
    await act(async () => seeTheDemo()!.click());
    expect(ensureDemoBrand).toHaveBeenCalledTimes(2);
  });

  it('says the demo is being set up while it opens', async () => {
    ensureDemoBrand.mockReturnValue(new Promise(() => {}));
    await render();
    await act(async () => seeTheDemo()!.click());
    expect(seeTheDemo()).toBeUndefined();
    const setting = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Setting up the demo…',
    );
    expect(setting?.disabled).toBe(true);
  });

  it('starts the setup ahead only for an admin or a manager with no demo brand yet', async () => {
    await render({ role: 'analyst', demoBrand: { id: 'demo', hidden: false } });
    expect(ensureDemoBrand).not.toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(container);
    await render({ demoBrand: { id: 'demo', hidden: true } });
    expect(ensureDemoBrand).not.toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(container);
    await render({ status: 'past_due' });
    expect(ensureDemoBrand).not.toHaveBeenCalled();
  });

  it('offers no demo while a payment is being retried, nor to a member with none to see', async () => {
    await render({ status: 'past_due' });
    expect(seeTheDemo()).toBeUndefined();
    act(() => root.unmount());
    root = createRoot(container);
    await render({ role: 'analyst' });
    expect(seeTheDemo()).toBeUndefined();
  });

  it('offers a workspace that never had a plan its free trial', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ valid: false })),
    );
    await render({ status: null, neverSubscribed: true });
    expect(container.textContent).toContain(
      "Your brand isn't tracked yet. Start a 14-day free trial, or get 50% off your first month.",
    );
    const start = seePlans()!;
    expect(seeTheDemo()).toBeDefined();
    await act(async () => start.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Choose how to start');
    vi.unstubAllGlobals();
  });

  it('says only the trial with the first-month offer off', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIRST_MONTH_OFFER', 'off');
    await render({ status: null, neverSubscribed: true });
    expect(container.textContent).toContain(
      "Your brand isn't tracked yet. Start a 14-day free trial.",
    );
    expect(container.textContent).not.toContain('50%');
  });

  it('offers another member of such a workspace See plans', async () => {
    await render({ status: null, neverSubscribed: true, role: 'analyst' });
    expect(container.textContent).toContain("Your brand isn't tracked yet.");
    expect(seePlans()).toBeDefined();
  });

  it('shows nothing while the plan is active', async () => {
    await render({ active: true, status: 'active' });
    expect(container.textContent).toBe('');
  });
});
