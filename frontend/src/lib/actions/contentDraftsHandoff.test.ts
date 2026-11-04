import { afterEach, describe, expect, it, vi } from 'vitest';

/** Hand off (CE-051): what the editor sends the API, and why it didn't run. */

const DRAFT = '77777777-7777-7777-7777-777777777777';
const BRAND = '33333333-3333-3333-3333-333333333333';

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  })),
}));

const { handOffDraft } = await import('./contentDrafts');

const answer = (body: unknown, status = 200) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const request = {
  items: [{ key: 'readability:longSentences', detail: '2 sentences over 35 words' }],
  textRules: [],
  locked: [],
  origin: 'person' as const,
};

afterEach(() => vi.unstubAllGlobals());

describe('handOffDraft', () => {
  it('sends the page’s checks to the API’s hand-off, and gives how many it left', async () => {
    const fetch = answer({ count: 4, batchId: 'b1' });
    await expect(handOffDraft(DRAFT, BRAND, request)).resolves.toEqual({ count: 4 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/api/content-drafts/${DRAFT}/handoff$`));
    expect(JSON.parse(init.body as string)).toEqual({
      brandId: BRAND,
      items: request.items,
      textRules: [],
      locked: [],
      origin: 'person',
    });
  });

  it('says why it didn’t run, and an answer lost on the way as unconfirmed', async () => {
    for (const code of ['not_due', 'already', 'running', 'off', 'open_suggestions', 'ai_budget']) {
      answer({ code }, 409);
      await expect(handOffDraft(DRAFT, BRAND, request)).resolves.toEqual({ error: code });
    }
    answer({ code: 'something_new' }, 409);
    await expect(handOffDraft(DRAFT, BRAND, request)).resolves.toEqual({ error: 'failed' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>timeout</html>', { status: 504 })),
    );
    await expect(handOffDraft(DRAFT, BRAND, request)).resolves.toEqual({ error: 'unconfirmed' });
  });
});
