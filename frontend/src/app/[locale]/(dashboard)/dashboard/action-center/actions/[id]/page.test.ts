import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirect(url);
    // next/navigation's redirect never returns.
    throw new Error('NEXT_REDIRECT');
  },
}));
const row = vi.hoisted(() => ({ value: null as { brand_id: string } | null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row.value, error: null }) }),
      }),
    }),
  }),
}));

import ActionRedirect from './page';

const go = (id: string) =>
  ActionRedirect({ params: Promise.resolve({ id }) }).catch((err: Error) => {
    if (err.message !== 'NEXT_REDIRECT') throw err;
  });

describe("an action's own path", () => {
  beforeEach(() => {
    redirect.mockClear();
    row.value = { brand_id: 'brand-1' };
  });

  it("opens the Actions page on its drawer, on the action's brand, with no filter", async () => {
    await go('action-1');
    expect(redirect).toHaveBeenCalledWith(
      '/dashboard/action-center/actions?action=action-1&brand=brand-1',
    );
  });

  it('keeps an odd id inside the query value', async () => {
    await go('a&b=c');
    expect(redirect).toHaveBeenCalledWith(
      '/dashboard/action-center/actions?action=a%26b%3Dc&brand=brand-1',
    );
  });

  it("opens the list for an action the person can't read", async () => {
    row.value = null;
    await go('action-2');
    expect(redirect).toHaveBeenCalledWith('/dashboard/action-center/actions');
  });
});
