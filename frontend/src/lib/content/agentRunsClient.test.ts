import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAgentRun, readAutoHandOff, stopAgentRun } from './agentRunsClient';

/**
 * The Content Agent's run, read and stopped from the browser (CE-027/035):
 * the draft's latest run through RLS, and Stop through the API's proxy.
 */

let row: { data: Record<string, unknown> | null; error: Error | null };
let rows: { data: Record<string, unknown>[] | null; error: Error | null };
let filters: [string, string][];
let brand: { data: Record<string, unknown> | null; error: Error | null };
let session: { access_token: string } | null;
const query = { draft: '', order: '', limit: 0 };
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    from: (table: string) => {
      if (table === 'brands') {
        const brandChain = {
          select: () => brandChain,
          eq: (col: string, value: string) => (filters.push([`brands.${col}`, value]), brandChain),
          maybeSingle: async () => brand,
        };
        return brandChain;
      }
      expect(table).toBe('content_agent_runs');
      const chain = {
        select: () => chain,
        eq: (col: string, value: string) => (
          filters.push([col, value]),
          (query.draft = value),
          chain
        ),
        order: (col: string) => ((query.order = col), chain),
        limit: (n: number) => ((query.limit = n), chain),
        maybeSingle: async () => row,
        then: (resolve: (value: typeof rows) => void) => resolve(rows),
      };
      return chain;
    },
  }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  row = { data: null, error: null };
  rows = { data: [], error: null };
  brand = { data: { content_quality_handoff: true }, error: null };
  filters = [];
  query.draft = '';
  session = { access_token: 'token-1' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('readAutoHandOff (Quality CE-051)', () => {
  it('says whether the automatic hand-off is behind the draft, null when that can’t be read', async () => {
    expect(await readAutoHandOff('d1', 'b1')).toBe(false);
    expect(filters).toEqual([
      ['draft_id', 'd1'],
      ['kind', 'handoff'],
      ['origin', 'auto'],
      ['brands.id', 'b1'],
    ]);
    // It had it.
    rows = { data: [{ id: 'r1' }], error: null };
    expect(await readAutoHandOff('d1', 'b1')).toBe(true);
    // Its brand stopped handing off since the draft was made.
    rows = { data: [], error: null };
    brand = { data: { content_quality_handoff: false }, error: null };
    expect(await readAutoHandOff('d1', 'b1')).toBe(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rows = { data: null, error: new Error('down') };
    expect(await readAutoHandOff('d1', 'b1')).toBeNull();
    rows = { data: [], error: null };
    brand = { data: null, error: new Error('down') };
    expect(await readAutoHandOff('d1', 'b1')).toBeNull();
    vi.mocked(console.error).mockRestore();
  });
});

describe('readAgentRun', () => {
  it('reads the draft’s latest run', async () => {
    row.data = {
      id: 'r1',
      kind: 'fix',
      steps: [{ key: 'read_rules', count: 4 }],
      step: 0,
      started_at: '2026-10-23T10:00:00Z',
      finished_at: null,
      stopped_at: null,
      outcome: null,
    };
    expect(await readAgentRun('d1')).toMatchObject({
      id: 'r1',
      kind: 'fix',
      steps: [{ key: 'read_rules', count: 4 }],
      startedAt: '2026-10-23T10:00:00Z',
    });
    expect(query).toEqual({ draft: 'd1', order: 'started_at', limit: 1 });
  });

  it('is null when it can’t be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    row = { data: null, error: new Error('down') };
    expect(await readAgentRun('d1')).toBeNull();
  });
});

describe('stopAgentRun', () => {
  it('asks the API to stop the draft’s run, signed in', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ stopped: true })));
    expect(await stopAgentRun('d1', 'b1')).toEqual({ stopped: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/aeo/api/content-drafts/d1/stop');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(JSON.parse(init.body)).toEqual({ brandId: 'b1' });
    // The run the editor shows, when it names it: another tab's goes on.
    await stopAgentRun('d1', 'b1', 'r9');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ brandId: 'b1', runId: 'r9' });
  });

  it('says when no run was under way', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ stopped: false })));
    expect(await stopAgentRun('d1', 'b1')).toEqual({ stopped: false });
  });

  it('fails without a session, on an error answer, or when the request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    session = null;
    expect(await stopAgentRun('d1', 'b1')).toEqual({ error: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();

    session = { access_token: 'token-1' };
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    expect(await stopAgentRun('d1', 'b1')).toEqual({ error: 'failed' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await stopAgentRun('d1', 'b1')).toEqual({ error: 'failed' });
  });
});
