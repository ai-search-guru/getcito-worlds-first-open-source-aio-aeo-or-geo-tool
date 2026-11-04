// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Once a plan is bought, the demo brand is hidden and its sample chats go
 * with it (Chat's menu lists a person's chats of every brand).
 */

const db = vi.hoisted(() => ({
  /** The demo brands the hide updates. */
  hidden: [] as { id: string }[],
  calls: [] as string[],
  deleted: null as string[] | null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain = {
        update: () => (db.calls.push(`update ${table}`), chain),
        delete: () => (db.calls.push(`delete ${table}`), chain),
        eq: () => chain,
        is: () => chain,
        in: (_column: string, ids: string[]) => {
          db.deleted = ids;
          return Promise.resolve({ error: null });
        },
        select: () => Promise.resolve({ data: db.hidden, error: null }),
      };
      return chain;
    },
  },
}));

const { hideDemoBrandAfterPurchase } = await import('./hideAfterPurchase');

beforeEach(() => {
  db.hidden = [];
  db.calls = [];
  db.deleted = null;
});

describe('hideDemoBrandAfterPurchase', () => {
  it('hides the demo brand and deletes its chats', async () => {
    db.hidden = [{ id: 'demo-1' }];
    await hideDemoBrandAfterPurchase('org-1', 'active', 'test');
    expect(db.calls).toEqual(['update brands', 'delete chat_conversations']);
    expect(db.deleted).toEqual(['demo-1']);
  });

  it('touches nothing for a subscription that hasn’t started, and no chats when none was hidden', async () => {
    await hideDemoBrandAfterPurchase('org-1', 'incomplete', 'test');
    expect(db.calls).toEqual([]);

    // Already hidden (an admin showed it again, or it never was): no chats to take away.
    await hideDemoBrandAfterPurchase('org-1', 'active', 'test');
    expect(db.calls).toEqual(['update brands']);
    expect(db.deleted).toBeNull();
  });
});
