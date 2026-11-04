// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Product Visibility over MCP (B6b), through the MCP client and the page's
 * own loaders: they run with the service role, which skips RLS, so each read
 * must keep to the brand by itself. The member's (RLS) client is never asked
 * for inside an MCP call, and every table read and RPC names the brand.
 */

const BRAND = '11111111-1111-1111-1111-111111111111';
const PRODUCT = '22222222-2222-2222-2222-222222222222';
const ORG = 'org-1';

/** One table read or RPC the service role was asked for: its builder calls, or its arguments. */
interface Read {
  table: string;
  calls: [string, ...unknown[]][];
  args?: Record<string, unknown>;
}

const db = vi.hoisted(() => ({
  reads: [] as Read[],
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpcs: {} as Record<string, unknown>,
}));

// The service role: any PostgREST chain, answered from `db`, rows kept by their `eq` filters.
vi.mock('@/lib/supabase/admin', () => {
  const builder = (read: Read, answer: () => unknown) => {
    const rows = () => {
      const data = answer();
      if (!Array.isArray(data)) return data;
      return data.filter((row: Record<string, unknown>) =>
        read.calls.every(
          ([method, column, value]) =>
            method !== 'eq' || !(String(column) in row) || row[String(column)] === value,
        ),
      );
    };
    const chain: unknown = new Proxy(
      {},
      {
        get(_, prop) {
          if (typeof prop === 'symbol') return undefined;
          if (prop === 'then') {
            return (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) => {
              const data = rows();
              const count = Array.isArray(data) ? data.length : null;
              return Promise.resolve({ data, error: null, count }).then(resolve, reject);
            };
          }
          if (prop === 'maybeSingle' || prop === 'single') {
            return async () => {
              const data = rows();
              return { data: Array.isArray(data) ? (data[0] ?? null) : data, error: null };
            };
          }
          return (...args: unknown[]) => {
            read.calls.push([prop, ...args]);
            return chain;
          };
        },
      },
    );
    return chain;
  };
  return {
    supabaseAdmin: {
      from: (table: string) => {
        const read: Read = { table, calls: [] };
        db.reads.push(read);
        return builder(read, () => db.tables[table] ?? []);
      },
      rpc: (name: string, args: Record<string, unknown>) => {
        const read: Read = { table: `rpc:${name}`, calls: [], args };
        db.reads.push(read);
        return builder(read, () => db.rpcs[name] ?? []);
      },
    },
  };
});

// The member's client: asked for inside an MCP call, it fails the read.
const createClient = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('the RLS client inside an MCP call');
  }),
);
vi.mock('@/lib/supabase/server', () => ({ createClient }));

const { createMcpServer } = await import('./server');
const { SHOPPING_NOT_IN_PLAN } = await import('./data');

/** A client talking to a server built for one request, as the MCP route builds it. */
async function connect(organizationId = ORG) {
  const server = createMcpServer({
    userId: 'user-1',
    email: null,
    organizationId,
    apiKeyId: 'k',
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

/** Every read keeps to the brand: its brand_id, the brand's own row, or the key's organization. */
const scoped = (read: Read) =>
  read.args
    ? read.args.p_brand_id === BRAND
    : read.calls.some(
        ([method, column, value]) =>
          method === 'eq' &&
          (read.table === 'organizations'
            ? column === 'id' && value === ORG
            : value === BRAND &&
              (column === 'brand_id' ||
                column === 'prompt_sets.brand_id' ||
                (read.table === 'brands' && column === 'id'))),
      );

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  createClient.mockClear();
  db.reads.length = 0;
  const now = new Date().toISOString();
  db.tables = {
    organizations: [
      { id: ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
    ],
    brands: [{ id: BRAND, organization_id: ORG, openai_product_feed: false }],
    brand_domains: [{ brand_id: BRAND, country: 'US' }],
    prompts: [{ id: 'q1', regions: ['US-CA'] }],
    catalog_products: [
      {
        id: PRODUCT,
        brand_id: BRAND,
        title: 'Ridge Trail 2',
        url: 'https://shop.example/ridge',
        product_type: 'Trail running shoes',
        product_brand: 'Acme',
        description: null,
      },
    ],
    prompt_result_shopping_cards: [
      {
        id: 'c1',
        brand_id: BRAND,
        prompt_result_id: 'r1',
        position: 0,
        created_at: now,
        platform: 'chatgpt-shopping',
        region: 'US',
        product_title: 'Ridge Trail 2',
        product_brand: 'Acme',
        price_amount: 120,
        price_currency: 'USD',
        matched_brand_role: 'own',
        merchant_kind: 'own',
        catalog_product_id: PRODUCT,
        prompt_results: { prompt_id: 'q1', prompt: { id: 'q1', text: 'best trail shoes' } },
      },
    ],
    prompt_results: [
      {
        id: 'r1',
        brand_id: BRAND,
        platform: 'chatgpt-shopping',
        created_at: now,
        response: 'The Ridge Trail 2 grips well on wet rock.',
        prompt: { text: 'best trail shoes' },
      },
    ],
  };
  db.rpcs = {
    shopping_filter_options: [{ platforms: ['chatgpt-shopping'], regions: ['US'] }],
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Product Visibility over MCP, with the service role', () => {
  it('reads the page’s loaders without the member’s client, every read naming the brand', async () => {
    const error = vi.spyOn(console, 'error');
    const client = await connect();
    const shelf = await client.callTool({
      name: 'get_shopping_shelf',
      arguments: { brand_id: BRAND },
    });
    const readiness = await client.callTool({
      name: 'get_shopping_readiness',
      arguments: { brand_id: BRAND },
    });
    const says = await client.callTool({
      name: 'get_product_ai_says',
      arguments: { brand_id: BRAND, product_id: PRODUCT },
    });
    for (const result of [shelf, readiness, says]) expect(result.isError, text(result)).toBeFalsy();

    // Readiness logs and leaves out a read that fails: none did.
    expect(JSON.parse(text(readiness))).toMatchObject({ unread: [] });
    expect(error).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(JSON.parse(text(shelf)).shelves[0]).toMatchObject({ own_rank: 1, products_total: 1 });
    expect(JSON.parse(text(says))).toMatchObject({ answers: 1 });

    expect(db.reads.filter((read) => !scoped(read))).toEqual([]);
    // What the page reads, read here too.
    expect(new Set(db.reads.map((read) => read.table))).toEqual(
      new Set([
        'brands',
        'organizations',
        'brand_domains',
        'prompts',
        'prompt_result_shopping_cards',
        'catalog_products',
        'catalog_variants',
        'catalog_images',
        'catalog_product_categories',
        'catalog_sources',
        'prompt_results',
        'prompt_result_citations',
        'rpc:catalog_product_ai_stats',
        'rpc:shopping_merchant_split',
        'rpc:shopping_own_product_offers',
        'rpc:shopping_amazon_share_weekly',
        'rpc:shopping_filter_options',
      ]),
    );
  });

  it('answers a plan without Product Visibility as an error, before reading the brand’s data', async () => {
    db.tables.organizations[0].plan = 'starter';
    const client = await connect();
    for (const [name, args] of [
      ['get_shopping_shelf', { brand_id: BRAND }],
      ['get_shopping_readiness', { brand_id: BRAND }],
      ['get_product_ai_says', { brand_id: BRAND, product_id: PRODUCT }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBe(true);
      // The answer list_shopping_cards and get_product_visibility give.
      expect(JSON.parse(text(result)), name).toEqual(SHOPPING_NOT_IN_PLAN);
      expect(JSON.parse(text(result)).error, name).toBe('plan_limit');
    }
    expect(new Set(db.reads.map((read) => read.table))).toEqual(
      new Set(['brands', 'organizations']),
    );
  });

  it("answers another organization's brand, and a product not the brand's, as not found", async () => {
    const other = await connect('org-2');
    const shelf = await other.callTool({
      name: 'get_shopping_shelf',
      arguments: { brand_id: BRAND },
    });
    expect(shelf.isError).toBe(true);
    expect(text(shelf)).toBe('Brand not found');

    db.tables.catalog_products[0].brand_id = 'another-brand';
    const client = await connect();
    const says = await client.callTool({
      name: 'get_product_ai_says',
      arguments: { brand_id: BRAND, product_id: PRODUCT },
    });
    expect(says.isError).toBe(true);
    expect(text(says)).toBe('Brand or product not found');
    expect(db.reads.map((read) => read.table)).not.toContain('prompt_result_shopping_cards');
  });
});
