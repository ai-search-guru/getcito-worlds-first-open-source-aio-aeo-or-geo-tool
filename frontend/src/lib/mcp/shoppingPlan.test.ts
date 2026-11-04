// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Shopping analytics is a Growth feature: over an API key, list_shopping_cards,
 * get_product_visibility and their REST routes (/api/v1/shopping-cards too)
 * answer plan_limit on Starter, as the Shopping page shows it locked, without
 * reading a card. A plan that has ended keeps reading what it had; self-hosted
 * has no gate.
 */

/** The organization's row, as the plan is read from it. */
let org: { plan: string; subscription_status: string; plan_overrides: null } | null;
/** The tables read, in order. */
const reads: string[] = [];

const CARD = {
  id: 'card-1',
  brand_id: 'b1',
  product_title: 'Trail Pack 30',
  platform: 'chatgpt-shopping',
  region: 'US',
  created_at: '2026-10-28T10:00:00Z',
  rating: 4.5,
  review_count: 120,
  merchant_domain: 'shop.example',
};

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      reads.push(table);
      const answer = () => ({
        data: table === 'organizations' ? org : table === 'brands' ? { id: 'b1' } : [CARD],
        error: null,
      });
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => answer(),
        then: (resolve: (value: unknown) => void) => resolve(answer()),
      };
      return chain;
    },
  },
}));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));

const { createMcpServer } = await import('./server');
const { GET: listCardsRoute } = await import('@/app/api/v1/shopping-cards/route');
const { GET: productRoute } = await import('@/app/api/mcp/product-visibility/route');

const BRAND = '11111111-2222-3333-4444-555555555555';

async function connect() {
  const server = createMcpServer({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
    role: 'admin',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { text: string }[])[0].text;

/** Both shopping tools, called for the brand. */
async function callBoth(client: Client) {
  return Promise.all([
    client.callTool({ name: 'list_shopping_cards', arguments: { brand_id: BRAND } }),
    client.callTool({
      name: 'get_product_visibility',
      arguments: { brand_id: BRAND, product_title: 'Trail Pack 30' },
    }),
  ]);
}

const onPlan = (plan: string, subscription_status = 'active') => {
  org = { plan, subscription_status, plan_overrides: null };
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  reads.length = 0;
  onPlan('growth');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the shopping tools by plan', () => {
  it('answer plan_limit on Starter, without reading a card', async () => {
    onPlan('starter');
    const results = await callBoth(await connect());
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(JSON.parse(text(result))).toEqual({
        error: 'plan_limit',
        message:
          "Shopping analytics comes with the Growth plan and above, and this workspace's plan doesn't include it. An admin can upgrade in Settings › Billing.",
      });
    }
    expect(reads).not.toContain('prompt_result_shopping_cards');
  });

  it('answer on Growth', async () => {
    const [cards, product] = await callBoth(await connect());
    expect(cards.isError).toBeFalsy();
    expect(JSON.parse(text(cards)).cards).toEqual([CARD]);
    expect(product.isError).toBeFalsy();
    expect(JSON.parse(text(product))).toMatchObject({ total_appearances: 1 });
  });

  it('keep reading a Growth plan that has ended, as the read-only dashboard does', async () => {
    onPlan('growth', 'canceled');
    const [cards] = await callBoth(await connect());
    expect(cards.isError).toBeFalsy();
  });

  it('read no plan self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    org = null;
    const [cards] = await callBoth(await connect());
    expect(cards.isError).toBeFalsy();
    expect(reads).not.toContain('organizations');
  });
});

describe('the shopping REST routes by plan', () => {
  const listCards = () =>
    listCardsRoute(new Request(`http://localhost/api/v1/shopping-cards?brand_id=${BRAND}`));
  const product = () =>
    productRoute(
      new Request(
        `http://localhost/api/mcp/product-visibility?brand_id=${BRAND}&product_title=Trail%20Pack%2030`,
      ),
    );

  it('answer 403 plan_limit on Starter', async () => {
    onPlan('starter');
    for (const res of [await listCards(), await product()]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'plan_limit' });
    }
  });

  it('answer on Growth', async () => {
    expect((await listCards()).status).toBe(200);
    expect((await product()).status).toBe(200);
  });
});
