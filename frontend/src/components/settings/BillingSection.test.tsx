import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { DemoBrandProvider } from '@/components/context/DemoBrandProvider';
import { PlanProvider } from '@/components/context/PlanProvider';
import { BillingSection } from './BillingSection';

/**
 * Billing's current plan: a workspace that never started a plan has none to
 * name ("No plan yet", not "Starter incomplete"), and its cards offer the
 * free trial beside Buy now; a plan that ended keeps its name and status.
 */

/** The organization's row, as Billing reads it. */
let org: { plan: string | null; subscription_status: string | null };

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data:
              table === 'profiles'
                ? { organization_id: 'org1' }
                : { ...org, subscription_ends_at: null },
          }),
        }),
      }),
    }),
  }),
}));

// The cards, as Billing hands them the subscription; their own test covers them.
const switcher = vi.hoisted(() => vi.fn());
vi.mock('@/components/settings/PlanSwitcher', () => ({
  PlanSwitcher: (props: { trialOffered?: boolean; onUpdate: (data: unknown) => void }) => {
    switcher(props);
    return <div data-slot="plan-switcher" />;
  },
}));
// The AI usage card: each time it mounts, it reads the usage.
const usageReads = vi.hoisted(() => vi.fn());
vi.mock('@/components/settings/AiUsageCard', async () => {
  const { useEffect } = await import('react');
  return {
    AiUsageCard: () => {
      useEffect(() => usageReads(), []);
      return null;
    },
  };
});
vi.mock('@/components/settings/AddOnsCard', () => ({ AddOnsCard: () => null }));
vi.mock('@/components/settings/InvoiceList', () => ({ InvoiceList: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render(everSubscribed: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanProvider planId="starter" subscriptionActive={false}>
          <DemoBrandProvider everSubscribed={everSubscribed}>
            <BillingSection />
          </DemoBrandProvider>
        </PlanProvider>
      </NextIntlClientProvider>,
    );
  });
  await vi.waitFor(() =>
    expect(container.querySelector('[data-slot="plan-switcher"]')).not.toBeNull(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  // Stripe has no subscription to add: the organization's row stands.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'none' }, { status: 404 })),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('BillingSection', () => {
  it('says a workspace that never started a plan has none yet, and offers the trial', async () => {
    org = { plan: 'free', subscription_status: 'incomplete' };
    await render(false);
    expect(container.textContent).toContain('No plan yet');
    expect(container.textContent).toContain(
      'Your brands are saved. Tracking starts once you choose a plan below.',
    );
    expect(container.textContent).not.toContain('Starter');
    expect(container.textContent).not.toContain('incomplete');
    expect(container.textContent).not.toContain('$49/');
    expect(container.textContent).toContain('Choose how to start');
    expect(switcher).toHaveBeenLastCalledWith(expect.objectContaining({ trialOffered: true }));
  });

  it('names the plan that ended, with Buy now alone on its cards', async () => {
    org = { plan: 'growth', subscription_status: 'canceled' };
    await render(true);
    expect(container.textContent).toContain('Growth');
    expect(container.textContent).toContain('Canceled');
    expect(container.textContent).not.toContain('No plan yet');
    expect(container.textContent).toContain('Choose a plan');
    expect(switcher).toHaveBeenLastCalledWith(expect.objectContaining({ trialOffered: false }));
  });

  it('reads the AI usage again once the plan changes, as a trial bought starts at 0', async () => {
    org = { plan: 'starter', subscription_status: 'trialing' };
    await render(true);
    expect(usageReads).toHaveBeenCalledTimes(1);

    await act(async () => {
      switcher.mock.lastCall![0].onUpdate({ planId: 'starter', status: 'active' });
    });
    expect(container.textContent).toContain('Active');
    expect(usageReads).toHaveBeenCalledTimes(2);
  });
});
