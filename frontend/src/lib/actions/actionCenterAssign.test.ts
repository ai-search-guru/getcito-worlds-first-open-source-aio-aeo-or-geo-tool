import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Assigning an action (BRAND-ACCESS §3.1): only someone who can see the
 * brand takes it. Everyone has All brands until the Team screen narrows
 * someone, so a teammate is always let through today.
 */

const writes: { table: string; op: string; payload: unknown }[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const record = (op: string) => (payload: unknown) => {
        writes.push({ table, op, payload });
        return chain;
      };
      Object.assign(chain, {
        update: record('update'),
        insert: record('insert'),
        eq: () => chain,
        not: () => chain,
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      });
      return chain;
    },
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
const canAccessBrand = vi.hoisted(() => vi.fn());
vi.mock('@/lib/brandAccess', () => ({ canAccessBrand }));

const { assignAction } = await import('./actionCenter');

beforeEach(() => {
  writes.length = 0;
  canAccessBrand.mockReset().mockResolvedValue(true);
});

describe('assignAction', () => {
  it('assigns someone who can see the brand, and logs it', async () => {
    await assignAction('b1', 'a1', 'u2');
    expect(canAccessBrand).toHaveBeenCalledWith('u2', 'b1');
    expect(writes).toContainEqual({
      table: 'actions',
      op: 'update',
      payload: expect.objectContaining({ assignee_id: 'u2' }),
    });
    expect(writes).toContainEqual(
      expect.objectContaining({ table: 'action_events', op: 'insert' }),
    );
  });

  it("refuses someone the brand wasn't shared with, writing nothing", async () => {
    canAccessBrand.mockResolvedValue(false);
    await expect(assignAction('b1', 'a1', 'u3')).rejects.toThrow("can't see this brand");
    expect(writes).toEqual([]);
  });

  it('clears the assignee without asking about anyone', async () => {
    await assignAction('b1', 'a1', null);
    expect(canAccessBrand).not.toHaveBeenCalled();
    expect(writes).toContainEqual({
      table: 'actions',
      op: 'update',
      payload: expect.objectContaining({ assignee_id: null }),
    });
  });
});
