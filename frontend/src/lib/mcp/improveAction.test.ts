import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * create_improve_action is the MCP way to send Improve suggestions to Action
 * Center. These pin what the web layer owns: a prompt outside the caller's org
 * never reaches the server, the send goes out as the API key's user with the
 * range and suggestions the server expects, and a server refusal (plan, no
 * set for the range) reaches the agent in the server's words.
 */

let promptOwned = true;
const filters: Array<[string, unknown]> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        maybeSingle: async () => ({ data: promptOwned ? { id: 'p1' } : null, error: null }),
      };
      return chain;
    },
  },
}));

const { createImproveActionFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const input = {
  promptId: 'p1',
  range: {
    preset: '7d' as const,
    from: '2026-10-06T00:00:00.000Z',
    to: '2026-10-13T00:00:00.000Z',
  },
  idempotencyKey: 'mcp-key-0001',
  suggestions: [
    {
      id: 's1',
      platform: 'perplexity-web',
      title: 'Publish a comparison page',
      sources: [{ type: 'domain' as const, ref: 'example.com' }],
    },
  ],
};

const fetchMock = vi.fn();

describe('createImproveActionFor', () => {
  beforeEach(() => {
    promptOwned = true;
    filters.length = 0;
    vi.stubEnv('CRON_SECRET', 'secret');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns null without calling the server for a prompt outside the caller org', async () => {
    promptOwned = false;
    expect(await createImproveActionFor(auth, input)).toBeNull();
    expect(filters).toContainEqual(['prompt_sets.brands.organization_id', 'org-1']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for a key without an organization', async () => {
    expect(await createImproveActionFor({ ...auth, organizationId: null }, input)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the range and suggestions to the internal endpoint as the key user', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          actionId: 'a1',
          actionNo: 7,
          created: true,
          taskCount: 1,
          sent: { latest: null, sentSuggestionIds: ['s1'] },
        }),
        { status: 200 },
      ),
    );

    const result = await createImproveActionFor(auth, input);

    expect(result).toEqual({ actionId: 'a1', actionNo: 7, created: true, taskCount: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/internal\/prompts\/p1\/improve\/action$/);
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body)).toEqual({
      userId: 'user-1',
      preset: '7d',
      from: '2026-10-06T00:00:00.000Z',
      to: '2026-10-13T00:00:00.000Z',
      region: '',
      idempotencyKey: 'mcp-key-0001',
      suggestions: input.suggestions,
    });
  });

  it("relays the server's refusal message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, message: 'Generate suggestions for this range first' }),
        { status: 404 },
      ),
    );

    await expect(createImproveActionFor(auth, input)).rejects.toThrow(
      'Generate suggestions for this range first',
    );
  });

  it('refuses to run without CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', '');
    await expect(createImproveActionFor(auth, input)).rejects.toThrow(/CRON_SECRET/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
