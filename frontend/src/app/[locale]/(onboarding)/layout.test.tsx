import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Onboarding on GetCito Cloud once a member has finished it: a workspace
 * whose plan ended opens the dashboard read-only instead of the wizard (where
 * the brand could be set up again); only an admin of a new account that never
 * subscribed keeps the plan step.
 */

let profile: Record<string, unknown> | null;
let org: Record<string, unknown> | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        single: async () => ({ data: table === 'profiles' ? profile : org }),
        maybeSingle: async () => ({ data: null }),
      };
      return query;
    },
  }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));
vi.mock('@/components/context/SessionProvider', () => ({ SessionProvider: () => null }));
vi.mock('@/components/auth/OnboardingSignOutButton', () => ({
  OnboardingSignOutButton: () => null,
}));

const { default: OnboardingLayout } = await import('./layout');

/** The wizard drawn (true), or the address the layout redirected to. */
async function open(): Promise<true | string> {
  try {
    const tree: ReactNode = await OnboardingLayout({ children: <p>Wizard</p> });
    expect(isValidElement(tree)).toBe(true);
    return true;
  } catch (err) {
    const match = /^NEXT_REDIRECT (.+)$/.exec((err as Error).message);
    if (match) return match[1];
    throw err;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  profile = { organization_id: 'org1', onboarding_completed: true, role: 'admin' };
  org = { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
});

describe('the onboarding layout', () => {
  it('sends a member whose plan ended to the read-only dashboard', async () => {
    profile = { ...profile, role: 'analyst' };
    expect(await open()).toBe('/dashboard');
  });

  it('sends an admin whose plan ended to the dashboard too, where Billing has the plans', async () => {
    expect(await open()).toBe('/dashboard');
  });

  it('keeps the plan step for an admin of a new account that never subscribed', async () => {
    org = { subscription_status: 'incomplete', stripe_subscription_id: null };
    expect(await open()).toBe(true);
  });

  it('lets a new member who has not finished onboarding through', async () => {
    profile = { organization_id: null, onboarding_completed: false, role: 'admin' };
    expect(await open()).toBe(true);
  });
});
