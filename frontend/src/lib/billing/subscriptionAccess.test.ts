import { describe, expect, it, vi } from 'vitest';

import { evaluateSubscriptionAccess, readOnlyReason } from './subscriptionAccess';

// Minimal Supabase stub: the chained query builder resolves to `ownerRow` at
// `.maybeSingle()`. Only the read-only path for non-admins touches it.
function fakeSupabase(ownerRow: { full_name: string | null } | null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: ownerRow, error: null }),
  };
  const from = vi.fn(() => builder);
  // Cast through unknown — the helper only uses .from(...).select()....maybeSingle().
  return { client: { from } as unknown as Parameters<typeof evaluateSubscriptionAccess>[0], from };
}

describe('evaluateSubscriptionAccess', () => {
  it('returns ok for active/trialing regardless of role (no owner lookup)', async () => {
    const { client, from } = fakeSupabase(null);
    expect(await evaluateSubscriptionAccess(client, 'org', 'analyst', 'active', true)).toEqual({
      state: 'ok',
    });
    expect(await evaluateSubscriptionAccess(client, 'org', 'admin', 'trialing', true)).toEqual({
      state: 'ok',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("sends an admin who never subscribed back to onboarding's plan step", async () => {
    const { client, from } = fakeSupabase(null);
    expect(await evaluateSubscriptionAccess(client, 'org', 'admin', 'incomplete', false)).toEqual({
      state: 'choose_plan',
    });
    expect(await evaluateSubscriptionAccess(client, 'org', 'admin', null, false)).toEqual({
      state: 'choose_plan',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('lets an admin who never subscribed explore the demo brand, read-only', async () => {
    const { client, from } = fakeSupabase(null);
    expect(
      await evaluateSubscriptionAccess(client, 'org', 'admin', null, false, { hasDemoBrand: true }),
    ).toEqual({ state: 'read_only', adminName: null });
    expect(
      await evaluateSubscriptionAccess(client, 'org', 'admin', 'incomplete', false, {
        hasDemoBrand: false,
      }),
    ).toEqual({ state: 'choose_plan' });
    expect(from).not.toHaveBeenCalled();
  });

  it('lets an admin whose plan ended into the dashboard, read-only', async () => {
    const { client, from } = fakeSupabase(null);
    expect(await evaluateSubscriptionAccess(client, 'org', 'admin', 'canceled', true)).toEqual({
      state: 'read_only',
      adminName: null,
    });
    expect(await evaluateSubscriptionAccess(client, 'org', 'admin', 'past_due', true)).toEqual({
      state: 'read_only',
      adminName: null,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('lets other members in read-only and names the admin to ask', async () => {
    const { client } = fakeSupabase({ full_name: 'Jane Owner' });
    expect(await evaluateSubscriptionAccess(client, 'org', 'manager', 'canceled', true)).toEqual({
      state: 'read_only',
      adminName: 'Jane Owner',
    });
    // Never subscribed: only an admin can take the plan step.
    expect(await evaluateSubscriptionAccess(client, 'org', 'analyst', null, false)).toEqual({
      state: 'read_only',
      adminName: 'Jane Owner',
    });
  });

  it('falls back to no admin name when the lookup returns nothing', async () => {
    const { client } = fakeSupabase(null);
    expect(await evaluateSubscriptionAccess(client, 'org', 'analyst', null, true)).toEqual({
      state: 'read_only',
      adminName: null,
    });
  });
});

describe('readOnlyReason', () => {
  it('reads a payment being retried as one to fix with the card', () => {
    expect(readOnlyReason('past_due')).toBe('payment_failed');
    expect(readOnlyReason('unpaid')).toBe('payment_failed');
  });

  it('reads anything else as ended, with no claim about a trial', () => {
    for (const status of ['canceled', 'paused', 'incomplete', 'incomplete_expired', null]) {
      expect(readOnlyReason(status)).toBe('ended');
    }
    expect(readOnlyReason(undefined)).toBe('ended');
  });
});
