import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

const { planFromOrgRow, usagePlanFromOrgRow } = await import('./planGuard');

/** The plan an organization's usage is shown against, while it's on one and once it has ended. */

afterEach(() => vi.unstubAllEnvs());

describe('usagePlanFromOrgRow', () => {
  it('is the plan it is entitled to while its subscription is active or in trial', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    for (const status of ['active', 'trialing']) {
      const { plan, ended } = usagePlanFromOrgRow({ plan: 'growth', subscription_status: status });
      expect([plan.id, ended]).toEqual(['growth', false]);
    }
  });

  it('is the plan it was on once that has ended, marked ended, where entitlement reads Starter', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    const org = {
      plan: 'enterprise',
      subscription_status: 'canceled',
      plan_overrides: { maxPrompts: 1000 },
    };
    expect(planFromOrgRow(org).id).toBe('starter');
    const { plan, ended } = usagePlanFromOrgRow(org);
    expect([plan.id, plan.limits.maxPrompts, ended]).toEqual(['enterprise', 1000, true]);
  });

  it('never ends on a self-hosted install', () => {
    const { plan, ended } = usagePlanFromOrgRow({ plan: 'growth', subscription_status: null });
    expect([plan.id, ended]).toEqual(['self_hosted', false]);
  });
});
