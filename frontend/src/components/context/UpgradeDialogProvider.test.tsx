import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { PlanProvider } from './PlanProvider';
import { RoleProvider, type TeamRole } from './RoleProvider';
import { UpgradeDialogProvider, useUpgradeGate } from './UpgradeDialogProvider';
import { DemoBrandProvider } from './DemoBrandProvider';
import { useBrandStore } from '@/state/useBrandStore';
import type { Brand } from '@/types';

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

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const action = vi.fn((label: string) => `ran ${label}`);
let returned: unknown;
// What a guarded button says it does, for the dialog's label; none unless a test says.
let label: string | undefined;

/** A button whose click is guarded, as a page's action button would be. */
function Probe() {
  const { guard, isLocked } = useUpgradeGate();
  return (
    <button
      type="button"
      data-locked={String(isLocked)}
      onClick={() => {
        returned = guard(action, { action: label })('Run all');
      }}
    >
      Run all
    </button>
  );
}

async function render({
  active,
  status = 'canceled',
  role = 'admin',
  adminName = null,
  provider = true,
  everSubscribed = true,
}: {
  active: boolean;
  status?: string | null;
  role?: TeamRole;
  adminName?: string | null;
  provider?: boolean;
  everSubscribed?: boolean;
}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanProvider planId="starter" subscriptionActive={active} subscriptionStatus={status}>
          <RoleProvider role={role}>
            <DemoBrandProvider everSubscribed={everSubscribed}>
              {provider ? (
                <UpgradeDialogProvider adminName={adminName}>
                  <Probe />
                </UpgradeDialogProvider>
              ) : (
                <Probe />
              )}
            </DemoBrandProvider>
          </RoleProvider>
        </PlanProvider>
      </NextIntlClientProvider>,
    );
  });
}

function brand(id: string, isDemo = false): Brand {
  return {
    id,
    organizationId: 'org1',
    name: isDemo ? 'Brewline Coffee' : 'Acme',
    slug: id,
    shoppingModeEnabled: false,
    isActive: true,
    isDemo,
    domains: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

/** The workspace's own brand and its demo brand, the given one selected. */
function selectBrand(id: 'own' | 'demo') {
  useBrandStore.setState({ brands: [brand('own'), brand('demo', true)], activeBrandId: id });
}

const probe = () => container.querySelector<HTMLButtonElement>('button[data-locked]')!;
const dialog = () => document.querySelector('[role="dialog"]');
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

async function runAll() {
  await act(async () => {
    probe().click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  useBrandStore.setState({ brands: [], activeBrandId: null });
  returned = undefined;
  label = undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe('useUpgradeGate', () => {
  it('runs the action while the plan is active', async () => {
    await render({ active: true, status: 'active' });
    expect(probe().dataset.locked).toBe('false');
    await runAll();
    expect(action).toHaveBeenCalledWith('Run all');
    expect(returned).toBe('ran Run all');
    expect(dialog()).toBeNull();
  });

  it('opens the upgrade dialog instead, without running it, while read-only', async () => {
    await render({ active: false });
    expect(probe().dataset.locked).toBe('true');
    await runAll();
    expect(action).not.toHaveBeenCalled();
    expect(returned).toBeUndefined();
    expect(dialog()?.textContent).toContain('Choose a plan to keep going');
    expect(dialog()?.textContent).toContain(
      "Your workspace has no active plan, so it\'s read-only. Everything you set up is still here: pick a plan to track, write and run your agents again.",
    );
    // The workspace's state when the button didn't say what it does.
    expect(document.querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Your workspace is read-only',
    );
  });

  it('closes with its ×, and opens again on the next action', async () => {
    await render({ active: false });
    await runAll();
    await act(async () => {
      button('Close')!.click();
    });
    await vi.waitFor(() => expect(dialog()).toBeNull());

    await runAll();
    expect(dialog()?.textContent).toContain('Choose a plan to keep going');
    expect(action).not.toHaveBeenCalled();
  });

  it('labels the dialog with what was clicked, when the button says', async () => {
    label = 'Adding prompts needs a plan';
    await render({ active: false });
    await runAll();
    expect(document.querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Adding prompts needs a plan',
    );
  });

  it('offers an admin the plans, to choose one right there', async () => {
    // The first-month code doesn't apply here: the plain Choose buttons.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ valid: false })),
    );
    try {
      await render({ active: false, status: 'canceled' });
      await runAll();
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      expect(button('Choose Starter')).toBeDefined();
      expect(button('Choose Growth')).toBeDefined();
      expect(dialog()?.textContent).toContain('Card required.');
      expect(button('Update payment method')).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('takes an admin to Stripe’s billing page while a payment is being retried', async () => {
    // Stripe's billing page; a hash, which jsdom can navigate to.
    const fetchMock = vi.fn(async () => Response.json({ url: '#portal' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await render({ active: false, status: 'past_due' });
      await runAll();
      expect(dialog()?.textContent).toContain('Update your payment method to keep going');
      expect(dialog()?.textContent).toContain("Your last payment didn't go through");
      // No new plan beside the one being retried.
      expect(
        [...document.querySelectorAll('a')].some((a) => a.textContent === 'Choose a plan'),
      ).toBe(false);
      await act(async () => {
        button('Update payment method')!.click();
      });
      expect(fetchMock).toHaveBeenCalledWith('/api/stripe/portal', { method: 'POST' });
      await vi.waitFor(() => expect(window.location.hash).toBe('#portal'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks another member to turn to the admin, by name when known', async () => {
    await render({ active: false, status: null, role: 'manager', adminName: 'Jane Owner' });
    await runAll();
    expect(dialog()?.textContent).toContain('Your workspace has no active plan');
    expect(dialog()?.textContent).toContain(
      'Only an admin can choose a plan for your workspace. Ask Jane Owner, your workspace admin, to choose a plan.',
    );
    expect(button('Choose Starter')).toBeUndefined();
  });

  it('asks another member to have the admin update the payment method', async () => {
    await render({ active: false, status: 'unpaid', role: 'analyst' });
    await runAll();
    expect(dialog()?.textContent).toContain(
      'Ask your workspace admin to update the payment method.',
    );
    expect(button('Update payment method')).toBeUndefined();
  });

  it('asks for the workspace admin without a name', async () => {
    await render({ active: false, role: 'analyst' });
    await runAll();
    expect(dialog()?.textContent).toContain(
      'Only an admin can choose a plan for your workspace. Ask your admin to choose a plan.',
    );
  });

  it('never locks self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await render({ active: false });
    await runAll();
    expect(action).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('runs the action outside the dashboard’s provider', async () => {
    await render({ active: false, provider: false });
    await runAll();
    expect(action).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
});

describe('useUpgradeGate on the demo brand', () => {
  const fetchMock = vi.fn(async () => Response.json({ valid: false }));
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a workspace that never subscribed with the trial, naming what was clicked', async () => {
    selectBrand('demo');
    label = 'Adding prompts needs a plan';
    await render({ active: false, status: null, everSubscribed: false });
    expect(probe().dataset.locked).toBe('true');
    await runAll();
    expect(action).not.toHaveBeenCalled();
    // The workspace's own brand, by name.
    expect(dialog()?.textContent).toContain('Use GetCito for Acme');
    expect(document.querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Adding prompts works on your own brand',
    );
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-choice="trial"]')!.click();
    });
    expect(button('Start 14-day free trial')).toBeDefined();
  });

  it('gives a workspace whose plan ended Buy now, with no trial', async () => {
    selectBrand('demo');
    await render({ active: false, status: 'canceled' });
    await runAll();
    expect(dialog()?.textContent).toContain('Use GetCito for Acme');
    // Opened without a label: what the demo is.
    expect(document.querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'This is a demo brand with sample data',
    );
    expect(button('Choose Starter')).toBeDefined();
  });

  it('locks the demo brand with a plan active too, and switches to the own brand', async () => {
    selectBrand('demo');
    await render({ active: true, status: 'active' });
    expect(probe().dataset.locked).toBe('true');
    await runAll();
    expect(action).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('This is a demo brand');
    expect(button('Choose Starter')).toBeUndefined();
    await act(async () => {
      button('Switch to your brand')!.click();
    });
    expect(useBrandStore.getState().activeBrandId).toBe('own');
    // On its own brand, the action runs.
    await runAll();
    expect(action).toHaveBeenCalledWith('Run all');
  });

  it('asks for the payment method while a payment is being retried', async () => {
    selectBrand('demo');
    await render({ active: false, status: 'past_due' });
    await runAll();
    expect(dialog()?.textContent).toContain('Update your payment method to keep going');
  });

  it("keeps the workspace's own brand as it was", async () => {
    selectBrand('own');
    await render({ active: true, status: 'active' });
    expect(probe().dataset.locked).toBe('false');
    await runAll();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('never treats a demo brand as one self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    selectBrand('demo');
    await render({ active: true, status: 'active' });
    await runAll();
    expect(action).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
});

describe("useUpgradeGate on a brand that isn't tracked yet", () => {
  const fetchMock = vi.fn(async () => Response.json({ valid: false }));
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers an admin who never subscribed the free trial', async () => {
    selectBrand('own');
    await render({ active: false, status: null, everSubscribed: false });
    expect(probe().dataset.locked).toBe('true');
    await runAll();
    expect(action).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Choose how to start');
    expect(document.querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      "Your brand isn't tracked yet",
    );
    expect(button('Choose Starter')).toBeDefined();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-choice="trial"]')!.click();
    });
    expect(button('Start 14-day free trial')).toBeDefined();
  });

  it('keeps what was clicked as the label', async () => {
    selectBrand('own');
    label = 'Adding prompts needs a plan';
    await render({ active: false, status: 'incomplete', everSubscribed: false });
    await runAll();
    expect(document.querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Adding prompts needs a plan',
    );
  });

  it('asks another member to have the admin start it', async () => {
    selectBrand('own');
    await render({ active: false, status: null, everSubscribed: false, role: 'analyst' });
    await runAll();
    expect(dialog()?.textContent).toContain('Ask your admin to choose a plan.');
    expect(button('Start 14-day free trial')).toBeUndefined();
  });
});

describe('a server action refused as read-only', () => {
  /** A rejection no caller caught, as the browser reports it. */
  async function reject(reason: unknown) {
    const event = Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason });
    await act(async () => {
      window.dispatchEvent(event);
    });
    return event;
  }

  it('opens the upgrade dialog when no caller caught it, though the page still thought the plan active', async () => {
    await render({ active: true, status: 'active' });
    const event = await reject(
      Object.assign(new Error('masked in production'), { digest: 'subscription_inactive' }),
    );
    expect(event.defaultPrevented).toBe(true);
    expect(dialog()?.textContent).toContain('Choose a plan to keep going');
  });

  it('opens it for a write the server refused on the demo brand, by its digest', async () => {
    await render({ active: true, status: 'active' });
    const event = await reject(
      Object.assign(new Error('masked in production'), { digest: 'demo_brand' }),
    );
    expect(event.defaultPrevented).toBe(true);
    expect(dialog()).not.toBeNull();
  });

  it('leaves any other rejection alone', async () => {
    await render({ active: false });
    const event = await reject(new Error('Failed to fetch'));
    expect(event.defaultPrevented).toBe(false);
    expect(dialog()).toBeNull();
  });
});
