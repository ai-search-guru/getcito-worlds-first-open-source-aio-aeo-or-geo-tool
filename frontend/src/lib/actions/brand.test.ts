import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS, type Plan } from '@/config/plans';

/**
 * createBrand reports the brand limit as a value, not a throw: production
 * masks errors thrown from a server action, so a thrown limit error reached
 * the user as the generic Server Components digest message.
 */

let brandCount = 0;
let countCalls: unknown[][] = [];
let inserted: unknown[] = [];
let readBackFilters: unknown[][][] = [];
let returningRequested = false;
let updates: Record<string, unknown>[] = [];
let plan: Plan;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/guards/planGuard', () => ({
  getOrgPlan: vi.fn(async () => plan),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: async (...call: unknown[]) => {
      countCalls.push(call);
      return { data: brandCount, error: null };
    },
    from: (table: string) => ({
      select: () => {
        const filters: unknown[][] = [];
        const chain = {
          eq: (...filter: unknown[]) => {
            filters.push(filter);
            return chain;
          },
          // The read-back after the insert (by the id createBrand chose).
          single: async () => {
            readBackFilters.push(filters);
            const id = filters.find(([column]) => column === 'id')?.[1];
            return {
              data: { id, organization_id: 'org-1', name: 'Acme', slug: 'acme' },
              error: null,
            };
          },
        };
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        const row = {
          id: 'b1',
          organization_id: 'org-1',
          name: 'Acme',
          slug: 'acme',
          site_type: payload.site_type ?? null,
          brand_domains: [],
        };
        return {
          eq: () => ({ select: () => ({ single: async () => ({ data: row, error: null }) }) }),
        };
      },
      insert: (row: unknown) => {
        inserted.push({ table, row });
        return {
          // insert … returning: refused for a Selected-brands person (00389).
          select: () => {
            returningRequested = true;
            return {
              single: async () => ({
                data: { id: 'b1', organization_id: 'org-1', name: 'Acme', slug: 'acme' },
                error: null,
              }),
            };
          },
          then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
        };
      },
    }),
  })),
}));

const { createBrand, updateBrand } = await import('./brand');

const input = { organizationId: 'org-1', name: 'Acme', domains: [] };
const capped = (maxBrands: number): Plan => ({
  ...PLANS.enterprise,
  limits: { ...PLANS.enterprise.limits, maxBrands },
});

describe('createBrand plan limit', () => {
  beforeEach(() => {
    inserted = [];
    countCalls = [];
    readBackFilters = [];
    returningRequested = false;
  });

  it('counts every brand of the organization, whatever the person sees, never the demo brand (00380, 00390)', async () => {
    brandCount = 0;
    plan = capped(5);

    await createBrand(input);

    expect(countCalls).toEqual([['org_brand_count', { p_organization_id: 'org-1' }]]);
  });

  it('returns a readable plan_limit result and inserts nothing at the limit', async () => {
    brandCount = 5;
    plan = capped(5);

    const result = await createBrand(input);

    expect(result).toEqual({
      code: 'plan_limit',
      error: 'Your plan includes 5 brands. Upgrade your plan to add more.',
    });
    expect(inserted).toEqual([]);
  });

  it('creates the brand below the limit', async () => {
    brandCount = 4;
    plan = capped(5);

    const result = await createBrand(input);

    expect(inserted).toHaveLength(1);
    const { row } = inserted[0] as { row: { id: string } };
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect('brand' in result && result.brand.id).toBe(row.id);
  });

  it('inserts with its own id and reads the brand back after, never insert … returning', async () => {
    // A Selected-brands manager (00388/00389) sees a new brand only once the
    // creator grant has run, after the insert: returning would fail RLS.
    brandCount = 0;
    plan = capped(5);

    await createBrand(input);

    const { row } = inserted[0] as { row: { id: string } };
    expect(returningRequested).toBe(false);
    expect(readBackFilters).toEqual([[['id', row.id]]]);
  });
});

describe('updateBrand site type (Content Editor CE-023)', () => {
  beforeEach(() => {
    updates = [];
  });

  it('saves the site type picked in the settings', async () => {
    const brand = await updateBrand('b1', { siteType: 'ecommerce' });
    expect(updates).toEqual([{ site_type: 'ecommerce' }]);
    expect(brand.siteType).toBe('ecommerce');
  });

  it('saves Mobile app (00456)', async () => {
    await updateBrand('b1', { siteType: 'app' });
    expect(updates).toEqual([{ site_type: 'app' }]);
  });

  it('refuses a site type it doesn’t know, before writing', async () => {
    await expect(
      updateBrand('b1', { siteType: 'agency' as Parameters<typeof updateBrand>[1]['siteType'] }),
    ).rejects.toThrow('Unknown site type');
    expect(updates).toEqual([]);
  });
});

describe('updateBrand conversions (CE-017)', () => {
  beforeEach(() => {
    updates = [];
  });

  it('saves conversions on or off and the consent mode', async () => {
    await updateBrand('b1', { conversionsEnabled: true });
    await updateBrand('b1', { conversionsConsent: 'always' });
    expect(updates).toEqual([{ conversions_enabled: true }, { conversions_consent: 'always' }]);
  });

  it('refuses a consent mode it doesn’t know, before writing', async () => {
    await expect(
      updateBrand('b1', {
        conversionsConsent: 'sometimes' as Parameters<typeof updateBrand>[1]['conversionsConsent'],
      }),
    ).rejects.toThrow('Unknown consent mode');
    expect(updates).toEqual([]);
  });
});
