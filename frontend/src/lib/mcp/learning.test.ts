import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * get_action_scorecard (learning B3): what each kind of action did at the
 * brand, as the History tab's scorecard reads it — its own actions only, a
 * success rate only from three verdicts, the median change in percent and
 * the reason it is most often dismissed for.
 */

let brandFound = true;
let rpcRows: unknown[] = [];
let rpcError: { message: string } | null = null;
const rpcCalls: [string, Record<string, unknown>][] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: brandFound ? { id: 'brand-1' } : null, error: null }),
      };
      return chain;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push([fn, args]);
      return { data: rpcError ? null : rpcRows, error: rpcError };
    },
  },
}));

const { getActionScorecardFor } = await import('./learning');
const { createMcpServer } = await import('./server');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const rpcRow = (over: Record<string, unknown>) => ({
  kind: 'content_opportunity',
  completed: 0,
  improved: 0,
  mixed: 0,
  no_change: 0,
  declined: 0,
  not_measurable: 0,
  pending: 0,
  final: 0,
  median_change: null,
  dismissed: 0,
  dismiss_reasons: {},
  ...over,
});

beforeEach(() => {
  brandFound = true;
  rpcRows = [];
  rpcError = null;
  rpcCalls.length = 0;
});

describe('getActionScorecardFor', () => {
  it("reads the brand's scorecard by kind, busiest first", async () => {
    rpcRows = [
      rpcRow({ kind: 'citation_gap', completed: 1, improved: 1 }),
      rpcRow({
        completed: 5,
        improved: 3,
        mixed: 1,
        no_change: 1,
        final: 4,
        median_change: '0.1525',
        dismissed: 3,
        dismiss_reasons: { not_relevant: 1, already_done: 2 },
      }),
    ];
    const scorecard = await getActionScorecardFor(auth, {
      brandId: 'brand-1',
      since: '2026-09-01T00:00:00Z',
    });
    expect(rpcCalls).toEqual([
      ['action_scorecard', { p_brand_id: 'brand-1', p_since: '2026-09-01T00:00:00.000Z' }],
    ]);
    expect(scorecard).toEqual([
      {
        kind: 'content_opportunity',
        completed: 5,
        improved: 3,
        mixed: 1,
        no_change: 1,
        declined: 0,
        not_measurable: 0,
        pending: 0,
        final: 4,
        success_rate: 60,
        median_change_percent: 15.3,
        dismissed: 3,
        dismiss_reasons: { not_relevant: 1, already_done: 2 },
        top_dismiss_reason: 'already_done',
      },
      expect.objectContaining({
        kind: 'citation_gap',
        // One verdict is too few to say.
        success_rate: null,
        median_change_percent: null,
        top_dismiss_reason: null,
      }),
    ]);
  });

  it('passes the start to the database as an ISO timestamp, whatever form it came in', async () => {
    await getActionScorecardFor(auth, { brandId: 'brand-1', since: '1' });
    expect(rpcCalls[0][1]).toEqual({
      p_brand_id: 'brand-1',
      p_since: new Date('1').toISOString(),
    });
  });

  it('reads every action without a start', async () => {
    await getActionScorecardFor(auth, { brandId: 'brand-1' });
    expect(rpcCalls[0][1]).toEqual({ p_brand_id: 'brand-1', p_since: null });
  });

  it("answers null for another organization's brand, without reading it", async () => {
    brandFound = false;
    expect(await getActionScorecardFor(auth, { brandId: 'brand-2' })).toBeNull();
    expect(rpcCalls).toEqual([]);
  });

  it('fails when the scorecard cannot be read', async () => {
    rpcError = { message: 'statement timeout' };
    await expect(getActionScorecardFor(auth, { brandId: 'brand-1' })).rejects.toThrow(
      'statement timeout',
    );
  });
});

describe('the get_action_scorecard tool', () => {
  it('lists as a read-only tool with a title', async () => {
    const server = createMcpServer(auth);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'get_action_scorecard');
    expect(tool?.title).toBe('What worked, by kind of action');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });
});
