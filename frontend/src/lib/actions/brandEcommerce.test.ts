import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * markBrandAsEcommerce: setup found the brand sells online, so its site type
 * becomes e-commerce as a detection unless a person chose one (00379), its
 * industry becomes E-commerce & Retail when it has none and Shopping mode
 * goes on (ChatGPT Shopping on every prompt, the brand_platforms row), which
 * shows Product Visibility in the menu.
 */

let brand: {
  industry: string | null;
  shopping_mode_enabled: boolean;
  site_type: string | null;
  site_type_source: string | null;
};
let prompts: { id: string; platforms: string[] }[];
let writes: { table: string; op: string; value: unknown }[];
// RLS lets a write through, or matches no row without an error (an analyst).
let denied: boolean;
// 00379 not applied yet: its columns don't exist (Postgres 42703).
let missingColumn: boolean;
const MISSING = { code: '42703', message: 'column brands.site_type_source does not exist' };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/guards/planGuard', () => ({ getOrgPlan: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      let op = 'select';
      let value: unknown = null;
      let columns = '';
      const settle = async () => {
        if (op !== 'select') {
          if (
            op === 'update' &&
            missingColumn &&
            Object.hasOwn(value as object, 'site_type_detected_at')
          ) {
            return { data: null, error: MISSING };
          }
          if (op === 'update' && denied) return { data: [], error: null };
          writes.push({ table, op, value });
          return { data: [{ id: 'row' }], error: null };
        }
        if (missingColumn && columns.includes('site_type_source'))
          return { data: null, error: MISSING };
        return { data: table === 'prompts' ? prompts : brand, error: null };
      };
      const chain: Record<string, unknown> = {
        select: (cols?: string) => {
          if (op === 'select' && cols) columns = cols;
          return chain;
        },
        eq: () => chain,
        single: settle,
        update: (patch: unknown) => {
          op = 'update';
          value = patch;
          return chain;
        },
        upsert: (row: unknown) => {
          op = 'upsert';
          value = row;
          return settle();
        },
        then: (resolve: (v: unknown) => unknown) => settle().then(resolve),
      };
      return chain;
    },
  })),
}));

const { markBrandAsEcommerce, setBrandShoppingMode } = await import('./brand');

const TYPE_WRITE = {
  table: 'brands',
  op: 'update',
  value: { site_type: 'ecommerce', site_type_detected_at: expect.any(String) },
};

beforeEach(() => {
  brand = { industry: null, shopping_mode_enabled: false, site_type: null, site_type_source: null };
  prompts = [
    { id: 'p1', platforms: ['chatgpt-web'] },
    { id: 'p2', platforms: ['chatgpt-web', 'chatgpt-shopping'] },
  ];
  writes = [];
  denied = false;
  missingColumn = false;
});

describe('markBrandAsEcommerce', () => {
  it('still turns Shopping mode on when 00379 is not applied yet, leaving the type', async () => {
    missingColumn = true;
    expect(await markBrandAsEcommerce('b1')).toEqual({
      industry: 'E-commerce & Retail',
      promptsUpdated: 1,
      siteType: null,
    });
    expect(writes.some((w) => Object.hasOwn(w.value as object, 'site_type'))).toBe(false);
    expect(writes).toContainEqual({
      table: 'brands',
      op: 'update',
      value: { shopping_mode_enabled: true },
    });
  });

  it('sets the site type and industry and turns Shopping mode on', async () => {
    expect(await markBrandAsEcommerce('b1')).toEqual({
      industry: 'E-commerce & Retail',
      promptsUpdated: 1,
      siteType: 'ecommerce',
    });
    expect(writes).toEqual([
      TYPE_WRITE,
      { table: 'brands', op: 'update', value: { industry: 'E-commerce & Retail' } },
      { table: 'brands', op: 'update', value: { shopping_mode_enabled: true } },
      { table: 'prompts', op: 'update', value: { platforms: ['chatgpt-web', 'chatgpt-shopping'] } },
      {
        table: 'brand_platforms',
        op: 'upsert',
        value: { brand_id: 'b1', platform: 'chatgpt-shopping', is_enabled: true },
      },
    ]);
  });

  it('keeps an industry the brand already has', async () => {
    brand.industry = 'Food & Beverage';
    expect(await markBrandAsEcommerce('b1')).toMatchObject({ industry: 'Food & Beverage' });
    expect(writes.some((w) => (w.value as { industry?: string })?.industry)).toBe(false);
  });

  it('leaves a brand already in Shopping mode as it is, industry included', async () => {
    brand = {
      ...brand,
      shopping_mode_enabled: true,
      site_type: 'ecommerce',
      site_type_source: 'auto',
    };
    expect(await markBrandAsEcommerce('b1')).toEqual({
      industry: null,
      promptsUpdated: 0,
      siteType: null,
    });
    expect(writes).toEqual([]);
  });

  it('gives a brand already in Shopping mode its site type, and nothing else', async () => {
    brand = { ...brand, shopping_mode_enabled: true };
    expect(await markBrandAsEcommerce('b1')).toMatchObject({ siteType: 'ecommerce' });
    expect(writes).toEqual([TYPE_WRITE]);
  });

  it('never writes over a site type a person chose', async () => {
    brand = { ...brand, site_type: 'b2b', site_type_source: 'manual' };
    expect(await markBrandAsEcommerce('b1')).toMatchObject({ siteType: null });
    expect(writes.some((w) => (w.value as { site_type?: string })?.site_type)).toBe(false);
  });

  it('fails, writing nothing, when RLS denies the brand update', async () => {
    denied = true;
    await expect(markBrandAsEcommerce('b1')).rejects.toThrow(
      'Brand not found or you do not have permission to update it.',
    );
    expect(writes).toEqual([]);
  });
});

describe('setBrandShoppingMode', () => {
  it('fails when RLS denies the brand update, adding no prompt platform or brand_platforms row', async () => {
    denied = true;
    await expect(setBrandShoppingMode('b1', true)).rejects.toThrow(
      'Brand not found or you do not have permission to update it.',
    );
    expect(writes).toEqual([]);
  });
});
