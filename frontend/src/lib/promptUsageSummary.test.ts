import { describe, expect, it, vi } from 'vitest';
import { PLANS, type Plan } from '@/config/plans';
import { fetchPromptUsageRow, toPromptUsageSummary, usagePlan } from './promptUsageSummary';

const withLimit = (plan: Plan, maxPrompts: number): Plan => ({
  ...plan,
  limits: { ...plan.limits, maxPrompts },
});

describe('usagePlan', () => {
  it('names each plan with its limit and where the Slots left card points', () => {
    expect(usagePlan(PLANS.starter)).toEqual({
      key: 'starter',
      name: 'Starter plan',
      locationLimit: 50,
      cta: 'upgrade_growth',
    });
    expect(usagePlan(PLANS.growth)).toEqual({
      key: 'growth',
      name: 'Growth plan',
      locationLimit: 200,
      cta: 'upgrade',
    });
  });

  it('shows the limit GetCito set for an Enterprise customer, and asks them to contact us', () => {
    expect(usagePlan(withLimit(PLANS.enterprise, 1000))).toEqual({
      key: 'enterprise',
      name: 'Enterprise plan',
      locationLimit: 1000,
      cta: 'contact',
    });
  });

  it('reports no limit, rather than -1, while none is set', () => {
    expect(usagePlan(PLANS.enterprise).locationLimit).toBeNull();
    expect(usagePlan(PLANS.self_hosted)).toEqual({
      key: 'self_hosted',
      name: 'Self-Hosted plan',
      locationLimit: null,
      cta: null,
    });
  });
});

describe('toPromptUsageSummary', () => {
  it('shapes the counters row as the usage cards read it', () => {
    const now = new Date('2026-10-15T09:12:00Z');
    const summary = toPromptUsageSummary(
      {
        brand_active: 702,
        brand_paused: 7,
        account_active: 1248,
        account_brands: 3,
        account_locations: 781,
      },
      withLimit(PLANS.enterprise, 1000),
      now,
    );

    expect(summary).toEqual({
      plan: { key: 'enterprise', name: 'Enterprise plan', locationLimit: 1000, cta: 'contact' },
      brand: { active: 702, paused: 7, total: 709 },
      account: { activePrompts: 1248, brands: 3, locationsUsed: 781 },
      updatedAt: '2026-10-15T09:12:00.000Z',
    });
  });
});

describe('fetchPromptUsageRow', () => {
  it("reads the brand's row from the counters RPC", async () => {
    const row = {
      brand_active: 1,
      brand_paused: 0,
      account_active: 1,
      account_brands: 1,
      account_locations: 2,
    };
    const rpc = vi.fn(async () => ({ data: [row], error: null }));

    await expect(fetchPromptUsageRow({ rpc } as never, 'b1')).resolves.toEqual(row);
    expect(rpc).toHaveBeenCalledWith('prompt_usage_summary', { p_brand_id: 'b1' });
  });

  it('is null for a brand the caller cannot see', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await expect(fetchPromptUsageRow({ rpc } as never, 'b2')).resolves.toBeNull();
  });

  it('throws when the RPC fails', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
    await expect(fetchPromptUsageRow({ rpc } as never, 'b1')).rejects.toThrow('boom');
  });
});
