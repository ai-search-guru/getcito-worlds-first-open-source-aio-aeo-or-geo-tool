import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The brand's webhook keeps the events it is subscribed to: Content page
 * sent (#1331) among them, anything else left out. Test Webhook is the
 * brand's, and says why the API refused it (#1568 review).
 */

let upserts: unknown[];
let session: { access_token: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    from: () => {
      let value: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        upsert: (v: Record<string, unknown>) => ((value = v), upserts.push(v), chain),
        select: () => chain,
        single: async () => ({ data: { id: 'w1', ...value }, error: null }),
      };
      return chain;
    },
  })),
}));

const { saveWebhookConfig, testWebhook } = await import('./content');

const fetchMock = vi.fn();

beforeEach(() => {
  upserts = [];
  session = { access_token: 'tok' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('saveWebhookConfig', () => {
  it('keeps Content page sent and leaves out what no webhook sends', async () => {
    const saved = await saveWebhookConfig('brand-1', {
      webhookUrl: 'https://hooks.example/abc',
      events: ['content_draft.sent', 'opportunity.sent', 'content_draft.sent', 'page.deleted'],
    });
    expect(upserts).toEqual([
      expect.objectContaining({ events: ['content_draft.sent', 'opportunity.sent'] }),
    ]);
    expect(saved.events).toEqual(['content_draft.sent', 'opportunity.sent']);
  });

  it('needs one event it sends', async () => {
    await expect(
      saveWebhookConfig('brand-1', { webhookUrl: 'https://hooks.example/abc', events: ['x'] }),
    ).rejects.toThrow('Select at least one webhook event.');
    expect(upserts).toEqual([]);
  });
});

describe('testWebhook', () => {
  it('tests the address for the brand, with the session, and hands back the answer', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        success: false,
        status: 307,
        statusText: 'Temporary Redirect',
        location: 'https://hooks.example/v2',
      }),
    );
    await expect(testWebhook('brand-1', 'https://hooks.example/abc', 'shh')).resolves.toEqual({
      success: false,
      status: 307,
      statusText: 'Temporary Redirect',
      location: 'https://hooks.example/v2',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/content\/webhook-test$/);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({
      brandId: 'brand-1',
      webhookUrl: 'https://hooks.example/abc',
      webhookSecret: 'shh',
    });
  });

  it.each([
    [
      'a member',
      403,
      { error: 'Only admins and managers can test the webhook.', code: 'forbidden' },
      'forbidden',
    ],
    [
      'another workspace’s brand',
      403,
      { error: "This brand isn't in your workspace", code: 'not_in_workspace' },
      'workspace',
    ],
    [
      'too many tests',
      429,
      { success: false, message: 'Too many requests, please try again later.' },
      'busy',
    ],
    ['an expired session', 401, { error: 'Invalid token' }, 'session'],
    ['a bad request', 400, { error: 'Invalid request' }, 'failed'],
  ])(
    'says why the API refused it for %s, without throwing',
    async (_who, status, body, failure) => {
      fetchMock.mockResolvedValue(answer(status, body));
      await expect(testWebhook('brand-1', 'https://hooks.example/abc')).resolves.toEqual({
        success: false,
        status: 0,
        failure,
      });
    },
  );

  it('asks to sign in again without a session, calling nothing', async () => {
    session = null;
    await expect(testWebhook('brand-1', 'https://hooks.example/abc')).resolves.toEqual({
      success: false,
      status: 0,
      failure: 'session',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
