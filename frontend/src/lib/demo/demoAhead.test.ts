import { describe, expect, it } from 'vitest';
import { wantsDemoAhead } from './demoAhead';

/**
 * Onboarding builds the demo brand ahead for a new workspace's admin, so
 * "Explore the demo" on the plan step opens at once.
 */

type Answer = { data: unknown; error: { message: string } | null };

function client(answers: { profiles: Answer; organizations: Answer; brands: Answer }) {
  const asked: { table: string; filters: [string, unknown][] }[] = [];
  return {
    asked,
    from(table: keyof typeof answers) {
      const query = { table, filters: [] as [string, unknown][] };
      asked.push(query);
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => (query.filters.push([column, value]), chain),
        limit: () => Promise.resolve(answers[table]),
        maybeSingle: () => Promise.resolve(answers[table]),
      };
      return chain;
    },
  };
}

const ok = (data: unknown): Answer => ({ data, error: null });
const args = { organizationId: 'org1', userId: 'user1' };

describe('wantsDemoAhead', () => {
  it("builds it for a new workspace's admin, without a plan or a demo brand", async () => {
    const supabase = client({
      profiles: ok({ role: 'admin' }),
      organizations: ok({ subscription_status: 'incomplete' }),
      brands: ok([]),
    });
    expect(await wantsDemoAhead(supabase as never, args)).toBe(true);
    expect(supabase.asked.find((q) => q.table === 'brands')?.filters).toEqual([
      ['organization_id', 'org1'],
      ['is_demo', true],
    ]);
  });

  it('leaves it to the plan step otherwise', async () => {
    const cases = [
      { profiles: ok({ role: 'manager' }) },
      { organizations: ok({ subscription_status: 'trialing' }) },
      { organizations: ok({ subscription_status: 'active' }) },
      { brands: ok([{ id: 'demo' }]) },
      { profiles: { data: null, error: { message: 'boom' } } },
      { organizations: ok(null) },
    ];
    for (const over of cases) {
      const supabase = client({
        profiles: ok({ role: 'admin' }),
        organizations: ok({ subscription_status: null }),
        brands: ok([]),
        ...over,
      });
      expect(await wantsDemoAhead(supabase as never, args)).toBe(false);
    }
  });
});
