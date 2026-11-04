// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/** open_page (CHAT-19 §2): a page the plan opens, its filters, and no AI usage. */

const tables = vi.hoisted(() => [] as string[]);
const org = vi.hoisted(() => ({ row: {} as unknown }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      tables.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: org.row, error: null }),
      };
      return chain;
    },
  },
}));

const { openPageFor } = await import('./navigation');
const { routeRequest } = await import('@/lib/chat/routes');
const { NAVIGATION_READS } = await import('@/lib/chat/registry/navigation');

const auth: McpAuthContext = {
  userId: 'u1',
  email: null,
  organizationId: 'org-1',
  role: 'analyst',
  apiKeyId: 'agent-internal',
  brandAccess: 'all',
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  tables.length = 0;
  org.row = { plan: 'growth', subscription_status: 'active', plan_overrides: null };
});
afterEach(() => vi.unstubAllEnvs());

describe('openPageFor', () => {
  it('opens a page with the filters it keeps, reading only the plan: no AI usage', async () => {
    expect(
      await openPageFor(auth, { route: 'citations', range: '30d', platform: 'perplexity-web' }),
    ).toEqual({
      found: true,
      title: 'Citations',
      section: null,
      locked: false,
      href: '/dashboard/citations?preset=30d&platform=perplexity-web',
      filters: [
        { key: 'range', value: '30d' },
        { key: 'platform', value: 'perplexity-web' },
      ],
      navigation_only: true,
    });
    expect(tables).toEqual(['organizations']);
  });

  it("leaves out a platform the plan doesn't read, and says so", async () => {
    org.row = { plan: 'starter', subscription_status: 'active', plan_overrides: null };
    expect(
      await openPageFor(auth, { route: 'citations', platform: 'perplexity-web' }),
    ).toMatchObject({
      href: '/dashboard/citations',
      filters: [],
      platform_not_in_plan: 'perplexity-web',
    });
  });

  it("doesn't open a page the plan doesn't include, and names the plan that does", async () => {
    org.row = { plan: 'starter', subscription_status: 'active', plan_overrides: null };
    const shopping = await openPageFor(auth, { route: 'shopping' });
    expect(shopping).toMatchObject({ found: true, locked: true, needs: 'growth' });
    expect(shopping).not.toHaveProperty('href');
  });

  it('locks a page the router found when the plan lacks it', async () => {
    org.row = { plan: 'starter', subscription_status: 'active', plan_overrides: null };
    const routed = routeRequest('Open Product Visibility');
    expect(routed?.route.id).toBe('shopping');
    expect(await openPageFor(auth, { route: routed!.route.id })).toMatchObject({
      locked: true,
      needs: 'growth',
    });
  });

  it('takes only known platform ids, and opens no address it is given', async () => {
    const schema = NAVIGATION_READS[0].inputSchema;
    expect(schema.safeParse({ route: 'insights', platform: 'perplexity-web' }).success).toBe(true);
    expect(schema.safeParse({ route: 'insights', platform: 'perplexity' }).success).toBe(false);
    for (const route of ['//evil.com', 'https://evil.com', 'javascript:alert(1)']) {
      expect(await openPageFor(auth, { route })).toEqual({ found: false });
    }
  });

  it('says when there is no such page, and reads nothing without an organization', async () => {
    expect(await openPageFor(auth, { route: 'nowhere' })).toEqual({ found: false });
    expect(await openPageFor({ ...auth, organizationId: null }, { route: 'insights' })).toBeNull();
  });
});
