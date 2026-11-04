import { describe, expect, it, vi } from 'vitest';
import { countPlanBrands } from './planBrandCount';

type Client = Parameters<typeof countPlanBrands>[0];

function client(
  answer: { data: number | null; error: { code: string; message: string } | null },
  seen = 0,
) {
  const filters: unknown[][] = [];
  const rpc = vi.fn(async () => answer);
  const chain = {
    select: () => chain,
    eq: (...filter: unknown[]) => {
      filters.push(filter);
      return chain;
    },
    then: (resolve: (value: { count: number }) => void) => resolve({ count: seen }),
  };
  const from = vi.fn(() => chain);
  return { db: { rpc, from } as unknown as Client, rpc, from, filters };
}

describe('countPlanBrands', () => {
  it('counts every brand of the organization, not only the ones the person sees (00390)', async () => {
    const { db, rpc, from } = client({ data: 3, error: null }, 1);

    expect(await countPlanBrands(db, 'org-1')).toBe(3);
    expect(rpc).toHaveBeenCalledWith('org_brand_count', { p_organization_id: 'org-1' });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ['PGRST202', 'Could not find the function public.org_brand_count(p_organization_id)'],
    ['42883', 'function public.org_brand_count(uuid) does not exist'],
  ])(
    'falls back to the brands the person reads, the demo brand left out, until 00390 is on the database (%s)',
    async (code, message) => {
      const { db, from, filters } = client({ data: null, error: { code, message } }, 2);

      expect(await countPlanBrands(db, 'org-1')).toBe(2);
      expect(from).toHaveBeenCalledWith('brands');
      expect(filters).toEqual([
        ['organization_id', 'org-1'],
        ['is_demo', false],
      ]);
    },
  );

  it('throws on any other error, so a limit never passes on a failed count', async () => {
    const { db, from } = client(
      {
        data: null,
        error: { code: '57014', message: 'canceling statement due to statement timeout' },
      },
      0,
    );

    await expect(countPlanBrands(db, 'org-1')).rejects.toThrow('statement timeout');
    expect(from).not.toHaveBeenCalled();
  });
});
