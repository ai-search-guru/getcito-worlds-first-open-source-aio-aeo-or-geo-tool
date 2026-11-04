// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/mcp/mentions/{id}/sentiment-override (MS-13): the body is
 * checked here, and the database's refusals come back as HTTP statuses.
 */

const { overrideMentionSentimentFor } = vi.hoisted(() => ({
  overrideMentionSentimentFor: vi.fn(),
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
// The real filters and checks; only the database read is replaced.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/mcp/mentions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/mentions')>()),
  overrideMentionSentimentFor,
}));

const { POST } = await import('./route');

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/mcp/mentions/r1/sentiment-override', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'r1' }) },
  );

beforeEach(() => overrideMentionSentimentFor.mockReset());

describe('POST /api/mcp/mentions/{id}/sentiment-override', () => {
  it("corrects the answer as the key's owner", async () => {
    overrideMentionSentimentFor.mockResolvedValue({
      changed: true,
      previous: 'negative',
      sentiment: 'neutral',
      override: null,
    });
    const res = await post({ sentiment: 'neutral', note: 'Comparison' });
    expect(res.status).toBe(200);
    expect(overrideMentionSentimentFor).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      'r1',
      'neutral',
      'Comparison',
    );
    expect(await res.json()).toMatchObject({ changed: true, sentiment: 'neutral' });
  });

  it('refuses a body without a sentiment, or with a note that is not text', async () => {
    expect((await post('not json')).status).toBe(400);
    expect((await post({ sentiment: 'great' })).status).toBe(400);
    expect((await post({ sentiment: 'neutral', note: 5 })).status).toBe(400);
    expect(overrideMentionSentimentFor).not.toHaveBeenCalled();
  });

  it("returns the database's refusals as 403, 400 and 404", async () => {
    for (const [error, status] of [
      ['forbidden', 403],
      ['invalid', 400],
      ['missing', 404],
    ] as const) {
      overrideMentionSentimentFor.mockResolvedValueOnce({ error, message: `${error}!` });
      const res = await post({ sentiment: 'neutral' });
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: `${error}!` });
    }
  });
});
