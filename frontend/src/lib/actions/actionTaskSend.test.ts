import { afterEach, describe, expect, it, vi } from 'vitest';

let configs: { id: string; events?: string[] }[] = [];
let filters: [string, unknown][] = [];
let selected = '';
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
    from: () => {
      const chain = {
        select: (columns: string) => ((selected = columns), chain),
        eq: (column: string, value: unknown) => (filters.push([column, value]), chain),
        limit: async () => ({ data: configs, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'https://api.example' }));

const { hasActiveWebhook, sendActionTask } = await import('./actionTaskSend');

afterEach(() => {
  vi.unstubAllGlobals();
  configs = [];
  filters = [];
});

describe('hasActiveWebhook', () => {
  it('asks only whether an active one exists, never for its secret', async () => {
    configs = [{ id: 'w1', events: ['action_task.sent'] }];
    expect(await hasActiveWebhook('b1')).toBe(true);
    expect(selected).toBe('id, events');
    expect(filters).toEqual([
      ['brand_id', 'b1'],
      ['is_active', true],
    ]);
    configs = [{ id: 'w1', events: ['opportunity.sent'] }];
    expect(await hasActiveWebhook('b1')).toBe(false);
    configs = [];
    expect(await hasActiveWebhook('b1')).toBe(false);
  });
});

describe('sendActionTask', () => {
  it('posts where to send it and the text the drawer shows', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ opportunityId: 'o1', created: true })),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await sendActionTask('t1', 'content', 'Add a table to /pricing')).toEqual({
      to: 'content',
      opportunityId: 'o1',
      created: true,
      merged: false,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/api/action-center/tasks/t1/send');
    expect(JSON.parse(String(init.body))).toEqual({
      to: 'content',
      title: 'Add a table to /pricing',
    });
  });

  it('says when the task joined the open opportunity on its question', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ opportunityId: 'o9', created: false, merged: true })),
      ),
    );
    expect(await sendActionTask('t1', 'content', 'x')).toEqual({
      to: 'content',
      opportunityId: 'o9',
      created: false,
      merged: true,
    });
  });

  it("returns the server's reason as a code", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'No webhook', code: 'no_webhook' }), {
            status: 409,
          }),
      ),
    );
    expect(await sendActionTask('t1', 'webhook', 'x')).toEqual({
      error: 'server',
      code: 'no_webhook',
      message: 'No webhook',
    });
  });
});
